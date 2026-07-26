/**
 * wallet-store.js — Encrypted wallet storage with password protection.
 * 
 * Works in both web pages (localStorage) and Chrome extensions (chrome.storage.local).
 * Uses WebCrypto AES-GCM to encrypt wallet seeds at rest.
 * Password is derived into an AES key via PBKDF2 (100k iterations).
 * 
 * Storage format:
 *   mmx_wallets: [{ id, name, address, enc_seed, iv, salt, created }]
 *   mmx_active_wallet: <wallet_id>
 */

const STORAGE_KEY = "mmx_wallets";
const ACTIVE_KEY = "mmx_active_wallet";

// Detect environment
const isExtension = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local);

// --- Storage abstraction (async for both environments) ---

async function storageGet(key) {
  if (isExtension) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, result => resolve(result[key]));
    });
  }
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : null;
}

async function storageSet(key, value) {
  if (isExtension) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  }
  localStorage.setItem(key, JSON.stringify(value));
}

async function storageRemove(key) {
  if (isExtension) {
    return new Promise(resolve => {
      chrome.storage.local.remove(key, () => resolve());
    });
  }
  localStorage.removeItem(key);
}

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

// --- Wallet list management (all async now) ---

export async function getWallets() {
  return (await storageGet(STORAGE_KEY)) || [];
}

export async function getActiveWalletId() {
  return await storageGet(ACTIVE_KEY);
}

export async function setActiveWalletId(id) {
  await storageSet(ACTIVE_KEY, id);
}

export async function getWallet(id) {
  const wallets = await getWallets();
  return wallets.find(w => w.id === id) || null;
}

export async function getActiveWallet() {
  const id = await getActiveWalletId();
  return id ? await getWallet(id) : null;
}

export async function saveWallet(wallet) {
  const wallets = await getWallets();
  const idx = wallets.findIndex(w => w.id === wallet.id);
  if (idx >= 0) wallets[idx] = wallet;
  else wallets.push(wallet);
  await storageSet(STORAGE_KEY, wallets);
}

export async function deleteWallet(id) {
  const wallets = (await getWallets()).filter(w => w.id !== id);
  await storageSet(STORAGE_KEY, wallets);
  if ((await getActiveWalletId()) === id) {
    await storageRemove(ACTIVE_KEY);
  }
}

export async function hasWallets() {
  return (await getWallets()).length > 0;
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
  await saveWallet(wallet);
  await setActiveWalletId(wallet.id);
  return wallet;
}

export async function unlockWallet(walletId, password) {
  const wallet = await getWallet(walletId);
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
