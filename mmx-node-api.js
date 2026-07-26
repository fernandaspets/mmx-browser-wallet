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

// Estimate fee for a standard transfer (1 in, 1 out, 1 solution)
// Fee = static_cost in satoshis (node charges this directly)
// static_cost = min_txfee(20000) + 1in(10000) + 1out(10000) + 1sol(10000) = 50000
/**
 * Fee estimate for UI display before sending.
 *
 * The ACTUAL fee is determined by the node during validation and returned
 * in exec_result.total_fee. For the local node wallet API, you can get it
 * by calling send() with auto_send:false (dry-run) — the response includes
 * exec_result.total_fee (satoshis) and total_fee_value (MMX units, /wapi only).
 *
 * For the public RPC, /transaction/validate returns exec_result with total_fee.
 *
 * For a standard transfer (1 input, 1 output, 1 PubKey solution):
 *   static_cost = min_txfee(20000) + input(10000) + output(10000) + solution(10000) = 50000 sat
 * This is what the node charges when max_fee_amount >= 50000.
 *
 * This function returns the static estimate for UI preview. The real fee
 * is confirmed after validation in sendTransaction().
 */
export async function getFeeEstimate() {
  try {
    const header = await getHeader();
    // If average_txfee is 0, no transactions in recent blocks (not "free mode")
    // The fee is still 50000 sat — average_txfee just reflects block content
    if (header?.average_txfee?.amount && BigInt(header.average_txfee.amount) === 0n) {
      return 50000n; // still 50000, average_txfee=0 just means empty blocks
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
