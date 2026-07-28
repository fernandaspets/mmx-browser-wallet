/**
 * content.js — Injects window.mmx into web pages for dApp integration.
 * Address requests require per-site user approval (deny by default).
 * Send and signing requests require explicit confirmation each time.
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

// Respond to the page using the page's own origin (not '*') so other
// scripts on the page can't eavesdrop on wallet responses.
function respondToPage(id, response) {
  window.postMessage({ source: 'mmx-content', id, response }, window.location.origin);
}

// Types that can be answered immediately by the background (no signing needed)
const IMMEDIATE_TYPES = ['MMX_GET_ADDRESS', 'MMX_REQUEST', 'MMX_GET_NETWORK'];

// Types that require popup confirmation (signing or sending)
const CONFIRM_TYPES = ['MMX_SEND', 'MMX_GET_PUBLIC_KEY', 'MMX_SIGN_MESSAGE', 'MMX_SIGN_TRANSACTION'];

// Wait for a result from the popup via storage
function waitForResult(id, storageKey, resultKey, cleanupKeys, badge) {
  return new Promise(resolve => {
    const listener = (changes, area) => {
      if (area !== "local" || !changes[resultKey]) return;
      const result = changes[resultKey].newValue;
      if (result && result.id === id) {
        _browser.storage.onChanged.removeListener(listener);
        for (const key of cleanupKeys) _browser.storage.local.remove(key);
        _browser.storage.local.remove(resultKey);
        if (_browser.action && badge) _browser.action.setBadgeText({ text: '' });
        resolve(result.response);
      }
    };
    _browser.storage.onChanged.addListener(listener);
  });
}

// Listen for messages from the injected script (page context)
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.source !== 'mmx-inject') return;
  
  const { type, id } = event.data;
  const origin = window.location.origin;
  
  if (IMMEDIATE_TYPES.includes(type) || CONFIRM_TYPES.includes(type)) {
    const perms = await getPermissions();
    
    if (perms[origin] === true) {
      // Site is approved
      if (IMMEDIATE_TYPES.includes(type)) {
        // Address/network — respond immediately from background
        if (type === 'MMX_GET_NETWORK') {
          respondToPage(id, { network: 'MMX/mainnet' });
        } else {
          _browser.runtime.sendMessage({ type: 'GET_ADDRESS' }, (response) => {
            respondToPage(id, response);
          });
        }
      } else {
        // Signing/sending — requires popup confirmation
        // MMX_SEND uses mmx_pending_send/mmx_send_result (popup has dedicated UI)
        // Other confirm types use mmx_pending_dapp_action/mmx_dapp_result
        const isSend = (type === 'MMX_SEND');
        const pendingKey = isSend ? 'mmx_pending_send' : 'mmx_pending_dapp_action';
        const resultKey = isSend ? 'mmx_send_result' : 'mmx_dapp_result';
        const pendingData = isSend
          ? { origin, id, params: event.data.params, timestamp: Date.now() }
          : { origin, id, type, params: event.data.params, timestamp: Date.now() };
        _browser.storage.local.set({ [pendingKey]: pendingData });
        if (_browser.action) {
          _browser.action.setBadgeText({ text: '✎' });
          _browser.action.setBadgeBackgroundColor({ color: '#ffa726' });
        }
        const response = await waitForResult(id, pendingKey, resultKey, [pendingKey], true);
        respondToPage(id, response);
      }
    } else if (perms[origin] === false) {
      // Already denied
      respondToPage(id, { address: null, error: 'Permission denied' });
    } else {
      // No permission yet — ask the user via popup
      _browser.storage.local.set({ 
        mmx_pending_dapp: { origin, id, type, timestamp: Date.now() } 
      });
      if (_browser.action) {
        _browser.action.setBadgeText({ text: '!' });
        _browser.action.setBadgeBackgroundColor({ color: '#ffa726' });
      }
      respondToPage(id, { address: null, error: 'Approval required. Open the MMX wallet extension popup to approve.' });
      
      // Listen for approval
      const approvalListener = (msg) => {
        if (msg && msg.type === 'DAPP_APPROVED' && msg.origin === origin) {
          _browser.runtime.onMessage.removeListener(approvalListener);
          // After approval, re-handle the request (will now go through the approved path)
          if (type === 'MMX_GET_NETWORK') {
            respondToPage(id, { network: 'MMX/mainnet' });
          } else if (IMMEDIATE_TYPES.includes(type)) {
            _browser.runtime.sendMessage({ type: 'GET_ADDRESS' }, (response) => {
              respondToPage(id, response);
            });
          } else {
            // Signing/sending — now that we're approved, route through popup
            const isSend = (type === 'MMX_SEND');
            const pendingKey = isSend ? 'mmx_pending_send' : 'mmx_pending_dapp_action';
            const resultKey = isSend ? 'mmx_send_result' : 'mmx_dapp_result';
            const pendingData = isSend
              ? { origin, id, params: event.data.params, timestamp: Date.now() }
              : { origin, id, type, params: event.data.params, timestamp: Date.now() };
            _browser.storage.local.set({ [pendingKey]: pendingData });
            if (_browser.action) {
              _browser.action.setBadgeText({ text: '✎' });
              _browser.action.setBadgeBackgroundColor({ color: '#ffa726' });
            }
            waitForResult(id, pendingKey, resultKey, [pendingKey], true).then(response => {
              respondToPage(id, response);
            });
          }
          _browser.storage.local.remove('mmx_pending_dapp');
          if (_browser.action) _browser.action.setBadgeText({ text: '' });
        }
      };
      _browser.runtime.onMessage.addListener(approvalListener);
    }
  }
});
