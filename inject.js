/**
 * inject.js — Injects window.mmx into web pages for dApp integration.
 * Runs in the page's context (not the extension's isolated world).
 */

window.mmx = {
  isMMX: true,
  
  getAddress: async function() {
    return window.mmx._request({ type: 'MMX_GET_ADDRESS' })
      .then(r => r?.address || null);
  },
  
  // Send a transaction. Shows confirm dialog in the extension popup.
  // params: { to: "mmx1...", amount: "1", currency: "TRAIL" or "MMX", memo: "optional" }
  // Returns: { txid: "ABCD..." } or throws on rejection/error
  send: async function(params) {
    return window.mmx._request({ type: 'MMX_SEND', params }, 60000);
  },
  
  // Internal request handler with configurable timeout
  _request: function(data, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const id = Date.now() + Math.random();
      window.postMessage({
        source: 'mmx-inject',
        id,
        ...data,
      }, '*');
      
      const handler = (event) => {
        if (event.data && event.data.source === 'mmx-content' && event.data.id === id) {
          window.removeEventListener('message', handler);
          const response = event.data.response;
          if (response && response.error) reject(new Error(response.error));
          else resolve(response);
        }
      };
      window.addEventListener('message', handler);
      
      setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('Request timeout'));
      }, timeoutMs);
    });
  },
};

window.dispatchEvent(new CustomEvent('mmx#initialized'));
