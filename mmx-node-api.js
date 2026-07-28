/**
 * mmx-node-api.js — Browser-side MMX node API client.
 * 
 * Talks directly to a public MMX RPC node (default: https://rpc.mmx.network).
 * No proxy needed — the node has CORS enabled (Access-Control-Allow-Origin: *).
 * 
 * Public endpoints used:
 *   GET  /balance?id=<addr>           → all token balances for address
 *   GET  /headers?limit=1              → latest block height (for expires field)
 *   POST /transaction/validate         → validate a transaction
 *   POST /transaction/broadcast        → broadcast a transaction
 *   GET  /contract?id=<addr>&field=... → read contract state (for tokens)
 */

const DEFAULT_NODE = "https://rpc.mmx.network";

let _nodeUrl = DEFAULT_NODE;

export function setNodeUrl(url) {
  _nodeUrl = url.replace(/\/+$/, ""); // strip trailing slash
}

export function getNodeUrl() {
  return _nodeUrl;
}

// --- Balance ---

export async function getBalance(address) {
  let resp;
  try {
    resp = await fetch(`${_nodeUrl}/balance?id=${address}`);
  } catch {
    throw new Error("Network error: cannot reach MMX node. Check your internet connection.");
  }
  if (!resp.ok) throw new Error(`Balance API error: HTTP ${resp.status}`);
  const data = await resp.json();
  // Returns { balances: [{ contract, symbol, decimals, spendable, total, ... }], nfts: [] }
  return data.balances || [];
}

export async function getBalanceOf(address, currencySymbol) {
  const balances = await getBalance(address);
  return balances.find(b => b.symbol === currencySymbol) || null;
}

// --- Block header (height + fee estimate) ---

export async function getHeader() {
  let resp;
  try {
    resp = await fetch(`${_nodeUrl}/headers?limit=1`);
  } catch {
    throw new Error("Network error: cannot reach MMX node.");
  }
  if (!resp.ok) throw new Error(`Headers API error: HTTP ${resp.status}`);
  const data = await resp.json();
  return data[0] ?? null;
}

export async function getHeight() {
  const header = await getHeader();
  return header?.height ?? 0;
}

// --- Fee estimation ---
// static_cost = min_txfee(20000) + 1in(10000) + 1out(10000) + 1sol(10000) = 50000 sat
// This is the BASE cost. The ACTUAL fee is returned by the node during
// validation (dry-run via /transaction/validate) in exec_result.total_fee.
// The wallet always dry-runs before broadcasting to get the real fee.
/**
 * Fee estimate for UI display before sending.
 *
 * The wallet calls /transaction/validate (dry-run) before broadcasting.
 * The node returns exec_result.total_fee which is the actual fee charged.
 * This function returns the static estimate (50000 sat) for UI preview.
 * The real fee is confirmed in sendTransaction() after validation.
 */
export async function getFeeEstimate() {
  try {
    const header = await getHeader();
    // average_txfee reflects recent block content, not the minimum fee.
    // The fee is always 50000 sat for a standard transfer regardless.
    if (header?.average_txfee?.amount && BigInt(header.average_txfee.amount) === 0n) {
      return 50000n; // empty blocks don't mean free transactions
    }
  } catch {}
  return 50000n; // standard transfer: 20000 + 10000 + 10000 + 10000
}

// --- Transaction validate/broadcast ---

export async function validateTransaction(txObj) {
  let resp;
  try {
    resp = await fetch(`${_nodeUrl}/transaction/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(txObj),
    });
  } catch {
    throw new Error("Network error: cannot reach MMX node to validate transaction.");
  }
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Transaction invalid: ${text}`);
  return JSON.parse(text);
}

export async function broadcastTransaction(txObj) {
  let resp;
  try {
    resp = await fetch(`${_nodeUrl}/transaction/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(txObj),
    });
  } catch {
    throw new Error("Network error: cannot reach MMX node to broadcast transaction.");
  }
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Broadcast rejected by node: ${text}`);
  // Success returns empty 200
  return true;
}

// --- Contract read (for token info) ---

export async function readContractField(contractAddr, field, args = []) {
  const params = new URLSearchParams({ id: contractAddr, field });
  if (args.length) params.set("args", JSON.stringify(args));
  const resp = await fetch(`${_nodeUrl}/contract?${params}`);
  if (!resp.ok) throw new Error(`Contract read error: ${resp.status}`);
  return await resp.json();
}

// --- Swap pools (public RPC, read-only) ---

export async function getSwapList(limit = 20) {
  const resp = await fetch(`${_nodeUrl}/swap/list?limit=${limit}`);
  if (!resp.ok) throw new Error(`Swap list error: ${resp.status}`);
  return await resp.json();
}

export async function getSwapInfo(poolAddr) {
  const resp = await fetch(`${_nodeUrl}/swap/info?id=${poolAddr}`);
  if (!resp.ok) throw new Error(`Swap info error: ${resp.status}`);
  return await resp.json();
}

export async function getSwapUserInfo(poolAddr, userAddr) {
  const resp = await fetch(`${_nodeUrl}/swap/user_info?id=${poolAddr}&user=${userAddr}`);
  if (!resp.ok) throw new Error(`Swap user info error: ${resp.status}`);
  return await resp.json();
}

export async function getSwapTradeEstimate(poolAddr, index, amount, iters = 200) {
  const resp = await fetch(`${_nodeUrl}/swap/trade_estimate?id=${poolAddr}&index=${index}&amount=${amount}&iters=${iters}`);
  if (!resp.ok) throw new Error(`Trade estimate error: ${resp.status}`);
  return await resp.json();
}
