/**
 * background.js — Background script for MMX wallet extension.
 * Handles communication between popup, content scripts, and dApp integrations.
 * Wallet storage is handled by wallet-store.js (chrome.storage.local).
 *
 * SESSION PERSISTENCE (MV3-compliant):
 * In Chrome MV3, the service worker dies after ~30s of inactivity, wiping
 * global variables. We use chrome.storage.session to persist the unlocked
 * seed across SW sleep/wake cycles. storage.session is volatile (in-memory
 * only, cleared on browser close) — safer than storage.local for seeds.
 *
 * AUTO-LOCK:
 * We use chrome.alarms instead of setTimeout. Alarms survive SW death —
 * the browser wakes the SW to fire the alarm, ensuring auto-lock always
 * works even if the SW was asleep.
 *
 * FALLBACK:
 * For browsers without storage.session or alarms (older Firefox), we fall
 * back to in-memory globals + setTimeout. This is less reliable but
 * works in Firefox's event page model (which is more persistent than
 * Chrome's service worker).
 */

const _browser = typeof browser !== "undefined" ? browser : chrome;

// --- Feature detection ---
const hasSessionStorage = _browser.storage && _browser.storage.session;
const hasAlarms = _browser.alarms;

// --- Constants ---
const AUTO_LOCK_MINUTES = 5;           // for chrome.alarms
const AUTO_LOCK_MS = 5 * 60 * 1000;   // for setTimeout fallback
const ALARM_NAME = "mmx-auto-lock";

// --- In-memory fallback (for browsers without storage.session) ---
let _memSeed = null;
let _memWallet = null;
let autoLockTimer = null;

// --- Session helpers ---

async function getSession() {
  if (hasSessionStorage) {
    return new Promise(resolve => {
      _browser.storage.session.get(["seed", "wallet"], resolve);
    });
  }
  return { seed: _memSeed, wallet: _memWallet };
}

async function setSession(seed, wallet) {
  if (hasSessionStorage) {
    return new Promise(resolve => {
      _browser.storage.session.set({ seed, wallet }, resolve);
    });
  }
  _memSeed = seed;
  _memWallet = wallet;
}

async function clearSession() {
  if (hasSessionStorage) {
    // Zero the seed before removing
    const result = await new Promise(r => _browser.storage.session.get(["seed"], r));
    if (result.seed && result.seed.fill) result.seed.fill(0);
    await new Promise(resolve => {
      _browser.storage.session.remove(["seed", "wallet"], resolve);
    });
  }
  if (_memSeed && _memSeed.fill) _memSeed.fill(0);
  _memSeed = null;
  _memWallet = null;
  if (autoLockTimer) { clearTimeout(autoLockTimer); autoLockTimer = null; }
  if (hasAlarms) {
    _browser.alarms.clear(ALARM_NAME).catch(() => {});
  }
}

async function isSessionValid() {
  const session = await getSession();
  return session.seed != null && session.wallet != null;
}

function resetAutoLock() {
  if (hasAlarms) {
    // chrome.alarms.create replaces any existing alarm with the same name
    _browser.alarms.create(ALARM_NAME, { delayInMinutes: AUTO_LOCK_MINUTES });
  } else {
    // Fallback: setTimeout (not SW-survivable, but works in Firefox event page)
    if (autoLockTimer) clearTimeout(autoLockTimer);
    autoLockTimer = setTimeout(() => clearSession(), AUTO_LOCK_MS);
  }
}

// --- Alarm listener (fires even after SW restart) ---
if (hasAlarms) {
  _browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      clearSession();
    }
  });
}

// --- Message handler ---

_browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- Session management (popup ↔ background) ---

  if (message.type === "SESSION_SET") {
    setSession(message.seed, message.wallet).then(() => {
      resetAutoLock();
      sendResponse({ ok: true });
    });
    return true; // async
  }

  if (message.type === "SESSION_GET") {
    (async () => {
      const session = await getSession();
      if (session.seed != null && session.wallet != null) {
        resetAutoLock();
        sendResponse({ seed: session.seed, wallet: session.wallet });
      } else {
        sendResponse({ seed: null, wallet: null });
      }
    })();
    return true; // async
  }

  if (message.type === "SESSION_CLEAR") {
    clearSession().then(() => sendResponse({ ok: true }));
    return true; // async
  }

  if (message.type === "SESSION_PING") {
    (async () => {
      const valid = await isSessionValid();
      if (valid) resetAutoLock();
      sendResponse({ valid });
    })();
    return true; // async
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
