/**
 * background.js — Background script for MMX wallet extension.
 * Handles communication between popup and content scripts (for dApp integration).
 * Wallet storage is handled by wallet-store.js (chrome.storage.local).
 *
 * SESSION PERSISTENCE:
 * The popup's JS context is destroyed when it closes. To avoid re-entering
 * the password on every popup reopen, the background holds the unlocked seed
 * in memory (not in persistent storage). The popup asks the background for
 * the session on open — if still valid, it restores without password entry.
 */

const _browser = typeof browser !== "undefined" ? browser : chrome;

// --- Session state (lives in background, survives popup close/reopen) ---
let sessionSeed = null;       // Array (serializable form of Uint8Array)
let sessionWallet = null;    // wallet metadata object
let autoLockTimer = null;
const AUTO_LOCK_MS = 5 * 60 * 1000; // 5 minutes

function resetAutoLock() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (sessionSeed) {
    autoLockTimer = setTimeout(() => {
      clearSession();
    }, AUTO_LOCK_MS);
  }
}

function clearSession() {
  if (sessionSeed && sessionSeed.fill) sessionSeed.fill(0);
  sessionSeed = null;
  sessionWallet = null;
  if (autoLockTimer) { clearTimeout(autoLockTimer); autoLockTimer = null; }
}

function isSessionValid() {
  return sessionSeed !== null && sessionWallet !== null;
}

// --- Message handler ---

_browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- Session management (popup ↔ background) ---

  if (message.type === "SESSION_SET") {
    sessionSeed = message.seed;       // Array
    sessionWallet = message.wallet;   // {id, name, address, ...}
    resetAutoLock();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "SESSION_GET") {
    // Any message resets the auto-lock timer (user is active)
    if (isSessionValid()) {
      resetAutoLock();
      sendResponse({
        seed: sessionSeed,
        wallet: sessionWallet
      });
    } else {
      sendResponse({ seed: null, wallet: null });
    }
    return false;
  }

  if (message.type === "SESSION_CLEAR") {
    clearSession();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "SESSION_PING") {
    // Reset auto-lock without returning session data (activity signal)
    if (isSessionValid()) resetAutoLock();
    sendResponse({ valid: isSessionValid() });
    return false;
  }

  // --- dApp integration (content script → background) ---

  if (message.type === "WALLET_INFO") {
    _browser.storage.local.get(["mmx_wallets", "mmx_active_wallet"], (result) => {
      const wallets = result.mmx_wallets || [];
      const activeId = result.mmx_active_wallet;
      const activeWallet = wallets.find(w => w.id === activeId);
      sendResponse({
        hasWallet: wallets.length > 0,
        address: activeWallet ? activeWallet.address : null,
        name: activeWallet ? activeWallet.name : null,
      });
    });
    return true; // async response
  }

  if (message.type === "GET_ADDRESS") {
    _browser.storage.local.get(["mmx_wallets", "mmx_active_wallet"], (result) => {
      const wallets = result.mmx_wallets || [];
      const activeId = result.mmx_active_wallet;
      const activeWallet = wallets.find(w => w.id === activeId);
      sendResponse({ address: activeWallet ? activeWallet.address : null });
    });
    return true;
  }

  // --- dApp content script registration (opt-in) ---
  // NOTE: registerContentScripts/unregisterContentScripts only affect FUTURE page loads.
  // Already-open tabs keep their current state until reloaded. The UI notifies
  // the user to reload tabs after toggling.

  if (message.type === "DAPP_ENABLE") {
    const _chrome = _browser.scripting ? _browser : (typeof chrome !== "undefined" ? chrome : null);
    if (!_chrome || !_chrome.scripting) {
      sendResponse({ ok: false, error: "scripting API not available" });
      return false;
    }
    _chrome.scripting.registerContentScripts([{
      id: "mmx-dapp",
      matches: ["<all_urls>"],
      js: ["content.js"],
      runAt: "document_start"
    }]).then(() => {
      _browser.storage.local.set({ mmx_dapp_enabled: true });
      sendResponse({ ok: true });
    }).catch(e => {
      sendResponse({ ok: false, error: e.message });
    });
    return true; // async
  }

  if (message.type === "DAPP_DISABLE") {
    const _chrome = _browser.scripting ? _browser : (typeof chrome !== "undefined" ? chrome : null);
    if (_chrome && _chrome.scripting) {
      _chrome.scripting.unregisterContentScripts({ ids: ["mmx-dapp"] }).catch(() => {});
    }
    _browser.storage.local.set({ mmx_dapp_enabled: false });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "DAPP_STATUS") {
    const _chrome = _browser.scripting ? _browser : (typeof chrome !== "undefined" ? chrome : null);
    if (!_chrome || !_chrome.scripting) {
      sendResponse({ registered: false });
      return false;
    }
    _chrome.scripting.getRegisteredContentScripts({ ids: ["mmx-dapp"] }).then(scripts => {
      sendResponse({ registered: scripts.length > 0 });
    }).catch(() => {
      sendResponse({ registered: false });
    });
    return true; // async
  }
});
