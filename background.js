/**
 * background.js — Background script for MMX wallet extension.
 * Handles communication between popup and content scripts (for dApp integration).
 * Wallet storage is handled by wallet-store.js (chrome.storage.local).
 */

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log("MMX Wallet installed");
});

// Listen for messages from content scripts (dApp integration)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "WALLET_INFO") {
    chrome.storage.local.get(["mmx_wallets", "mmx_active_wallet"], (result) => {
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
    chrome.storage.local.get(["mmx_wallets", "mmx_active_wallet"], (result) => {
      const wallets = result.mmx_wallets || [];
      const activeId = result.mmx_active_wallet;
      const activeWallet = wallets.find(w => w.id === activeId);
      sendResponse({ address: activeWallet ? activeWallet.address : null });
    });
    return true;
  }
});
