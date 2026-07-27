# Code Review — MMX Browser Wallet

**Last updated:** 2026-07-26  
**Scope:** All tracked files in `browser-wallet/`

---

## Summary

| Area | Status |
|---|---|
| Crypto (key derivation, signing) | Solid — verified against mmx-node C++ source |
| Transaction serialization | Solid — byte-for-byte match with vnx-base `write_bytes` |
| Encrypted storage | Good — AES-GCM + PBKDF2 600k iterations |
| Send flow | Good — validation, balance check, confirm dialog, bech32m address check |
| Address book | Good — auto-tracks sent addresses, duplicate detection |
| Theme system | Good — CSS variables, persists choice |
| Tests | 183 tests across 4 suites |
| Security | No known vulnerabilities in current version |

---

## Architecture

```
wallet.html / popup.html  (UI)
        ↓
   wallet-app.js          (wallet logic: keys, tx, balance, history)
        ↓
   wallet-store.js         (encrypted storage: localStorage / chrome.storage)
   mmx-node-api.js        (public RPC client: rpc.mmx.network)
   mmx-tx.js              (tx serialization + signing)
   theme.css               (dark/light CSS variables)
```

Both web page and extension use the same `wallet-app.js`. Storage auto-detects
environment (localStorage vs chrome.storage.local).

---

## Security Notes

- **Keys never leave the device.** All crypto via `@noble/secp256k1` (pure JS).
- **Wallets encrypted at rest** with AES-GCM. Password via PBKDF2 (600k iterations, OWASP).
- **No server, no backend.** Talks directly to public MMX RPC node (CORS enabled).
- **Auto-lock** after 5 minutes of inactivity.
- **Password re-entry** required for mnemonic reveal and wallet deletion.
- **dApp deny-by-default** — `window.mmx` address requests need per-site approval.
- **64-bit crypto nonce** per transaction (`crypto.getRandomValues`).
- **skey zeroed** after signing.
- **Send-to-self blocked** (wastes fee).
- **Balance check** before send (prevents cryptic node errors).
- **bech32m checksum validation** on destination address.

---

## Known Limitations

- **No memo support** — tx memo serialization matches C++ but public RPC rejects
  txs with non-null memo. Removed pending investigation.
- **Fee from node validation** — `sendTransaction()` validates the tx before
  broadcasting and returns the actual fee charged (`exec_result.total_fee`).
  `getFeeEstimate()` returns a static estimate (50000 sat = 0.05 MMX) for UI
  preview; the real fee is confirmed post-validation. For the local node wallet
  API, `auto_send: false` dry-run also returns `exec_result.total_fee`.
  Note: `average_txfee=0` from headers means empty blocks, NOT free transactions.
- **dApp integration is opt-in** — no `<all_urls>` permission at install.
  User toggles it on in dashboard → extension requests permission at runtime →
  dynamically registers content script via `chrome.scripting.registerContentScripts`.
  When off: zero page access, no content script registered. This keeps the install-time
  permission footprint minimal (only `storage`, `activeTab`, `scripting`, + RPC host).
- **No network selector** — public RPC only. Local node support planned.
- **Public RPC gives no error details** — `/transaction/validate` returns
  "invalid tx" with no explanation, making debugging difficult.

---

## Test Coverage

| Suite | Tests | Covers |
|---|---|---|
| `test-crypto.mjs` | 22 | Address derivation, mnemonic round-trip, bech32m, tx hash, signature, storage |
| `test-regression.mjs` | 69 | All past bugs: prehash trap, max_fee_amount, bech32m fromWords, expires, nonce, BigInt JSON, formatAmount, manifest, no prompt(), syntax check, theme system, session persistence, dApp opt-in manifest |
| `test-fuzz.mjs` | 38 | Invalid mnemonics, addresses, amounts, keys, XSS, large amounts, multi-io |
| `test-integration.mjs` | 54 | Create→unlock→verify, import, wrong password, build→sign, lock cycle, memo, contacts, send validation |
| **Total** | **183** | |

---

## File Reference

| File | Purpose |
|---|---|
| `wallet-app.js` | Wallet logic: key derivation, tx building, balance, history, contacts |
| `wallet-store.js` | Encrypted storage (AES-GCM), address book, wallet CRUD |
| `mmx-node-api.js` | Public RPC client (balance, height, validate, broadcast, fee estimate) |
| `mmx-tx.js` | Transaction serialization (BinaryWriter), tx hash, signing |
| `theme.css` | CSS variables for dark/light themes |
| `popup.html` | Extension popup UI |
| `popup.js` | Extension popup logic |
| `wallet.html` | Web page wallet UI + logic (single file) |
| `background.js` | Extension background script (dApp request routing) |
| `content.js` | Extension content script (injects `window.mmx` provider) — opt-in only |
| `inject.js` | `window.mmx` API definition (dApp integration) |
| `manifest.json` | Extension manifest (MV3, Firefox/Chrome compatible) |
| `wordlist.txt` | 2048-word BIP-0039 wordlist (MMX custom variant) |
| `lib/bech32-esm.js` | bech32m encoder/decoder |
| `lib/buffer-esm.js` | Buffer polyfill for browser |
