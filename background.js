/**
 * background.js — Background script for MMX wallet extension.
 * Handles communication between popup and content scripts (for dApp integration).
 * Wallet storage is handled by wallet-store.js (chrome.storage.local).
 */

const _browser = typeof browser !== "undefined" ? browser : chrome;

// Listen for installation
_browser.runtime.onInstalled.addListener(() => {
  // Background script runs on extension install/load
});

// Listen for messages from content scripts (dApp integration)
_browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
