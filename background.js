/**
 * background.js — Service worker for MMX wallet extension.
 * Handles wallet state persistence and communication between popup and content scripts.
 */

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  console.log("MMX Wallet installed");
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "WALLET_INFO") {
    chrome.storage.local.get("mmx_wallet_data", (result) => {
      const data = result.mmx_wallet_data;
      sendResponse({
        hasWallet: !!data,
        address: data ? data.address : null,
      });
    });
    return true; // async response
  }
  
  if (message.type === "GET_ADDRESS") {
    chrome.storage.local.get("mmx_wallet_data", (result) => {
      const data = result.mmx_wallet_data;
      sendResponse({ address: data ? data.address : null });
    });
    return true;
  }
});
