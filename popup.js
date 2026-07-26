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
  try {
    const mnemonic = app.showMnemonic();
    document.getElementById("seedDisplay").textContent = mnemonic.join("  ");
    document.getElementById("newAddress").textContent = app.getUnlockedWallet().address;
    showView("seedView");
  } catch (e) {
    setStatus("dashStatus", "Error: " + e.message, "error");
  }
});

document.getElementById("lockBtn").addEventListener("click", () => {
  app.lockWalletPub();
  document.getElementById("unlockPassword").value = "";
  const walletId = app.getActiveWalletId();
  // Show unlock for current wallet
  init().then(() => {
    document.getElementById("unlockPassword").focus();
  });
});

document.getElementById("deleteBtn").addEventListener("click", async () => {
  if (!confirm("Delete this wallet? Make sure you have your mnemonic saved!")) return;
  try {
    const walletId = await app.getActiveWalletId();
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
  } catch (e) {
    setStatus("dashStatus", "Error: " + e.message, "error");
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

// --- Send ---

document.getElementById("sendConfirmBtn").addEventListener("click", async () => {
  const to = document.getElementById("sendTo").value.trim();
  const amount = document.getElementById("sendAmount").value.trim();

  if (!to || !to.startsWith("mmx1")) { setStatus("sendStatus", "Valid MMX address required", "error"); return; }
  if (!amount || parseFloat(amount) <= 0) { setStatus("sendStatus", "Valid amount required", "error"); return; }

  setStatus("sendStatus", "Building & signing...", "");

  try {
    const amountSat = app.mmxToSat(amount);
    const txid = await app.sendTransaction(to, amountSat, null);
    setStatus("sendStatus", "✅ Sent!", "success");
    document.getElementById("sendTo").value = "";
    document.getElementById("sendAmount").value = "";

    // Show tx hash with explorer link
    const txLink = document.createElement("div");
    txLink.className = "tx-link";
    txLink.innerHTML = `<a href="https://explore.mmx.network/#/explore/transaction/${txid}" target="_blank" style="color:#00d4ff;text-decoration:none;">${txid.substring(0,20)}...↗</a>`;
    document.getElementById("sendStatus").appendChild(txLink);

    // Refresh balance after delay
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
