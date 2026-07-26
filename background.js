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
});
