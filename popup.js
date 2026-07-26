/**
 * popup.js — Chrome/Firefox extension popup UI logic.
 * Uses the same wallet-app.js as the web page wallet.
 */

import * as app from "./wallet-app.js";

// --- DOM helpers ---
function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(name).classList.add("active");
}

function setStatus(id, msg, type = "") {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.className = "status" + (type ? " " + type : "");
  }
}

// --- Initialize ---

async function init() {
  try {
    await app.init();
  } catch(e) {
    setStatus("createStatus", "Init error: " + e.message, "error");
    return;
  }
  
  let hasWallets = false;
  try {
    const wallets = await app.getWalletsList();
    hasWallets = wallets.length > 0;
  } catch(e) {
    // Storage might not be ready yet
  }
  
  if (hasWallets) {
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
  if (pwd.length < 4) { setStatus("createStatus", "Password too short (min 4 chars)", "error"); return; }
  if (pwd !== pwdConfirm) { setStatus("createStatus", "Passwords don't match", "error"); return; }
  
  setStatus("createStatus", "Generating wallet...", "");
  
  try {
    const { mnemonic } = await app.createWallet("My Wallet", pwd);
    // Show seed backup (mnemonic words)
    document.getElementById("seedDisplay").textContent = mnemonic.join("  ");
    const wallet = app.getUnlockedWallet();
    document.getElementById("newAddress").textContent = wallet ? wallet.address : "";
    showView("seedView");
    setStatus("createStatus", "Wallet created! Save your seed words.", "success");
  } catch (e) {
    setStatus("createStatus", "Error: " + e.message, "error");
    console.error("Create wallet error:", e);
  }
});

document.getElementById("seedDoneBtn").addEventListener("click", async () => {
  await renderDashboard();
});

// --- Unlock wallet ---

document.getElementById("unlockBtn").addEventListener("click", async () => {
  const pwd = document.getElementById("unlockPassword").value;
  if (!pwd) { setStatus("unlockStatus", "Password required", "error"); return; }
  
  setStatus("unlockStatus", "Unlocking...", "");
  
  try {
    const walletId = await app.getActiveWalletId();
    if (!walletId) {
      setStatus("unlockStatus", "No active wallet found", "error");
      return;
    }
    await app.unlockWallet(walletId, pwd);
    await renderDashboard();
    setStatus("unlockStatus", "Unlocked", "success");
  } catch (e) {
    setStatus("unlockStatus", "Error: " + e.message, "error");
    console.error("Unlock error:", e);
  }
});

document.getElementById("unlockPassword").addEventListener("keypress", (e) => {
  if (e.key === "Enter") document.getElementById("unlockBtn").click();
});

// --- Dashboard ---

async function renderDashboard() {
  const wallet = app.getUnlockedWallet();
  if (!wallet) {
    showView("unlockView");
    return;
  }
  
  document.getElementById("addressDisplay").textContent = wallet.address;
  document.getElementById("receiveAddress").textContent = wallet.address;
  showView("dashboardView");
  
  // Fetch balance
  setStatus("dashStatus", "Fetching balance...", "");
  try {
    const balances = await app.fetchBalance();
    // Find MMX balance
    const mmxBal = balances.find(b => b.symbol === "MMX");
    const mmxAmount = mmxBal ? (mmxBal.spendable !== undefined ? mmxBal.spendable : mmxBal.total || 0) : 0;
    document.getElementById("balanceValue").textContent = mmxAmount;
    setStatus("dashStatus", "");
  } catch (e) {
    setStatus("dashStatus", "Balance fetch failed: " + e.message, "error");
    console.error("Balance error:", e);
  }
}

document.getElementById("sendBtn").addEventListener("click", () => {
  showView("sendView");
});

document.getElementById("receiveBtn").addEventListener("click", () => {
  showView("receiveView");
});

document.getElementById("lockBtn").addEventListener("click", () => {
  app.lockWalletPub();
  document.getElementById("unlockPassword").value = "";
  showView("unlockView");
  document.getElementById("unlockPassword").focus();
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  renderDashboard();
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
  
  setStatus("sendStatus", "Building & signing transaction...", "");
  
  try {
    const amountSat = app.mmxToSat(amount);
    const txid = await app.sendTransaction(to, amountSat, null);
    setStatus("sendStatus", "✅ Sent!", "success");
    document.getElementById("sendTo").value = "";
    document.getElementById("sendAmount").value = "";
    
    // Show tx hash with explorer link
    const txLink = document.createElement("div");
    txLink.style.cssText = "font-family:monospace;font-size:11px;padding:6px;margin-top:8px;background:rgba(0,212,255,0.05);border-radius:4px;word-break:break-all;";
    txLink.innerHTML = `<a href="https://explore.mmx.network/#/explore/transaction/${txid}" target="_blank" style="color:#00d4ff;text-decoration:none;">${txid.substring(0,20)}...↗</a>`;
    document.getElementById("sendStatus").appendChild(txLink);
    
    // Refresh balance after a short delay
    setTimeout(() => renderDashboard(), 3000);
  } catch (e) {
    setStatus("sendStatus", "Error: " + e.message, "error");
    console.error("Send error:", e);
  }
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
