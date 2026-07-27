/**
 * wallet-app.js — Main wallet application logic.
 * 
 * Features:
 *   - Create new wallet (with password)
 *   - Import wallet from mnemonic (with password)
 *   - Unlock wallet with password
 *   - View balance (from public RPC)
 *   - Send transactions (build, sign, broadcast)
 *   - Multiple wallets, switch between them
 *   - Auto-lock after inactivity
 */

// Browser imports need full paths (bare specifiers don't work in browsers)
import * as secp from "./node_modules/@noble/secp256k1/index.js";
import { sha256, sha512 } from "./node_modules/@noble/hashes/sha2.js";
import { hmac } from "./node_modules/@noble/hashes/hmac.js";
import { bech32m } from "./lib/bech32-esm.js";
import "./lib/buffer-esm.js";
import * as store from "./wallet-store.js";
import * as api from "./mmx-node-api.js";
import { calcTxId, calcContentHash, signTx } from "./mmx-tx.js";
// Configure secp256k1
secp.hashes.sha256 = (data) => sha256(data);
secp.hashes.hmacSha256 = (key, data) => sha256(Buffer.concat([Buffer.from(key), Buffer.from(data)]));

// --- State ---
let unlockedSeed = null;     // Uint8Array, cleared on lock
let unlockedWallet = null;   // wallet metadata object
let autoLockTimer = null;
const AUTO_LOCK_MS = 5 * 60 * 1000; // 5 minutes

// --- Wordlist ---
let wordlist = null;
let wordMap = {};

async function loadWordlist() {
  if (wordlist) return;
  let resp;
  try { resp = await fetch("./wordlist.txt"); }
  catch { resp = await fetch("../wordlist.txt"); }
  if (!resp.ok) resp = await fetch("../wordlist.txt");
  wordlist = (await resp.text()).trim().split("\n");
  for (let i = 0; i < wordlist.length; i++) wordMap[wordlist[i]] = i;
}

// --- Crypto helpers ---

function hmacSha512(key, data) {
  return Buffer.from(hmac(sha512, Uint8Array.from(Buffer.from(key)), Uint8Array.from(Buffer.from(data))));
}
function hmacSha512N(seed, key, index) {
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32BE(index);
  return hmacSha512(Buffer.from(key), Buffer.concat([Buffer.from(seed), indexBuf]));
}
function kdfHmacSha512(seed, key, iters) {
  let tmp = hmacSha512(Buffer.from(key), Buffer.from(seed));
  for (let i = 1; i < iters; i++) tmp = hmacSha512(tmp, Buffer.from(seed));
  return { first: Buffer.from(tmp.subarray(0, 32)), second: Buffer.from(tmp.subarray(32, 64)) };
}

function deriveKeypair(seed, passphrase, acctIdx, addrIdx) {
  const passHash = Buffer.from(sha256(Buffer.from("MMX/seed/" + passphrase)));
  const master = kdfHmacSha512(seed, passHash, 4096);
  const chain = hmacSha512N(master.first, master.second, 11337);
  const cF = Buffer.from(chain.subarray(0, 32)), cS = Buffer.from(chain.subarray(32, 64));
  const account = hmacSha512N(cF, cS, acctIdx);
  const aF = Buffer.from(account.subarray(0, 32)), aS = Buffer.from(account.subarray(32, 64));
  const tmp = hmacSha512N(aF, aS, addrIdx);
  const skey = Buffer.from(tmp.subarray(0, 32));
  const pubkey = Buffer.from(secp.getPublicKey(skey));
  const addrHash = Buffer.from(sha256(pubkey));
  return { skey, pubkey, addrHash };
}

function hashToAddress(hash32LE) {
  // Use bech32m.toWords like the MMX explorer: encode('mmx', toWords(bytes.reverse()))
  // hash32LE is little-endian, reverse to big-endian for bech32m
  return bech32m.encode("mmx", bech32m.toWords(Array.from(Buffer.from(hash32LE).reverse())));
}

// --- Mnemonic ---

function seedToWords(seed) {
  const be = Buffer.from(seed).reverse();
  let bits = BigInt("0x" + be.toString("hex"));
  const checksum = sha256(be)[0];
  const words = [];
  for (let i = 0; i < 24; i++) {
    let index;
    if (i === 0) { index = ((bits & 0x7n) << 8n) | BigInt(checksum); bits >>= 3n; }
    else { index = bits & 0x7FFn; bits >>= 11n; }
    words.push(wordlist[Number(index)]);
  }
  words.reverse();
  return words;
}

function wordsToSeed(words) {
  let seed = 0n;
  for (let i = 0; i < 24; i++) {
    const index = wordMap[words[i]];
    if (index === undefined) throw new Error("Invalid word: " + words[i]);
    if (i < 23) { seed <<= 11n; seed |= BigInt(index); }
    else { seed <<= 3n; seed |= BigInt(index >> 8); }
  }
  const hex = seed.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex").reverse();
}

// --- Auto-lock ---

function resetAutoLock() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (unlockedSeed) {
    autoLockTimer = setTimeout(() => {
      lockWallet();
    }, AUTO_LOCK_MS);
  }
}

function lockWallet() {
  if (unlockedSeed && unlockedSeed.fill) unlockedSeed.fill(0);
  unlockedSeed = null;
  unlockedWallet = null;
  if (autoLockTimer) { clearTimeout(autoLockTimer); autoLockTimer = null; }
  // Notify UI via callback if set (extension/web page handle their own view switching)
  if (onLockCallback) onLockCallback();
}

// --- Transaction building ---

function uint128LE(val) {
  const v = BigInt(val);
  const arr = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) arr[i] = Number((v >> BigInt(i * 8)) & 0xFFn);
  return arr;
}

// Format raw satoshi amount to human-readable string based on decimals
function formatAmount(raw, decimals) {
  const sat = BigInt(raw);
  const div = BigInt(10) ** BigInt(decimals);
  const whole = sat / div;
  const frac = sat % div;
  if (decimals === 0) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export async function sendTransaction(toAddress, amountSat, currencyContract) {
  if (!unlockedSeed) throw new Error("Wallet is locked");

  // Derive keys from unlocked seed
  const { skey, pubkey, addrHash } = deriveKeypair(unlockedSeed, "", 0, 0);
  const fromAddrBytes = Array.from(addrHash);

  // Parse destination address to bytes (using bech32m.fromWords like the MMX explorer)
  const { words: dstWords } = bech32m.decode(toAddress);
  const dstBytesBE = bech32m.fromWords(dstWords);
  const dstBytes = Array.from(Buffer.from(dstBytesBE).reverse()); // BE → LE

  // Parse currency contract address (MMX native = all zeros)
  let contractBytes = new Array(32).fill(0);
  if (currencyContract && currencyContract !== "mmx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdgytev") {
    const { words: cw } = bech32m.decode(currencyContract);
    const cBytesBE = bech32m.fromWords(cw);
    contractBytes = Array.from(Buffer.from(cBytesBE).reverse());
  }

  // Get height for expires
  const height = await api.getHeight();
  const expires = height + 100;

  // Cost: min_txfee(20000) + 1 input(10000) + 1 output(10000) + 1 solution(10000) = 50000
  const staticCost = 50000;

  // 64-bit random nonce (crypto.getRandomValues, not Math.random)
  const nonceBytes = crypto.getRandomValues(new Uint8Array(8));
  let nonce = 0n;
  for (let i = 0; i < 8; i++) nonce |= BigInt(nonceBytes[i]) << BigInt(i * 8);
  // Ensure non-zero (node requires nonce != 0)
  if (nonce === 0n) nonce = 1n;

  const tx = {
    version: 0,
    expires,
    fee_ratio: 1024,
    max_fee_amount: 5040000,
    note: "TRANSFER",
    nonce,
    network: "mainnet",
    sender: fromAddrBytes,
    inputs: [{
      address: fromAddrBytes,
      contract: contractBytes,
      amount: uint128LE(amountSat),
      memo: null,
      solution: 0,
      flags: 0,
    }],
    outputs: [{
      address: dstBytes,
      contract: contractBytes,
      amount: uint128LE(amountSat),
      memo: null,
    }],
    execute: [],
    deploy: null,
    static_cost: staticCost,
  };

  // Compute tx id
  const txId = calcTxId(tx);

  // Sign
  const solution = await signTx(txId, skey);
  tx.solutions = [solution];

  // Compute content hash
  const contentHash = calcContentHash(tx);

  // Build VNX object
  const txObj = {
    __type: "mmx.Transaction",
    version: tx.version,
    expires: tx.expires,
    fee_ratio: tx.fee_ratio,
    max_fee_amount: tx.max_fee_amount,
    note: tx.note,
    nonce: tx.nonce.toString(),
    network: tx.network,
    sender: tx.sender,
    inputs: tx.inputs.map(i => ({ ...i, __type: "mmx.txin_t" })),
    outputs: tx.outputs.map(o => ({ ...o, __type: "mmx.txout_t" })),
    execute: [],
    deploy: null,
    solutions: [{ ...solution, __type: "mmx.solution.PubKey" }],
    static_cost: tx.static_cost,
    id: Array.from(txId),
    content_hash: Array.from(contentHash),
  };

  // Validate — the node returns the actual fee in exec_result.total_fee
  const result = await api.validateTransaction(txObj);
  if (result.did_fail) throw new Error("Transaction validation failed: " + (result.error || "unknown"));

  // Broadcast
  await api.broadcastTransaction(txObj);

  // Auto-track destination address in contacts (if not own and not already saved)
  try { await store.autoTrackAddress(toAddress, "Sent to"); } catch {}

  // Clear sensitive data from memory after signing
  // skey and seed are local, but let's zero them out
  skey.fill(0);
  
  return {
    txid: Buffer.from(txId).toString("hex").toUpperCase(),
    fee: result.total_fee || 50000,        // actual fee in satoshis
    fee_value: (result.total_fee || 50000) / 1e6,  // human-readable MMX
  };
}

// --- Public API for UI ---

export async function init() {
  await loadWordlist();
}

export async function createWallet(name, password) {
  const seed = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  const { addrHash } = deriveKeypair(seed, "", 0, 0);
  const address = hashToAddress(addrHash);
  const wallet = await store.createWallet(name, password, seed, address);
  // Unlock immediately
  unlockedSeed = seed;
  unlockedWallet = wallet;
  resetAutoLock();
  return { wallet, mnemonic: seedToWords(seed) };
}

export async function importWallet(name, mnemonicWords, password) {
  const seed = wordsToSeed(mnemonicWords);
  const { addrHash } = deriveKeypair(seed, "", 0, 0);
  const address = hashToAddress(addrHash);
  // Check for duplicate wallet (same address already imported)
  const existing = await store.getWallets();
  const dup = existing.find(w => w.address === address);
  if (dup) {
    throw new Error(`Wallet already imported as "${dup.name}" (${address.substring(0,16)}...)`);
  }
  const wallet = await store.createWallet(name, password, seed, address);
  unlockedSeed = seed;
  unlockedWallet = wallet;
  resetAutoLock();
  return { wallet, address };
}

export async function unlockWallet(walletId, password) {
  const { wallet, seed } = await store.unlockWallet(walletId, password);
  unlockedSeed = seed;
  unlockedWallet = wallet;
  resetAutoLock();
  return wallet;
}

// Restore session from background (popup reopen without re-entering password)
export function restoreSession(seed, wallet) {
  unlockedSeed = seed;
  unlockedWallet = wallet;
  resetAutoLock();
}

// Get the raw seed for background session storage
export function getUnlockedSeed() {
  return unlockedSeed;
}

export function lockWalletPub() {
  lockWallet();
}

export function isUnlocked() {
  return unlockedSeed !== null;
}

// For background session checks without exposing the seed
export function getUnlockedWalletId() {
  return unlockedWallet ? unlockedWallet.id : null;
}

export function getUnlockedWallet() {
  return unlockedWallet;
}

export function getUnlockedAddress() {
  if (!unlockedWallet) return null;
  return unlockedWallet.address;
}

export async function getWalletsList() {
  return await store.getWallets();
}

export async function hasWallets() {
  return (await store.getWallets()).length > 0;
}

export async function getActiveWalletId() {
  return store.getActiveWalletId();
}

export async function setActiveWalletId(id) {
  await store.setActiveWalletId(id);
}

export async function deleteWalletById(id) {
  await store.deleteWallet(id);
  if (unlockedWallet?.id === id) lockWallet();
}

export async function fetchBalance() {
  if (!unlockedWallet) return [];
  return await api.getBalance(unlockedWallet.address);
}
export function mmxToSat(mmxStr, decimals = 6) {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(mmxStr)) throw new Error("Invalid amount");
  if (parseFloat(mmxStr) < 0) throw new Error("Amount cannot be negative");
  // Parse decimal string to integer smallest units (respects token decimals)
  const [whole, frac = ""] = mmxStr.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).substring(0, decimals);
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(fracPadded || "0");
}

export function satToMmx(satStr) {
  // Convert satoshi amount (may be decimal from API) to MMX display string
  const sat = BigInt(Math.floor(parseFloat(satStr)));
  const whole = sat / 1000000n;
  const frac = (sat % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// --- Transaction history ---

export async function getTransactionHistory(limit = 20, offset = 0) {
  if (!unlockedWallet) return [];
  const resp = await fetch(`${api.getNodeUrl()}/transactions?addr=${unlockedWallet.address}&limit=${limit}&offset=${offset}`);
  if (!resp.ok) throw new Error(`Transaction history error: ${resp.status}`);
  const txs = await resp.json();
  // Format for UI: determine direction (sent/received) and amounts
  const myAddr = unlockedWallet.address;
  return txs.map(tx => {
    const isSender = tx.sender === myAddr;
    const inputAmounts = tx.input_amounts || [];
    const outputAmounts = tx.output_amounts || [];
    // For received txs, the sender is someone else and one of the outputs goes to us
    // For sent txs, we are the sender
    let direction = isSender ? 'sent' : 'received';
    let amount = '';
    let symbol = '';
    if (inputAmounts.length > 0) {
      const raw = inputAmounts[0].amount;
      const decimals = inputAmounts[0].decimals || 0;
      amount = formatAmount(raw, decimals);
      symbol = inputAmounts[0].symbol || 'MMX';
    }
    return {
      id: tx.id,
      height: tx.height,
      confirm: tx.confirm || 0,
      note: tx.note,
      direction,
      amount,
      symbol,
      fee: tx.fee?.value || 0,
      time: tx.time_stamp || tx.time,
      sender: tx.sender,
    };
  });
}

// --- Lock callback (UI sets this to handle view switching) ---
let onLockCallback = null;
export function onLock(cb) { onLockCallback = cb; }

// --- Auto-refresh balance ---
let autoRefreshTimer = null;
let lastBalanceHash = null;
const AUTO_REFRESH_MS = 30 * 1000; // 30 seconds

export function startAutoRefresh(onUpdate) {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(async () => {
    if (!unlockedWallet) return;
    try {
      const balances = await api.getBalance(unlockedWallet.address);
      const hash = JSON.stringify(balances);
      if (hash !== lastBalanceHash) {
        lastBalanceHash = hash;
        if (onUpdate) onUpdate(balances);
      }
    } catch { /* network error, try again next interval */ }
  }, AUTO_REFRESH_MS);
}

export function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}

if (typeof document !== "undefined") {
  document.addEventListener("click", () => { if (unlockedSeed) resetAutoLock(); });
  document.addEventListener("keydown", () => { if (unlockedSeed) resetAutoLock(); });
}

// Re-export for UI
// --- HTML escape helper (prevents XSS when inserting user data into innerHTML) ---
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export { seedToWords };

// Show mnemonic — requires password re-entry
export async function showMnemonic(password) {
  if (!unlockedSeed) throw new Error("Wallet is locked");
  // Verify password before revealing mnemonic
  const walletId = unlockedWallet?.id;
  if (!walletId) throw new Error("No active wallet");
  await store.unlockWallet(walletId, password); // throws if wrong password
  return seedToWords(unlockedSeed);
}

// --- Address book (re-export from store) ---
export async function getContacts() { return store.getContacts(); }
export async function addContact(name, address) { return store.addContact(name, address); }
export async function deleteContact(id) { return store.deleteContact(id); }
export async function findContactByAddress(address) { return store.findContactByAddress(address); }
export async function autoTrackAddress(address, defaultName) { return store.autoTrackAddress(address, defaultName); }
