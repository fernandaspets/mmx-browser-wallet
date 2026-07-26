/**
 * content.js — Injected into web pages to enable MMX wallet integration.
 * Exposes window.mmx API similar to window.ethereum for dApps.
 * 
 * Security (#91): Address requests require user approval per site.
 * The popup shows "Website X wants to see your wallet address. Allow?"
 */

// Inject the MMX provider script
const script = document.createElement('script');
script.src = (typeof browser !== 'undefined' ? browser.runtime : chrome.runtime).getURL('inject.js');
script.onload = function() { script.remove(); };
(document.head || document.documentElement).appendChild(script);

// Permission cache per origin
const PERMISSION_KEY = 'mmx_dapp_permissions';
let pendingRequests = new Map();

async function getPermissions() {
  return new Promise(resolve => {
    const storage = typeof browser !== 'undefined' ? browser.storage.local : chrome.storage.local;
    storage.get(PERMISSION_KEY, result => {
      resolve(result[PERMISSION_KEY] || {});
    });
  });
}

async function setPermission(origin, allowed) {
  const perms = await getPermissions();
  perms[origin] = allowed;
  const storage = typeof browser !== 'undefined' ? browser.storage.local : chrome.storage.local;
  return new Promise(resolve => {
    storage.set({ [PERMISSION_KEY]: perms }, () => resolve());
  });
}

// Listen for messages from the injected script
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data || !event.data.source || event.data.source !== 'mmx-inject') return;
  
  const { type, id } = event.data;
  const origin = window.location.origin;
  
  if (type === 'MMX_GET_ADDRESS' || type === 'MMX_REQUEST') {
    // Check permission
    const perms = await getPermissions();
    if (perms[origin] === true) {
      // Already allowed, respond immediately
      const bg = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
      bg.sendMessage({ type: 'GET_ADDRESS' }, (response) => {
        window.postMessage({ source: 'mmx-content', id, response }, '*');
      });
    } else if (perms[origin] === false) {
      // Already denied
      window.postMessage({ source: 'mmx-content', id, response: { address: null, error: 'Permission denied' } }, '*');
    } else {
      // No permission yet — need to ask the user
      // For now, we deny by default and notify. A proper implementation would
      // open the popup with a permission dialog. This prevents silent address leaks.
      window.postMessage({ source: 'mmx-content', id, response: { address: null, error: 'Permission required. Open the MMX wallet extension to approve this site.' } }, '*');
      
      // Store as pending so the user can approve from the popup later
      pendingRequests.set(id, { origin, type });
      
      // Notify (could show a badge on the extension icon)
      const bg = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
      if (bg.action) {
        bg.action.setBadgeText({ text: '!' });
        bg.action.setBadgeBackgroundColor({ color: '#ff9800' });
      }
    }
  }
});
