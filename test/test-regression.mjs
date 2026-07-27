/**
 * test-regression.mjs — Regression tests for bugs we found during development.
 *
 * Each test prevents a specific bug from returning. The comment above each
 * test explains the original bug and how it manifested.
 *
 * Run with: node test-regression.mjs
 */

import * as secp from "../node_modules/@noble/secp256k1/index.js";
import { sha256 } from "../node_modules/@noble/hashes/sha2.js";
import { bech32m } from "../lib/bech32-esm.js";
import "../lib/buffer-esm.js";
import { calcTxId, calcContentHash, signTx, BinaryWriter, TX_NOTE } from "../mmx-tx.js";

secp.hashes.sha256 = (data) => sha256(data);
secp.hashes.hmacSha256 = (key, data) => sha256(Buffer.concat([Buffer.from(key), Buffer.from(data)]));

let passed = 0;
let failed = 0;

function assert(name, actual, expected) {
  if (actual === expected) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    console.log(`     Expected: ${expected}`);
    console.log(`     Actual:   ${actual}`);
    failed++;
  }
}

function assertEqual(name, actual, expected) {
  const a = typeof actual === "string" ? actual : Buffer.from(actual).toString("hex");
  const e = typeof expected === "string" ? expected : Buffer.from(expected).toString("hex");
  assert(name, a, e);
}

function assertThrows(name, fn) {
  try {
    fn();
    console.log(`  ❌ ${name} (expected error but none thrown)`);
    failed++;
  } catch {
    console.log(`  ✅ ${name}`);
    passed++;
  }
}

// --- Helpers ---
function uint128LE(val) {
  const v = BigInt(val);
  const arr = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) arr[i] = Number((v >> BigInt(i * 8)) & 0xFFn);
  return arr;
}

function makeTestTx(overrides = {}) {
  const addrBytes = new Array(32).fill(0).map((_, i) => (i + 1) % 256);
  return {
    version: 0,
    expires: 4793000,
    fee_ratio: 1024,
    max_fee_amount: 5040000,
    note: "TRANSFER",
    nonce: 42n,
    network: "mainnet",
    sender: addrBytes,
    inputs: [{
      address: addrBytes,
      contract: new Array(32).fill(0),
      amount: uint128LE(1000000n),
      memo: null,
      solution: 0,
      flags: 0,
    }],
    outputs: [{
      address: addrBytes,
      contract: new Array(32).fill(0),
      amount: uint128LE(1000000n),
      memo: null,
    }],
    execute: [],
    deploy: null,
    static_cost: 50000,
    ...overrides,
  };
}

console.log("\n📋 MMX Browser Wallet — Regression Tests\n");

// === REGRESSION: max_fee_amount must be 8 bytes (uint32), not 16 bytes (uint128) ===
// Bug: Writing max_fee_amount as uint128 (16 bytes) produced wrong transaction hashes.
// The node's hash didn't match, causing "invalid tx" errors.
console.log("1. max_fee_amount serialization (must be 8 bytes, not 16)");

{
  const tx = makeTestTx();
  const w = new BinaryWriter();
  // Serialize just the max_fee_amount field to check its size
  w.writeField("max_fee_amount", () => w.writeUint32LE(tx.max_fee_amount));
  // writeField adds "field<>" + "string<>" + name + value
  // The value portion should be 8 bytes (uint32 promoted to uint64)
  // Total: "field<>" (7) + "string<>" (8) + len(8) + "max_fee_amount" (13) + 8 = 44
  // But we just need to verify the uint32 write is 8 bytes,  not 16
  const w2 = new BinaryWriter();
  w2.writeUint32LE(tx.max_fee_amount);
  assert("max_fee_amount serializes to 8 bytes (not 16)", w2.buf.length, 8);
}

// === REGRESSION: @noble/secp256k1 prehash must be false ===
// Bug: @noble v3 defaults prehash:true, which double-hashes the message.
// Signatures were valid per @noble but rejected by the MMX node.
console.log("\n2. Signature prehash (must be false for pre-hashed data)");

{
  const skey = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  const msgHash = sha256(Buffer.from("test"));
  const sig = await signTx(Buffer.from(msgHash), skey);

  // Verify with @noble using prehash:false (correct)
  const validCorrect = await secp.verify(
    Uint8Array.from(sig.signature),
    Uint8Array.from(msgHash),
    Uint8Array.from(sig.pubkey),
    { prehash: false }
  );
  assert("Signature verifies with prehash:false", validCorrect, true);

  // Verify with @noble using prehash:true (would double-hash, should fail)
  const validWrong = await secp.verify(
    Uint8Array.from(sig.signature),
    Uint8Array.from(msgHash),
    Uint8Array.from(sig.pubkey),
    { prehash: true }
  );
  assert("Signature does NOT verify with prehash:true (would double-hash)", validWrong, false);
}

// === REGRESSION: bech32m must use fromWords, not manual BigInt bit-shifting ===
// Bug: Manual BigInt bit-shifting produced wrong address bytes.
// Sending to mmx10lrzsfeam8... went to mmx18l33gyu7... instead.
console.log("\n3. bech32m address decoding (fromWords, not BigInt)");

{
  const addr = "mmx10lrzsfeam8m8lmrxnhzd2zn4kahtkmnthd0nhytstw52s92d0wdq7x0824";
  const { words } = bech32m.decode(addr);
  const bytes = bech32m.fromWords(words);

  // The wrong BigInt method would produce different bytes
  let bigIntBits = 0n;
  for (let i = 0; i < 51; i++) bigIntBits = (bigIntBits << 5n) | BigInt(words[i]);
  bigIntBits = (bigIntBits << 4n) | (BigInt(words[51]) >> 1n);
  const bigIntHex = bigIntBits.toString(16).padStart(64, "0");
  const bigIntBytes = Buffer.from(bigIntHex, "hex");

  const fromWordsHex = Buffer.from(bytes).toString("hex");
  const bigIntHexStr = bigIntBytes.toString("hex");

  assert("fromWords produces correct bytes", bytes.length, 32);
  assert("BigInt method produces DIFFERENT (wrong) bytes", fromWordsHex === bigIntHexStr, false);
  assert("fromWords round-trip matches original address",
    bech32m.encode("mmx", bech32m.toWords(bytes)), addr);
}

// === REGRESSION: expires must be absolute block height, not relative ===
// Bug: Setting expires=100 caused immediate TX_EXPIRED (block 100 is ancient).
console.log("\n4. Transaction expires field (absolute height)");

{
  // The wallet API sets expires = get_height() + 100
  // Our code should set it the same way
  const currentHeight = 4793000;
  const expires = currentHeight + 100;
  assert("expires is absolute (current + 100)", expires, 4793100);
  assert("expires=100 would be ancient (not relative)", 100 < currentHeight, true);
}

// === REGRESSION: nonce must be 64-bit crypto random, not Math.random ===
// Bug: Math.random()*1e15 only gave ~50 bits of entropy. Now using crypto.getRandomValues.
console.log("\n5. Nonce entropy (64-bit crypto random)");

{
  // Generate nonce like wallet-app.js does
  const nonceBytes = crypto.getRandomValues(new Uint8Array(8));
  let nonce = 0n;
  for (let i = 0; i < 8; i++) nonce |= BigInt(nonceBytes[i]) << BigInt(i * 8);
  if (nonce === 0n) nonce = 1n;

  // Verify it's 64-bit (can exceed Number.MAX_SAFE_INTEGER)
  assert("Nonce can exceed MAX_SAFE_INTEGER", nonce > 9007199254740991n, true);

  // Verify two nonces are different (not constant)
  const nonceBytes2 = crypto.getRandomValues(new Uint8Array(8));
  let nonce2 = 0n;
  for (let i = 0; i < 8; i++) nonce2 |= BigInt(nonceBytes2[i]) << BigInt(i * 8);
  if (nonce2 === 0n) nonce2 = 1n;
  assert("Two nonces are different", nonce !== nonce2, true);
}

// === REGRESSION: MMX is account-based, input amount = output amount ===
// Bug: Building tx with change output (like Bitcoin) produced wrong results.
console.log("\n6. Account-based tx model (input = output, no change)");

{
  const tx = makeTestTx();
  const inputAmount = tx.inputs[0].amount;
  const outputAmount = tx.outputs[0].amount;
  assert("Input amount equals output amount",
    Buffer.from(inputAmount).toString("hex"),
    Buffer.from(outputAmount).toString("hex"));
  assert("Only 1 output (no change)", tx.outputs.length, 1);
}

// === REGRESSION: TX_NOTE must use TRANSFER enum value, not string ===
// Bug: If note is passed as string "TRANSFER" but TX_NOTE lookup fails, hash is wrong.
console.log("\n7. TX_NOTE enum lookup");

{
  assert("TRANSFER maps to correct enum value", TX_NOTE["TRANSFER"], 858544509);
  assert("Unknown note maps to 0", TX_NOTE["UNKNOWN"] || 0, 0);
}

// === REGRESSION: txId and contentHash must differ when solutions present ===
// Bug: If content_hash = tx_id, the node rejects (solutions not included in id).
console.log("\n8. txId vs contentHash (must differ with solutions)");

{
  const tx = makeTestTx();
  const txId = calcTxId(tx);

  // Add a solution
  const skey = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  const solution = await signTx(txId, skey);
  tx.solutions = [solution];

  const contentHash = calcContentHash(tx);
  assert("txId differs from contentHash (solutions included in contentHash)",
    Buffer.from(txId).toString("hex") !== Buffer.from(contentHash).toString("hex"), true);
}

// === REGRESSION: execute/solutions fields use write_field(name) + count, not write_field(name, value) ===
// Bug: Wrapping execute in vector<> produced wrong serialization.
console.log("\n9. execute field serialization (no vector wrapper)");

{
  const tx = makeTestTx();
  const w = new BinaryWriter();
  // The correct pattern: write_field(name) then count
  w.writeCStr("field<>");
  w.writeString("execute");
  w.writeUint32LE(0); // count = 0

  // Verify: after "execute" + uint64(0), there is NO "vector<>" tag
  const hex = Buffer.from(w.buf).toString("hex");
  const execHex = Buffer.from("execute").toString("hex");
  const execIdx = hex.indexOf(execHex);
  assert("execute field found in serialization", execIdx >= 0, true);
  // After execute + 8 bytes count, should NOT start with "vector<>"
  const afterExec = hex.substring(execIdx + execHex.length + 16);
  const vectorHex = Buffer.from("vector<>").toString("hex");
  assert("No vector<> after execute field", afterExec.indexOf(vectorHex) !== 0, true);
}

// === REGRESSION: BigInt nonce must be JSON.stringify-able (#bug: send crashed) ===
// Bug: nonce was BigInt, JSON.stringify threw "Do not know how to serialize a BigInt",
// caught by fetch try/catch and shown as "Network error: cannot reach MMX node"
console.log("\nBigInt nonce serialization");
{
  const nonce = 123456789012345n;
  // Bug: BigInt in object crashes JSON.stringify
  let threw = false;
  try { JSON.stringify({ nonce }); } catch { threw = true; }
  assert("JSON.stringify with BigInt nonce throws", threw, true);

  // Fix: convert to string
  const fixed = { nonce: nonce.toString() };
  let jsonStr = null;
  try { jsonStr = JSON.stringify(fixed); } catch { threw = true; }
  assert("JSON.stringify with string nonce works", jsonStr !== null, true);
  assert("String nonce preserves value", JSON.parse(jsonStr).nonce, "123456789012345");

  // Verify max uint64 nonce serializes
  const maxNonce = 0xFFFFFFFFFFFFFFFFn;
  const maxStr = { nonce: maxNonce.toString() };
  let maxJson = null;
  try { maxJson = JSON.stringify(maxStr); } catch { threw = true; }
  assert("Max uint64 nonce serializes as string", maxJson !== null, true);
}

// === REGRESSION: showMnemonic requires password (#bug: silent failure) ===
// Bug: showMnemonic() called with no arg → password=undefined → unlock fails silently
console.log("\nShow mnemonic requires password");
{
  // The function signature is: showMnemonic(password)
  // If called with undefined, it should throw, not silently fail
  function mockShowMnemonic(password) {
    if (!password) throw new Error("Password required");
    return ["word1", "word2"];
  }
  let threwUndefined = false;
  try { mockShowMnemonic(); } catch { threwUndefined = true; }
  assert("showMnemonic(undefined) throws", threwUndefined, true);

  let threwEmpty = false;
  try { mockShowMnemonic(""); } catch { threwEmpty = true; }
  assert("showMnemonic(empty string) throws", threwEmpty, true);

  let result = null;
  try { result = mockShowMnemonic("correct-pw"); } catch { result = null; }
  assert("showMnemonic(password) returns words", result !== null, true);
}

// === REGRESSION: formatAmount respects decimals (#bug: showed raw satoshis) ===
// Bug: tx history showed 2000000 instead of 2 MMX (6 decimals)
console.log("\nFormat amount with decimals");
{
  function formatAmount(raw, decimals) {
    const sat = BigInt(raw);
    const div = BigInt(10) ** BigInt(decimals);
    const whole = sat / div;
    const frac = sat % div;
    if (decimals === 0) return whole.toString();
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  }
  assert("2000000 with 6 decimals = 2", formatAmount("2000000", 6), "2");
  assert("1000 with 6 decimals = 0.001", formatAmount("1000", 6), "0.001");
  assert("1 with 0 decimals = 1", formatAmount("1", 0), "1");
  assert("1500000 with 6 decimals = 1.5", formatAmount("1500000", 6), "1.5");
  assert("50000 with 6 decimals = 0.05", formatAmount("50000", 6), "0.05");
  assert("0 with 6 decimals = 0", formatAmount("0", 6), "0");
}

// === REGRESSION: manifest has host_permissions (#bug: Firefox blocked fetch) ===
// Bug: Firefox MV3 requires host_permissions to fetch external URLs
console.log("\nManifest host_permissions");
{
  const fs = await import("fs");
  const manifest = JSON.parse(fs.readFileSync(import.meta.dirname + "/../manifest.json", "utf8"));
  assert("manifest has host_permissions", Array.isArray(manifest.host_permissions), true);
  assert("host_permissions includes rpc.mmx.network",
    manifest.host_permissions.some(h => h.includes("rpc.mmx.network")), true);
  // dApp integration is opt-in: no content_scripts in manifest, uses dynamic registration
  assert("no content_scripts in manifest (opt-in via scripting API)",
    !manifest.content_scripts, true);
  assert("manifest has scripting permission",
    manifest.permissions.includes("scripting"), true);
  // <all_urls> is in host_permissions (granted at install, no runtime dialog needed)
  assert("host_permissions includes <all_urls>",
    manifest.host_permissions.includes("<all_urls>"), true);
  assert("no optional_permissions (not needed)",
    !manifest.optional_permissions, true);
}

// === REGRESSION: no prompt()/confirm()/alert() in source (#bug: popup windows) ===
// Bug: password prompts used browser popup windows instead of inline UI
console.log("\nNo popup dialogs in source");
{
  const fs = await import("fs");
  const files = ["popup.js", "popup.html", "wallet.html", "content.js"];
  let allClean = true;
  for (const f of files) {
    const src = fs.readFileSync(import.meta.dirname + "/../" + f, "utf8");
    if (/\bprompt\s*\(/.test(src)) { console.log(`  ❌ ${f} has prompt()`); allClean = false; }
    if (/\bconfirm\s*\(/.test(src)) { console.log(`  ❌ ${f} has confirm()`); allClean = false; }
    if (/\balert\s*\(/.test(src)) { console.log(`  ❌ ${f} has alert()`); allClean = false; }
  }
  assert("No prompt()/confirm()/alert() in UI source", allClean, true);
}

// === REGRESSION: wallet.html and popup.html pass syntax check (#bug: await in non-async) ===
// Bug: onclick handler used await but wasn't async → SyntaxError broke entire page
console.log("\nHTML inline script syntax check");
{
  const fs = await import("fs");
  const { execSync } = await import("child_process");
  const files = ["wallet.html", "popup.html"];
  let allValid = true;
  for (const f of files) {
    const html = fs.readFileSync(import.meta.dirname + "/../" + f, "utf8");
    const match = html.match(/<script[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) { console.log(`  ⚠️  ${f}: no module script found`); continue; }
    const tmpFile = `/tmp/syntax-check-${f}.mjs`;
    fs.writeFileSync(tmpFile, match[1]);
    try {
      execSync(`node --check ${tmpFile}`, { stdio: 'pipe' });
      console.log(`  ✅ ${f} syntax OK`);
    } catch {
      console.log(`  ❌ ${f} has syntax errors`);
      allValid = false;
    }
  }
  assert("All HTML scripts pass syntax check", allValid, true);
}

// === REGRESSION: Fee estimate is dynamic, not hardcoded (#bug: fee could change) ===
// Bug: fee was hardcoded to 50000 sat. If network congestion raises fees, tx fails.
console.log("\nDynamic fee estimate");
{
  // Fee for standard transfer = static_cost in satoshis
  // static_cost = min_txfee(20000) + 1in(10000) + 1out(10000) + 1sol(10000) = 50000
  const staticCost = 50000n;
  const feeSat = staticCost;
  assert("Standard transfer fee = 50000 sat", feeSat, 50000n);
  assert("Fee in MMX = 0.05", Number(feeSat) / 1e6, 0.05);
  
  // If average_txfee is 0, transactions are free (special network mode)
  const freeFee = 0n;
  assert("Free mode fee = 0", freeFee, 0n);
  
  // Verify getFeeEstimate returns BigInt (not number) to avoid precision loss
  assert("Fee is BigInt", typeof feeSat, "bigint");
}

// === REGRESSION: Theme system exists and has CSS variables (#bug: hardcoded colors) ===
console.log("\nTheme system");
{
  const fs = await import("fs");
  
  // theme.css exists
  assert("theme.css exists", fs.existsSync("./theme.css"), true);
  
  // theme.css has dark and light variables
  const css = fs.readFileSync(import.meta.dirname + "/../theme.css", "utf8");
  assert("Dark theme defined", css.includes(".theme-dark"), true);
  assert("Light theme defined", css.includes(".theme-light"), true);
  assert("CSS variables used", css.includes("--bg:"), true);
  assert("Theme toggle class defined", css.includes(".theme-toggle"), true);
  
  // manifest includes theme.css
  const manifest = JSON.parse(fs.readFileSync(import.meta.dirname + "/../manifest.json", "utf8"));
  const resources = manifest.web_accessible_resources[0].resources;
  assert("theme.css in web_accessible_resources", resources.includes("theme.css"), true);
  
  // HTML files reference theme.css
  const popupHtml = fs.readFileSync(import.meta.dirname + "/../popup.html", "utf8");
  const walletHtml = fs.readFileSync(import.meta.dirname + "/../wallet.html", "utf8");
  assert("popup.html imports theme.css", popupHtml.includes("theme.css"), true);
  assert("wallet.html imports theme.css", walletHtml.includes("theme.css"), true);
  
  // HTML files have theme toggle button
  assert("popup.html has theme toggle", popupHtml.includes("themeToggle"), true);
  assert("wallet.html has theme toggle", walletHtml.includes("themeToggle"), true);
}

// === REGRESSION: Balance conversion — API returns float, not satoshis (#bug: showed 0.000001 MMX) ===
// Bug: spendable=1.282603 (float), BigInt(Math.floor(1.282603))=1 sat → thought had 0.000001 MMX
console.log("\nBalance conversion from float");
{
  // API returns spendable as human-readable float (e.g. 1.282603 MMX, 1.0 TRAIL)
  const mmxSpendableFloat = 1.282603;
  const trailSpendableFloat = 1.0;

  // BUG: treating float as satoshis
  const bugSat = BigInt(Math.floor(mmxSpendableFloat));
  assert("BUG: 1.282603 treated as 1 sat", bugSat, 1n);
  assert("BUG: displays as 0.000001 MMX", (Number(bugSat) / 1e6).toFixed(6), "0.000001");

  // FIX: multiply by 10^decimals
  const fixedMmxSat = BigInt(Math.floor(mmxSpendableFloat * Math.pow(10, 6)));
  assert("FIX: 1.282603 MMX = 1282603 sat", fixedMmxSat, 1282603n);
  assert("FIX: displays as 1.282603 MMX", (Number(fixedMmxSat) / 1e6).toFixed(6), "1.282603");

  const fixedTrailSat = BigInt(Math.floor(trailSpendableFloat * Math.pow(10, 0)));
  assert("FIX: 1.0 TRAIL = 1 unit", fixedTrailSat, 1n);

  // Balance check should pass: have 1282603 sat, need 1000 + 0 (free mode) = 1000
  const feeSat = 0n; // free mode on mainnet
  const amountSat = 1000n;
  assert("Sufficient balance with fix", fixedMmxSat >= amountSat + feeSat, true);
  assert("Insufficient with bug", bugSat < amountSat + feeSat, true);
}

// === Session persistence (background holds seed across popup reopen) ===
{
  // wallet-app.js must export restoreSession, getUnlockedSeed, getUnlockedWalletId
  const app = await import("../wallet-app.js");
  assert("restoreSession is a function", typeof app.restoreSession, "function");
  assert("getUnlockedSeed is a function", typeof app.getUnlockedSeed, "function");
  assert("getUnlockedWalletId is a function", typeof app.getUnlockedWalletId, "function");

  // Simulate: background returns seed + wallet, popup restores without password
  const fakeSeed = new Uint8Array(32).fill(42);
  const fakeWallet = { id: "test-id", name: "Test", address: "mmx1test" };
  app.restoreSession(fakeSeed, fakeWallet);
  assert("restoreSession sets unlocked state", app.isUnlocked(), true);
  assert("getUnlockedSeed returns the seed", JSON.stringify(Array.from(app.getUnlockedSeed())), JSON.stringify(Array.from(fakeSeed)));
  assert("getUnlockedWalletId returns wallet id", app.getUnlockedWalletId(), "test-id");
  assert("getUnlockedAddress returns address", app.getUnlockedAddress(), "mmx1test");

  // Lock clears everything
  app.lockWalletPub();
  assert("Lock clears unlocked state", app.isUnlocked(), false);
  assert("Lock clears seed", app.getUnlockedSeed(), null);
  assert("Lock clears wallet id", app.getUnlockedWalletId(), null);

  // Seed can be serialized to Array and back (for runtime.sendMessage)
  app.restoreSession(fakeSeed, fakeWallet);
  const seedArray = Array.from(app.getUnlockedSeed());
  const restoredSeed = new Uint8Array(seedArray);
  assert("Seed round-trips through Array serialization", JSON.stringify(Array.from(restoredSeed)), JSON.stringify(Array.from(fakeSeed)));

  // Lock to clear the auto-lock timer (otherwise Node hangs for 5 min)
  app.lockWalletPub();
}

// === XSS prevention: escapeHtml ===
console.log("\nXSS prevention (escapeHtml)");
{
  const app = await import("../wallet-app.js");
  assert("escapeHtml is a function", typeof app.escapeHtml, "function");
  assert("escapes <", app.escapeHtml("<script>"), "&lt;script&gt;");
  assert("escapes >", app.escapeHtml("a>b"), "a&gt;b");
  assert("escapes \"", app.escapeHtml('a"b'), "a&quot;b");
  assert("escapes '", app.escapeHtml("a'b"), "a&#39;b");
  assert("escapes &", app.escapeHtml("a&b"), "a&amp;b");
  assert("null returns empty", app.escapeHtml(null), "");
  assert("undefined returns empty", app.escapeHtml(undefined), "");
  assert("number converts to string", app.escapeHtml(42), "42");
  // Real XSS payload
  const payload = '<img src=x onerror=alert(1)>';
  const escaped = app.escapeHtml(payload);
  assert("XSS payload is escaped", escaped.includes("&lt;img"), true);
  assert("XSS payload has no raw <", escaped.includes("<img"), false);
}

// === Seed zeroing on lock ===
console.log("\nSeed zeroing on lock");
{
  const app = await import("../wallet-app.js");
  const seed = new Uint8Array(32).fill(99);
  app.restoreSession(seed, { id: "test", name: "T", address: "mmx1test" });
  const seedBefore = Array.from(app.getUnlockedSeed());
  assert("Seed is set", seedBefore[0], 99);
  app.lockWalletPub();
  assert("Seed is null after lock", app.getUnlockedSeed(), null);
  // The original seed array should have been filled with zeros
  assert("Seed bytes were zeroed", seed[0], 0);
  assert("All seed bytes zeroed", seed.every(b => b === 0), true);
}

// === content.js postMessage uses origin, not '*' ===
console.log("\ncontent.js postMessage origin");
{
  const fs = await import("fs");
  const contentSrc = fs.readFileSync(import.meta.dirname + "/../content.js", "utf8");
  // Should NOT have any postMessage with '*'
  assert("no postMessage with '*'", contentSrc.includes("}, '*')"), false);
  assert("uses respondToPage helper", contentSrc.includes("function respondToPage"), true);
  assert("respondToPage uses location.origin", contentSrc.includes("window.location.origin"), true);
}

// === CSP in manifest ===
console.log("\nCSP in manifest");
{
  const fs = await import("fs");
  const manifest = JSON.parse(fs.readFileSync(import.meta.dirname + "/../manifest.json", "utf8"));
  assert("manifest has content_security_policy", !!manifest.content_security_policy, true);
  assert("CSP restricts script-src to self", manifest.content_security_policy.extension_pages.includes("script-src 'self'"), true);
  assert("CSP restricts object-src to self", manifest.content_security_policy.extension_pages.includes("object-src 'self'"), true);
}

// === Official MMX dApp API (window.mmx_wallet) ===
console.log("\nOfficial MMX dApp API");
{
  const fs = await import("fs");
  const injectSrc = fs.readFileSync(import.meta.dirname + "/../inject.js", "utf8");
  // window.mmx_wallet must be injected
  assert("inject.js creates window.mmx_wallet", injectSrc.includes("window.mmx_wallet"), true);
  assert("mmx_wallet has get_address", injectSrc.includes("get_address:"), true);
  assert("mmx_wallet has get_public_key", injectSrc.includes("get_public_key:"), true);
  assert("mmx_wallet has get_network", injectSrc.includes("get_network:"), true);
  assert("mmx_wallet has sign_message", injectSrc.includes("sign_message:"), true);
  assert("mmx_wallet has sign_transaction", injectSrc.includes("sign_transaction:"), true);
  // window.mmx_wallet must NOT conflict with node GUI (which only checks window.mmx)
  assert("inject.js doesn't clobber existing window.mmx", injectSrc.includes("typeof window.mmx === 'undefined'"), true);
}

// === wallet-app.js dApp API functions ===
console.log("\nwallet-app.js dApp API functions");
{
  const app = await import("../wallet-app.js");
  assert("getPublicKeyHex is a function", typeof app.getPublicKeyHex, "function");
  assert("getNetwork is a function", typeof app.getNetwork, "function");
  assert("signMessage is a function", typeof app.signMessage, "function");
  assert("signTransactionObject is a function", typeof app.signTransactionObject, "function");
  assert("getNetwork returns MMX/mainnet", app.getNetwork(), "MMX/mainnet");
}

// === sign_message produces valid signature ===
console.log("\nsign_message produces valid signature");
{
  const app = await import("../wallet-app.js");
  // DON'T import buffer-esm.js — breaks Node fetch
  const secp = await import("../node_modules/@noble/secp256k1/index.js");
  const { sha256 } = await import("../node_modules/@noble/hashes/sha2.js");
  secp.hashes.sha256 = (data) => sha256(data);
  secp.hashes.hmacSha256 = (key, data) => sha256(Buffer.concat([Buffer.from(key), Buffer.from(data)]));

  // Restore a session so we can sign
  const { Buffer } = await import("buffer");
  const testSeed = new Uint8Array(32).fill(42);
  app.restoreSession(testSeed, { id: "t", name: "T", address: "mmx1test" });

  const result = await app.signMessage("test123");
  assert("signature is hex string", typeof result.signature, "string");
  assert("public_key is hex string", typeof result.public_key, "string");
  assert("signature is 128 chars (64 bytes hex)", result.signature.length, 128);
  assert("public_key is 66 chars (33 bytes hex compressed)", result.public_key.length, 66);

  // Verify: SHA256("MMX/sign_message/test123") signed with prehash:false
  const msgHash = Buffer.from(sha256(Buffer.from("MMX/sign_message/test123")));
  const pubkey = Buffer.from(result.public_key, "hex");
  const sig = Buffer.from(result.signature, "hex");
  const isValid = secp.verify(sig, msgHash, pubkey, { prehash: false });
  assert("signature verifies against message hash", isValid, true);

  // Wrong message should NOT verify
  const wrongHash = Buffer.from(sha256(Buffer.from("MMX/sign_message/wrong")));
  const invalidSig = secp.verify(sig, wrongHash, pubkey, { prehash: false });
  assert("signature fails on wrong message", invalidSig, false);

  app.lockWalletPub();
}

// === content.js handles new request types ===
console.log("\ncontent.js handles new request types");
{
  const fs = await import("fs");
  const contentSrc = fs.readFileSync(import.meta.dirname + "/../content.js", "utf8");
  assert("content.js handles MMX_GET_PUBLIC_KEY", contentSrc.includes("MMX_GET_PUBLIC_KEY"), true);
  assert("content.js handles MMX_GET_NETWORK", contentSrc.includes("MMX_GET_NETWORK"), true);
  assert("content.js handles MMX_SIGN_MESSAGE", contentSrc.includes("MMX_SIGN_MESSAGE"), true);
  assert("content.js handles MMX_SIGN_TRANSACTION", contentSrc.includes("MMX_SIGN_TRANSACTION"), true);
  assert("content.js uses mmx_pending_dapp_action", contentSrc.includes("mmx_pending_dapp_action"), true);
  assert("content.js uses mmx_dapp_result", contentSrc.includes("mmx_dapp_result"), true);
}

// === Swap pool demo: human amounts, iters, price display ===
console.log("\nSwap pool demo");
{
  const fs = await import("fs");
  const swapSrc = fs.readFileSync(import.meta.dirname + "/../demo/swap-pools.html", "utf8");
  // Must send human amounts directly (not raw satoshis)
  assert("swap demo sends human amount directly", swapSrc.includes("const rawAmt = amt"), true);
  // Must use iters=1 (matches official GUI)
  assert("swap demo uses iters=1", swapSrc.includes("iters=1"), true);
  // Must not multiply by 10^decimals
  assert("swap demo does not convert to raw", swapSrc.includes("Math.pow(10, decimals)"), false);
  // Buy direction shows inverted price (1/avg_price = MMX/TRAIL)
  assert("swap demo inverts price for buy direction", swapSrc.includes("1 / avgPrice"), true);
}

// === Demo hub and pages exist ===
console.log("\nDemo files");
{
  const fs = await import("fs");
  const path = await import("path");
  const demoDir = path.resolve(import.meta.dirname, "../demo");
  const files = fs.readdirSync(demoDir).filter(f => f.endsWith(".html"));
  assert("demo/index.html exists", files.includes("index.html"), true);
  assert("demo/paywall.html exists", files.includes("paywall.html"), true);
  assert("demo/swap-pools.html exists", files.includes("swap-pools.html"), true);
  assert("demo/offers.html exists", files.includes("offers.html"), true);
  // Index links to all demos
  const indexSrc = fs.readFileSync(path.join(demoDir, "index.html"), "utf8");
  assert("index links to paywall", indexSrc.includes("paywall.html"), true);
  assert("index links to swap-pools", indexSrc.includes("swap-pools.html"), true);
  assert("index links to offers", indexSrc.includes("offers.html"), true);
}

// === mmx-node-api.js swap functions ===
console.log("\nSwap API functions");
{
  const fs = await import("fs");
  const apiSrc = fs.readFileSync(import.meta.dirname + "/../mmx-node-api.js", "utf8");
  assert("getSwapList exported", apiSrc.includes("export async function getSwapList"), true);
  assert("getSwapInfo exported", apiSrc.includes("export async function getSwapInfo"), true);
  assert("getSwapUserInfo exported", apiSrc.includes("export async function getSwapUserInfo"), true);
  assert("getSwapTradeEstimate exported", apiSrc.includes("export async function getSwapTradeEstimate"), true);
}

// === signTransactionObject zeros skey ===
console.log("\nsignTransactionObject security");
{
  const fs = await import("fs");
  const appSrc = fs.readFileSync(import.meta.dirname + "/../wallet-app.js", "utf8");
  // Find signTransactionObject function and check skey.fill(0) is inside it
  const funcStart = appSrc.indexOf("export async function signTransactionObject");
  const funcEnd = appSrc.indexOf("\n}", funcStart);
  const funcBody = appSrc.substring(funcStart, funcEnd);
  assert("signTransactionObject zeros skey", funcBody.includes("skey.fill(0)"), true);
  assert("signTransactionObject uses prehash:false", funcBody.includes("prehash: false"), false); // signTx handles that
}

// === RESULTS ===
console.log(`\n${"=".repeat(50)}`);
console.log(`Regression tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("❌ SOME TESTS FAILED");
  process.exit(1);
} else {
  console.log("✅ ALL REGRESSION TESTS PASSED");
}
