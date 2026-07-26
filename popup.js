/**
 * popup.js — Firefox/Chrome extension popup UI logic.
 * Uses the same wallet-app.js as the web page wallet.
 * Supports: create, import, multi-wallet, switch, send, receive, lock, delete.
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
    console.error("Init error:", e);
    return;
  }

  let wallets = [];
  try {
    wallets = await app.getWalletsList();
  } catch(e) {
    console.error("Get wallets error:", e);
  }

  if (wallets.length === 0) {
    showView("onboardingView");
  } else {
    // Set active wallet if not set
    let activeId = await app.getActiveWalletId();
    if (!activeId) {
      activeId = wallets[0].id;
      await app.setActiveWalletId(activeId);
    }
    const wallet = wallets.find(w => w.id === activeId) || wallets[0];
    document.getElementById("unlockWalletName").textContent = wallet.name;
    showView("unlockView");
    document.getElementById("unlockPassword").focus();
  }
}

// --- Onboarding ---

document.getElementById("onboardCreateBtn").addEventListener("click", () => {
  showView("createView");
  document.getElementById("createName").value = "My Wallet";
  document.getElementById("createPassword").focus();
});

document.getElementById("onboardImportBtn").addEventListener("click", () => {
  showView("importView");
  document.getElementById("importName").value = "Imported Wallet";
  document.getElementById("importMnemonic").focus();
});

// --- Create wallet ---

document.getElementById("createBtn").addEventListener("click", async () => {
  const name = document.getElementById("createName").value.trim() || "My Wallet";
  const pwd = document.getElementById("createPassword").value;
  const pwdConfirm = document.getElementById("createPasswordConfirm").value;

  if (!pwd) { setStatus("createStatus", "Password required", "error"); return; }
  if (pwd.length < 4) { setStatus("createStatus", "Password too short (min 4 chars)", "error"); return; }
  if (pwd !== pwdConfirm) { setStatus("createStatus", "Passwords don't match", "error"); return; }

  setStatus("createStatus", "Generating wallet...", "");

  try {
    const { mnemonic } = await app.createWallet(name, pwd);
    document.getElementById("seedDisplay").textContent = mnemonic.join("  ");
    const wallet = app.getUnlockedWallet();
    document.getElementById("newAddress").textContent = wallet ? wallet.address : "";
    showView("seedView");
    setStatus("createStatus", "Wallet created!", "success");
  } catch (e) {
    setStatus("createStatus", "Error: " + e.message, "error");
    console.error("Create wallet error:", e);
  }
});

document.getElementById("createCancelBtn").addEventListener("click", async () => {
  const wallets = await app.getWalletsList();
  if (wallets.length > 0) {
    showView("unlockView");
  } else {
    showView("onboardingView");
  }
});

// --- Import wallet ---

document.getElementById("importBtn").addEventListener("click", async () => {
  const name = document.getElementById("importName").value.trim() || "Imported Wallet";
  const mnemonicStr = document.getElementById("importMnemonic").value.trim();
  const pwd = document.getElementById("importPassword").value;
  const words = mnemonicStr.split(/\s+/).filter(w => w);

  if (words.length !== 24) { setStatus("importStatus", "Mnemonic must be exactly 24 words", "error"); return; }
  if (!pwd) { setStatus("importStatus", "Password required", "error"); return; }

  setStatus("importStatus", "Importing wallet...", "");

  try {
    await app.importWallet(name, words, pwd);
    await renderDashboard();
    setStatus("importStatus", "Wallet imported!", "success");
  } catch (e) {
    setStatus("importStatus", "Error: " + e.message, "error");
    console.error("Import error:", e);
  }
});

document.getElementById("importCancelBtn").addEventListener("click", async () => {
  const wallets = await app.getWalletsList();
  if (wallets.length > 0) {
    showView("unlockView");
  } else {
    showView("onboardingView");
  }
});

// --- Seed backup view ---

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
      setStatus("unlockStatus", "No active wallet", "error");
      return;
    }
    await app.unlockWallet(walletId, pwd);
    await renderDashboard();
    setStatus("unlockStatus", "Unlocked", "success");
  } catch (e) {
    setStatus("unlockStatus", "Wrong password", "error");
    console.error("Unlock error:", e);
  }
});

document.getElementById("unlockPassword").addEventListener("keypress", (e) => {
  if (e.key === "Enter") document.getElementById("unlockBtn").click();
});

document.getElementById("unlockSwitchBtn").addEventListener("click", () => {
  showWalletList();
});

// --- Dashboard ---

async function renderDashboard() {
  const wallet = app.getUnlockedWallet();
  if (!wallet) {
    showView("unlockView");
    return;
  }

  document.getElementById("dashWalletName").textContent = wallet.name;
  document.getElementById("addressDisplay").textContent = wallet.address;
  document.getElementById("receiveAddress").textContent = wallet.address;

  // Show wallet count
  const wallets = await app.getWalletsList();
  document.getElementById("dashWalletCount").textContent = wallets.length > 1 ? `(${wallets.length} wallets)` : "";

  showView("dashboardView");

  // M5: Check for pending dApp requests (badge notification)
  try {
    const _browser = typeof browser !== "undefined" ? browser : chrome;
    if (_browser.action && _browser.action.getBadgeText) {
      _browser.action.getBadgeText({}, (text) => {
        const notice = document.getElementById("dappNotice");
        if (notice) notice.style.display = text ? "block" : "none";
      });
    }
  } catch {}

  // Fetch balance
  setStatus("dashStatus", "Fetching balance...", "");
  try {
    const balances = await app.fetchBalance();
    renderBalances(balances);
    setStatus("dashStatus", "");
  } catch (e) {
    setStatus("dashStatus", "Balance fetch failed", "error");
    console.error("Balance error:", e);
  }
}

function renderBalances(balances) {
  const list = document.getElementById("balanceList");
  const sendCurrency = document.getElementById("sendCurrency");

  if (balances.length === 0) {
    list.innerHTML = '<div style="color:#888;font-size:13px;text-align:center;">No balances yet</div>';
    sendCurrency.innerHTML = '<option value="MMX">MMX</option>';
    return;
  }

  // Show balances
  let html = "";
  for (const b of balances) {
    const amount = b.spendable !== undefined ? b.spendable : b.total || 0;
    html += `<div class="balance-row">
      <span style="font-weight:600;font-size:14px;">${b.symbol || '?'}</span>
      <span style="font-family:monospace;font-size:14px;color:#4caf50;">${amount}</span>
    </div>`;
  }
  list.innerHTML = html;

  // Update currency dropdown
  sendCurrency.innerHTML = "";
  for (const b of balances) {
    sendCurrency.innerHTML += `<option value="${b.symbol}">${b.symbol}</option>`;
  }
}

document.getElementById("sendBtn").addEventListener("click", () => {
  showView("sendView");
});

document.getElementById("receiveBtn").addEventListener("click", () => {
  showView("receiveView");
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  renderDashboard();
});

document.getElementById("switchBtn").addEventListener("click", () => {
  showWalletList();
});

document.getElementById("showSeedBtn").addEventListener("click", () => {
  // Require password re-entry (#89: was showing mnemonic without re-auth)
  const pwd = prompt("Enter your password to reveal your mnemonic:");
  if (!pwd) return;
  try {
    const mnemonic = app.showMnemonic(pwd);
    document.getElementById("seedDisplay").textContent = mnemonic.join("  ");
    document.getElementById("newAddress").textContent = app.getUnlockedWallet().address;
    showView("seedView");
  } catch {
    setStatus("dashStatus", "Wrong password", "error");
  }
});

document.getElementById("lockBtn").addEventListener("click", async () => {
  app.lockWalletPub();
  document.getElementById("unlockPassword").value = "";
  // L8: just show unlock view directly, no need to re-init
  const walletId = await app.getActiveWalletId();
  const wallets = await app.getWalletsList();
  const wallet = wallets.find(w => w.id === walletId);
  if (wallet) document.getElementById("unlockWalletName").textContent = wallet.name;
  showView("unlockView");
  document.getElementById("unlockPassword").focus();
});

document.getElementById("deleteBtn").addEventListener("click", async () => {
  // Require password before deleting (#92: was confirm() only)
  const pwd = prompt("Enter your password to delete this wallet:\nMake sure you have your mnemonic saved!");
  if (!pwd) return;
  try {
    // Verify password before deleting
    const walletId = await app.getActiveWalletId();
    await app.unlockWallet(walletId, pwd); // throws if wrong
    await app.deleteWalletById(walletId);
    const wallets = await app.getWalletsList();
    if (wallets.length === 0) {
      showView("onboardingView");
    } else {
      await app.setActiveWalletId(wallets[0].id);
      document.getElementById("unlockWalletName").textContent = wallets[0].name;
      document.getElementById("unlockPassword").value = "";
      showView("unlockView");
    }
    setStatus("dashStatus", "Wallet deleted", "");
  } catch {
    setStatus("dashStatus", "Wrong password", "error");
  }
});

// --- Wallet list (switch) ---

async function showWalletList() {
  const wallets = await app.getWalletsList();
  const activeId = await app.getActiveWalletId();

  let html = "";
  for (const w of wallets) {
    const isActive = w.id === activeId ? " active" : "";
    const addrShort = w.address.substring(0, 16) + "..." + w.address.slice(-6);
    html += `<div class="wallet-item${isActive}" data-id="${w.id}">
      <div>
        <div class="wallet-name">${w.name}</div>
        <div class="wallet-addr">${addrShort}</div>
      </div>
    </div>`;
  }
  document.getElementById("walletListItems").innerHTML = html;
  showView("walletListView");

  // Attach click handlers
  for (const el of document.querySelectorAll(".wallet-item")) {
    el.addEventListener("click", async () => {
      const id = el.dataset.id;
      await app.setActiveWalletId(id);
      app.lockWalletPub();
      const wallets = await app.getWalletsList();
      const wallet = wallets.find(w => w.id === id);
      document.getElementById("unlockWalletName").textContent = wallet.name;
      document.getElementById("unlockPassword").value = "";
      showView("unlockView");
      document.getElementById("unlockPassword").focus();
    });
  }
}

document.getElementById("walletListBackBtn").addEventListener("click", () => {
  if (app.isUnlocked()) {
    renderDashboard();
  } else {
    showView("unlockView");
  }
});

document.getElementById("listCreateBtn").addEventListener("click", () => {
  showView("createView");
  document.getElementById("createName").value = "Wallet " + (Math.floor(Math.random() * 100));
  document.getElementById("createPassword").focus();
});

document.getElementById("listImportBtn").addEventListener("click", () => {
  showView("importView");
  document.getElementById("importName").value = "Imported Wallet";
  document.getElementById("importMnemonic").focus();
});

// --- Copy address ---

window.copyAddress = async function() {
  const addr = document.getElementById("addressDisplay").textContent;
  try {
    await navigator.clipboard.writeText(addr);
    const fb = document.getElementById("copyFeedback");
    fb.style.display = "block";
    setTimeout(() => fb.style.display = "none", 2000);
  } catch {}
};

document.getElementById("copyReceiveBtn").addEventListener("click", async () => {
  const addr = document.getElementById("receiveAddress").textContent;
  try {
    await navigator.clipboard.writeText(addr);
    const btn = document.getElementById("copyReceiveBtn");
    btn.textContent = "✓ Copied!";
    setTimeout(() => btn.textContent = "📋 Copy Address", 2000);
  } catch {}
});

// --- Send (review step) ---

document.getElementById("sendReviewBtn").addEventListener("click", async () => {
  const to = document.getElementById("sendTo").value.trim();
  const amount = document.getElementById("sendAmount").value.trim();

  if (!to || !to.startsWith("mmx1")) { setStatus("sendStatus", "Valid MMX address required", "error"); return; }
  if (!amount || parseFloat(amount) <= 0) { setStatus("sendStatus", "Valid amount required", "error"); return; }

  // Validate address checksum (#95)
  try {
    const { bech32m } = await import("./lib/bech32-esm.js");
    const decoded = bech32m.decode(to);
    if (!decoded || decoded.prefix !== "mmx") {
      setStatus("sendStatus", "Invalid MMX address (checksum failed)", "error"); return;
    }
    const bytes = bech32m.fromWords(decoded.words);
    if (bytes.length !== 32) {
      setStatus("sendStatus", "Invalid MMX address (wrong length)", "error"); return;
    }
  } catch {
    setStatus("sendStatus", "Invalid MMX address", "error"); return;
  }

  // Look up currency and decimals
  const currency = document.getElementById("sendCurrency").value;
  let contractAddr = null;
  let decimals = 6;
  if (currency !== "MMX") {
    try {
      const balances = await app.fetchBalance();
      const token = balances.find(b => b.symbol === currency);
      if (token) { contractAddr = token.contract; decimals = token.decimals || 0; }
      else { setStatus("sendStatus", `No ${currency} balance found`, "error"); return; }
    } catch {
      setStatus("sendStatus", "Failed to fetch balances", "error"); return;
    }
  }

  // Show confirmation view (#90 + #100)
  const amountSat = app.mmxToSat(amount, decimals);
  const feeSat = 50000; // standard transfer fee
  const feeMmx = (feeSat / 1e6).toFixed(6);
  const amountDisplay = decimals > 0 ? amount : amountSat.toString();
  const totalDisplay = currency === "MMX"
    ? `${(Number(amountSat + BigInt(feeSat)) / 1e6).toFixed(6)} MMX`
    : `${amountDisplay} ${currency} + ${feeMmx} MMX fee`;

  document.getElementById("confirmAmount").textContent = `${amountDisplay} ${currency}`;
  document.getElementById("confirmTo").textContent = to;
  document.getElementById("confirmFee").textContent = `~${feeMmx} MMX`;
  document.getElementById("confirmTotal").textContent = totalDisplay;
  showView("sendConfirmView");
});

// --- Send broadcast (final confirm) ---

document.getElementById("sendBroadcastBtn").addEventListener("click", async () => {
  const btn = document.getElementById("sendBroadcastBtn");
  // L5: rate limit — disable button for 3s to prevent double-clicks
  if (btn.disabled) return;
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, 3000);

  const to = document.getElementById("sendTo").value.trim();
  const amount = document.getElementById("sendAmount").value.trim();
  const currency = document.getElementById("sendCurrency").value;

  setStatus("sendConfirmStatus", "Building & signing...", "");

  try {
    let contractAddr = null;
    let decimals = 6;
    if (currency !== "MMX") {
      const balances = await app.fetchBalance();
      const token = balances.find(b => b.symbol === currency);
      if (token) { contractAddr = token.contract; decimals = token.decimals || 0; }
    }
    const amountSat = app.mmxToSat(amount, decimals);
    const txid = await app.sendTransaction(to, amountSat, contractAddr);
    setStatus("sendConfirmStatus", "✅ Sent!", "success");
    document.getElementById("sendTo").value = "";
    document.getElementById("sendAmount").value = "";

    const txLink = document.createElement("div");
    txLink.className = "tx-link";
    txLink.innerHTML = `<a href="https://explore.mmx.network/#/explore/transaction/${txid}" target="_blank" style="color:#00d4ff;text-decoration:none;">${txid.substring(0,20)}...↗</a>`;
    document.getElementById("sendConfirmStatus").appendChild(txLink);

    setTimeout(() => renderDashboard(), 3000);
  } catch (e) {
    setStatus("sendConfirmStatus", "Error: " + e.message, "error");
    console.error("Send error:", e);
  }
});

document.getElementById("sendConfirmBackBtn").addEventListener("click", () => {
  showView("sendView");
});

document.getElementById("sendCancelBtn").addEventListener("click", () => {
  showView("dashboardView");
});

// --- Back buttons ---

document.getElementById("sendBackBtn").addEventListener("click", () => {
  showView("dashboardView");
});

document.getElementById("receiveBackBtn").addEventListener("click", () => {
  showView("dashboardView");
});

// --- Open in tab (stays open when popup closes) ---

document.getElementById("openTabBtn").addEventListener("click", () => {
  if (typeof browser !== "undefined" && browser.tabs) {
    browser.tabs.create({ url: browser.runtime.getURL("wallet.html") });
  } else if (typeof chrome !== "undefined" && chrome.tabs) {
    chrome.tabs.create({ url: chrome.runtime.getURL("wallet.html") });
  }
  window.close();
});

// --- Start ---
init();
