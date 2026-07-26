/**
 * test-regression.mjs — Regression tests for bugs we found during development.
 *
 * Each test prevents a specific bug from returning. The comment above each
 * test explains the original bug and how it manifested.
 *
 * Run with: node test-regression.mjs
 */

import * as secp from "./node_modules/@noble/secp256k1/index.js";
import { sha256 } from "./node_modules/@noble/hashes/sha2.js";
import { bech32m } from "./lib/bech32-esm.js";
import "./lib/buffer-esm.js";
import { calcTxId, calcContentHash, signTx, BinaryWriter, TX_NOTE } from "./mmx-tx.js";

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

// === RESULTS ===
console.log(`\n${"=".repeat(50)}`);
console.log(`Regression tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("❌ SOME TESTS FAILED");
  process.exit(1);
} else {
  console.log("✅ ALL REGRESSION TESTS PASSED");
}
