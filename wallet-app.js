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
import { calcTxId, calcContentHash, signTx, TX_NOTE, calcDepositHash, calcExecuteHash, calcExecutableHash, TX_NOTE_TRADE, TX_NOTE_OFFER } from "./mmx-tx.js";
// Configure secp256k1
secp.hashes.sha256 = (data) => sha256(data);
secp.hashes.hmacSha256 = (key, data) => sha256(Buffer.concat([Buffer.from(key), Buffer.from(data)]));

// --- State ---
let unlockedSeed = null;     // Uint8Array, cleared on lock
let unlockedWallet = null;   // wallet metadata object
let allTxHistory = [];       // tracks all loaded tx history for pagination
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
  allTxHistory = [];      // reset tx history pagination
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

  // Compute static_cost correctly (must match Transaction::calc_cost in C++)
  // For simple transfer: 1 input + 1 output + 0 execute + 1 solution
  const params = await getChainParamsLocal(); const staticCost = calcStaticCost(1, 1, null, 1, null, params);

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
    max_fee_amount: calcMaxFee(staticCost),
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

  // Dry-run: validate to get actual fee from node (exec_result.total_fee)
  const result = await api.validateTransaction(toVNX(txObj));
  if (result.did_fail) throw new Error("Transaction validation failed: " + (result.error || "unknown"));

  // Broadcast to network
  await api.broadcastTransaction(toVNX(txObj));

  // Auto-track destination address in contacts (if not own and not already saved)
  try { await store.autoTrackAddress(toAddress, "Sent to"); } catch {}

  // Clear sensitive data from memory after signing
  // skey and seed are local, but let's zero them out
  skey.fill(0);
  
  return {
    txid: Buffer.from(txId).toString("hex").toUpperCase(),
    fee: result.total_fee || 50000,        // actual fee from node dry-run (satoshis)
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
  await loadWordlist();
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

// --- Official MMX dApp API functions (window.mmx_wallet) ---

export function getPublicKeyHex() {
  if (!unlockedSeed) return null;
  const { pubkey } = deriveKeypair(unlockedSeed, "", 0, 0);
  return Buffer.from(pubkey).toString("hex").toUpperCase();
}

export function getNetwork() {
  return "MMX/mainnet";
}

// Sign a message with prefix "MMX/sign_message/" using SHA-256
// Returns: { signature: hex, public_key: hex } or null
export async function signMessage(msg) {
  if (!unlockedSeed) throw new Error("Wallet is locked");
  const { skey, pubkey } = deriveKeypair(unlockedSeed, "", 0, 0);
  const msgHash = Buffer.from(sha256(Buffer.from("MMX/sign_message/" + msg)));
  const sig = await secp.sign(msgHash, skey, { prehash: false });
  const result = {
    signature: Buffer.from(sig).toString("hex").toUpperCase(),
    public_key: Buffer.from(pubkey).toString("hex").toUpperCase(),
  };
  skey.fill(0);
  return result;
}

// Sign a transaction object (VNX format). Returns the signed tx or null if rejected.
// The tx object must match interface/Transaction.vni format.
export async function signTransactionObject(txObj) {
  if (!unlockedSeed) throw new Error("Wallet is locked");
  const { skey, addrHash } = deriveKeypair(unlockedSeed, "", 0, 0);

  // Ensure sender is set to our address
  if (!txObj.sender) txObj.sender = Array.from(addrHash);

  // Ensure nonce is set (generate if missing)
  if (!txObj.nonce || txObj.nonce === "0") {
    const nonceBytes = crypto.getRandomValues(new Uint8Array(8));
    let nonce = 0n;
    for (let i = 0; i < 8; i++) nonce |= BigInt(nonceBytes[i]) << BigInt(i * 8);
    if (nonce === 0n) nonce = 1n;
    txObj.nonce = nonce.toString();
  }

  // Ensure network is set
  if (!txObj.network) txObj.network = "mainnet";

  // Ensure expires is set (current height + 100)
  if (!txObj.expires) {
    const height = await api.getHeight();
    txObj.expires = height + 100;
  }

  // Build tx from the VNX object for hashing
  const tx = {
    version: txObj.version || 0,
    expires: txObj.expires,
    fee_ratio: txObj.fee_ratio || 1024,
    max_fee_amount: txObj.max_fee_amount || 5040000,
    note: typeof txObj.note === "string" ? (TX_NOTE[txObj.note] || txObj.note || 0) : (txObj.note || 0),
    nonce: BigInt(txObj.nonce),
    network: txObj.network,
    sender: txObj.sender,
    inputs: (txObj.inputs || []).map(i => ({
      address: i.address,
      contract: i.contract,
      amount: i.amount,
      memo: i.memo,
      solution: i.solution || 0,
      flags: i.flags || 0,
    })),
    outputs: (txObj.outputs || []).map(o => ({
      address: o.address,
      contract: o.contract,
      amount: o.amount,
      memo: o.memo,
    })),
    execute: txObj.execute || [],
    deploy: txObj.deploy,
    static_cost: txObj.static_cost || 50000,
  };

  // Compute tx id and sign
  const txId = calcTxId(tx);
  const solution = await signTx(txId, skey);
  tx.solutions = [solution];
  const contentHash = calcContentHash(tx);

  skey.fill(0);

  // Return the full signed transaction object
  return {
    ...txObj,
    __type: "mmx.Transaction",
    nonce: tx.nonce.toString(),
    sender: tx.sender,
    expires: tx.expires,
    solutions: [{ ...solution, __type: "mmx.solution.PubKey" }],
    id: Array.from(txId),
    content_hash: Array.from(contentHash),
  };
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
  // Use /address/history (address-specific) instead of /transactions (global)
  // /address/history uses since/until (block heights) for pagination, not offset
  let url = `${api.getNodeUrl()}/address/history?id=${unlockedWallet.address}&limit=${limit}`;
  // For pagination: use 'until' = last tx height from previous page
  if (offset > 0 && allTxHistory.length > 0) {
    const lastHeight = allTxHistory[allTxHistory.length - 1].height;
    if (lastHeight) url += `&until=${lastHeight}`;
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Transaction history error: ${resp.status}`);
  const txs = await resp.json();
  // Track all loaded txs for pagination (until=last height)
  if (offset === 0) allTxHistory = txs;
  else allTxHistory = allTxHistory.concat(txs);
  // Format for UI: /address/history returns tx_entry_t objects
  return txs.map(tx => ({
    id: tx.txid,
    height: tx.height,
    confirm: tx.is_pending ? 0 : 1,
    note: tx.memo,
    direction: (tx.type === 'SPEND' || tx.type === 'TXFEE' || tx.type === 'DEPOSIT') ? 'sent' : 'received',
    amount: tx.value != null ? String(tx.value) : formatAmount(tx.amount, tx.decimals || 0),
    symbol: tx.symbol || 'MMX',
    fee: 0,
    time: tx.time_stamp || tx.time,
    sender: tx.address,
  }));
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

// --- Swap trade ---
// Builds a Deposit operation transaction to trade on a swap pool.
// swapAddr: the swap pool contract address
// tokenIndex: 0 or 1 (which token to sell)
// amountSat: amount in smallest units (satoshis)
// currencyContract: the token contract address being sold
// minTradeSat: minimum output in smallest units (slippage protection, 0 = no min)
// numIter: iterations (1 = simple, 20 = default in MMX wallet)

// Compute static_cost for a transaction (must match Transaction::calc_cost in C++)
// ChainParams (mainnet): min_txfee=20000, min_txfee_io=10000, min_txfee_sign=10000,
//                       min_txfee_exec=10000, min_txfee_byte=100, min_txfee_deploy=200000
// For Execute/Deposit ops: cost += (method.length + sum(get_num_bytes(arg))) * min_txfee_byte
// Mainnet chain params (fallback if API unavailable)
// Source: https://rpc.mmx.network/chain/info
const CHAIN_PARAMS = {
  min_txfee: 20000,
  min_txfee_io: 10000,
  min_txfee_sign: 10000,
  min_txfee_exec: 10000,
  min_txfee_byte: 100,
  min_txfee_deploy: 20000,
  min_txfee_depend: 10000,
  min_txfee_memo: 5000,
};

let _chainParams = null;
async function getChainParamsLocal() {
  if (_chainParams) return _chainParams;
  try { _chainParams = await api.getChainParams(); } catch {}
  return _chainParams || CHAIN_PARAMS;
}

// Compute max_fee_amount = cost_to_fee(static_cost + gas_limit, fee_ratio)
// gas_limit default = 5000000 (from spend_options_t)
// With fee_ratio=1024: max_fee = static_cost + gas_limit
const DEFAULT_GAS_LIMIT = 5000000;
function calcMaxFee(staticCost, feeRatio = 1024, gasLimit = DEFAULT_GAS_LIMIT) {
  return Math.floor((staticCost + gasLimit) * feeRatio / 1024);
}

function calcStaticCost(numInputs, numOutputs, executeOps, numSolutions, deployExec = null, params = CHAIN_PARAMS) {
  let cost = params.min_txfee;
  cost += numInputs * params.min_txfee_io;
  cost += numOutputs * params.min_txfee_io;
  cost += (executeOps?.length || 0) * params.min_txfee_exec;
  cost += numSolutions * params.min_txfee_sign;
  // Add execute payload cost
  for (const op of (executeOps || [])) {
    if (!op) continue;
    let payload = (op.method || "").length;
    for (const arg of (op.args || [])) {
      payload += getVariantNumBytes(arg);
    }
    cost += payload * params.min_txfee_byte;
  }
  // Deploy cost (Executable contract)
  if (deployExec) {
    cost += params.min_txfee_deploy;
    let numBytes = 16; // Contract::num_bytes (base)
    numBytes += (deployExec.name || "").length;
    numBytes += (deployExec.symbol || "").length;
    numBytes += getVariantNumBytes(deployExec.meta_data ?? null);
    numBytes += 32; // binary (addr_t)
    numBytes += (deployExec.init_method || "").length;
    for (const arg of (deployExec.init_args || [])) {
      numBytes += getVariantNumBytes(arg);
    }
    numBytes += (deployExec.depends || []).length * 32;
    for (const [key] of (deployExec.depends || [])) {
      numBytes += key.length;
    }
    cost += numBytes * params.min_txfee_byte;
    cost += (deployExec.depends || []).length * params.min_txfee_depend;
  }
  return cost;
}

// Get serialized size of a VNX Variant (matches get_num_bytes in C++)
function getVariantNumBytes(val) {
  if (val === null || val === undefined) return 1;      // null or bool = 1 byte
  if (typeof val === "boolean") return 1;
  if (typeof val === "number") return 8;                  // uint64/int64 = 8 bytes
  if (typeof val === "bigint") return 8;
  if (typeof val === "string") return 4 + val.length;    // string = 4 + length
  if (Array.isArray(val)) {
    let total = 4;
    for (const e of val) total += getVariantNumBytes(e);
    return total;
  }
  return 8; // fallback
}

export async function swapTrade(swapAddr, tokenIndex, amountSat, currencyContract, minTradeSat = 0, numIter = 1) {
  if (!unlockedSeed) throw new Error("Wallet is locked");

  const { skey, addrHash } = deriveKeypair(unlockedSeed, "", 0, 0);
  const fromAddrBytes = Array.from(addrHash);
  const userAddrStr = hashToAddress(addrHash);

  // Parse swap contract address
  const { words: swWords } = bech32m.decode(swapAddr);
  const swBytesBE = bech32m.fromWords(swWords);
  const swapAddrBytes = Array.from(Buffer.from(swBytesBE).reverse());

  // Parse currency contract address
  let currencyBytes = new Array(32).fill(0);
  if (currencyContract && currencyContract !== MMX_NULL_ADDR) {
    currencyBytes = addrToBytes32(currencyContract);
  }

  // Build the Deposit operation
  // trade(i, address, min_trade, num_iter) — address is user's address (bech32 string)
  const deposit = {
    __type: "mmx.operation.Deposit",
    version: 0,
    address: swapAddrBytes,
    method: "trade",
    args: [
      tokenIndex,                                    // i: which token to sell
      userAddrStr,                                    // address: where to send output
      minTradeSat > 0 ? Number(minTradeSat) : 1, // min_trade: must be a number (not null) — default 1 smallest unit
      numIter,                                        // num_iter
    ],
    user: null,                                      // user: NOT set for swap trades
    currency: currencyBytes,                         // currency being deposited
    amount: uint128LE(amountSat),                    // amount being deposited
  };

  // Compute the operation hash for the tx hash
  const opHash = calcDepositHash(deposit, false);
  const opFullHash = calcDepositHash(deposit, true);

  // Get height for expires
  const height = await api.getHeight();
  const expires = height + 100;

  // Nonce
  const nonce = randomNonce();

  // Compute static_cost correctly (must match Transaction::calc_cost in C++)
  // min_txfee(100) + inputs(100 each) + outputs(100 each) + exec(10000 each) + solutions(1000 each)
  // + execute payload * min_txfee_byte(10)
  const params = await getChainParamsLocal(); const staticCost = calcStaticCost(1, 0, [deposit], 1, null, params);

  const tx = {
    version: 0,
    expires,
    fee_ratio: 1024,
    max_fee_amount: calcMaxFee(staticCost),
    note: TX_NOTE_TRADE,
    nonce,
    network: "mainnet",
    sender: fromAddrBytes,
    inputs: [{
      address: fromAddrBytes,
      contract: currencyBytes,
      amount: uint128LE(amountSat),
      memo: null,
      solution: 0,
      flags: 0,
    }],
    // outputs: EMPTY — the node auto-creates deposit outputs and trade outputs during validation
    outputs: [],
    execute: [{ hash: Array.from(opHash), fullHash: Array.from(opFullHash) }],
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

  // Build VNX object for broadcast
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
    outputs: [],
    execute: [deposit],
    deploy: null,
    solutions: [{ ...solution, __type: "mmx.solution.PubKey" }],
    static_cost: tx.static_cost,
    id: Array.from(txId),
    content_hash: Array.from(contentHash),
  };

  // Dry-run: validate to get actual fee
  const result = await api.validateTransaction(toVNX(txObj));
  if (result.did_fail) throw new Error("Swap trade validation failed: " + (result.error || "unknown"));

  // Broadcast
  await api.broadcastTransaction(toVNX(txObj));

  skey.fill(0);

  return {
    txid: Buffer.from(txId).toString("hex").toUpperCase(),
    fee: result.total_fee || staticCost,
    fee_value: (result.total_fee || staticCost) / 1e6,
  };
}

// ====================================================================
// OFFERS
// ====================================================================
// Offer binary is a chain parameter (same for all offers on the network)
const OFFER_BINARY_ADDR = "mmx18rcdx8nhh56twmr2gq3h22kwj00slsn23ejan8qp00rqqw8yl4jq6ccysq";
const MMX_NULL_ADDR = "mmx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdgytev";

// Helper: parse bech32m address to 32-byte LE array
function addrToBytes32(addrStr) {
  if (!addrStr || addrStr === MMX_NULL_ADDR) return new Array(32).fill(0);
  const { words } = bech32m.decode(addrStr);
  const bytesBE = bech32m.fromWords(words);
  return Array.from(Buffer.from(bytesBE).reverse());
}

// Convert byte array to hex string (uppercase, no 0x prefix)
function bytesToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Convert uint128 LE byte array to decimal string
function uint128LEToDecimal(arr) {
  let val = 0n;
  for (let i = 0; i < 16; i++) val |= BigInt(arr[i]) << BigInt(i * 8);
  return val.toString();
}

// Convert a tx object's byte-array fields to VNX-native JSON format.
// VNX JSON API expects: addr_t → bech32 string, uint128 → decimal string,
// hash_t → hex string, bytes → hex string, tx_note_e → string name.
// Our hash computation uses byte arrays (correct binary serialization),
// but the JSON we send to the node must use VNX-native strings so the node
// deserializes to the same binary representation.
const TX_NOTE_NAMES = { 858544509: "TRANSFER", 329618288: "TRADE", 1549148948: "OFFER" };

function toVNX(txObj) {
  const out = JSON.parse(JSON.stringify(txObj)); // deep clone
  // note: number → string name
  if (typeof out.note === "number" && TX_NOTE_NAMES[out.note]) out.note = TX_NOTE_NAMES[out.note];
  // sender: byte array → bech32 string
  if (Array.isArray(out.sender)) out.sender = hashToAddress(out.sender);
  // id, content_hash: byte array → hex string
  if (Array.isArray(out.id)) out.id = bytesToHex(out.id);
  if (Array.isArray(out.content_hash)) out.content_hash = bytesToHex(out.content_hash);
  // inputs
  for (const inp of (out.inputs || [])) {
    if (Array.isArray(inp.address)) inp.address = hashToAddress(inp.address);
    if (Array.isArray(inp.contract)) inp.contract = hashToAddress(inp.contract);
    if (Array.isArray(inp.amount)) inp.amount = uint128LEToDecimal(inp.amount);
  }
  // outputs
  for (const out2 of (out.outputs || [])) {
    if (Array.isArray(out2.address)) out2.address = hashToAddress(out2.address);
    if (Array.isArray(out2.contract)) out2.contract = hashToAddress(out2.contract);
    if (Array.isArray(out2.amount)) out2.amount = uint128LEToDecimal(out2.amount);
  }
  // execute (Deposit/Execute operations)
  for (const op of (out.execute || [])) {
    if (Array.isArray(op.address)) op.address = hashToAddress(op.address);
    if (Array.isArray(op.currency)) op.currency = hashToAddress(op.currency);
    if (Array.isArray(op.amount)) op.amount = uint128LEToDecimal(op.amount);
    if (Array.isArray(op.user)) op.user = hashToAddress(op.user);
  }
  // deploy (Executable)
  if (out.deploy && Array.isArray(out.deploy.binary)) {
    out.deploy.binary = hashToAddress(out.deploy.binary);
  }
  // solutions: pubkey, signature → hex string
  for (const sol of (out.solutions || [])) {
    if (Array.isArray(sol.pubkey)) sol.pubkey = bytesToHex(sol.pubkey);
    if (Array.isArray(sol.signature)) sol.signature = bytesToHex(sol.signature);
  }
  return out;
}

// Helper: build, sign, validate, broadcast a transaction
async function buildAndSendTx(tx, skey) {
  const txId = calcTxId(tx);
  const solution = await signTx(txId, skey);
  tx.solutions = [solution];
  const contentHash = calcContentHash(tx);
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
    execute: tx.execute || [],
    deploy: tx.deploy || null,
    solutions: [{ ...solution, __type: "mmx.solution.PubKey" }],
    static_cost: tx.static_cost,
    id: Array.from(txId),
    content_hash: Array.from(contentHash),
  };
  const result = await api.validateTransaction(toVNX(txObj));
  if (result.did_fail) {
    let msg = "unknown";
    if (result.error) {
      if (typeof result.error === "string") msg = result.error;
      else if (result.error.message) msg = result.error.message;
      else msg = JSON.stringify(result.error);
    }
    throw new Error("Validation failed: " + msg);
  }
  await api.broadcastTransaction(toVNX(txObj));
  return {
    txid: Buffer.from(txId).toString("hex").toUpperCase(),
    fee: result.total_fee || tx.static_cost,
    fee_value: (result.total_fee || tx.static_cost) / 1e6,
  };
}

// Helper: generate random nonce
function randomNonce() {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(8));
  let nonce = 0n;
  for (let i = 0; i < 8; i++) nonce |= BigInt(nonceBytes[i]) << BigInt(i * 8);
  if (nonce === 0n) nonce = 1n;
  return nonce;
}

// makeOffer: create a new offer (deploy offer contract + deposit bid currency)
// bidCurrency: contract address of what you're offering (MMX = null addr)
// askCurrency: contract address of what you want
// bidAmountSat: amount in smallest units (MMX = *1e6, TRAIL = *1)
// askAmountSat: amount in smallest units
export async function makeOffer(bidCurrency, askCurrency, bidAmountSat, askAmountSat) {
  if (!unlockedSeed) throw new Error("Wallet is locked");
  if (bidAmountSat <= 0n || askAmountSat <= 0n) throw new Error("Amounts must be positive");

  const { skey, addrHash } = deriveKeypair(unlockedSeed, "", 0, 0);
  const fromAddrBytes = Array.from(addrHash);
  const fromAddrStr = hashToAddress(addrHash);

  const bidCurrencyBytes = addrToBytes32(bidCurrency);
  const askCurrencyBytes = addrToBytes32(askCurrency);
  const offerBinaryBytes = addrToBytes32(OFFER_BINARY_ADDR);

  // Compute inverse price: (bid_amount << 64) / ask_amount  (uint256 division)
  const bid256 = BigInt(bidAmountSat) << 64n;
  const invPrice = bid256 / BigInt(askAmountSat);
  if (invPrice >> 128n) throw new Error("Price out of range");
  // Format as hex string "0x..." (uint128 hex, 32 chars)
  const invPriceHex = "0x" + invPrice.toString(16);

  // Build the Executable contract (offer template)
  const executable = {
    __type: "mmx.contract.Executable",
    version: 0,
    name: "",
    symbol: "",
    decimals: 0,
    meta_data: null,
    binary: offerBinaryBytes,
    init_method: "init",
    init_args: [
      fromAddrStr,       // owner address
      bidCurrency,        // bid currency (bech32 string)
      askCurrency,        // ask currency (bech32 string)
      invPriceHex,        // inverse price (hex string)
      null,               // empty 5th arg
    ],
    depends: [],
  };

  // Compute deploy hash (for tx hash serialization)
  const deployHash = calcExecutableHash(executable, false);
  const deployFullHash = calcExecutableHash(executable, true);

  const height = await api.getHeight();
  const expires = height + 100;

  const tx = {
    version: 0,
    expires,
    fee_ratio: 1024,
    max_fee_amount: 0, // computed below
    note: TX_NOTE_OFFER,
    nonce: randomNonce(),
    network: "mainnet",
    sender: fromAddrBytes,
    inputs: [{
      address: fromAddrBytes,
      contract: bidCurrencyBytes,
      amount: uint128LE(bidAmountSat),
      memo: null,
      solution: 0,
      flags: 0,
    }],
    // outputs: EMPTY — the node auto-creates deposit output to tx.id (new contract addr) during execution
    outputs: [],
    execute: [],
    deploy: { hash: deployHash, fullHash: deployFullHash },
    static_cost: 0, // computed below
  };
  const offerParams = await getChainParamsLocal();
  tx.static_cost = calcStaticCost(1, 0, null, 1, executable, offerParams);
  tx.max_fee_amount = calcMaxFee(tx.static_cost);

  // For broadcast, deploy needs the full Executable object
  const result = await buildAndSendTxDeploy(tx, executable, skey);
  skey.fill(0);
  return result;
}

// Helper: build and send tx with a deploy (Executable) instead of execute ops
async function buildAndSendTxDeploy(tx, executable, skey) {
  const txId = calcTxId(tx);
  const solution = await signTx(txId, skey);
  tx.solutions = [solution];
  const contentHash = calcContentHash(tx);
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
    deploy: executable,  // Full Executable object for node to deserialize
    solutions: [{ ...solution, __type: "mmx.solution.PubKey" }],
    static_cost: tx.static_cost,
    id: Array.from(txId),
    content_hash: Array.from(contentHash),
  };
  const result = await api.validateTransaction(toVNX(txObj));
  if (result.did_fail) {
    let msg = "unknown";
    if (result.error) {
      if (typeof result.error === "string") msg = result.error;
      else if (result.error.message) msg = result.error.message;
      else msg = JSON.stringify(result.error);
    }
    throw new Error("Validation failed: " + msg);
  }
  await api.broadcastTransaction(toVNX(txObj));
  return {
    txid: Buffer.from(txId).toString("hex").toUpperCase(),
    fee: result.total_fee || tx.static_cost,
    fee_value: (result.total_fee || tx.static_cost) / 1e6,
  };
}

// _offerDeposit: shared helper for offer trade/accept (Deposit to offer contract)
// method: 'trade' (partial fill) or 'accept' (full fill)
// broadcast: if false, only validate (for fee estimation). if true, validate + broadcast.
async function _offerDeposit(method, offerAddr, askAmountSat, broadcast = true) {
  if (!unlockedSeed) throw new Error("Wallet is locked");
  if (askAmountSat <= 0n) throw new Error("Amount must be positive");

  const { skey, addrHash } = deriveKeypair(unlockedSeed, "", 0, 0);
  const fromAddrBytes = Array.from(addrHash);
  const fromAddrStr = hashToAddress(addrHash);

  // Fetch offer to get ask_currency and inv_price
  const offer = await api.getOffer(offerAddr);
  const askCurrencyBytes = addrToBytes32(offer.ask_currency);
  const offerAddrBytes = addrToBytes32(offerAddr);

  // Deposit: user MUST be null (official Wallet.cpp doesn't set options.user)
  const deposit = {
    __type: "mmx.operation.Deposit",
    version: 0,
    address: offerAddrBytes,
    method: method,
    args: [
      fromAddrStr,      // dst_addr: where to send bid currency + change
      offer.inv_price,  // price (hex string, must match current inv_price)
    ],
    user: null,          // MUST be null — not offer.owner
    currency: askCurrencyBytes,
    amount: uint128LE(askAmountSat),
  };

  const opHash = calcDepositHash(deposit, false);
  const opFullHash = calcDepositHash(deposit, true);

  const height = await api.getHeight();
  const expires = height + 100;

  const tx = {
    version: 0,
    expires,
    fee_ratio: 1024,
    max_fee_amount: 0, // computed below
    note: TX_NOTE_TRADE,
    nonce: randomNonce(),
    network: "mainnet",
    sender: fromAddrBytes,
    inputs: [{
      address: fromAddrBytes,
      contract: askCurrencyBytes,
      amount: uint128LE(askAmountSat),
      memo: null,
      solution: 0,
      flags: 0,
    }],
    // outputs: EMPTY — the node auto-creates deposit output to the offer contract during validation
    outputs: [],
    execute: [{ hash: Array.from(opHash), fullHash: Array.from(opFullHash) }],
    deploy: null,
    static_cost: calcStaticCost(1, 0, [deposit], 1, null, await getChainParamsLocal()),
  };
  tx.max_fee_amount = calcMaxFee(tx.static_cost);

  // For broadcast, include the full deposit object
  const txId = calcTxId(tx);
  const solution = await signTx(txId, skey);
  tx.solutions = [solution];
  const contentHash = calcContentHash(tx);
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
    execute: [deposit],
    deploy: null,
    solutions: [{ ...solution, __type: "mmx.solution.PubKey" }],
    static_cost: tx.static_cost,
    id: Array.from(txId),
    content_hash: Array.from(contentHash),
  };
  const result = await api.validateTransaction(toVNX(txObj));
  if (result.did_fail) {
    let msg = "unknown";
    if (result.error) {
      if (typeof result.error === "string") msg = result.error;
      else if (result.error.message) msg = result.error.message;
      else msg = JSON.stringify(result.error);
    }
    throw new Error("Validation failed: " + msg);
  }
  if (broadcast) {
    await api.broadcastTransaction(toVNX(txObj));
  }
  skey.fill(0);
  return {
    txid: Buffer.from(txId).toString("hex").toUpperCase(),
    fee: result.total_fee || tx.static_cost,
    fee_value: (result.total_fee || tx.static_cost) / 1e6,
    did_fail: result.did_fail,
    outputs: result.outputs || [],
  };
}

// acceptOffer: accept an existing offer — full fill (buy ALL remaining bid currency)
// Sends offer.ask_amount of ask_currency, receives all bid_balance, gets change back.
// For convenience, askAmountSat defaults to offer.ask_amount if not provided.
export async function acceptOffer(offerAddr, askAmountSat = null) {
  if (!unlockedSeed) throw new Error("Wallet is locked");
  if (askAmountSat === null) {
    const offer = await api.getOffer(offerAddr);
    askAmountSat = BigInt(offer.ask_amount);
  }
  if (askAmountSat <= 0n) throw new Error("Amount must be positive");
  return _offerDeposit("accept", offerAddr, askAmountSat, true);
}

// offerTrade: trade against an offer — partial fill (user-specified amount)
// Sends askAmountSat of ask_currency, receives floor(amount * inv_price >> 64) of bid currency.
// Leftover ask_currency stays in the offer (owner withdraws later).
export async function offerTrade(offerAddr, askAmountSat) {
  if (!unlockedSeed) throw new Error("Wallet is locked");
  if (askAmountSat <= 0n) throw new Error("Amount must be positive");
  return _offerDeposit("trade", offerAddr, askAmountSat, true);
}

// validateOfferTx: dry-run validation only (no broadcast) — for fee estimation
export async function validateOfferTx(method, offerAddr, askAmountSat) {
  if (!unlockedSeed) throw new Error("Wallet is locked");
  if (askAmountSat <= 0n) throw new Error("Amount must be positive");
  return _offerDeposit(method, offerAddr, askAmountSat, false);
}

// cancelOffer: cancel an offer (Execute on offer contract with method "cancel")
// Only the offer owner can cancel
export async function cancelOffer(offerAddr) {
  if (!unlockedSeed) throw new Error("Wallet is locked");

  const { skey, addrHash } = deriveKeypair(unlockedSeed, "", 0, 0);
  const fromAddrBytes = Array.from(addrHash);

  // Fetch offer to get owner (for user field)
  const offer = await api.getOffer(offerAddr);
  const offerAddrBytes = addrToBytes32(offerAddr);
  const ownerBytes = addrToBytes32(offer.owner);

  // cancel() takes no args, user = offer.owner
  const executeOp = {
    __type: "mmx.operation.Execute",
    version: 0,
    address: offerAddrBytes,
    method: "cancel",
    args: [],
    user: ownerBytes,  // must be offer owner
    solution: 0,       // our PubKey solution is at index 0 (node validates against owner)
  };

  const opHash = calcExecuteHash(executeOp, false);
  const opFullHash = calcExecuteHash(executeOp, true);

  const height = await api.getHeight();
  const expires = height + 100;

  const tx = {
    version: 0,
    expires,
    fee_ratio: 1024,
    max_fee_amount: 0, // computed below
    note: TX_NOTE.TRANSFER,  // TRANSFER
    nonce: randomNonce(),
    network: "mainnet",
    sender: fromAddrBytes,
    inputs: [],
    outputs: [],
    execute: [{ hash: Array.from(opHash), fullHash: Array.from(opFullHash) }],
    deploy: null,
    static_cost: 0, // computed below
  };
  const cancelParams = await getChainParamsLocal();
  tx.static_cost = calcStaticCost(0, 0, [executeOp], 1, null, cancelParams);
  tx.max_fee_amount = calcMaxFee(tx.static_cost);
  const txId = calcTxId(tx);
  tx.solutions = [solution];
  const contentHash = calcContentHash(tx);
  const txObj = {
    __type: "mmx.Transaction",
    version: tx.version,
    expires: tx.expires,
    fee_ratio: tx.fee_ratio,
    max_fee_amount: tx.max_fee_amount,
    note: TX_NOTE.TRANSFER,
    nonce: tx.nonce.toString(),
    network: tx.network,
    sender: tx.sender,
    inputs: [],
    outputs: [],
    execute: [executeOp],
    deploy: null,
    solutions: [{ ...solution, __type: "mmx.solution.PubKey" }],
    static_cost: tx.static_cost,
    id: Array.from(txId),
    content_hash: Array.from(contentHash),
  };
  const result = await api.validateTransaction(toVNX(txObj));
  if (result.did_fail) {
    let msg = "unknown";
    if (result.error) {
      if (typeof result.error === "string") msg = result.error;
      else if (result.error.message) msg = result.error.message;
      else msg = JSON.stringify(result.error);
    }
    throw new Error("Validation failed: " + msg);
  }
  await api.broadcastTransaction(toVNX(txObj));
  skey.fill(0);
  return {
    txid: Buffer.from(txId).toString("hex").toUpperCase(),
    fee: result.total_fee || tx.static_cost,
    fee_value: (result.total_fee || tx.static_cost) / 1e6,
  };
}
