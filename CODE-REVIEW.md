# Code Review — MMX Browser Wallet

**Date:** July 29, 2026
**Commit:** ea0e5f8
**Scope:** All source files + dapp/ directory

## Summary

Well-structured with clear separation: crypto (`mmx-tx.js`), storage (`wallet-store.js`), API (`mmx-node-api.js`), app logic (`wallet-app.js`), extension plumbing (`background.js`, `content.js`, `inject.js`), UI (`popup.js`, `wallet-page.js`), and dApp (`dapp/app.html`). Security hardening from ARTTOO's review is implemented and tested.

## Issues Found

### Resolved (this review)

1. ~~`SESSION_GET` returns raw seed to any caller~~ — **Fixed**: `sender.tab` check rejects content script requests
2. ~~XSS: balance symbol unescaped in popup.js~~ — **Fixed**: `app.escapeHtml(b.symbol)` added
3. ~~`_request` exposed on `window.mmx`~~ — **Fixed**: IIFE closure (ARTTOO)
4. ~~SW dies, loses seed~~ — **Fixed**: `storage.session` + `chrome.alarms` (ARTTOO)
5. ~~Listener leak on deny/dismiss~~ — **Fixed**: `DAPP_DENIED` + 5-min timeout (ARTTOO)
6. ~~Concurrent requests collide~~ — **Fixed**: ID-prefixed storage keys (ARTTOO)
7. ~~No instant toggle~~ — **Fixed**: `tabs.sendMessage` ON / `MMX_DEACTIVATE` OFF (ARTTOO)
8. ~~Swap estimate shows 0~~ — **Fixed**: `est.trade?.value` not `est.output`
9. ~~Pool tokens not parsed~~ — **Fixed**: transform parallel arrays to token objects
10. ~~Deposit hash serialization~~ — **Fixed**: `null` → `"NULL"`, solution as uint16, dual op hashes
11. ~~Offer accept/trade: `user: offer.owner`~~ — **Fixed**: `user: null` (matches official Wallet.cpp)
12. ~~Offer accept/trade: `max_fee_amount: 0`~~ — **Fixed**: `calcMaxFee(tx.static_cost)` — was root cause of "invalid tx"
13. ~~Offer accept/trade: explicit output on Deposit~~ — **Fixed**: `outputs: []` — node auto-creates deposit output
14. ~~Offer cancel: `solution: 0xFFFF`~~ — **Fixed**: `solution: 0` (our PubKey solution index)
15. ~~Sweep wastes MMX on partial fills~~ — **Fixed**: uses `accept()` when affordable (returns change), `trade()` only for partials
16. ~~Transaction history uses wrong endpoint~~ — **Fixed**: `/address/history` not `/transactions` (which returns global txs)
17. ~~No auto-refresh~~ — **Fixed**: 15s polling for balances, 30s for order book, stops when tab hidden

### Remaining (low priority)

- `getFeeEstimate()` always returns 50000n regardless of `average_txfee` — dead API call
- `satToMmx()` hardcodes 6 decimals — safe for MMX fees but not general-purpose
- `waitForResult()` in content.js has no timeout — hangs if popup never responds
- `setPermission()` in content.js is dead code (never called)
- `MMX_REQUEST` in `IMMEDIATE_TYPES` is dead code (never sent)

### Positive Findings

- **Crypto is solid**: PBKDF2 600k, AES-GCM, seed zeroing, `prehash: false`
- **IIFE closure**: `_request` not accessible from page context
- **storage.session + alarms**: MV3-compliant with fallback
- **Per-site permission model**: deny-by-default, per-origin approval
- **ID-prefixed storage keys**: concurrent request isolation
- **Origin-restricted postMessage**: `window.location.origin`, not `'*'`
- **CSP enabled**: `script-src 'self'; object-src 'self'`
- **Swap trade**: Deposit operation hash matches C++ `Deposit::calc_hash()` exactly
- **Offer trade/accept/cancel**: Golden test vectors verify hash computation byte-for-byte
- **281 tests pass** across 7 suites (crypto, regression, fuzz, integration, security, dApp, golden)
