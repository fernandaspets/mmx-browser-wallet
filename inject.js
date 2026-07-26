/**
 * inject.js — Injected into web pages. Exposes window.mmx for dApp integration.
 * This runs in the page's context (not the extension's isolated world).
 */

window.mmx = {
  isMMX: true,
  
  // Get the current wallet address
  request: async function(args) {
    // args = { method: 'mmx_getAddress', params: {} }
    return new Promise((resolve, reject) => {
      const id = Date.now() + Math.random();
      window.postMessage({
        source: 'mmx-inject',
        type: 'MMX_REQUEST',
        id,
        ...args,
      }, '*');
      
      const handler = (event) => {
        if (event.data && event.data.source === 'mmx-content' && event.data.id === id) {
          window.removeEventListener('message', handler);
          resolve(event.data.response);
        }
      };
      window.addEventListener('message', handler);
      
      // Timeout after 5 seconds
      setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('Request timeout'));
      }, 5000);
    });
  },
  
  // Convenience method
  getAddress: async function() {
    return new Promise((resolve, reject) => {
      const id = Date.now() + Math.random();
      window.postMessage({
        source: 'mmx-inject',
        type: 'MMX_GET_ADDRESS',
        id,
      }, '*');
      
      const handler = (event) => {
        if (event.data && event.data.source === 'mmx-content' && event.data.id === id) {
          window.removeEventListener('message', handler);
          resolve(event.data.response?.address || null);
        }
      };
      window.addEventListener('message', handler);
      
      setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('Request timeout'));
      }, 5000);
    });
  },
};

// Dispatch event to notify dApps that MMX wallet is available
window.dispatchEvent(new CustomEvent('mmx#initialized'));
