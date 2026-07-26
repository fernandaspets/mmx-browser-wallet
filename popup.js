/**
 * popup.js — UI logic for the MMX wallet extension popup.
 */

import { hasWallet, createWallet, unlockWallet, getWalletInfo } from "./wallet.js";
import { sha256 } from "./mmx-crypto.js";

// --- DOM helpers ---
function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(name).classList.add("active");
}

function setStatus(id, msg, type = "") {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = "status" + (type ? " " + type : "");
}

// --- Node connection ---
const NODE_URL = "http://localhost:11380";
// For MVP, we'll connect to a local node. In production, this would be configurable.

async function apiCall(module, method, params = {}) {
  const body = JSON.stringify({ module, method, ...params });
  const res = await fetch(`${NODE_URL}/api/${module}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function wapiCall(path, opts = {}) {
  const { query = {}, method = "GET", body } = opts;
  const qs = new URLSearchParams(query).toString();
  const url = `${NODE_URL}/wapi/${path}${qs ? "?" + qs : ""}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// --- Balance fetching ---

async function getBalance(address) {
  try {
    // MMX native = null address, try that
    const result = await apiCall("node", "get_balance", { address, currency: "MMX" });
    if (Array.isArray(result)) {
      let val = 0n;
      for (let i = 0; i < result.length; i++) {
        val += BigInt(result[i]) * (1n << BigInt(i * 8));
      }
      return Number(val) / 1_000_000; // MMX has 6 decimals
    }
    return 0;
  } catch (e) {
    return 0;
  }
}

// --- Current wallet state ---
let currentWallet = null;

// --- Initialize ---

async function init() {
  const exists = await hasWallet();
  if (exists) {
    showView("unlockView");
    document.getElementById("unlockPassword").focus();
  } else {
    showView("createView");
    document.getElementById("createPassword").focus();
  }
}

// --- Create wallet ---

document.getElementById("createBtn").addEventListener("click", async () => {
  const pwd = document.getElementById("createPassword").value;
  const pwdConfirm = document.getElementById("createPasswordConfirm").value;
  
  if (!pwd) { setStatus("createStatus", "Password required", "error"); return; }
  if (pwd.length < 6) { setStatus("createStatus", "Password too short (min 6 chars)", "error"); return; }
  if (pwd !== pwdConfirm) { setStatus("createStatus", "Passwords don't match", "error"); return; }
  
  setStatus("createStatus", "Generating wallet...", "");
  
  try {
    // We need the seed to display it
    const { generateSeed, deriveKeypair } = await import("./mmx-crypto.js");
    const seed = generateSeed();
    const { address, pubkey, skey } = deriveKeypair(seed, "", 0, 0);
    
    // Encrypt and store
    const { encrypt } = await import("./wallet.js");
    // Actually use the createWallet function but we need the seed too
    // Let's do it manually
    const encryptedSeed = await encryptSeed(seed.toString("hex"), pwd);
    
    await chrome.storage.local.set({
      mmx_wallet_data: {
        encryptedSeed,
        address,
        pubkey: pubkey.toString("hex"),
        createdAt: Date.now(),
      }
    });
    
    // Show seed backup
    document.getElementById("seedDisplay").textContent = seed.toString("hex");
    document.getElementById("newAddress").textContent = address;
    showView("seedView");
  } catch (e) {
    setStatus("createStatus", "Error: " + e.message, "error");
  }
});

// Import encrypt from wallet.js
async function encryptSeed(data, password) {
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
  const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  result.set(salt, 0);
  result.set(iv, salt.length);
  result.set(new Uint8Array(encrypted), salt.length + iv.length);
  return Buffer.from(result).toString("base64");
}

document.getElementById("seedDoneBtn").addEventListener("click", () => {
  showView("unlockView");
  document.getElementById("unlockPassword").focus();
  setStatus("createStatus", "Wallet created! Unlock to continue.", "success");
});

// --- Unlock wallet ---

document.getElementById("unlockBtn").addEventListener("click", async () => {
  const pwd = document.getElementById("unlockPassword").value;
  if (!pwd) { setStatus("unlockStatus", "Password required", "error"); return; }
  
  setStatus("unlockStatus", "Unlocking...", "");
  
  try {
    currentWallet = await unlockWallet(pwd);
    document.getElementById("addressDisplay").textContent = currentWallet.address;
    document.getElementById("receiveAddress").textContent = currentWallet.address;
    
    // Fetch balance
    setStatus("dashStatus", "Fetching balance...", "");
    const balance = await getBalance(currentWallet.address);
    document.getElementById("balanceValue").textContent = balance.toFixed(6);
    setStatus("dashStatus", "");
    
    showView("dashboardView");
  } catch (e) {
    setStatus("unlockStatus", "Wrong password or wallet error", "error");
  }
});

document.getElementById("unlockPassword").addEventListener("keypress", (e) => {
  if (e.key === "Enter") document.getElementById("unlockBtn").click();
});

// --- Dashboard ---

document.getElementById("sendBtn").addEventListener("click", () => {
  showView("sendView");
});

document.getElementById("receiveBtn").addEventListener("click", () => {
  showView("receiveView");
});

document.getElementById("lockBtn").addEventListener("click", () => {
  currentWallet = null;
  showView("unlockView");
  document.getElementById("unlockPassword").value = "";
  document.getElementById("unlockPassword").focus();
});

// --- Copy address ---

window.copyAddress = async function() {
  const addr = document.getElementById("addressDisplay").textContent;
  await navigator.clipboard.writeText(addr);
  const fb = document.getElementById("copyFeedback");
  fb.style.display = "block";
  setTimeout(() => fb.style.display = "none", 2000);
};

document.getElementById("copyReceiveBtn").addEventListener("click", async () => {
  const addr = document.getElementById("receiveAddress").textContent;
  await navigator.clipboard.writeText(addr);
  const btn = document.getElementById("copyReceiveBtn");
  btn.textContent = "✓ Copied!";
  setTimeout(() => btn.textContent = "📋 Copy Address", 2000);
});

// --- Send ---

document.getElementById("sendConfirmBtn").addEventListener("click", async () => {
  const to = document.getElementById("sendTo").value.trim();
  const amount = document.getElementById("sendAmount").value.trim();
  
  if (!to || !to.startsWith("mmx1")) { setStatus("sendStatus", "Valid MMX address required", "error"); return; }
  if (!amount || parseFloat(amount) <= 0) { setStatus("sendStatus", "Valid amount required", "error"); return; }
  
  setStatus("sendStatus", "Building transaction...", "");
  
  // TODO: Build and sign the transaction
  // For MVP, we need to implement the transaction serialization
  // This is the hardest part — needs to match Transaction::hash_serialize()
  
  setStatus("sendStatus", "⚠️ Transaction signing not yet implemented. This is the next step.", "error");
});

// --- Back buttons ---

document.getElementById("sendBackBtn").addEventListener("click", () => {
  showView("dashboardView");
});

document.getElementById("receiveBackBtn").addEventListener("click", () => {
  showView("dashboardView");
});

// --- Start ---
init();
