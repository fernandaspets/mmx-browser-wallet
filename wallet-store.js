/**
 * wallet-store.js — Encrypted wallet storage with password protection.
 * 
 * Uses WebCrypto AES-GCM to encrypt wallet seeds at rest.
 * Password is derived into an AES key via PBKDF2 (100k iterations).
 * Wallets are stored in localStorage as encrypted blobs.
 * 
 * Storage format:
 *   mmx_wallets: [{ id, name, address, enc_seed, iv, salt, created }]
 *   mmx_active_wallet: <wallet_id>
 */

const STORAGE_KEY = "mmx_wallets";
const ACTIVE_KEY = "mmx_active_wallet";

// --- Password → AES key derivation (PBKDF2) ---

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// --- Encrypt/decrypt seed ---

async function encryptSeed(seedBytes, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    seedBytes
  );
  return {
    enc_seed: bufToB64(encrypted),
    iv: bufToB64(iv),
    salt: bufToB64(salt),
  };
}

async function decryptSeed(encSeedB64, ivB64, saltB64, password) {
  const salt = b64ToBuf(saltB64);
  const iv = b64ToBuf(ivB64);
  const encSeed = b64ToBuf(encSeedB64);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encSeed
  );
  return new Uint8Array(decrypted);
}

// --- Base64 helpers ---

function bufToB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function b64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- Wallet list management ---

export function getWallets() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function getActiveWalletId() {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveWalletId(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getWallet(id) {
  return getWallets().find(w => w.id === id) || null;
}

export function getActiveWallet() {
  const id = getActiveWalletId();
  return id ? getWallet(id) : null;
}

export function saveWallet(wallet) {
  const wallets = getWallets();
  const idx = wallets.findIndex(w => w.id === wallet.id);
  if (idx >= 0) wallets[idx] = wallet;
  else wallets.push(wallet);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
}

export function deleteWallet(id) {
  const wallets = getWallets().filter(w => w.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
  if (getActiveWalletId() === id) {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function hasWallets() {
  return getWallets().length > 0;
}

// --- High-level: create/import wallet ---

export async function createWallet(name, password, seedBytes, address) {
  const { enc_seed, iv, salt } = await encryptSeed(seedBytes, password);
  const wallet = {
    id: crypto.randomUUID(),
    name: name || "My Wallet",
    address,
    enc_seed,
    iv,
    salt,
    created: Date.now(),
  };
  saveWallet(wallet);
  setActiveWalletId(wallet.id);
  return wallet;
}

export async function unlockWallet(walletId, password) {
  const wallet = getWallet(walletId);
  if (!wallet) throw new Error("Wallet not found");
  try {
    const seed = await decryptSeed(wallet.enc_seed, wallet.iv, wallet.salt, password);
    return { wallet, seed };
  } catch {
    throw new Error("Wrong password");
  }
}

export async function verifyPassword(walletId, password) {
  try {
    await unlockWallet(walletId, password);
    return true;
  } catch {
    return false;
  }
}
