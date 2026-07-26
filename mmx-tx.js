/**
 * mmx-tx.js — MMX transaction serialization and signing.
 * 
 * Ported from mmx-node C++:
 *   - Transaction::hash_serialize() (binary serialization for hashing)
 *   - write_bytes.h (VNX binary format)
 *   - signature_t::sign() (ECDSA signing)
 * 
 * The serialization format:
 *   - Integers: little-endian uint64 (8 bytes), even for uint8/16/32
 *   - Strings: "string<>" + length(uint64 LE) + raw bytes
 *   - Bytes: "bytes<>" + length(uint64 LE) + raw bytes
 *   - Vectors: "vector<>" + count(uint64 LE) + elements
 *   - Optional: "optional<>" + bool(1 byte) + if present, value
 *   - Fields: "field<>" + name(as string) + value
 *   - Type tags: raw C string (e.g. "txin_t<>", "txout_t<>")
 */

import { sha256 } from "/node_modules/@noble/hashes/sha2.js";
import * as secp from "/node_modules/@noble/secp256k1/index.js";

// Transaction type hash (Hash64, 8 bytes LE)
const TX_TYPE_HASH = 0xce0462acdceaa5bcn;

// tx_note_e values
const TX_NOTE = {
  BURN: 1273454750,
  CLAIM: 3251493825,
  DEPLOY: 251696509,
  DEPOSIT: 4272391094,
  EXECUTE: 356250251,
  MINT: 2140500429,
  MUTATE: 2579166487,
  OFFER: 1549148948,
  REVOKE: 3821531424,
  REWARD: 3842121424,
  TIMELORD_REWARD: 1783340485,
  TRADE: 329618288,
  TRANSFER: 858544509,
  WITHDRAW: 4266232802,
};

// --- Binary writer ---

class BinaryWriter {
  constructor() {
    this.buf = [];
  }

  writeByte(b) {
    this.buf.push(b & 0xFF);
  }

  writeBytes(arr) {
    for (const b of arr) this.buf.push(b & 0xFF);
  }

  writeCStr(str) {
    for (let i = 0; i < str.length; i++) this.buf.push(str.charCodeAt(i));
  }

  writeUint64LE(val) {
    const v = BigInt(val);
    for (let i = 0; i < 8; i++) {
      this.buf.push(Number((v >> BigInt(i * 8)) & 0xFFn));
    }
  }

  writeUint32LE(val) {
    this.writeUint64LE(val); // promoted to uint64
  }

  writeUint16LE(val) {
    this.writeUint64LE(val); // promoted to uint64
  }

  writeUint8(val) {
    this.writeUint64LE(val); // promoted to uint64
  }

  writeBool(val) {
    this.writeByte(val ? 1 : 0);
  }

  writeString(str) {
    this.writeCStr("string<>");
    this.writeUint64LE(str.length);
    this.writeBytes(Buffer.from(str, "utf8"));
  }

  writeBytesType(arr) {
    this.writeCStr("bytes<>");
    this.writeUint64LE(arr.length);
    this.writeBytes(arr);
  }

  writeVector(elements, writeElem) {
    this.writeCStr("vector<>");
    this.writeUint64LE(elements.length);
    for (const elem of elements) writeElem(elem);
  }

  writeOptional(val, writeVal) {
    this.writeCStr("optional<>");
    if (val !== null && val !== undefined) {
      this.writeBool(true);
      writeVal(val);
    } else {
      this.writeBool(false);
    }
  }

  writeField(name, writeVal) {
    this.writeCStr("field<>");
    this.writeString(name);
    writeVal();
  }

  toBuffer() {
    return Buffer.from(this.buf);
  }

  toHash() {
    return Buffer.from(sha256(new Uint8Array(this.buf)));
  }
}

// --- Address helpers ---

function addrToBytes(addr) {
  // addr can be 32-byte array or bech32 string
  if (typeof addr === "string") {
    // Decode bech32m → 32 bytes (little-endian)
    const { bech32m } = require("bech32");
    const decoded = bech32m.decode(addr);
    const words = decoded.words;
    let bits = 0n;
    for (let i = 0; i < 50; i++) { bits |= BigInt(words[i] & 0x1F); bits <<= 5n; }
    bits |= BigInt(words[50] & 0x1F); bits <<= 1n;
    bits |= BigInt((words[51] >> 4) & 1);
    const hex = bits.toString(16).padStart(64, "0");
    return Array.from(Buffer.from(hex, "hex").reverse()); // big-endian hex → LE bytes
  }
  return addr; // assume already 32-byte array
}

// --- Transaction serialization ---

/**
 * Serialize a transaction for hashing.
 * 
 * tx = {
 *   version: uint32,
 *   expires: uint32,
 *   fee_ratio: uint32,
 *   max_fee_amount: uint32 (8 bytes LE, promoted to uint64),
 *   note: uint32 (tx_note_e value),
 *   nonce: uint64,
 *   network: string,
 *   sender: 32-byte array or null,
 *   inputs: [{address, contract, amount: uint128(16 bytes), memo: string|null, solution: uint16, flags: uint8}],
 *   outputs: [{address, contract, amount: uint128(16 bytes), memo: string|null}],
 *   execute: [],  // operations (array of hashes)
 *   deploy: null,  // hash or null
 *   solutions: [], // for full_hash only
 *   static_cost: uint32, // for full_hash only
 * }
 * 
 * full_hash: if true, includes solutions, static_cost, exec_result
 */
export function hashSerialize(tx, fullHash = false) {
  const w = new BinaryWriter();

  // write_bytes(out, get_type_hash()) — Hash64 as uint64 LE
  w.writeUint64LE(TX_TYPE_HASH);

  // Helper to write uint128 (16 bytes: lower 8 + upper 8)
  function writeUint128(val) {
    if (Array.isArray(val) && val.length === 16) {
      w.writeBytes(val);
    } else if (typeof val === "number" || typeof val === "bigint") {
      const v = BigInt(val);
      for (let i = 0; i < 8; i++) w.buf.push(Number((v >> BigInt(i * 8)) & 0xFFn));
      for (let i = 0; i < 8; i++) w.buf.push(0); // upper 64 bits = 0 for small numbers
    } else {
      w.writeBytes(new Array(16).fill(0));
    }
  }

  // Helper to write addr_t (bytes_t<32>)
  function writeAddr(addr) {
    if (addr === null || addr === undefined) {
      // addr_t() = zero hash = 32 zero bytes? No, optional<addr_t> is handled separately
      w.writeBytesType(addr);
    } else {
      w.writeBytesType(Array.from(addr));
    }
  }

  // Helper to write optional<addr_t>
  function writeOptionalAddr(addr) {
    w.writeOptional(addr, () => writeAddr(addr));
  }

  // Helper to write string
  function writeStrOpt(str) {
    w.writeOptional(str, () => w.writeString(str || ""));
  }

  // Helper to write txin_t
  function writeTxin(input, fullHash) {
    w.writeCStr("txin_t<>");
    // write_bytes_ex: address + contract + amount + memo
    writeAddr(input.address);
    writeAddr(input.contract);
    writeUint128(input.amount);
    writeStrOpt(input.memo);
    if (fullHash) {
      w.writeUint16LE(input.solution || 0);
      w.writeUint8(input.flags || 0);
    }
  }

  // Helper to write txout_t
  function writeTxout(output) {
    w.writeCStr("txout_t<>");
    writeAddr(output.address);
    writeAddr(output.contract);
    writeUint128(output.amount);
    writeStrOpt(output.memo);
  }

  // Now serialize all fields
  w.writeField("version", () => w.writeUint32LE(tx.version || 0));
  w.writeField("expires", () => w.writeUint32LE(tx.expires || 0));
  w.writeField("fee_ratio", () => w.writeUint32LE(tx.fee_ratio || 1024));
  // max_fee_amount is uint32_t (not uint128!) → promoted to uint64 = 8 bytes
  w.writeField("max_fee_amount", () => w.writeUint32LE(tx.max_fee_amount || 0));
  w.writeField("note", () => w.writeUint32LE(typeof tx.note === "string" ? (TX_NOTE[tx.note] || 0) : (tx.note || 0)));
  w.writeField("nonce", () => w.writeUint64LE(tx.nonce || 0));
  w.writeField("network", () => w.writeString(tx.network || "mainnet"));
  w.writeField("sender", () => writeOptionalAddr(tx.sender));

  // inputs (with full_hash flag)
  w.writeField("inputs", () => {
    w.writeVector(tx.inputs || [], (inp) => writeTxin(inp, fullHash));
  });

  // outputs
  w.writeField("outputs", () => {
    w.writeVector(tx.outputs || [], (out) => writeTxout(out));
  });

  // execute: write_field(out, "execute") then write_bytes(out, uint32_t(count))
  // This is NOT write_field(name, value) — just the field name, then count separately
  w.writeCStr("field<>");
  w.writeString("execute");
  w.writeUint32LE((tx.execute || []).length);
  for (const op of (tx.execute || [])) {
    w.writeBytesType(op || new Array(32).fill(0));
  }

  // deploy: write_field(out, "deploy", hash_t)
  w.writeField("deploy", () => {
    w.writeBytesType(tx.deploy || new Array(32).fill(0));
  });

  if (fullHash) {
    w.writeField("static_cost", () => w.writeUint32LE(tx.static_cost || 0));
    // solutions: write_field(out, "solutions") then write_bytes(out, uint32_t(count))
    w.writeCStr("field<>");
    w.writeString("solutions");
    w.writeUint32LE((tx.solutions || []).length);
    for (const sol of (tx.solutions || [])) {
      // Write solution's calc_hash() (32-byte hash), not the raw solution
      const solHash = calcPubKeyHash(sol);
      w.writeBytesType(solHash);
    }
    // exec_result (optional hash)
    w.writeField("exec_result", () => {
      w.writeBytesType(tx.exec_result || new Array(32).fill(0));
    });
  }

  return w.toBuffer();
}

export function calcTxId(tx) {
  const serialized = hashSerialize(tx, false);
  return Buffer.from(sha256(new Uint8Array(serialized)));
}

export function calcContentHash(tx) {
  const serialized = hashSerialize(tx, true);
  return Buffer.from(sha256(new Uint8Array(serialized)));
}

// --- PubKey solution hash ---
// PubKey::calc_hash() = type_hash(0xe47af6fcacfcefa5 LE) + version(uint32) + pubkey(bytes<32>) + signature(bytes<64>)
const PUBKEY_TYPE_HASH = 0xe47af6fcacfcefa5n;

export function calcPubKeyHash(solution) {
  if (!solution) return new Array(32).fill(0);
  const w = new BinaryWriter();
  // type hash (Hash64 = 8 bytes LE, no tag)
  w.writeUint64LE(PUBKEY_TYPE_HASH);
  // version
  w.writeField("version", () => w.writeUint32LE(solution.version || 0));
  // pubkey (bytes_t<32>)
  w.writeField("pubkey", () => w.writeBytesType(solution.pubkey));
  // signature (bytes_t<64>)
  w.writeField("signature", () => w.writeBytesType(solution.signature));
  return Buffer.from(sha256(new Uint8Array(w.toBuffer())));
}

// --- Signing ---

/**
 * Sign a transaction hash with a private key.
 * Returns a PubKey solution object.
 */
export async function signTx(txHash, skey) {
  const pubkey = Buffer.from(secp.getPublicKey(skey));
  // prehash: false because txHash is already a SHA256 hash
  const signature = await secp.sign(txHash, skey, { prehash: false });
  return {
    __type: "mmx.solution.PubKey",
    pubkey: Array.from(pubkey),
    signature: Array.from(Buffer.from(signature)),
    version: 0,
  };
}

/**
 * Compute the solution hash (for content_hash computation).
 * The solution hash = calc_hash() of the PubKey solution.
 */
export function calcSolutionHash(solution) {
  // PubKey calc_hash: type_hash + pubkey + signature + version
  const w = new BinaryWriter();
  // PubKey type hash: need to find this constant
  // For now, use placeholder — we'll need to get the real type hash
  // TODO: Get PubKey VNX_TYPE_HASH
  w.writeBytesType(solution.pubkey);
  w.writeBytesType(solution.signature);
  w.writeUint32LE(solution.version || 0);
  return w.toHash();
}

/**
 * Build, sign, and finalize a transaction.
 */
export async function buildAndSign(tx, skey) {
  // 1. Compute tx id (hash without solutions)
  const txId = calcTxId(tx);
  
  // 2. Sign the tx id
  const solution = await signTx(txId, skey);
  
  // 3. Add solution to tx
  tx.solutions = [solution];
  
  // 4. Compute content hash
  // TODO: Need to compute solution hash properly for content_hash
  // For now, the node might recompute this on validate
  
  return { tx, txId: Buffer.from(txId), solution };
}

export { TX_NOTE, BinaryWriter };
