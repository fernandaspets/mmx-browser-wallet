/**
 * content.js — Injects window.mmx into web pages for dApp integration.
 * Address requests require per-site user approval (deny by default).
 * Send requests require explicit confirmation each time.
 */

// Inject the MMX provider script
const script = document.createElement('script');
script.src = (typeof browser !== 'undefined' ? browser.runtime : chrome.runtime).getURL('inject.js');
script.onload = function() { script.remove(); };
(document.head || document.documentElement).appendChild(script);

const PERMISSION_KEY = 'mmx_dapp_permissions';
const _browser = typeof browser !== 'undefined' ? browser : chrome;

async function getPermissions() {
  return new Promise(resolve => {
    _browser.storage.local.get(PERMISSION_KEY, result => {
      resolve(result[PERMISSION_KEY] || {});
    });
  });
}

async function setPermission(origin, allowed) {
  const perms = await getPermissions();
  perms[origin] = allowed;
  return new Promise(resolve => {
    _browser.storage.local.set({ [PERMISSION_KEY]: perms }, () => resolve());
  });
}

// Listen for messages from the injected script (page context)
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.source !== 'mmx-inject') return;
  
  const { type, id } = event.data;
  const origin = window.location.origin;
  
  if (type === 'MMX_GET_ADDRESS' || type === 'MMX_REQUEST' || type === 'MMX_SEND') {
    const perms = await getPermissions();
    
    if (perms[origin] === true) {
      // Site is approved
      if (type === 'MMX_SEND') {
        // Send requires explicit confirmation each time
        _browser.storage.local.set({
          mmx_pending_send: { origin, id, params: event.data.params, timestamp: Date.now() }
        });
        if (_browser.action) {
          _browser.action.setBadgeText({ text: '$' });
          _browser.action.setBadgeBackgroundColor({ color: '#4caf50' });
        }
        // Wait for popup to confirm/reject
        const sendListener = (msg) => {
          if (msg && msg.type === 'SEND_RESULT' && msg.id === id) {
            _browser.runtime.onMessage.removeListener(sendListener);
            window.postMessage({ source: 'mmx-content', id, response: msg.response }, '*');
            _browser.storage.local.remove('mmx_pending_send');
            if (_browser.action) _browser.action.setBadgeText({ text: '' });
          }
        };
        _browser.runtime.onMessage.addListener(sendListener);
      } else {
        // Address request — respond immediately
        _browser.runtime.sendMessage({ type: 'GET_ADDRESS' }, (response) => {
          window.postMessage({ source: 'mmx-content', id, response }, '*');
        });
      }
    } else if (perms[origin] === false) {
      // Already denied
      window.postMessage({ source: 'mmx-content', id, response: { address: null, error: 'Permission denied' } }, '*');
    } else {
      // No permission yet — ask the user via popup
      _browser.storage.local.set({ 
        mmx_pending_dapp: { origin, id, type, timestamp: Date.now() } 
      });
      if (_browser.action) {
        _browser.action.setBadgeText({ text: '!' });
        _browser.action.setBadgeBackgroundColor({ color: '#ffa726' });
      }
      window.postMessage({ source: 'mmx-content', id, response: { address: null, error: 'Approval required. Open the MMX wallet extension popup to approve.' } }, '*');
      
      // Listen for approval
      const approvalListener = (msg) => {
        if (msg && msg.type === 'DAPP_APPROVED' && msg.origin === origin) {
          _browser.runtime.onMessage.removeListener(approvalListener);
          _browser.runtime.sendMessage({ type: 'GET_ADDRESS' }, (response) => {
            window.postMessage({ source: 'mmx-content', id, response }, '*');
          });
          _browser.storage.local.remove('mmx_pending_dapp');
          if (_browser.action) _browser.action.setBadgeText({ text: '' });
        }
      };
      _browser.runtime.onMessage.addListener(approvalListener);
    }
  }
});
