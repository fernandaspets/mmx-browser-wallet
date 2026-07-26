/**
 * mmx-crypto.js — Pure JS implementation of MMX key derivation and signing.
 * 
 * Ported from mmx-node C++ source:
 *   - mnemonic.cpp (words → seed)
 *   - ECDSA_Wallet.h (key derivation via HMAC-SHA512)
 *   - pubkey_t.hpp (address = SHA256 of compressed pubkey)
 *   - addr_t.cpp (bech32m encoding with "mmx" prefix)
 *   - signature_t.cpp (ECDSA signing)
 *   - bytes_t.hpp (from_uint stores little-endian by default)
 * 
 * VERIFIED: Derives the correct address from David's mnemonic seed.
 * 
 * Dependencies: @noble/secp256k1, @noble/hashes, bech32
 */

import * as secp from "@noble/secp256k1";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bech32m } from "bech32";

// Configure secp256k1 with hash functions (v3: utils is frozen, use hashes instead)
secp.hashes.sha256 = (data) => sha256(data);
secp.hashes.hmacSha256 = (key, data) =>
  sha256(Buffer.concat([Buffer.from(key), Buffer.from(data)]));

// --- HMAC-SHA512 helpers ---

function hmacSha512(key, data) {
  return Buffer.from(
    hmac(sha512, Uint8Array.from(Buffer.from(key)), Uint8Array.from(Buffer.from(data)))
  );
}

function hmacSha512N(seed, key, index) {
  // HMAC(key, seed || index_BE)
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32BE(index);
  return hmacSha512(Buffer.from(key), Buffer.concat([Buffer.from(seed), indexBuf]));
}

function kdfHmacSha512(seed, key, iters) {
  // Iterated HMAC: tmp = HMAC(key, seed), then tmp = HMAC(tmp, seed) for iters-1 more
  let tmp = hmacSha512(Buffer.from(key), Buffer.from(seed));
  for (let i = 1; i < iters; i++) {
    tmp = hmacSha512(tmp, Buffer.from(seed));
  }
  const first = Buffer.from(tmp.subarray(0, 32));
  const second = Buffer.from(tmp.subarray(32, 64));
  return { first, second };
}

// --- Mnemonic (MMX custom BIP-0039 variant, NOT standard BIP-39) ---

// In Chrome extension: chrome.runtime.getURL. In web page: relative path.
const WORDLIST_URL = (typeof chrome !== "undefined" && chrome.runtime)
  ? chrome.runtime.getURL("wordlist.txt")
  : "wordlist.txt";

let _wordlist = null;
let _wordMap = null;

export async function loadWordlist() {
  if (_wordlist) return _wordlist;
  const resp = await fetch(WORDLIST_URL);
  const text = await resp.text();
  _wordlist = text.trim().split("\n");
  _wordMap = {};
  for (let i = 0; i < _wordlist.length; i++) _wordMap[_wordlist[i]] = i;
  return _wordlist;
}

export function wordsToSeed(words) {
  if (!_wordMap) throw new Error("Wordlist not loaded. Call loadWordlist() first.");
  let seed = 0n;
  for (let i = 0; i < 24; i++) {
    const index = _wordMap[words[i]];
    if (index === undefined) throw new Error("invalid mnemonic word: " + words[i]);
    if (i < 23) {
      seed <<= 11n;
      seed |= BigInt(index);
    } else {
      seed <<= 3n;
      seed |= BigInt(index >> 8);
    }
  }
  // MMX bytes_t::from_uint stores little-endian by default
  const hex = seed.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex").reverse(); // big-endian hex → little-endian bytes
}

export function seedToWords(seed) {
  if (!_wordlist) throw new Error("Wordlist not loaded.");
  // Reverse: little-endian bytes → big-endian BigInt
  const be = Buffer.from(seed).reverse();
  let bits = BigInt("0x" + be.toString("hex"));
  
  // Checksum: first byte of SHA256 of the seed (big-endian representation)
  const checksum = sha256(be)[0];
  
  const words = [];
  for (let i = 0; i < 24; i++) {
    let index;
    if (i === 0) {
      index = ((bits & 0x7n) << 8n) | BigInt(checksum);
      bits >>= 3n;
    } else {
      index = bits & 0x7FFn;
      bits >>= 11n;
    }
    words.push(_wordlist[Number(index)]);
  }
  words.reverse();
  return words;
}

// --- Address encoding ---

function hashToBech32(hash32LE) {
  // hash_t stores little-endian. to_uint256() reads as big-endian = reverse bytes
  const be = Buffer.from(hash32LE).reverse();
  const bits = BigInt("0x" + be.toString("hex"));
  const dp = new Array(52);
  dp[51] = Number((bits & 1n) << 4n);
  let b = bits >> 1n;
  for (let i = 0; i < 51; i++) {
    dp[50 - i] = Number(b & 31n);
    b >>= 5n;
  }
  return bech32m.encode("mmx", dp);
}

export function bech32ToHash(addr) {
  const decoded = bech32m.decode(addr);
  const words = decoded.words;
  let bits = 0n;
  for (let i = 0; i < 50; i++) {
    bits |= BigInt(words[i] & 0x1F);
    bits <<= 5n;
  }
  bits |= BigInt(words[50] & 0x1F);
  bits <<= 1n;
  bits |= BigInt((words[51] >> 4) & 1);
  // bits is big-endian, MMX stores little-endian
  const hex = bits.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex").reverse();
}

// --- Key derivation (matches ECDSA_Wallet.h) ---

export function deriveKeypair(seedValue, passphrase, accountIndex, addressIndex) {
  // passphrase = SHA256("MMX/seed/" + passphrase)
  const passHash = Buffer.from(sha256(Buffer.from("MMX/seed/" + passphrase)));
  // master = kdf_hmac_sha512(seed, passHash, 4096)
  const master = kdfHmacSha512(seedValue, passHash, 4096);
  // chain = hmac_sha512_n(master.first, master.second, 11337)
  const chain = hmacSha512N(master.first, master.second, 11337);
  const chainFirst = Buffer.from(chain.subarray(0, 32));
  const chainSecond = Buffer.from(chain.subarray(32, 64));
  // account = hmac_sha512_n(chain.first, chain.second, accountIndex)
  const account = hmacSha512N(chainFirst, chainSecond, accountIndex);
  const acctFirst = Buffer.from(account.subarray(0, 32));
  const acctSecond = Buffer.from(account.subarray(32, 64));
  // address key = hmac_sha512_n(account.first, account.second, addressIndex)
  const tmp = hmacSha512N(acctFirst, acctSecond, addressIndex);
  const skey = Buffer.from(tmp.subarray(0, 32));
  const pubkey = Buffer.from(secp.getPublicKey(skey)); // 33 bytes compressed
  const addrHash = Buffer.from(sha256(pubkey)); // 32 bytes, little-endian (SHA256 output)
  const address = hashToBech32(addrHash);
  return { skey, pubkey, address };
}

export function generateSeed() {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return Buffer.from(seed);
}

export function generateMnemonic() {
  const seed = generateSeed();
  return seedToWords(seed);
}

export function addressFromPubkey(pubkey) {
  return hashToBech32(sha256(pubkey));
}

// --- Signing ---

export async function signMessage(skey, messageHash) {
  const sig = await secp.sign(messageHash, skey);
  return Buffer.from(sig);
}

export function verifySignature(pubkey, signature, messageHash) {
  return secp.verify(signature, messageHash, pubkey);
}

// --- Fingerprint (for passphrase verification) ---

export function getFingerprint(seedValue, passphrase) {
  let passHash = Buffer.alloc(32); // zeros if no passphrase
  if (passphrase) {
    passHash = Buffer.from(sha256(Buffer.from("MMX/fingerprint/" + passphrase)));
  }
  let hash = Buffer.alloc(32); // zeros
  for (let i = 0; i < 16384; i++) {
    hash = Buffer.from(sha256(Buffer.concat([hash, seedValue, passHash])));
  }
  // to_uint<uint32_t>() reads first 4 bytes as little-endian
  return hash.readUInt32LE(0);
}

export { sha256, sha512, secp, bech32m };
