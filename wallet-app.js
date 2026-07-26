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

import * as secp from "@noble/secp256k1/index.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
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
  const resp = await fetch("./wordlist.txt");
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
  const be = Buffer.from(hash32LE).reverse();
  const bits = BigInt("0x" + be.toString("hex"));
  const dp = new Array(52);
  dp[51] = Number((bits & 1n) << 4n);
  let b = bits >> 1n;
  for (let i = 0; i < 51; i++) { dp[50 - i] = Number(b & 31n); b >>= 5n; }
  return bech32m.encode("mmx", dp);
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
  unlockedSeed = null;
  unlockedWallet = null;
  if (autoLockTimer) { clearTimeout(autoLockTimer); autoLockTimer = null; }
  render();
}

// --- Transaction building ---

function uint128LE(val) {
  const v = BigInt(val);
  const arr = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) arr[i] = Number((v >> BigInt(i * 8)) & 0xFFn);
  return arr;
}

export async function sendTransaction(toAddress, amountSat, currencyContract) {
  if (!unlockedSeed) throw new Error("Wallet is locked");

  // Derive keys from unlocked seed
  const { skey, pubkey, addrHash } = deriveKeypair(unlockedSeed, "", 0, 0);
  const fromAddrBytes = Array.from(addrHash);

  // Parse destination address to bytes
  const { words } = bech32m.decode(toAddress);
  let dstBits = 0n;
  for (let i = 0; i < 51; i++) dstBits = (dstBits << 5n) | BigInt(words[i]);
  dstBits = (dstBits << 4n) | (BigInt(words[51]) >> 1n);
  const dstHex = dstBits.toString(16).padStart(64, "0");
  const dstBytes = Array.from(Buffer.from(dstHex, "hex").reverse());

  // Parse currency contract address (MMX native = all zeros)
  let contractBytes = new Array(32).fill(0);
  if (currencyContract && currencyContract !== "mmx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdgytev") {
    const { words: cw } = bech32m.decode(currencyContract);
    let cBits = 0n;
    for (let i = 0; i < 51; i++) cBits = (cBits << 5n) | BigInt(cw[i]);
    cBits = (cBits << 4n) | (BigInt(cw[51]) >> 1n);
    const cHex = cBits.toString(16).padStart(64, "0");
    contractBytes = Array.from(Buffer.from(cHex, "hex").reverse());
  }

  // Get height for expires
  const height = await api.getHeight();
  const expires = height + 100;

  // Cost: min_txfee(20000) + 1 input(10000) + 1 output(10000) + 1 solution(10000) = 50000
  const staticCost = 50000;

  const nonce = Math.floor(Math.random() * 1e15);

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
    nonce: tx.nonce,
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

  // Validate
  const result = await api.validateTransaction(txObj);
  if (result.did_fail) throw new Error("Transaction validation failed: " + (result.error || "unknown"));

  // Broadcast
  await api.broadcastTransaction(txObj);

  return Buffer.from(txId).toString("hex").toUpperCase();
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
  const wallet = await store.createWallet(name, password, seed, address);
  // Verify address matches
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

export function lockWalletPub() {
  lockWallet();
}

export function isUnlocked() {
  return unlockedSeed !== null;
}

export function getUnlockedWallet() {
  return unlockedWallet;
}

export function getUnlockedAddress() {
  if (!unlockedWallet) return null;
  return unlockedWallet.address;
}

export function getWalletsList() {
  return store.getWallets();
}

export function getActiveWalletId() {
  return store.getActiveWalletId();
}

export function setActiveWalletId(id) {
  store.setActiveWalletId(id);
}

export function deleteWalletById(id) {
  store.deleteWallet(id);
  if (unlockedWallet?.id === id) lockWallet();
}

export async function fetchBalance() {
  if (!unlockedWallet) return [];
  return await api.getBalance(unlockedWallet.address);
}

// Amount helpers: MMX has 6 decimals
export function mmxToSat(mmxStr) {
  // Parse decimal string to integer satoshis
  const [whole, frac = ""] = mmxStr.split(".");
  const fracPadded = (frac + "000000").substring(0, 6);
  return BigInt(whole) * 1000000n + BigInt(fracPadded || "0");
}

export function satToMmx(satStr) {
  // Convert satoshi amount (may be decimal from API) to MMX display string
  const sat = BigInt(Math.floor(parseFloat(satStr)));
  const whole = sat / 1000000n;
  const frac = (sat % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// Re-export for UI
export { seedToWords };

// Show mnemonic for current unlocked wallet (requires re-derivation from seed)
export function showMnemonic() {
  if (!unlockedSeed) throw new Error("Wallet is locked");
  return seedToWords(unlockedSeed);
}
