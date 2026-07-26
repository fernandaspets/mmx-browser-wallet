/**
 * popup.js — Firefox/Chrome extension popup UI logic.
 * Uses the same wallet-app.js as the web page wallet.
 * Supports: create, import, multi-wallet, switch, send, receive, lock, delete.
 */

import * as app from "./wallet-app.js";
import * as api from "./mmx-node-api.js";

// --- State ---
let lastBalanceHash = null;
let txOffset = 0;
let allTxs = [];

// --- Network badge ---
async function updateNetworkBadge() {
  const badge = document.getElementById("networkBadge");
  if (!badge) return;
  try {
    const height = await api.getHeight();
    badge.textContent = `mainnet · ✓ h:${height}`;
    badge.style.color = "#4caf50";
  } catch {
    badge.textContent = "mainnet · ✗ offline";
    badge.style.color = "#f44336";
  }
}

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

  // Update network badge with connection status + block height
  updateNetworkBadge();

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

  // Fetch balance + start auto-refresh
  setStatus("dashStatus", "Fetching balance...", "");
  try {
    const balances = await app.fetchBalance();
    renderBalances(balances);
    lastBalanceHash = JSON.stringify(balances);
    setStatus("dashStatus", "");
    // Auto-refresh every 30s, only re-render if balance changed
    app.startAutoRefresh((newBalances) => {
      renderBalances(newBalances);
      updateNetworkBadge();
      setStatus("dashStatus", "Balance updated", "success");
      setTimeout(() => setStatus("dashStatus", ""), 2000);
    });
  } catch (e) {
    setStatus("dashStatus", "Balance fetch failed", "error");
    console.error("Balance error:", e);
  }

  // Fetch transaction history (first page)
  txOffset = 0;
  try {
    const txs = await app.getTransactionHistory(10, 0);
    allTxs = txs;
    renderTxHistory(txs);
    await populateContactPicker();
    // Show load more if we got a full page
    document.getElementById("txLoadMore").style.display = txs.length >= 10 ? "block" : "none";
  } catch {
    document.getElementById("txHistory").innerHTML = '<div style="color:#888;font-size:11px;text-align:center;">Failed to load history</div>';
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

  let html = "";
  for (const b of balances) {
    const amount = b.spendable !== undefined ? b.spendable : b.total || 0;
    html += `<div class="balance-row">
      <span style="font-weight:600;font-size:14px;">${b.symbol || '?'}</span>
      <span style="font-family:monospace;font-size:14px;color:#4caf50;">${amount}</span>
    </div>`;
  }
  list.innerHTML = html;

  sendCurrency.innerHTML = "";
  for (const b of balances) {
    sendCurrency.innerHTML += `<option value="${b.symbol}">${b.symbol}</option>`;
  }
}

function renderTxHistory(txs, append = false) {
  const list = document.getElementById("txHistory");
  if (!txs || txs.length === 0) {
    if (!append) list.innerHTML = '<div style="color:#888;font-size:11px;text-align:center;">No transactions yet</div>';
    return;
  }
  // Check for pending txs (confirm < 1 means not yet in a block)
  let html = "";
  for (const tx of txs) {
    const isSent = tx.direction === 'sent';
    const arrow = isSent ? '📤' : '📥';
    const color = isSent ? '#ff9800' : '#4caf50';
    const addrShort = isSent ? (tx.id.substring(0, 12) + '...') : (tx.sender.substring(0, 12) + '...');
    const confirmations = tx.confirm || 0;
    const pendingBadge = confirmations < 1 ? ' <span style="color:#ff9800;font-size:9px;">⏳ pending</span>' : '';
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div style="display:flex;align-items:center;gap:6px;">
        <span>${arrow}</span>
        <div>
          <div style="font-size:12px;font-weight:600;color:${color};">${isSent ? '-' : '+'}${tx.amount} ${tx.symbol}${pendingBadge}</div>
          <div style="font-family:monospace;font-size:9px;color:#666;">${addrShort} · h:${tx.height}</div>
        </div>
      </div>
      <a href="https://explore.mmx.network/#/explore/transaction/${tx.id}" target="_blank" style="color:#555;font-size:10px;text-decoration:none;">↗</a>
    </div>`;
  }
  if (append) list.innerHTML += html;
  else list.innerHTML = html;
}

// Load more transactions
document.getElementById("txLoadMore").addEventListener("click", async () => {
  txOffset += 10;
  try {
    const btn = document.getElementById("txLoadMore");
    btn.textContent = "Loading...";
    const txs = await app.getTransactionHistory(10, txOffset);
    allTxs = allTxs.concat(txs);
    renderTxHistory(txs, true);
    btn.textContent = "Load More";
    btn.style.display = txs.length >= 10 ? "block" : "none";
  } catch {
    txOffset -= 10; // rollback on error
  }
});

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

// --- Reauth view (inline password for show mnemonic / delete) ---
let reauthAction = null;

function showReauth(title, msg, action) {
  reauthAction = action;
  document.getElementById("reauthTitle").textContent = title;
  document.getElementById("reauthMsg").textContent = msg;
  document.getElementById("reauthPassword").value = "";
  document.getElementById("reauthStatus").textContent = "";
  showView("reauthView");
  setTimeout(() => document.getElementById("reauthPassword").focus(), 50);
}

document.getElementById("reauthBackBtn").addEventListener("click", () => {
  showView("dashboardView");
});

document.getElementById("reauthConfirmBtn").addEventListener("click", async () => {
  const pwd = document.getElementById("reauthPassword").value;
  if (!pwd) { setStatus("reauthStatus", "Password required", "error"); return; }
  try {
    if (reauthAction === 'mnemonic') {
      const mnemonic = await app.showMnemonic(pwd);
      document.getElementById("seedDisplay").textContent = mnemonic.join("  ");
      document.getElementById("newAddress").textContent = app.getUnlockedWallet().address;
      showView("seedView");
    } else if (reauthAction === 'delete') {
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
    }
  } catch {
    setStatus("reauthStatus", "Wrong password", "error");
  }
});

document.getElementById("reauthPassword").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("reauthConfirmBtn").click();
});

// Register lock callback so wallet-app can notify UI on auto-lock
app.onLock(() => {
  app.stopAutoRefresh();
  document.getElementById("unlockPassword").value = "";
  (async () => {
    try {
      const wid = await app.getActiveWalletId();
      const wallets = await app.getWalletsList();
      const wallet = wallets.find(w => w.id === wid);
      if (wallet) document.getElementById("unlockWalletName").textContent = wallet.name;
    } catch {}
  })();
  showView("unlockView");
});

document.getElementById("showSeedBtn").addEventListener("click", () => {
  showReauth("Show Mnemonic", "Enter your password to reveal your 24-word seed:", 'mnemonic');
});

document.getElementById("lockBtn").addEventListener("click", async () => {
  app.stopAutoRefresh();
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

document.getElementById("deleteBtn").addEventListener("click", () => {
  showReauth("Delete Wallet", "Enter your password to permanently delete this wallet. Make sure you have your mnemonic saved!", 'delete');
});

// --- Contacts (address book) ---

async function renderContacts() {
  const contacts = await app.getContacts();
  const list = document.getElementById("contactsList");
  if (contacts.length === 0) {
    list.innerHTML = '<div style="color:#888;font-size:12px;text-align:center;padding:12px;">No saved contacts yet. Addresses you send to will be auto-saved here.</div>';
  } else {
    let html = "";
    for (const c of contacts) {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <div>
          <div style="font-size:13px;font-weight:600;">${c.name}</div>
          <div style="font-family:monospace;font-size:10px;color:#666;">${c.address.substring(0,20)}...</div>
        </div>
        <button class="btn btn-secondary" data-id="${c.id}" data-addr="${c.address}" style="font-size:10px;padding:4px 8px;">Send</button>
        <button class="btn btn-danger" data-del="${c.id}" style="font-size:10px;padding:4px 8px;margin-left:4px;">🗑</button>
      </div>`;
    }
    list.innerHTML = html;
    // Wire send buttons
    for (const btn of list.querySelectorAll("button[data-id]")) {
      btn.addEventListener("click", () => {
        document.getElementById("sendTo").value = btn.dataset.addr;
        showView("sendView");
      });
    }
    // Wire delete buttons
    for (const btn of list.querySelectorAll("button[data-del]")) {
      btn.addEventListener("click", async () => {
        await app.deleteContact(btn.dataset.del);
        await renderContacts();
        await populateContactPicker();
      });
    }
  }
}

async function populateContactPicker() {
  const contacts = await app.getContacts();
  const select = document.getElementById("sendToContact");
  select.innerHTML = '<option value="">Select from contacts...</option>';
  for (const c of contacts) {
    select.innerHTML += `<option value="${c.address}">${c.name} — ${c.address.substring(0,12)}...</option>`;
  }
}

document.getElementById("contactsBtn").addEventListener("click", async () => {
  await renderContacts();
  showView("contactsView");
});

document.getElementById("contactsBackBtn").addEventListener("click", () => {
  showView("dashboardView");
});

document.getElementById("addContactBtn").addEventListener("click", async () => {
  const name = document.getElementById("contactName").value.trim();
  const addr = document.getElementById("contactAddr").value.trim();
  if (!name) return;
  if (!addr || !addr.startsWith("mmx1")) return;
  try {
    await app.addContact(name, addr);
    document.getElementById("contactName").value = "";
    document.getElementById("contactAddr").value = "";
    await renderContacts();
    await populateContactPicker();
  } catch (e) {
    // duplicate or error
  }
});

document.getElementById("sendToContact").addEventListener("change", (e) => {
  if (e.target.value) {
    document.getElementById("sendTo").value = e.target.value;
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
let pendingSend = null; // stores { to, amountSat, contractAddr, decimals, currency }

document.getElementById("sendReviewBtn").addEventListener("click", async () => {
  const to = document.getElementById("sendTo").value.trim();
  const amount = document.getElementById("sendAmount").value.trim();
  const memo = document.getElementById("sendMemo").value.trim() || null;

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

  // Send-to-self warning
  const myAddr = app.getUnlockedWallet()?.address;
  if (to === myAddr) {
    setStatus("sendStatus", "⚠️ That's your own address — sending to yourself just wastes a fee", "error"); return;
  }

  const amountSat = app.mmxToSat(amount, decimals);
  let feeSat = 50000n; // fallback
  try { feeSat = await api.getFeeEstimate(); } catch {}

  // Balance check: verify sufficient funds
  try {
    const balances = await app.fetchBalance();
    const token = balances.find(b => b.symbol === currency);
    const spendable = token ? BigInt(Math.floor(token.spendable ?? 0)) : 0n;
    if (currency === "MMX") {
      // Need amount + fee in MMX
      if (spendable < amountSat + feeSat) {
        const have = (Number(spendable) / 1e6).toFixed(6);
        const need = (Number(amountSat + feeSat) / 1e6).toFixed(6);
        setStatus("sendStatus", `Insufficient balance: have ${have} MMX, need ${need} MMX (incl. fee)`, "error"); return;
      }
    } else {
      // Token balance + enough MMX for fee
      if (spendable < amountSat) {
        setStatus("sendStatus", `Insufficient ${currency}: have ${token?.spendable ?? 0}, need ${amount}`, "error"); return;
      }
      const mmxBal = balances.find(b => b.symbol === "MMX");
      const mmxSpendable = mmxBal ? BigInt(Math.floor(mmxBal.spendable ?? 0)) : 0n;
      if (mmxSpendable < feeSat) {
        setStatus("sendStatus", `Insufficient MMX for fee: need ${(Number(feeSat) / 1e6).toFixed(6)} MMX`, "error"); return;
      }
    }
  } catch {
    // If balance check fails, continue — node will reject if insufficient
  }

  // Store pending send so broadcast reads from state, not DOM
  pendingSend = { to, amountSat, contractAddr, decimals, currency, feeSat, memo };

  // Show confirmation view (#90 + #100)
  const feeMmx = (Number(feeSat) / 1e6).toFixed(6);
  const amountDisplay = decimals > 0 ? amount : amountSat.toString();
  const totalDisplay = currency === "MMX"
    ? `${(Number(amountSat + feeSat) / 1e6).toFixed(6)} MMX`
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

  if (!pendingSend) { setStatus("sendConfirmStatus", "No pending send", "error"); return; }

  setStatus("sendConfirmStatus", "Building & signing...", "");

  try {
    const txid = await app.sendTransaction(pendingSend.to, pendingSend.amountSat, pendingSend.contractAddr, pendingSend.memo);
    setStatus("sendConfirmStatus", "✅ Sent!", "success");
    document.getElementById("sendTo").value = "";
    document.getElementById("sendAmount").value = "";
    document.getElementById("sendMemo").value = "";
    pendingSend = null;

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
