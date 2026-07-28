/**
 * inject.js — Injects window.mmx and window.mmx_wallet into web pages for dApp integration.
 * Runs in the webpage main context (not the extension's isolated world).
 *
 * SECURITY: Everything wrapped in an IIFE closure so the internal _request
 * function is hidden from page scripts. A malicious site cannot access or
 * replace _request — the public methods reference it via closure, not via
 * window.mmx._request.
 *
 * Two namespaces:
 *   - window.mmx        — our extension's send API (send + getAddress)
 *   - window.mmx_wallet  — official MMX dApp API (get_address, get_public_key,
 *                          get_network, sign_message, sign_transaction)
 *
 * Note: The MMX node web-gui checks `typeof window.mmx !== 'undefined'` to
 * detect if it's running inside the native desktop wallet. We only inject
 * if window.mmx doesn't already exist (don't clobber the native app).
 * window.mmx_wallet is never used by the node GUI, so it's always safe.
 */

(function() {
  if (typeof window.mmx !== 'undefined') {
    // window.mmx already exists (native desktop wallet). Don't clobber it.
    // The native app's window.mmx has its own theme/locale properties.
    // We still signal that our extension is available for dApp integration.
    window.dispatchEvent(new CustomEvent('mmx#extension-ready'));
    return;
  }

  // Private communication method — hidden inside closure, not accessible from page
  function _request(data, timeoutMs) {
    timeoutMs = timeoutMs || 5000;
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
  }

  // --- Our extension's send API ---
  window.mmx = {
    isMMX: true,

    getAddress: async function() {
      return _request({ type: 'MMX_GET_ADDRESS' })
        .then(r => r?.address || null);
    },

    // Send a transaction. Shows confirm dialog in the extension popup.
    // params: { to: "mmx1...", amount: "1", currency: "TRAIL" or "MMX", memo: "optional" }
    // Returns: { txid: "ABCD..." } or throws on rejection/error
    send: async function(params) {
      return _request({ type: 'MMX_SEND', params }, 300000);
    },

    // Note: _request is NOT exposed here — it's a closure variable.
    // Malicious sites cannot access or replace it.
  };

  // --- Official MMX dApp API (window.mmx_wallet) ---
  // Mirrors the native desktop wallet's window.mmx_wallet interface.

  window.mmx_wallet = {
    isMMX: true,

    // Returns the active wallet address in bech32 format.
    // Note: can be spoofed. Use sign_message() to prove ownership.
    get_address: async function() {
      return _request({ type: 'MMX_GET_ADDRESS' })
        .then(r => r?.address || null);
    },

    // Returns the active wallet public key in hex string format (upper case).
    get_public_key: async function() {
      return _request({ type: 'MMX_GET_PUBLIC_KEY' })
        .then(r => r?.public_key || null);
    },

    // Returns the network name, e.g. "MMX/mainnet".
    get_network: async function() {
      return _request({ type: 'MMX_GET_NETWORK' })
        .then(r => r?.network || null);
    },

    // Signs a string message with prefix "MMX/sign_message/" using SHA-256.
    // Used to prove ownership of the wallet address.
    // Returns: { signature: "hex", public_key: "hex" } or null if not approved.
    sign_message: async function(msg) {
      return _request({ type: 'MMX_SIGN_MESSAGE', params: { msg } }, 30000);
    },

    // Signs a given transaction if the user approves.
    // tx format matches interface/Transaction.vni.
    // If tx.id is not specified, the user may modify expiration/fee.
    // Returns the signed transaction, or null if not approved.
    sign_transaction: async function(tx) {
      return _request({ type: 'MMX_SIGN_TRANSACTION', params: { tx } }, 300000);
    },
  };

  window.dispatchEvent(new CustomEvent('mmx#initialized'));
})();
