/**
 * wallet.js — Wallet state management for the MMX browser extension.
 * Stores keys encrypted in chrome.storage.local.
 */

import { deriveKeypair, generateSeed, addressFromPubkey, sha256 } from "./mmx-crypto.js";

const STORAGE_KEY = "mmx_wallet_data";
const KDF_ITERS = 4096;

// --- Storage helpers ---

async function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result[key]));
  });
}

async function storageSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

// --- Encryption ---

async function encrypt(data, password) {
  // Derive encryption key from password using PBKDF2
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    passwordKey, "AES-GCM", false, ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, enc.encode(data)
  );
  // Combine salt + iv + ciphertext
  const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  result.set(salt, 0);
  result.set(iv, salt.length);
  result.set(new Uint8Array(encrypted), salt.length + iv.length);
  return Buffer.from(result).toString("base64");
}

async function decrypt(encryptedB64, password) {
  const data = Buffer.from(encryptedB64, "base64");
  const salt = data.subarray(0, 16);
  const iv = data.subarray(16, 28);
  const ciphertext = data.subarray(28);
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    passwordKey, "AES-GCM", false, ["decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv }, key, ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

// --- Wallet operations ---

export async function createWallet(password) {
  const seed = generateSeed();
  const { address, pubkey, skey } = deriveKeypair(seed, "", 0, 0);
  
  // Store encrypted seed
  const encryptedSeed = await encrypt(seed.toString("hex"), password);
  await storageSet({
    [STORAGE_KEY]: {
      encryptedSeed,
      address,
      pubkey: pubkey.toString("hex"),
      createdAt: Date.now(),
    }
  });
  
  return { address, pubkey: pubkey.toString("hex") };
}

export async function unlockWallet(password) {
  const data = await storageGet(STORAGE_KEY);
  if (!data) throw new Error("No wallet found");
  
  const seedHex = await decrypt(data.encryptedSeed, password);
  const seed = Buffer.from(seedHex, "hex");
  const { skey, pubkey, address } = deriveKeypair(seed, "", 0, 0);
  
  return { skey, pubkey, address, seed };
}

export async function getWalletInfo() {
  const data = await storageGet(STORAGE_KEY);
  if (!data) return null;
  return { address: data.address, createdAt: data.createdAt };
}

export async function hasWallet() {
  const data = await storageGet(STORAGE_KEY);
  return !!data;
}

export async function deleteWallet() {
  await storageSet({ [STORAGE_KEY]: null });
}

// --- Transaction building (simplified for MVP) ---
// A full MMX transaction needs:
// 1. inputs (gather from UTXOs)
// 2. outputs (destination)
// 3. solutions (signatures)
// 4. nonce, fee, etc.
//
// For MVP, we'll use the node API to build the transaction,
// then sign it locally.

export async function buildAndSignTransaction(skey, pubkey, fromAddress, toAddress, amount, currency, nodeUrl, apiToken) {
  // Step 1: Get UTXOs / balance from node
  // For MVP, we'll ask the node to build the transaction skeleton,
  // then we sign it locally.
  //
  // This is a placeholder — the actual transaction format
  // needs to be ported from Transaction.cpp hash_serialize()
  
  // TODO: Implement transaction serialization
  // For now, return the signing components
  const msgHash = sha256(Buffer.from("placeholder_tx_data"));
  const signature = await signMessage(skey, msgHash);
  
  return {
    fromAddress,
    toAddress,
    amount,
    currency,
    pubkey: pubkey.toString("hex"),
    signature: Buffer.from(signature).toString("hex"),
  };
}
