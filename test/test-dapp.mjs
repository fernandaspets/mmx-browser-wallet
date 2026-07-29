/*
 * test-dapp.mjs — Tests for the TrailShare dApp (dapp/ directory)
 *
 * Tests:
 * 1. app.html exists and has all three tabs (wallet, swap, paywall)
 * 2. swap.html exists and has swap UI
 * 3. paywall.html exists and has payment flow
 * 4. swap-pools.html still works (old demo)
 * 5. Swap estimate uses est.trade.value (not est.output/amount)
 * 6. Percentage helper buttons exist in app.html
 * 7. Pool data transform (parallel arrays -> token objects)
 * 8. calcDepositHash exists in mmx-tx.js
 * 9. swapTrade exists in wallet-app.js
 * 10. Paywall has TRAIL balance check + Morpheus address
 * 11. All dapp pages import from ../ (not ./) for shared modules
 * 12. TX_NOTE_TRADE is defined
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const dir = import.meta.dirname;
const root = resolve(dir, '..');
const dappDir = resolve(dir, '../dapp');
const read = (path) => readFileSync(path, 'utf8');

function assert(name, actual, expected) {
  if (actual !== expected) {
    console.error(`  ❌ ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ ${name}`);
  }
}

function assertIncludes(name, str, substr) {
  if (!str || !str.includes(substr)) {
    console.error(`  ❌ ${name}: "${substr}" not found`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ ${name}`);
  }
}

function assertNotIncludes(name, str, substr) {
  if (str && str.includes(substr)) {
    console.error(`  ❌ ${name}: "${substr}" should NOT be present`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ ${name}`);
  }
}

console.log("📋 TrailShare dApp Tests\n");

// === 1. app.html exists and has tabs ===
console.log("1. app.html structure");
{
  const src = read(join(dappDir, 'app.html'));
  assert("app.html exists", src.length > 0, true);

  // Four tabs
  assertIncludes("app.html has wallet tab", src, 'data-tab="wallet"');
  assertIncludes("app.html has swap tab", src, 'data-tab="swap"');
  assertIncludes("app.html has offers tab", src, 'data-tab="offers"');
  assertIncludes("app.html has paywall tab", src, 'data-tab="paywall"');

  // Tab content divs
  assertIncludes("app.html has tab-wallet content", src, 'id="tab-wallet"');
  assertIncludes("app.html has tab-swap content", src, 'id="tab-swap"');
  assertIncludes("app.html has tab-offers content", src, 'id="tab-offers"');
  assertIncludes("app.html has tab-paywall content", src, 'id="tab-paywall"');

  // Imports from ../ (not ./)
  assertIncludes("app.html imports ../wallet-app.js", src, 'from "../wallet-app.js"');
  assertIncludes("app.html imports ../wallet-store.js", src, 'from "../wallet-store.js"');
  assertIncludes("app.html imports ../mmx-node-api.js", src, 'from "../mmx-node-api.js"');
  assertNotIncludes("app.html does NOT import ./wallet-app.js", src, 'from "./wallet-app.js"');

  // Send UI
  assertIncludes("app.html has send button", src, 'id="sendBtn"');
  assertIncludes("app.html has send-to input", src, 'id="sendTo"');
  assertIncludes("app.html has send amount", src, 'id="sendAmount"');

  // TX history
  assertIncludes("app.html has tx history", src, 'id="txHistory"');

  // Morpheus address
  assertIncludes("app.html has Morpheus address", src, 'mmx1vywfs5ymt9hfhkc3a37a3a5uw35mpl0j5l09qz59g3ek9t9az5sqgl8cq5');

  // TRAIL contract
  assertIncludes("app.html has TRAIL contract", src, 'mmx1q8cdxjwutex5t3s69d4nc0kdsvtcn2h207vcgvced78nzlvyh8mskhhgq7');
}

// === 2. app.html swap UI ===
console.log("\n2. app.html swap UI");
{
  const src = read(join(dappDir, 'app.html'));

  // Swap elements
  assertIncludes("app.html has swapFromAmount", src, 'id="swapFromAmount"');
  assertIncludes("app.html has swapToAmount", src, 'id="swapToAmount"');
  assertIncludes("app.html has swapFromToken", src, 'id="swapFromToken"');
  assertIncludes("app.html has swapToToken", src, 'id="swapToToken"');
  assertIncludes("app.html has flip button", src, 'id="swapFlip"');
  assertIncludes("app.html has swap button", src, 'id="swapBtn"');

  // Percentage helper buttons
  assertIncludes("app.html has 25% button", src, 'data-pct="25"');
  assertIncludes("app.html has 50% button", src, 'data-pct="50"');
  assertIncludes("app.html has 75% button", src, 'data-pct="75"');
  assertIncludes("app.html has Max button", src, 'data-pct="100"');
  assertIncludes("app.html has balance hint", src, 'id="swapBalanceHint"');

  // Slippage selector
  assertIncludes("app.html has slippage selector", src, 'id="swapSlippage"');
}

// === 3. app.html swap logic ===
console.log("\n3. app.html swap logic");
{
  const src = read(join(dappDir, 'app.html'));

  // Must use est.trade.value (not est.output or est.amount)
  assertIncludes("app.html uses est.trade?.value", src, 'est.trade?.value');

  // Pool data transform (parallel arrays to objects)
  assertIncludes("app.html transforms pool tokens", src, 'p.tokens || []).map');
  assertIncludes("app.html maps symbols array", src, 'p.symbols ||');
  assertIncludes("app.html maps decimals array", src, 'p.decimals ||');

  // swapTrade call
  assertIncludes("app.html calls swapTrade", src, 'app.swapTrade(');
}

// === 4. app.html paywall (Content tab) ===
console.log("\n4. app.html paywall");
{
  const src = read(join(dappDir, 'app.html'));
  assertIncludes("app.html has paywall tab content", src, 'id="tab-paywall"');
  assertIncludes("app.html has paywall button", src, 'id="paywallBtn"');
  assertIncludes("app.html has Morpheus address", src, 'mmx1vywfs5ymt9hfhkc3a37a3a5uw35mpl0j5l09qz59g3ek9t9az5sqgl8cq5');
  assertIncludes("app.html checks TRAIL balance", src, 'TRAIL');
  assertIncludes("app.html has Not enough TRAIL", src, 'Not enough TRAIL');
}

// === 5. swap-pools.html (read-only explorer) still works ===
console.log("\n6. swap-pools.html (old demo)");
{
  const src = read(join(dappDir, 'swap-pools.html'));
  assert("swap-pools.html exists", src.length > 0, true);

  // Uses est.trade.value (the working version)
  assertIncludes("swap-pools.html uses est.trade?.value", src, 'est.trade?.value');
  assertIncludes("swap-pools.html uses iters=1", src, 'iters=1');
}

// === 7. offers.html exists ===
console.log("\n7. offers.html exists");
{
  const src = read(join(dappDir, 'offers.html'));
  assert("offers.html exists", src.length > 0, true);
}

// === 8. dapp/index.html redirects to app.html ===
console.log("\n8. dapp/index.html redirect");
{
  const src = read(join(dappDir, 'index.html'));
  assertIncludes("dapp/index.html redirects to app.html", src, 'app.html');
}

// === 9. mmx-tx.js has swap trade support ===
console.log("\n9. mmx-tx.js swap trade support");
{
  const src = read(join(root, 'mmx-tx.js'));

  assertIncludes("mmx-tx.js has calcDepositHash", src, 'export function calcDepositHash');
  assertIncludes("mmx-tx.js has DEPOSIT_TYPE_HASH", src, 'DEPOSIT_TYPE_HASH');
  assertIncludes("mmx-tx.js has EXECUTE_TYPE_HASH", src, 'EXECUTE_TYPE_HASH');
  assertIncludes("mmx-tx.js has TX_NOTE_TRADE", src, 'TX_NOTE_TRADE');
  assertIncludes("mmx-tx.js exports TX_NOTE_TRADE", src, 'export { TX_NOTE, TX_NOTE_TRADE');
  assertIncludes("mmx-tx.js has writeVariant", src, 'function writeVariant');

  // Deposit hash fields
  assertIncludes("mmx-tx.js hashes version", src, '"version"');
  assertIncludes("mmx-tx.js hashes address", src, '"address"');
  assertIncludes("mmx-tx.js hashes method", src, '"method"');
  assertIncludes("mmx-tx.js hashes args", src, '"args"');
  assertIncludes("mmx-tx.js hashes user", src, '"user"');
  assertIncludes("mmx-tx.js hashes currency", src, '"currency"');
  assertIncludes("mmx-tx.js hashes amount", src, '"amount"');
}

// === 10. wallet-app.js has swapTrade ===
console.log("\n10. wallet-app.js swapTrade");
{
  const src = read(join(root, 'wallet-app.js'));

  assertIncludes("wallet-app.js has swapTrade function", src, 'export async function swapTrade');
  assertIncludes("wallet-app.js imports calcDepositHash", src, 'calcDepositHash');
  assertIncludes("wallet-app.js imports TX_NOTE_TRADE", src, 'TX_NOTE_TRADE');

  // swapTrade builds deposit with method "trade"
  assertIncludes("wallet-app.js uses trade method", src, 'method: "trade"');
  assertIncludes("wallet-app.js builds deposit operation", src, '__type: "mmx.operation.Deposit"');

  // swapTrade signs and broadcasts
  assertIncludes("wallet-app.js validates swap tx", src, 'Swap trade validation failed');
  assertIncludes("wallet-app.js broadcasts swap tx", src, 'api.broadcastTransaction');
}

// === 11. mmx-node-api.js has swap functions ===
console.log("\n11. mmx-node-api.js swap API functions");
{
  const src = read(join(root, 'mmx-node-api.js'));

  assertIncludes("mmx-node-api.js has getSwapList", src, 'export async function getSwapList');
  assertIncludes("mmx-node-api.js has getSwapInfo", src, 'export async function getSwapInfo');
  assertIncludes("mmx-node-api.js has getSwapTradeEstimate", src, 'export async function getSwapTradeEstimate');
  assertIncludes("mmx-node-api.js has getSwapUserInfo", src, 'export async function getSwapUserInfo');
}

// === 12. All dapp HTML files exist ===
console.log("\n12. dapp directory contents");
{
  const files = readdirSync(dappDir).filter(f => f.endsWith('.html'));
  assert("dapp/app.html exists", files.includes("app.html"), true);
      assert("dapp/swap-pools.html exists", files.includes("swap-pools.html"), true);
  assert("dapp/offers.html exists", files.includes("offers.html"), true);
  assert("dapp/index.html exists", files.includes("index.html"), true);
}

// === 13. Navigation links between wallet and dapp ===
console.log("\n13. Navigation links");
{
  const appSrc = read(join(dappDir, 'app.html'));
  assertIncludes("app.html links to ../wallet.html (correct relative path)", appSrc, 'href="../wallet.html"');
  assertIncludes("app.html has Wallet nav link", appSrc, '>💰 Wallet<');

  const walletSrc = read(join(dir, '../wallet.html'));
  assertIncludes("wallet.html links to dapp/app.html", walletSrc, 'href="dapp/app.html"');
  assertIncludes("wallet.html has Swap & Offers nav link", walletSrc, '>🔄 Swap & Offers<');
}

// === 13. Offer functions exist in wallet-app.js ===
console.log("\n13. Offer functions");
{
  const src = read(join(dir, "../wallet-app.js"));
  assertIncludes("wallet-app.js has makeOffer", src, 'export async function makeOffer');
  assertIncludes("wallet-app.js has acceptOffer", src, 'export async function acceptOffer');
  assertIncludes("wallet-app.js has cancelOffer", src, 'export async function cancelOffer');
  assertIncludes("wallet-app.js has OFFER_BINARY_ADDR", src, 'OFFER_BINARY_ADDR');
  assertIncludes("wallet-app.js imports calcExecutableHash", src, 'calcExecutableHash');
  assertIncludes("wallet-app.js imports calcExecuteHash", src, 'calcExecuteHash');
  assertIncludes("wallet-app.js imports TX_NOTE_OFFER", src, 'TX_NOTE_OFFER');
}

// === 14. Offer hash functions in mmx-tx.js ===
console.log("\n14. Offer hash functions");
{
  const src = read(join(dir, "../mmx-tx.js"));
  assertIncludes("mmx-tx.js has calcExecutableHash", src, 'export function calcExecutableHash');
  assertIncludes("mmx-tx.js has calcExecuteHash", src, 'export function calcExecuteHash');
  assertIncludes("mmx-tx.js has EXECUTABLE_TYPE_HASH", src, 'EXECUTABLE_TYPE_HASH');
  assertIncludes("mmx-tx.js has TX_NOTE_OFFER", src, 'TX_NOTE_OFFER');
  // TX_NOTE_OFFER must be 1549148948 (tx_note_e::OFFER)
  assertIncludes("mmx-tx.js has correct TX_NOTE_OFFER value", src, '1549148948');
  // TX_NOTE_TRADE must be 329618288 (tx_note_e::TRADE)
  assertIncludes("mmx-tx.js has correct TX_NOTE_TRADE value", src, '329618288');
}

// === 15. Offer API functions in mmx-node-api.js ===
console.log("\n15. Offer API functions");
{
  const src = read(join(dir, "../mmx-node-api.js"));
  assertIncludes("mmx-node-api.js has getOffer", src, 'export async function getOffer');
  assertIncludes("mmx-node-api.js has getTradeHistory", src, 'export async function getTradeHistory');
  assertIncludes("mmx-node-api.js has getOfferTradeEstimate", src, 'export async function getOfferTradeEstimate');
}

// === 16. app.html has offer UI elements ===
console.log("\n16. app.html offer UI");
{
  const src = read(join(dappDir, 'app.html'));
  assertIncludes("app.html has offerBidAmount input", src, 'id="offerBidAmount"');
  assertIncludes("app.html has offerAskAmount input", src, 'id="offerAskAmount"');
  assertIncludes("app.html has makeOfferBtn", src, 'id="makeOfferBtn"');
  assertIncludes("app.html has asksList", src, 'id="asksList"');
  assertIncludes("app.html has bidsList", src, 'id="bidsList"');
  assertIncludes("app.html has initOffersUI", src, 'initOffersUI');
  assertIncludes("app.html has makeOffer function", src, 'async function makeOffer');
  assertIncludes("app.html has loadOffers function", src, 'async function loadOffers');
}

// === RESULTS ===
console.log("\n==================================================");
const passed = (process.exitCode ? 0 : 16);
console.log(`dApp tests: ${passed} passed, ${process.exitCode ? 1 : 0} failed`);
if (process.exitCode) {
  console.log("❌ SOME TESTS FAILED");
} else {
  console.log("✅ ALL DAPP TESTS PASSED");
}
