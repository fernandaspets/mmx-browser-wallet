# Code Review — MMX Browser Wallet

**Date:** July 28, 2026
**Commit:** cba8053
**Scope:** All source files (4,581 lines across 14 files)

## Summary

The codebase is well-structured with clear separation of concerns: crypto (`mmx-tx.js`), storage (`wallet-store.js`), API (`mmx-node-api.js`), app logic (`wallet-app.js`), extension plumbing (`background.js`, `content.js`, `inject.js`), and UI (`popup.js`, `wallet-page.js`). Security hardening from ARTTOO's review is implemented and tested.

## Issues Found

### 1. Stale storage keys in locked-wallet badge check (popup.js)

**Severity:** Low (cosmetic — badge stays after deny)

In `checkPendingDapp()`, the locked-wallet branch checks for old fixed key names:
```js
_br.storage.local.get(null, (result) => {
  const hasPending = Object.keys(result).some(k =>
    k.startsWith('mmx_psend_') || k.startsWith('mmx_pdapp_') || k === 'mmx_pending_dapp');
```
This is correct now, but the `mmx_pending_dapp` (address approval) key is still a single shared key — two tabs requesting address approval simultaneously would collide. However, address approval is per-origin, so once approved the second tab would find `perms[origin] === true` and skip this path. Low risk.

### 2. `setPermission` defined but never called (content.js)

**Severity:** Info (dead code)

`content.js` defines `setPermission()` but never calls it. Permission changes happen via popup.js writing directly to `mmx_dapp_permissions` in storage. The function is dead code and could be removed.

### 3. `MMX_REQUEST` in IMMEDIATE_TYPES but never sent by inject.js

**Severity:** Info (dead code)

`IMMEDIATE_TYPES` includes `'MMX_REQUEST'` but inject.js never sends a message of type `MMX_REQUEST`. This appears to be a leftover from an earlier API design. Harmless but confusing.

### 4. Address approval `mmx_pending_dapp` is a single key (concurrent collision risk)

**Severity:** Low

While send/sign requests now use ID-prefixed keys, the address approval flow (`mmx_pending_dapp`) is still a single shared key. If two tabs from different origins request address approval at the same time, the second overwrites the first's pending request. The first tab's `approvalListener` would still fire (it matches by origin), but the popup would only show the second request. In practice this is unlikely — users rarely have two unapproved dApp tabs open simultaneously.

### 5. `wallet-app.js` auto-lock uses `setTimeout` (not `chrome.alarms`)

**Severity:** Medium (in popup/web page context only)

`wallet-app.js` has its own `autoLockTimer` using `setTimeout`. This is fine for the web page (which runs persistently) and popup (which has its own lifecycle). But it's separate from the `chrome.alarms` auto-lock in `background.js`. If the popup is closed, the wallet-app.js timer dies, but the background.js alarm takes over. This is actually correct — two layers of protection. Just worth noting they're independent.

### 6. `getFeeEstimate()` always returns 50000n regardless of `average_txfee`

**Severity:** Info (by design)

The function fetches `average_txfee` from the header but always returns `50000n`. The `average_txfee` check is effectively dead code. This is documented as intentional (static cost is always 50000 for standard transfers), but the API call to fetch headers is wasted if we always return the same value. Could be simplified to just `return 50000n` without the API call.

### 7. `satToMmx()` hardcodes 6 decimals

**Severity:** Low

`satToMmx()` always divides by `1000000n` (6 decimals). If used for TRAIL (0 decimals), it would show wrong values. Currently only used for MMX fee display, so it's safe, but the function name suggests general use. Should accept a `decimals` parameter like `mmxToSat()` does.

### 8. No timeout on `waitForResult` in content.js

**Severity:** Low

`waitForResult()` listens for `storage.onChanged` indefinitely. If the popup never responds (user closes popup and never reopens), the promise hangs forever. The `approvalListener` has a 5-minute timeout, but `waitForResult` does not. Should add a timeout that rejects with "Timeout waiting for wallet response".

### 9. `escapeHtml` defined in `wallet-app.js` but UI files may not use it consistently

**Severity:** Medium (needs audit)

`escapeHtml()` is exported from `wallet-app.js`, but `popup.js` and `wallet-page.js` need to call it on every `innerHTML` insertion of user data. Need to verify all `innerHTML` assignments in both UI files use `escapeHtml()` on dynamic content (wallet names, contact names, addresses, amounts).

### 10. `background.js` `SESSION_GET` returns raw seed to any caller

**Severity:** Medium

Any extension component (popup, content script) can call `SESSION_GET` and receive the raw seed. The popup needs this to restore the session, but a compromised content script could also request it. Should verify `sender.tab` is undefined (i.e., request comes from popup, not a content script).

### 11. No input validation on `mmxToSat` for very large amounts

**Severity:** Low

`mmxToSat()` accepts arbitrarily large amounts. A user typing a huge number would create a transaction with an enormous `amount` field. The node would reject it ("insufficient funds"), but the wallet could pre-validate against the balance.

### 12. `content.js` injects inject.js at top level (runs on every content script load)

**Severity:** Info (by design)

The top-level `script.src = ...; document.head.appendChild(script)` runs immediately when content.js loads. This is correct for the registered content script pattern, but the instant activation path also injects — the duplicate-injection guard (`typeof window.mmx === 'undefined'`) prevents double injection.

## Positive Findings

- **Crypto is solid**: PBKDF2 600k iterations, AES-GCM encryption, seed zeroing on lock, `prehash: false` for signing
- **IIFE closure in inject.js**: `_request` is not accessible from page context
- **storage.session + alarms**: MV3-compliant session persistence with fallback
- **Per-site permission model**: deny-by-default, per-origin approval
- **ID-prefixed storage keys**: concurrent request isolation
- **Origin-restricted postMessage**: responses use `window.location.origin`, not `'*'`
- **CSP enabled**: `script-src 'self'; object-src 'self'`
- **258 tests pass**: crypto, regression, fuzz, integration, security

## Recommendations

1. Add timeout to `waitForResult()` in content.js
2. Verify `sender.tab` in `SESSION_GET` handler (background.js)
3. Add `decimals` parameter to `satToMmx()`
4. Audit all `innerHTML` in popup.js and wallet-page.js for `escapeHtml()` usage
5. Remove dead code (`setPermission`, `MMX_REQUEST`)
6. Simplify `getFeeEstimate()` (remove unused API call)
