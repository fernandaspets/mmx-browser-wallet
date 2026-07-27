# Security

## Security Notes

- **Keys never leave the device.** All crypto via `@noble/secp256k1` (pure JS, audited).
- **Wallets encrypted at rest** with AES-GCM. Password via PBKDF2 (600k iterations, OWASP).
- **No server, no backend.** Talks directly to public MMX RPC node.
- **Auto-lock** after 5 minutes of inactivity.
- **Password re-entry** required for mnemonic reveal and wallet deletion.
- **dApp deny-by-default** — sites need explicit approval to read wallet address.
- **64-bit crypto nonce** per transaction.
- **skey zeroed** after signing.
- **Seed zeroed on lock** — `unlockedSeed.fill(0)` before nulling, both in wallet-app.js and background.js session.
- **XSS prevention** — all user-supplied data (contact names, wallet names, tx fields) is HTML-escaped via `escapeHtml()` before insertion into `innerHTML`.
- **postMessage origin-restricted** — content.js responds to page using `window.location.origin`, not `'*'`, preventing eavesdropping by other scripts.
- **CSP enabled** — `script-src 'self'; object-src 'self'` in manifest.
- **bech32m checksum validation** on destination address.
- **Send-to-self blocked** (wastes fee).
- **Balance check** before send (prevents cryptic node errors).

## Security Warnings

- This is MVP software. **Do not store large amounts** yet.
- Always **save your 24-word mnemonic** — it's the only way to recover your wallet.
- The password encrypts the wallet locally. If forgotten, the wallet is unrecoverable (but the mnemonic still works on any MMX wallet).
- Firefox temporary extensions lose all data on reload — each "Load Temporary Add-on" creates a new extension ID, wiping `chrome.storage.local`. Always save your 24-word mnemonic to re-import. For persistent storage, use the web page version (`wallet.html` with `localStorage`) or install the extension permanently (requires signing).

## Audit History

A security audit was performed covering common crypto wallet audit requirements. All findings were addressed:

| Issue | Severity | Fix |
|---|---|---|
| XSS via innerHTML (contact names, wallet names, tx fields) | Medium-High | `escapeHtml()` on all user-supplied data before innerHTML |
| Seed not zeroed on lock | Low | `unlockedSeed.fill(0)` in wallet-app.js and background.js |
| postMessage with '*' origin | Low-Medium | `respondToPage()` uses `window.location.origin` |
| No Content Security Policy | Low | Added CSP to manifest: `script-src 'self'; object-src 'self'` |

See [CODE-REVIEW.md](../CODE-REVIEW.md) for the full code review.
