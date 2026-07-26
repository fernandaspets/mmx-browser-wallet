/**
 * content.js — Injected into web pages to enable MMX wallet integration.
 * Exposes window.mmx API similar to window.ethereum for dApps.
 */

// Inject the MMX provider script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
(script.onload = function() { this.remove(); })();
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the injected script
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data || !event.data.source || event.data.source !== 'mmx-inject') return;
  
  const { type, id } = event.data;
  
  if (type === 'MMX_REQUEST') {
    // Forward to background
    chrome.runtime.sendMessage({ type: 'WALLET_INFO' }, (response) => {
      window.postMessage({
        source: 'mmx-content',
        id,
        response,
      }, '*');
    });
  }
  
  if (type === 'MMX_GET_ADDRESS') {
    chrome.runtime.sendMessage({ type: 'GET_ADDRESS' }, (response) => {
      window.postMessage({
        source: 'mmx-content',
        id,
        response,
      }, '*');
    });
  }
});
