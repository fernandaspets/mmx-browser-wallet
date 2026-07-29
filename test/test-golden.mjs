/**
 * test-golden.mjs — Golden test vectors for transaction hash verification.
 *
 * These test vectors are derived from Stotiks' mmx-node wallet implementation
 * (github.com/stotiks/mmx-node, branch wxt, ui/src/mmx/wallet/).
 * Each test case has a known-good transaction JSON with its computed id (tx hash).
 * We verify our hash computation produces the same result.
 *
 * Credit: Stotiks for the golden test vectors and the OOP wallet implementation
 * that inspired improvements to our codebase.
 */

import { readFileSync } from "fs";
import { Buffer as NativeBuffer } from "buffer";
globalThis.Buffer = NativeBuffer;

import { join, dirname } from "path";
import { fileURLToPath } from "url";

const dir = import.meta.dirname;

const { calcTxId, calcDepositHash, calcExecutableHash, TX_NOTE_TRADE, TX_NOTE_OFFER } =
  await import(join(dir, "../mmx-tx.js"));
const { bech32m } = await import(join(dir, "../lib/bech32-esm.js"));
await import(join(dir, "../lib/buffer-esm.js"));
const { sha256 } = await import(join(dir, "../node_modules/@noble/hashes/sha2.js"));

const MMX_NULL = "mmx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdgytev";

function addrToBytes32(addrStr) {
  if (!addrStr || addrStr === MMX_NULL) return new Array(32).fill(0);
  const { words } = bech32m.decode(addrStr);
  return Array.from(NativeBuffer.from(bech32m.fromWords(words)).reverse());
}
function uint128LE(val) {
  const v = BigInt(val);
  const arr = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) arr[i] = Number((v >> BigInt(i * 8)) & 0xFFn);
  return arr;
}
function bytesToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

let pass = 0, fail = 0;
function check(name, expected, actual) {
  if (expected === actual) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name}: expected ${expected.substring(0,16)}... got ${actual.substring(0,16)}...`); fail++; process.exitCode = 1; }
}

console.log("Golden test vectors (from Stotiks' mmx-node wallet)");

// === TRANSFER ===
console.log("\n1. TRANSFER");
{
  const tx = {
    version: 0, expires: 591204, fee_ratio: 1024, max_fee_amount: 5050000,
    note: 858544509, nonce: 8425803021051778044n, network: "mainnet",
    sender: addrToBytes32("mmx16aq5vpcmxcrh9xck0z06eqnmr87w5r2j062snjj6g7cvj0thry7q0mp3w6"),
    inputs: [{ address: addrToBytes32("mmx16aq5vpcmxcrh9xck0z06eqnmr87w5r2j062snjj6g7cvj0thry7q0mp3w6"), contract: new Array(32).fill(0), amount: uint128LE(1000000n), memo: "test", solution: 0, flags: 0 }],
    outputs: [{ address: addrToBytes32("mmx1mw38rg8jcy2tjc5r7sxque6z45qrw6dsu6g2wmhahwf30342rraqyhsnea"), contract: new Array(32).fill(0), amount: uint128LE(1000000n), memo: "test" }],
    execute: [], deploy: null, static_cost: 60000,
  };
  check("id", "A533C34FB79C24E982CE91EC079144E4FDAB7AA01C64842C540859F21916891D", bytesToHex(calcTxId(tx)));
}

// === SWAP TRADE ===
console.log("\n2. SWAP TRADE");
{
  const poolAddr = "mmx1rda9sdn9ypgcs07us2surft0rjtz0pkccdlmxpv0yftzs9zathfqeh5maw";
  const sender = "mmx16aq5vpcmxcrh9xck0z06eqnmr87w5r2j062snjj6g7cvj0thry7q0mp3w6";
  const deposit = {
    version: 0, address: addrToBytes32(poolAddr), method: "trade",
    args: [1, sender, 193849606240, 5], user: null,
    currency: new Array(32).fill(0), amount: uint128LE(1000000n),
  };
  const tx = {
    version: 0, expires: 591337, fee_ratio: 1024, max_fee_amount: 5049500,
    note: TX_NOTE_TRADE, nonce: 2580000024069863185n, network: "mainnet",
    sender: addrToBytes32(sender),
    inputs: [{ address: addrToBytes32(sender), contract: new Array(32).fill(0), amount: uint128LE(1000000n), memo: null, solution: 0, flags: 0 }],
    outputs: [], execute: [{ hash: Array.from(calcDepositHash(deposit, false)), fullHash: Array.from(calcDepositHash(deposit, true)) }],
    deploy: null, static_cost: 59500,
  };
  check("id", "9E905766A6AF2837B219C114640CD41F57C748D50E3D75A4D5C585799535851C", bytesToHex(calcTxId(tx)));
}

// === OFFER DEPLOY ===
console.log("\n3. OFFER DEPLOY");
{
  const sender = "mmx16aq5vpcmxcrh9xck0z06eqnmr87w5r2j062snjj6g7cvj0thry7q0mp3w6";
  const askCurrency = "mmx1ey6mxts9rcarq9jgl89su8cgex527plw3wskpnwxr4xgzkw4z65qxpj3fg";
  const executable = {
    version: 0, name: "", symbol: "", decimals: 0, meta_data: null,
    binary: addrToBytes32("mmx18rcdx8nhh56twmr2gq3h22kwj00slsn23ejan8qp00rqqw8yl4jq6ccysq"),
    init_method: "init",
    init_args: [sender, MMX_NULL, askCurrency, "0x3e80000000000000000", null],
    depends: [],
  };
  const tx = {
    version: 0, expires: 591244, fee_ratio: 1024, max_fee_amount: 5077700,
    note: TX_NOTE_OFFER, nonce: 6852061763865904619n, network: "mainnet",
    sender: addrToBytes32(sender),
    inputs: [{ address: addrToBytes32(sender), contract: new Array(32).fill(0), amount: uint128LE(100000n), memo: null, solution: 0, flags: 0 }],
    outputs: [], execute: [],
    deploy: { hash: calcExecutableHash(executable, false), fullHash: calcExecutableHash(executable, true) },
    static_cost: 87700,
  };
  check("id", "938868DBC81163585CE9D959F012B429790E361F6280857B0421195B61A746F0", bytesToHex(calcTxId(tx)));
}

// === OFFER ACCEPT ===
console.log("\n4. OFFER ACCEPT");
{
  const sender = "mmx16aq5vpcmxcrh9xck0z06eqnmr87w5r2j062snjj6g7cvj0thry7q0mp3w6";
  const offerAddr = "mmx1lr5vtm5sx5yspj6283hv3zqrp0jc450yzxdt4adv62v7gqty6gsqxn3nk5";
  const askCurrency = "mmx1ey6mxts9rcarq9jgl89su8cgex527plw3wskpnwxr4xgzkw4z65qxpj3fg";
  const deposit = {
    version: 0, address: addrToBytes32(offerAddr), method: "accept",
    args: [sender, "0x3e90000000000000000"], user: null,
    currency: addrToBytes32(askCurrency), amount: uint128LE(50n),
  };
  const tx = {
    version: 0, expires: 649660, fee_ratio: 1024, max_fee_amount: 5049700,
    note: TX_NOTE_TRADE, nonce: 16020945385765470065n, network: "mainnet",
    sender: addrToBytes32(sender),
    inputs: [{ address: addrToBytes32(sender), contract: addrToBytes32(askCurrency), amount: uint128LE(50n), memo: null, solution: 0, flags: 0 }],
    outputs: [], execute: [{ hash: Array.from(calcDepositHash(deposit, false)), fullHash: Array.from(calcDepositHash(deposit, true)) }],
    deploy: null, static_cost: 59700,
  };
  check("id", "9E724EF79AD255E711CEA535B535E40B958E58A2B1F4BD0D7148560164E0C38C", bytesToHex(calcTxId(tx)));
}

// === OFFER CANCEL (REVOKE) ===
console.log("\n5. OFFER CANCEL");
{
  const sender = "mmx16aq5vpcmxcrh9xck0z06eqnmr87w5r2j062snjj6g7cvj0thry7q0mp3w6";
  const offerAddr = "mmx1lr5vtm5sx5yspj6283hv3zqrp0jc450yzxdt4adv62v7gqty6gsqxn3nk5";
  const { calcExecuteHash } = await import(join(dir, "../mmx-tx.js"));
  const executeOp = {
    version: 0, address: addrToBytes32(offerAddr), method: "cancel",
    args: [], user: addrToBytes32(sender),
  };
  const tx = {
    version: 0, expires: 591289, fee_ratio: 1024, max_fee_amount: 5030600,
    note: 356250251, // EXECUTE
    nonce: 5068589432986602682n, network: "mainnet",
    sender: addrToBytes32(sender),
    inputs: [], outputs: [],
    execute: [{ hash: Array.from(calcExecuteHash(executeOp, false)), fullHash: Array.from(calcExecuteHash(executeOp, true)) }],
    deploy: null, static_cost: 40600,
  };
  check("id", "35B2D38D45566AF15AAE342525048EBEE04385ECA50C96D6F22E9BD7A7E1FAFC", bytesToHex(calcTxId(tx)));
}


// === 6. OFFER TRADE (partial fill) ===
console.log("\n6. OFFER TRADE");
{
  const sender = "mmx16aq5vpcmxcrh9xck0z06eqnmr87w5r2j062snjj6g7cvj0thry7q0mp3w6";
  const offerAddr = "mmx1lr5vtm5sx5yspj6283hv3zqrp0jc450yzxdt4adv62v7gqty6gsqxn3nk5";
  const askCurrency = "mmx1ey6mxts9rcarq9jgl89su8cgex527plw3wskpnwxr4xgzkw4z65qxpj3fg";
  const deposit = {
    version: 0, address: addrToBytes32(offerAddr), method: "trade",
    args: [sender, "0x3e90000000000000000"], user: null,
    currency: addrToBytes32(askCurrency), amount: uint128LE(25n),
  };
  const tx = {
    version: 0, expires: 649660, fee_ratio: 1024, max_fee_amount: 5049700,
    note: TX_NOTE_TRADE, nonce: 16020945385765470065n, network: "mainnet",
    sender: addrToBytes32(sender),
    inputs: [{ address: addrToBytes32(sender), contract: addrToBytes32(askCurrency), amount: uint128LE(25n), memo: null, solution: 0, flags: 0 }],
    outputs: [], execute: [{ hash: Array.from(calcDepositHash(deposit, false)), fullHash: Array.from(calcDepositHash(deposit, true)) }],
    deploy: null, static_cost: 59700,
  };
  const txid = bytesToHex(calcTxId(tx));
  check("trade hash is 64 chars", 64, txid.length);
  // Trade and accept must produce different hashes (different method + amount)
  const acceptDeposit = { ...deposit, method: "accept", amount: uint128LE(50n) };
  const acceptTx = { ...tx, execute: [{ hash: Array.from(calcDepositHash(acceptDeposit, false)), fullHash: Array.from(calcDepositHash(acceptDeposit, true)) }], inputs: [{ address: addrToBytes32(sender), contract: addrToBytes32(askCurrency), amount: uint128LE(50n), memo: null, solution: 0, flags: 0 }] };
  const acceptTxid = bytesToHex(calcTxId(acceptTx));
  check("trade hash != accept hash", false, txid === acceptTxid);
}

// === RESULTS ===
console.log("\n==================================================");
console.log(`Golden tests: ${pass} passed, ${fail} failed`);
if (fail) { console.log("❌ SOME GOLDEN TESTS FAILED"); }
else { console.log("✅ ALL GOLDEN TESTS PASSED"); }
console.log("==================================================");
