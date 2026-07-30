/**
 * popup.js — Firefox/Chrome extension popup UI logic.
 * Uses the same wallet-app.js as the web page wallet.
 * Supports: create, import, multi-wallet, switch, send, receive, lock, delete.
 */

import * as app from "./wallet-app.js";
import * as api from "./mmx-node-api.js";

// --- Theme toggle ---
function applyTheme(theme) {
  document.body.className = "theme-" + theme;
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = theme === "dark" ? "🌙" : "☀️";
}

// Load saved theme
const _browser = typeof browser !== "undefined" ? browser : chrome;
(async () => {
  try {
    let saved;
    if (_browser.storage) {
      const result = await _browser.storage.local.get("mmx_theme");
      saved = result.mmx_theme;
    } else {
      saved = localStorage.getItem("mmx_theme");
    }
    applyTheme(saved || "dark");
  } catch { applyTheme("dark"); }
})();

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.addEventListener("click", async () => {
      const isDark = document.body.className === "theme-dark";
      const newTheme = isDark ? "light" : "dark";
      applyTheme(newTheme);
      try {
        if (_browser.storage) await _browser.storage.local.set({ mmx_theme: newTheme });
        else localStorage.setItem("mmx_theme", newTheme);
      } catch {}
    });
  }

  // Re-check for pending dApp requests when storage changes
  // (content.js writes ID-prefixed keys: mmx_psend_*, mmx_pdapp_*, mmx_pending_dapp)
  try {
    if (_browser.storage && _browser.storage.onChanged) {
      _browser.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        const hasPending = Object.keys(changes).some(k =>
          k.startsWith('mmx_psend_') || k.startsWith('mmx_pdapp_') || k === 'mmx_pending_dapp');
        if (hasPending) {
          // Re-run the pending request check
          checkPendingDapp();
        }
      });
    }
  } catch {}

  // Ping background on user activity to reset auto-lock timer
  // (throttled — at most once per 10 seconds)
  let lastPing = 0;
  document.addEventListener("click", () => {
    const now = Date.now();
    if (now - lastPing > 10000) {
      lastPing = now;
      try { bgSend({ type: "SESSION_PING" }); } catch {}
    }
  });
});

// Check for pending dApp requests (address approval + send confirmation)
// Extracted to named function so it can be called from storage listener
async function checkPendingDapp() {
  const _br = typeof browser !== "undefined" ? browser : chrome;
  if (!_br.storage) return;
  
  // Don't show dApp requests if wallet is not unlocked yet
  if (!app.isUnlocked()) {
    document.getElementById("dappNotice").style.display = "none";
    document.getElementById("dappSendNotice").style.display = "none";
    _br.storage.local.get(null, (result) => {
      const hasPending = Object.keys(result).some(k =>
        k.startsWith('mmx_psend_') || k.startsWith('mmx_pdapp_') || k === 'mmx_pending_dapp');
      if (hasPending) {
        // Keep badge so user knows there's a pending request
        _br.action.setBadgeText({ text: "!" });
        _br.action.setBadgeBackgroundColor({ color: "#ffa726" });
      }
    });
    return;
  }
  
  // Check for pending address request
  _br.storage.local.get("mmx_pending_dapp", (result) => {
    const pending = result.mmx_pending_dapp;
    const notice = document.getElementById("dappNotice");
    if (pending && notice) {
      notice.style.display = "block";
      document.getElementById("dappMsg").textContent = `${pending.origin} wants to see your wallet address. Allow?`;
      document.getElementById("dappAllow").onclick = async () => {
        const perms = await new Promise(r => _br.storage.local.get("mmx_dapp_permissions", r)) || {};
        perms[pending.origin] = true;
        _br.storage.local.set({ mmx_dapp_permissions: perms });
        _br.runtime.sendMessage({ type: "DAPP_APPROVED", origin: pending.origin });
        _br.storage.local.remove("mmx_pending_dapp");
        _br.action.setBadgeText({ text: "" });
        notice.style.display = "none";
        showView("dashboardView");
      };
      document.getElementById("dappDeny").onclick = async () => {
        const perms = await new Promise(r => _br.storage.local.get("mmx_dapp_permissions", r)) || {};
        perms[pending.origin] = false;
        _br.storage.local.set({ mmx_dapp_permissions: perms });
        _br.storage.local.remove("mmx_pending_dapp");
        _br.action.setBadgeText({ text: "" });
        // Notify content.js that user denied — clean up listener
        _br.runtime.sendMessage({ type: "DAPP_DENIED", origin: pending.origin });
        notice.style.display = "none";
        showView("dashboardView");
      };
      // Switch to dApp view to show the request
      showView("dappView");
    } else {
      notice.style.display = "none";
    }
  });
  
  // Check for pending send request (scan for ID-prefixed keys)
  _br.storage.local.get(null, (result) => {
    // Find first pending send request
    const sendKey = Object.keys(result).find(k => k.startsWith('mmx_psend_'));
    const pending = sendKey ? result[sendKey] : null;
    const sendNotice = document.getElementById("dappSendNotice");
    if (pending && sendNotice) {
      sendNotice.style.display = "block";
      document.getElementById("dappSendOrigin").textContent = `${pending.origin} wants to send:`;
      document.getElementById("dappSendAmount").textContent = `${pending.params.amount} ${pending.params.currency || "MMX"}`;
      document.getElementById("dappSendTo").textContent = pending.params.to;
      document.getElementById("dappSendStatus").textContent = "";
      document.getElementById("dappSendConfirm").disabled = false;
      document.getElementById("dappSendConfirm").onclick = async () => {
        document.getElementById("dappSendConfirm").disabled = true;
        document.getElementById("dappSendStatus").textContent = "Sending...";
        try {
          let contractAddr = null;
          let decimals = 6;
          if (pending.params.currency && pending.params.currency !== "MMX") {
            const balances = await app.fetchBalance();
            const token = balances.find(b => b.symbol === pending.params.currency);
            if (token) { contractAddr = token.contract; decimals = token.decimals || 0; }
          }
          const amountSat = app.mmxToSat(pending.params.amount, decimals);
          const sendResult = await app.sendTransaction(pending.params.to, amountSat, contractAddr);
          _br.storage.local.set({ [`mmx_sresult_${pending.id}`]: { id: pending.id, response: { txid: sendResult.txid } } });
          sendNotice.style.display = "none";
          _br.storage.local.remove(sendKey);
          _br.action.setBadgeText({ text: "" });
          showView("dashboardView");
          setStatus("dashStatus", `dApp payment sent! TXID: ${sendResult.txid.substring(0, 20)}... Fee: ${sendResult.fee_value} MMX`, "success");
          setTimeout(() => renderDashboard(), 2000);
        } catch (e) {
          document.getElementById("dappSendStatus").textContent = "Error: " + e.message;
          document.getElementById("dappSendConfirm").disabled = false;
          _br.storage.local.set({ [`mmx_sresult_${pending.id}`]: { id: pending.id, response: { error: e.message } } });
        }
      };
      document.getElementById("dappSendReject").onclick = () => {
        _br.storage.local.set({ [`mmx_sresult_${pending.id}`]: { id: pending.id, response: { error: "User rejected" } } });
        sendNotice.style.display = "none";
        _br.storage.local.remove(sendKey);
        _br.action.setBadgeText({ text: "" });
        showView("dashboardView");
      };
      // Switch to dApp view to show the send request
      showView("dappView");
    } else {
      sendNotice.style.display = "none";
    }
  });
  
  // Check for pending dApp signing actions (get_public_key, sign_message, sign_transaction)
  // Scan for ID-prefixed keys to handle concurrent requests from multiple tabs
  _br.storage.local.get(null, (result) => {
    const actionKey = Object.keys(result).find(k => k.startsWith('mmx_pdapp_'));
    const pending = actionKey ? result[actionKey] : null;
    if (!pending) return;
    
    const status = document.getElementById("dappSendStatus");
    const sendNotice = document.getElementById("dappSendNotice");
    const sendConfirm = document.getElementById("dappSendConfirm");
    const sendReject = document.getElementById("dappSendReject");
    
    try {
      let response;
      if (pending.type === "MMX_GET_PUBLIC_KEY") {
        const pubKey = app.getPublicKeyHex();
        response = { public_key: pubKey };
        _br.storage.local.set({ [`mmx_dresult_${pending.id}`]: { id: pending.id, response } });
        _br.storage.local.remove(actionKey);
        _br.action.setBadgeText({ text: "" });
        showView("dashboardView");
        setStatus("dashStatus", "dApp: public key shared", "success");
        
      } else if (pending.type === "MMX_SIGN_MESSAGE") {
        // Show confirmation for message signing
        sendNotice.style.display = "block";
        document.getElementById("dappSendOrigin").textContent = `${pending.origin} wants you to sign a message:`;
        document.getElementById("dappSendAmount").textContent = `"${pending.params.msg}"`;
        document.getElementById("dappSendTo").textContent = "Sign with wallet key";
        status.textContent = "";
        sendConfirm.disabled = false;
        sendConfirm.textContent = "Sign";
        sendConfirm.onclick = async () => {
          sendConfirm.disabled = true;
          try {
            const result = await app.signMessage(pending.params.msg);
            _br.storage.local.set({ [`mmx_dresult_${pending.id}`]: { id: pending.id, response: result } });
            sendNotice.style.display = "none";
            _br.storage.local.remove(actionKey);
            _br.action.setBadgeText({ text: "" });
            showView("dashboardView");
            setStatus("dashStatus", "dApp: message signed", "success");
          } catch (e) {
            status.textContent = "Error: " + e.message;
            sendConfirm.disabled = false;
            _br.storage.local.set({ [`mmx_dresult_${pending.id}`]: { id: pending.id, response: { error: e.message } } });
          }
        };
        sendReject.onclick = () => {
          _br.storage.local.set({ [`mmx_dresult_${pending.id}`]: { id: pending.id, response: null } });
          sendNotice.style.display = "none";
          _br.storage.local.remove(actionKey);
          _br.action.setBadgeText({ text: "" });
          showView("dashboardView");
        };
        showView("dappView");
        
      } else if (pending.type === "MMX_SIGN_TRANSACTION") {
        // Show confirmation for transaction signing
        sendNotice.style.display = "block";
        document.getElementById("dappSendOrigin").textContent = `${pending.origin} wants you to sign a transaction`;
        const inputs = pending.params.tx?.inputs || [];
        const outputs = pending.params.tx?.outputs || [];
        document.getElementById("dappSendAmount").textContent = `${inputs.length} in, ${outputs.length} out`;
        document.getElementById("dappSendTo").textContent = "Review and sign";
        status.textContent = "";
        sendConfirm.disabled = false;
        sendConfirm.textContent = "Sign";
        sendConfirm.onclick = async () => {
          sendConfirm.disabled = true;
          try {
            const signedTx = await app.signTransactionObject(pending.params.tx);
            _br.storage.local.set({ [`mmx_dresult_${pending.id}`]: { id: pending.id, response: signedTx } });
            sendNotice.style.display = "none";
            _br.storage.local.remove(actionKey);
            _br.action.setBadgeText({ text: "" });
            showView("dashboardView");
            setStatus("dashStatus", "dApp: transaction signed", "success");
          } catch (e) {
            status.textContent = "Error: " + e.message;
            sendConfirm.disabled = false;
            _br.storage.local.set({ [`mmx_dresult_${pending.id}`]: { id: pending.id, response: { error: e.message } } });
          }
        };
        sendReject.onclick = () => {
          _br.storage.local.set({ [`mmx_dresult_${pending.id}`]: { id: pending.id, response: null } });
          sendNotice.style.display = "none";
          _br.storage.local.remove(actionKey);
          _br.action.setBadgeText({ text: "" });
          showView("dashboardView");
        };
        showView("dappView");
        
      }
    } catch (e) {
      _br.storage.local.set({ [`mmx_dresult_${pending.id}`]: { id: pending.id, response: { error: e.message } } });
      _br.storage.local.remove(actionKey);
      _br.action.setBadgeText({ text: "" });
    }
  });
}

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

// --- Background session (avoids re-entering password on popup reopen) ---

function bgSend(message) {
  return new Promise((resolve) => {
    try {
      _browser.runtime.sendMessage(message, (response) => {
        if (_browser.runtime.lastError) {
          // Background might not be ready; resolve with null
          resolve(null);
        } else {
          resolve(response);
        }
      });
    } catch {
      resolve(null);
    }
  });
}

async function saveSessionToBackground() {
  const seed = app.getUnlockedSeed();
  const wallet = app.getUnlockedWallet();
  if (seed && wallet) {
    await bgSend({ type: "SESSION_SET", seed: Array.from(seed), wallet });
  }
}

async function clearSessionFromBackground() {
  await bgSend({ type: "SESSION_CLEAR" });
}

async function tryRestoreFromBackground() {
  try {
    const resp = await bgSend({ type: "SESSION_GET" });
    if (resp && resp.seed && resp.wallet) {
      app.restoreSession(new Uint8Array(resp.seed), resp.wallet);
      return true;
    }
  } catch {}
  return false;
}

// --- Initialize ---

async function init() {
  try {
    await api.initNodeUrl();
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

    // Check background for active session (popup reopened without closing extension)
    const restored = await tryRestoreFromBackground();
    if (restored && app.isUnlocked()) {
      await renderDashboard();
      // Check for pending dApp requests
      try { checkPendingDapp(); } catch {}
    } else {
      document.getElementById("unlockWalletName").textContent = wallet.name;
      showView("unlockView");
      document.getElementById("unlockPassword").focus();
    }
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
    await saveSessionToBackground();
    document.getElementById("seedDisplay").textContent = mnemonic.join("  ");
    const wallet = app.getUnlockedWallet();
    document.getElementById("newAddress").textContent = wallet ? wallet.address : "";
    showView("seedView");
    setStatus("createStatus", "Wallet created!", "success");
    // Check for pending dApp requests now that wallet is created
    try { setTimeout(() => checkPendingDapp(), 100); } catch {}
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
    await saveSessionToBackground();
    await renderDashboard();
    setStatus("importStatus", "Wallet imported!", "success");
    try { checkPendingDapp(); } catch {}
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
    await saveSessionToBackground();
    await renderDashboard();
    setStatus("unlockStatus", "Unlocked", "success");
    // Check for pending dApp requests now that wallet is unlocked
    try { checkPendingDapp(); } catch {}
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

  // Check for pending dApp requests (address + send)
  try { checkPendingDapp(); } catch {}

  // Initialize dApp toggle
  try { initDappToggle(); } catch {}

  // Fetch balance + tx history in parallel (non-blocking)
  setStatus("dashStatus", "Fetching balance...", "");
  txOffset = 0;
  
  const [balanceResult, txResult] = await Promise.allSettled([
    app.fetchBalance(),
    app.getTransactionHistory(10, 0)
  ]);
  
  // Handle balance
  if (balanceResult.status === "fulfilled") {
    const balances = balanceResult.value;
    renderBalances(balances);
    lastBalanceHash = JSON.stringify(balances);
    setStatus("dashStatus", "");
    app.startAutoRefresh((newBalances) => {
      renderBalances(newBalances);
      updateNetworkBadge();
      setStatus("dashStatus", "Balance updated", "success");
      setTimeout(() => setStatus("dashStatus", ""), 2000);
    });
  } else {
    setStatus("dashStatus", "Balance fetch failed", "error");
    console.error("Balance error:", balanceResult.reason);
  }
  
  // Handle tx history
  if (txResult.status === "fulfilled") {
    const txs = txResult.value;
    allTxs = txs;
    renderTxHistory(txs);
    document.getElementById("txLoadMore").style.display = txs.length >= 10 ? "block" : "none";
  } else {
    console.error("TX history error:", txResult.reason?.message);
    // Retry once after 2s
    setTimeout(async () => {
      try {
        const txs = await app.getTransactionHistory(10, 0);
        allTxs = txs;
        renderTxHistory(txs);
        document.getElementById("txLoadMore").style.display = txs.length >= 10 ? "block" : "none";
      } catch(e2) {
        document.getElementById("txHistory").innerHTML = '<div style="color:#888;font-size:11px;text-align:center;">Failed to load history</div>';
      }
    }, 2000);
  }
  // Populate contact picker (separate so it works even if tx history fails)
  try { await populateContactPicker(); } catch {}
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
      <span style="font-weight:600;font-size:14px;">${app.escapeHtml(b.symbol || '?')}</span>
      <span style="font-family:monospace;font-size:14px;color:#4caf50;">${app.escapeHtml(amount)}</span>
    </div>`;
  }
  list.innerHTML = html;

  sendCurrency.innerHTML = "";
  for (const b of balances) {
    sendCurrency.innerHTML += `<option value="${app.escapeHtml(b.symbol)}">${app.escapeHtml(b.symbol)}</option>`;
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
    const color = isSent ? '#f44336' : '#4caf50';
    const addrShort = app.escapeHtml(tx.id.substring(0, 12)) + '...';
    const confirmations = tx.confirm || 0;
    const pendingBadge = confirmations < 1 ? ' <span style="color:#ff9800;font-size:9px;">⏳ pending</span>' : '';
    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div style="display:flex;align-items:center;gap:6px;">
        <span>${arrow}</span>
        <div>
          <div style="font-size:12px;font-weight:600;color:${color};">${isSent ? '-' : '+'}${app.escapeHtml(tx.amount)} ${app.escapeHtml(tx.symbol)}${pendingBadge}</div>
          <div style="font-family:monospace;font-size:9px;color:#666;">${addrShort} · h:${app.escapeHtml(tx.height)}</div>
        </div>
      </div>
      <a href="https://explore.mmx.network/#/explore/transaction/${app.escapeHtml(tx.id)}" target="_blank" style="color:#555;font-size:10px;text-decoration:none;">↗</a>
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
      await clearSessionFromBackground();
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
  clearSessionFromBackground();
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

// Settings
if (document.getElementById("settingsBtn")) {
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("popupRpcUrl").value = api.getNodeUrl();
    document.getElementById("popupRpcStatus").textContent = "Current: " + api.getNodeUrl();
    showView("settingsView");
  });
}
if (document.getElementById("settingsBackBtn")) {
  document.getElementById("settingsBackBtn").addEventListener("click", () => showView("dashboardView"));
}
if (document.getElementById("popupRpcOfficial")) {
  document.getElementById("popupRpcOfficial").addEventListener("click", () => {
    document.getElementById("popupRpcUrl").value = "https://rpc.mmx.network";
  });
}
if (document.getElementById("popupRpcLocal")) {
  document.getElementById("popupRpcLocal").addEventListener("click", () => {
    document.getElementById("popupRpcUrl").value = "http://localhost:11380";
  });
}
if (document.getElementById("popupRpcSave")) {
  document.getElementById("popupRpcSave").addEventListener("click", async () => {
    const url = document.getElementById("popupRpcUrl").value.trim();
    if (!url) return;
    const btn = document.getElementById("popupRpcSave");
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      await api.saveNodeUrl(url);
      document.getElementById("popupRpcStatus").innerHTML = '<span style="color:#4caf50">✓ Saved! RPC set to ' + app.escapeHtml(url) + '</span>';
      // Update the settings input to show the saved value
      document.getElementById("popupRpcUrl").value = api.getNodeUrl();
      // Refresh balance/tx data with new RPC (no reload needed)
      try {
        if (app.isUnlocked()) {
          await renderDashboard();
        }
      } catch {}
    } catch (e) {
      document.getElementById("popupRpcStatus").innerHTML = '<span style="color:#f44336">✗ Error: ' + app.escapeHtml(e.message) + '</span>';
    }
    btn.disabled = false;
    btn.textContent = "Save";
  });
}

document.getElementById("lockBtn").addEventListener("click", async () => {
  app.stopAutoRefresh();
  app.lockWalletPub();
  await clearSessionFromBackground();
  document.getElementById("unlockPassword").value = "";
  // Show unlock view directly
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
          <div style="font-size:13px;font-weight:600;">${app.escapeHtml(c.name)}</div>
          <div style="font-family:monospace;font-size:10px;color:#666;">${app.escapeHtml(c.address.substring(0,20))}...</div>
        </div>
        <button class="btn btn-secondary" data-id="${app.escapeHtml(c.id)}" data-addr="${app.escapeHtml(c.address)}" style="font-size:10px;padding:4px 8px;">Send</button>
        <button class="btn btn-danger" data-del="${app.escapeHtml(c.id)}" style="font-size:10px;padding:4px 8px;margin-left:4px;">🗑</button>
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
    select.innerHTML += `<option value="${app.escapeHtml(c.address)}">${app.escapeHtml(c.name)} — ${app.escapeHtml(c.address.substring(0,12))}...</option>`;
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
  const status = document.getElementById("contactStatus");
  if (!name) { status.textContent = "Enter a name"; status.className = "status error"; return; }
  if (!addr || !addr.startsWith("mmx1")) { status.textContent = "Enter a valid MMX address"; status.className = "status error"; return; }
  try {
    await app.addContact(name, addr);
    document.getElementById("contactName").value = "";
    document.getElementById("contactAddr").value = "";
    status.textContent = "Contact added!";
    status.className = "status success";
    await renderContacts();
    await populateContactPicker();
  } catch (e) {
    status.textContent = e.message || "Failed to add contact";
    status.className = "status error";
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
    html += `<div class="wallet-item${isActive}" data-id="${app.escapeHtml(w.id)}">
      <div>
        <div class="wallet-name">${app.escapeHtml(w.name)}</div>
        <div class="wallet-addr">${app.escapeHtml(addrShort)}</div>
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
      await clearSessionFromBackground();
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

  // Validate bech32m checksum
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
    const spendable = token ? BigInt(Math.floor(token.spendable * Math.pow(10, token.decimals || 0))) : 0n;
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
      const mmxSpendable = mmxBal ? BigInt(Math.floor(mmxBal.spendable * 1e6)) : 0n;
      if (mmxSpendable < feeSat) {
        setStatus("sendStatus", `Insufficient MMX for fee: need ${(Number(feeSat) / 1e6).toFixed(6)} MMX`, "error"); return;
      }
    }
  } catch {
    // If balance check fails, continue — node will reject if insufficient
  }

  // Store pending send so broadcast reads from state, not DOM
  pendingSend = { to, amountSat, contractAddr, decimals, currency, feeSat, memo };

  // Show confirmation view
  const feeMmx = (Number(feeSat) / 1e6).toFixed(6);
  const amountDisplay = decimals > 0 ? amount : amountSat.toString();
  const totalDisplay = currency === "MMX"
    ? `${(Number(amountSat + feeSat) / 1e6).toFixed(6)} MMX`
    : `${amountDisplay} ${currency} + ${feeMmx} MMX fee`;

  document.getElementById("confirmAmount").textContent = `${amountDisplay} ${currency}`;
  document.getElementById("confirmTo").textContent = to;
  document.getElementById("confirmFee").textContent = `~${feeMmx} MMX`;
  document.getElementById("confirmTotal").textContent = totalDisplay;
  if (memo) {
    document.getElementById("confirmMemo").textContent = memo;
    document.getElementById("confirmMemoRow").style.display = "block";
  } else {
    document.getElementById("confirmMemoRow").style.display = "none";
  }
  showView("sendConfirmView");
});

// --- Send broadcast (final confirm) ---

document.getElementById("sendBroadcastBtn").addEventListener("click", async () => {
  const btn = document.getElementById("sendBroadcastBtn");
  // Rate limit — disable button for 3s to prevent double-clicks
  if (btn.disabled) return;
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, 3000);

  if (!pendingSend) { setStatus("sendConfirmStatus", "No pending send", "error"); return; }

  setStatus("sendConfirmStatus", "Building & signing...", "");

  try {
    const sendResult = await app.sendTransaction(pendingSend.to, pendingSend.amountSat, pendingSend.contractAddr, pendingSend.memo);
    setStatus("sendConfirmStatus", `✅ Sent! Fee: ${sendResult.fee_value} MMX`, "success");
    document.getElementById("sendTo").value = "";
    document.getElementById("sendAmount").value = "";
    document.getElementById("sendMemo").value = "";
    pendingSend = null;

    const txLink = document.createElement("div");
    txLink.className = "tx-link";
    txLink.innerHTML = `<a href="https://explore.mmx.network/#/explore/transaction/${app.escapeHtml(sendResult.txid)}" target="_blank" style="color:#00d4ff;text-decoration:none;">${app.escapeHtml(sendResult.txid.substring(0,20))}...↗</a>`;
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

if (document.getElementById("openTabBtn")) {
  document.getElementById("openTabBtn").addEventListener("click", () => {
    if (typeof browser !== "undefined" && browser.tabs) {
      browser.tabs.create({ url: browser.runtime.getURL("wallet.html") });
    } else if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.create({ url: chrome.runtime.getURL("wallet.html") });
    }
    window.close();
  });
}

// --- dApp integration toggle (opt-in) ---

async function initDappToggle() {
  const toggle = document.getElementById("dappToggle");
  const slider = document.getElementById("dappSlider");
  const status = document.getElementById("dappToggleStatus");
  if (!toggle || !slider) return;

  // Check current state: is the content script registered?
  let registered = false;
  try {
    const resp = await bgSend({ type: "DAPP_STATUS" });
    registered = resp?.registered || false;
  } catch {}

  function updateUI(on) {
    toggle.checked = on;
    slider.style.background = on ? "#4caf50" : "#555";
    const knob = slider.querySelector("span");
    if (knob) {
      knob.style.transform = on ? "translateX(20px)" : "translateX(0)";
      knob.style.background = on ? "#fff" : "#ccc";
    }
  }
  updateUI(registered);

  toggle.addEventListener("change", async () => {
    if (toggle.checked) {
      status.textContent = "Enabling...";
      status.className = "status";
      try {
        const resp = await bgSend({ type: "DAPP_ENABLE" });
        if (resp?.ok) {
          status.textContent = "✅ dApp enabled. window.mmx injected into open tabs.";
          status.className = "status success";
          updateUI(true);
        } else {
          status.textContent = resp?.error || "Failed to enable";
          status.className = "status error";
          updateUI(false);
        }
      } catch (e) {
        status.textContent = e.message;
        status.className = "status error";
        updateUI(false);
      }
    } else {
      status.textContent = "Disabling...";
      status.className = "status";
      try {
        await bgSend({ type: "DAPP_DISABLE" });
        status.textContent = "✅ dApp disabled. window.mmx removed from open tabs.";
        status.className = "status success";
        updateUI(false);
      } catch (e) {
        status.textContent = e.message;
        status.className = "status error";
      }
    }
  });
}

// --- Start ---
init();
