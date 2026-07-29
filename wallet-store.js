/**
 * wallet-store.js — Encrypted wallet storage with password protection.
 * 
 * Works in both web pages (localStorage) and Chrome extensions (chrome.storage.local).
 * Uses WebCrypto AES-GCM to encrypt wallet seeds at rest.
 * Password is derived into an AES key via PBKDF2 (600k iterations per OWASP).
 * 
 * Storage format:
 *   mmx_wallets: [{ id, name, address, enc_seed, iv, salt, created }]
 *   mmx_active_wallet: <wallet_id>
 */

const STORAGE_KEY = "mmx_wallets";
const ACTIVE_KEY = "mmx_active_wallet";

// Detect environment — check both chrome (Chrome) and browser (Firefox)
const _ext = typeof browser !== "undefined" ? browser : (typeof chrome !== "undefined" ? chrome : null);
const isExtension = (_ext && _ext.storage && _ext.storage.local);

// --- Storage abstraction (async for both environments) ---

async function storageGet(key) {
  if (isExtension) {
    return new Promise(resolve => {
      _ext.storage.local.get(key, result => resolve(result[key]));
    });
  }
  const data = localStorage.getItem(key);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    // JSON.parse failed — return raw string as fallback
    console.warn(`[MMX Wallet] storageGet(${key}): JSON.parse failed, returning raw string`);
    return data;
  }
}

async function storageSet(key, value) {
  if (isExtension) {
    return new Promise(resolve => {
      _ext.storage.local.set({ [key]: value }, () => resolve());
    });
  }
  // Only JSON.stringify objects/arrays, store raw strings as-is
  if (typeof value === "string") {
    localStorage.setItem(key, value);
  } else {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

async function storageRemove(key) {
  if (isExtension) {
    return new Promise(resolve => {
      _ext.storage.local.remove(key, () => resolve());
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
    { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, // 600k per OWASP
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

// --- UUID fallback (crypto.randomUUID may not be available in all contexts) ---
function generateId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// --- Wallet list management (all async now) ---

export async function getWallets() {
  const data = await storageGet(STORAGE_KEY);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  // Maybe stored as non-JSON string, try parsing
  try { const parsed = JSON.parse(data); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
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
    id: crypto.randomUUID ? crypto.randomUUID() : generateId(),
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

// --- Address book ---
// Stores named addresses the user has interacted with. Not encrypted (addresses are public).
// Format: [{ id, name, address, created }]

const CONTACTS_KEY = "mmx_contacts";

export async function getContacts() {
  const data = await storageGet(CONTACTS_KEY);
  if (!data) return [];
  // storageGet already JSON.parses for localStorage, check if it's already an array
  return Array.isArray(data) ? data : JSON.parse(data);
}

export async function addContact(name, address) {
  const contacts = await getContacts();
  // Check for duplicate address
  if (contacts.some(c => c.address === address)) {
    throw new Error("Address already in contacts");
  }
  const contact = { id: generateId(), name: name.trim() || "Unnamed", address, created: Date.now() };
  contacts.push(contact);
  await storageSet(CONTACTS_KEY, JSON.stringify(contacts));
  return contact;
}

export async function deleteContact(id) {
  const contacts = await getContacts();
  const filtered = contacts.filter(c => c.id !== id);
  await storageSet(CONTACTS_KEY, JSON.stringify(filtered));
}

export async function findContactByAddress(address) {
  const contacts = await getContacts();
  return contacts.find(c => c.address === address) || null;
}

// Auto-save an address we interacted with (if not already saved)
export async function autoTrackAddress(address, defaultName) {
  const existing = await findContactByAddress(address);
  if (existing) return existing; // already tracked
  // Don't auto-save own address
  const wallets = await getWallets();
  if (wallets.some(w => w.address === address)) return null;
  // Auto-save with default name (user can rename later)
  return await addContact(defaultName || "Unknown", address);
}

// --- Generic settings (key-value, persisted) ---
const SETTINGS_KEY = "mmx_settings";

export async function getSetting(key) {
  const data = await storageGet(SETTINGS_KEY);
  if (!data) return null;
  return data[key] ?? null;
}

export async function setSetting(key, value) {
  const data = (await storageGet(SETTINGS_KEY)) || {};
  data[key] = value;
  await storageSet(SETTINGS_KEY, data);
}

export async function getAllSettings() {
  return (await storageGet(SETTINGS_KEY)) || {};
}
