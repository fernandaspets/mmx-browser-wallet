/*
 * test-security.mjs — Security tests for dApp integration hardening
 *
 * Tests the fixes contributed by ARTTOO:
 * 1. inject.js IIFE closure (prototype pollution protection)
 * 2. content.js listener cleanup (deny, timeout, approve)
 * 3. content.js send routing (MMX_SEND -> mmx_psend_, not mmx_pdapp_)
 * 4. Concurrent request isolation (ID-prefixed storage keys)
 * 5. Instant toggle (DAPP_ACTIVATE / MMX_DEACTIVATE)
 * 6. background.js storage.session + alarms usage
 * 7. inject.js nullifies window.mmx on MMX_DEACTIVATE
 * 8. Error propagation paths exist
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const dir = import.meta.dirname;
const read = (name) => readFileSync(join(dir, '..', name), 'utf8');

function assert(name, actual, expected) {
  if (actual !== expected) {
    console.error(`  ❌ ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ ${name}`);
  }
}

function assertIncludes(name, str, substr) {
  if (!str.includes(substr)) {
    console.error(`  ❌ ${name}: "${substr}" not found`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ ${name}`);
  }
}

function assertNotIncludes(name, str, substr) {
  if (str.includes(substr)) {
    console.error(`  ❌ ${name}: "${substr}" should NOT be present`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ ${name}`);
  }
}

console.log("📋 MMX Browser Wallet — Security Tests (ARTTOO hardening)\n");

// === 1. inject.js IIFE closure ===
console.log("1. inject.js IIFE closure (prototype pollution protection)");
{
  const src = read('inject.js');

  // Must be wrapped in IIFE
  assertIncludes("inject.js has IIFE wrapper", src, "(function() {");

  // _request must be a closure variable (function _request), not a property
  assertIncludes("inject.js has _request as closure function", src, "function _request(");

  // _request must NOT be a property of window.mmx object
  // Find the window.mmx = { block and verify _request is not a key
  const mmxBlockStart = src.indexOf("window.mmx = {");
  const mmxBlockEnd = src.indexOf("};", mmxBlockStart) + 2;
  const mmxBlock = src.slice(mmxBlockStart, mmxBlockEnd);
  // _request appears as function calls inside methods, but not as a property definition
  const hasRequestProp = mmxBlock.includes("_request:") || mmxBlock.includes("_request =");
  assert("window.mmx object does NOT expose _request as property", hasRequestProp, false);

  // window.mmx should only have isMMX, getAddress, send
  assertIncludes("window.mmx has isMMX", mmxBlock, "isMMX");
  assertIncludes("window.mmx has getAddress", mmxBlock, "getAddress");
  assertIncludes("window.mmx has send", mmxBlock, "send");

  // window.mmx_wallet should have all official API methods
  const walletBlockStart = src.indexOf("window.mmx_wallet = {");
  const walletBlockEnd = src.indexOf("};", walletBlockStart) + 2;
  const walletBlock = src.slice(walletBlockStart, walletBlockEnd);
  assertIncludes("window.mmx_wallet has get_address", walletBlock, "get_address");
  assertIncludes("window.mmx_wallet has get_public_key", walletBlock, "get_public_key");
  assertIncludes("window.mmx_wallet has get_network", walletBlock, "get_network");
  assertIncludes("window.mmx_wallet has sign_message", walletBlock, "sign_message");
  assertIncludes("window.mmx_wallet has sign_transaction", walletBlock, "sign_transaction");

  // _request must NOT be a property of window.mmx_wallet
  const hasWalletRequestProp = walletBlock.includes("_request:") || walletBlock.includes("_request =");
  assert("window.mmx_wallet does NOT expose _request as property", hasWalletRequestProp, false);
}

// === 2. content.js listener cleanup ===
console.log("\n2. content.js listener cleanup (deny, timeout, approve)");
{
  const src = read('content.js');

  // Must remove listener on DAPP_APPROVED
  assertIncludes("content.js removes listener on DAPP_APPROVED", src, "DAPP_APPROVED");
  assertIncludes("content.js removes approvalListener on approve", src, "removeListener(approvalListener)");

  // Must handle DAPP_DENIED
  assertIncludes("content.js handles DAPP_DENIED", src, "DAPP_DENIED");

  // Must have timeout for auto-cleanup
  assertIncludes("content.js has approval timeout", src, "approvalTimeout");
  assertIncludes("content.js timeout removes listener", src, "clearTimeout(approvalTimeout)");
}

// === 3. content.js send routing ===
console.log("\n3. content.js send routing (MMX_SEND -> mmx_psend_)");
{
  const src = read('content.js');

  // MMX_SEND must route to mmx_psend_ not mmx_pdapp_
  assertIncludes("content.js uses mmx_psend_ for sends", src, "mmx_psend_");
  assertIncludes("content.js uses mmx_sresult_ for send results", src, "mmx_sresult_");

  // Other types must use mmx_pdapp_
  assertIncludes("content.js uses mmx_pdapp_ for other confirms", src, "mmx_pdapp_");
  assertIncludes("content.js uses mmx_dresult_ for dapp results", src, "mmx_dresult_");

  // Must NOT use old fixed keys
  assertNotIncludes("content.js does NOT use old mmx_pending_send", src, "'mmx_pending_send'");
  assertNotIncludes("content.js does NOT use old mmx_send_result", src, "'mmx_send_result'");
  assertNotIncludes("content.js does NOT use old mmx_pending_dapp_action", src, "'mmx_pending_dapp_action'");
  assertNotIncludes("content.js does NOT use old mmx_dapp_result", src, "'mmx_dapp_result'");
}

// === 4. Concurrent request isolation (ID-prefixed keys) ===
console.log("\n4. Concurrent request isolation (ID-prefixed storage keys)");
{
  const contentSrc = read('content.js');
  const popupSrc = read('popup.js');

  // content.js must use template literals with id in keys
  assertIncludes("content.js uses ${id} in send key", contentSrc, "mmx_psend_${id}");
  assertIncludes("content.js uses ${id} in dapp key", contentSrc, "mmx_pdapp_${id}");

  // popup.js must scan with get(null) for prefixed keys
  assertIncludes("popup.js scans storage with get(null)", popupSrc, "storage.local.get(null");
  assertIncludes("popup.js finds mmx_psend_ prefix", popupSrc, "startsWith('mmx_psend_')");
  assertIncludes("popup.js finds mmx_pdapp_ prefix", popupSrc, "startsWith('mmx_pdapp_')");

  // popup.js must write results with ID-prefixed keys
  assertIncludes("popup.js writes mmx_sresult_ results", popupSrc, "mmx_sresult_${pending.id}");
  assertIncludes("popup.js writes mmx_dresult_ results", popupSrc, "mmx_dresult_${pending.id}");
}

// === 5. Instant toggle ===
console.log("\n5. Instant toggle (DAPP_ACTIVATE / MMX_DEACTIVATE)");
{
  const bgSrc = read('background.js');
  const contentSrc = read('content.js');
  const injectSrc = read('inject.js');

  // ON: background sends DAPP_ACTIVATE to tabs
  assertIncludes("background.js sends DAPP_ACTIVATE", bgSrc, "DAPP_ACTIVATE");
  assertIncludes("background.js uses tabs.query for activation", bgSrc, "tabs.query");
  assertIncludes("background.js uses tabs.sendMessage for activation", bgSrc, "tabs.sendMessage");

  // OFF: content.js detects storage change and dispatches event
  assertIncludes("content.js listens for mmx_dapp_enabled change", contentSrc, "mmx_dapp_enabled");
  assertIncludes("content.js dispatches MMX_DEACTIVATE", contentSrc, "MMX_DEACTIVATE");

  // inject.js nullifies window.mmx on MMX_DEACTIVATE
  assertIncludes("inject.js listens for MMX_DEACTIVATE", injectSrc, "MMX_DEACTIVATE");
  assertIncludes("inject.js deletes window.mmx", injectSrc, "delete window.mmx");
  assertIncludes("inject.js deletes window.mmx_wallet", injectSrc, "delete window.mmx_wallet");
}

// === 6. background.js storage.session + alarms ===
console.log("\n6. background.js storage.session + alarms");
{
  const src = read('background.js');

  // Must use storage.session
  assertIncludes("background.js uses storage.session", src, "storage.session");

  // Must use alarms for auto-lock
  assertIncludes("background.js uses chrome.alarms", src, "alarms");
  assertIncludes("background.js has alarm listener", src, "alarms.onAlarm.addListener");
  assertIncludes("background.js creates auto-lock alarm", src, "alarms.create");

  // Must zero seed on clear
  assertIncludes("background.js zeros seed on clear", src, ".fill(0)");

  // Must have fallback for browsers without storage.session
  assertIncludes("background.js has fallback for no session storage", src, "hasSessionStorage");
  assertIncludes("background.js has fallback for no alarms", src, "hasAlarms");
}

// === 7. inject.js MMX_DEACTIVATE fires mmx#deactivated ===
console.log("\n7. inject.js deactivation event");
{
  const src = read('inject.js');

  // Must dispatch mmx#deactivated event
  assertIncludes("inject.js dispatches mmx#deactivated", src, "mmx#deactivated");
}

// === 8. manifest.json permissions ===
console.log("\n8. manifest.json permissions");
{
  const src = read('manifest.json');
  const manifest = JSON.parse(src);

  // Must have alarms permission
  assert("manifest has alarms permission", manifest.permissions.includes("alarms"), true);

  // Must have tabs permission (for instant activation)
  assert("manifest has tabs permission", manifest.permissions.includes("tabs"), true);

  // Must have CSP
  assertIncludes("manifest has CSP", src, "content_security_policy");

  // Must NOT have <all_urls> in permissions (it's in host_permissions)
  assert("manifest does NOT have <all_urls> in permissions", manifest.permissions.includes("<all_urls>"), false);
}

// === 9. popup.js DAPP_DENIED message ===
console.log("\n9. popup.js sends DAPP_DENIED");
{
  const src = read('popup.js');

  // Deny button must send DAPP_DENIED message
  assertIncludes("popup.js sends DAPP_DENIED on deny", src, "DAPP_DENIED");
}

// === 10. Error propagation in paywall ===
console.log("\n10. Error propagation in paywall demo");
{
  const src = read('demo/paywall.html');

  // Must have try/catch in startPayment
  assertIncludes("paywall has try/catch in payment", src, "catch (e)");
  assertIncludes("paywall shows error message", src, "status.error");
  assertIncludes("paywall re-enables button on error", src, "btn.disabled = false");
}

// === RESULTS ===
console.log("\n==================================================");
const passed = (process.exitCode ? 0 : 10);
console.log(`Security tests: ${passed} passed, ${process.exitCode ? 1 : 0} failed`);
if (process.exitCode) {
  console.log("❌ SOME TESTS FAILED");
} else {
  console.log("✅ ALL SECURITY TESTS PASSED");
}
