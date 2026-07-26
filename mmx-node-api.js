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
  const resp = await fetch(`${_nodeUrl}/balance?id=${address}`);
  if (!resp.ok) throw new Error(`Balance API error: ${resp.status}`);
  const data = await resp.json();
  // Returns { balances: [{ contract, symbol, decimals, spendable, total, ... }], nfts: [] }
  return data.balances || [];
}

export async function getBalanceOf(address, currencySymbol) {
  const balances = await getBalance(address);
  return balances.find(b => b.symbol === currencySymbol) || null;
}

// --- Block height (for tx expires field) ---

export async function getHeight() {
  const resp = await fetch(`${_nodeUrl}/headers?limit=1`);
  if (!resp.ok) throw new Error(`Headers API error: ${resp.status}`);
  const data = await resp.json();
  return data[0]?.height ?? 0;
}

// --- Transaction validate/broadcast ---

export async function validateTransaction(txObj) {
  const resp = await fetch(`${_nodeUrl}/transaction/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(txObj),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Validate failed: ${text}`);
  return JSON.parse(text);
}

export async function broadcastTransaction(txObj) {
  const resp = await fetch(`${_nodeUrl}/transaction/broadcast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(txObj),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Broadcast failed: ${text}`);
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
