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

export function getDefaultNodeUrl() {
  return DEFAULT_NODE;
}

// Load saved RPC URL from storage on startup (call from app init)
export async function initNodeUrl() {
  try {
    // Dynamic import to avoid circular dependency in extension context
    const store = await import("./wallet-store.js");
    const saved = await store.getSetting("rpc_url");
    if (saved && typeof saved === "string" && saved.startsWith("http")) {
      _nodeUrl = saved.replace(/\/+$/, "");
    }
  } catch {
    // wallet-store.js not available (e.g. test environment) — use default
  }
}

// Save RPC URL to storage
// Auto-detect if RPC URL needs /wapi prefix.
// Public RPC (rpc.mmx.network) reverse-proxies / → /wapi/ so no prefix needed.
// Raw MMX nodes serve WebAPI at /wapi/ only.
// Test: try /headers?limit=1, if 404 try /wapi/headers?limit=1, auto-append if needed.
async function autoDetectWapi(url) {
  const cleanUrl = url.replace(/\/+$/, "");
  // Already has /wapi
  if (cleanUrl.endsWith("/wapi")) return cleanUrl;
  try {
    // Test without /wapi
    let resp = await fetch(`${cleanUrl}/headers?limit=1`);
    if (resp.ok) return cleanUrl; // No /wapi needed (public RPC style)
  } catch {}
  // Test with /wapi
  try {
    let resp = await fetch(`${cleanUrl}/wapi/headers?limit=1`);
    if (resp.ok) return cleanUrl + "/wapi"; // Raw node needs /wapi
  } catch {}
  // Can't detect — return as-is, user can fix manually
  return cleanUrl;
}

export async function saveNodeUrl(url) {
  const detected = await autoDetectWapi(url);
  try {
    const store = await import("./wallet-store.js");
    await store.setSetting("rpc_url", detected);
    setNodeUrl(detected);
    return detected;
  } catch {
    setNodeUrl(detected); // at least apply in-memory
    return detected;
  }
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

// --- Offers (public RPC, read-only) ---

export async function getOffer(offerAddr) {
  const resp = await fetch(`${_nodeUrl}/offer?id=${offerAddr}`);
  if (!resp.ok) throw new Error(`Offer error: ${resp.status}`);
  return await resp.json();
}

export async function getTradeHistory(bidCurrency, askCurrency, limit = 50) {
  let qs = `limit=${limit}`;
  if (bidCurrency) qs += `&bid=${bidCurrency}`;
  if (askCurrency) qs += `&ask=${askCurrency}`;
  const resp = await fetch(`${_nodeUrl}/trade_history?${qs}`);
  if (!resp.ok) throw new Error(`Trade history error: ${resp.status}`);
  return await resp.json();
}

export async function getOfferTradeEstimate(offerAddr, amount) {
  const resp = await fetch(`${_nodeUrl}/offer/trade_estimate?id=${offerAddr}&amount=${amount}`);
  if (!resp.ok) throw new Error(`Offer trade estimate error: ${resp.status}`);
  return await resp.json();
}

export async function getOffers(bidCurrency, askCurrency, limit = 50) {
  let qs = `limit=${limit}`;
  if (bidCurrency) qs += `&bid=${bidCurrency}`;
  if (askCurrency) qs += `&ask=${askCurrency}`;
  const resp = await fetch(`${_nodeUrl}/offers?${qs}`);
  if (!resp.ok) throw new Error(`Offers error: ${resp.status}`);
  return await resp.json();
}

// --- Chain params (public RPC, cached) ---
let _chainParams = null;

export async function getChainParams() {
  if (_chainParams) return _chainParams;
  const resp = await fetch(`${_nodeUrl}/chain/info`);
  if (!resp.ok) throw new Error(`Chain info error: ${resp.status}`);
  _chainParams = await resp.json();
  return _chainParams;
}
