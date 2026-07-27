# MMX Browser Wallet

A lightweight, fully browser-based wallet for the [MMX](https://github.com/madMAx43v3r/mmx-node) cryptocurrency network. Keys are generated and stored locally — they **never leave the user's device**. No server, no backend, no custodial service.

Works as both a **browser extension** (Firefox/Chrome) and a **web page**.

## Features

- **Create wallet** — generates keys locally, encrypts with password (AES-GCM + PBKDF2)
- **Import from mnemonic** — restore any wallet from 24 words
- **Password-protected** — wallet locked at rest, auto-lock after 5 min inactivity
- **Send transactions** — builds, signs, and broadcasts entirely in the browser
- **Balance display** — auto-refreshes every 30 seconds from public RPC
- **Transaction history** — paginated, with pending tx indicator and explorer links
- **Multi-wallet** — create/import/switch between multiple wallets
- **Address book** — auto-saves addresses you send to, name them, quick-select when sending
- **Send confirmation** — review amount, destination, fee, and total before broadcasting
- **Balance check** — verifies sufficient funds before send (prevents cryptic node errors)
- **bech32m validation** — destination address checksum verified
- **Send-to-self warning** — blocks sending to your own address (wastes fee)
- **dApp integration (opt-in)** — toggle in dashboard enables `window.mmx` injection.
  Off by default: zero page access, no content script. On: requests `<all_urls>` permission
  and dynamically registers content script via `chrome.scripting` API. Same pattern as MetaMask.
- **Dark/light theme** — toggle in header, choice persists across sessions
- **Connection status** — network badge shows block height, green when connected
- **Mnemonic backup** — 24-word recovery phrase (MMX custom BIP-0039 format)
- **dApp integration** — `window.mmx` injector for web apps (deny-by-default)
- **CORS-free** — talks directly to public RPC node, no backend required

## Quick Start

### Option A: Browser Extension (recommended)

1. **Clone the repo:**
   ```bash
   git clone https://github.com/fernandaspets/mmx-browser-wallet.git mmx-wallet
   cd mmx-wallet
   ```

2. **Install dependencies:**
   ```bash
   ./setup.sh
   ```
   Or manually: `npm install && cp -r node_modules/@noble .` (Firefox needs physical copies, not symlinks)

3. **Load in Firefox:**
   - Go to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select `manifest.json`

4. **Load in Chrome:**
   - Go to `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the folder

### Option B: Web Page (for development/testing)

```bash
npm install
python3 -m http.server 5050
```

Open `http://localhost:5050/browser-wallet/wallet.html` in your browser.

### Run Tests

```bash
npm test                    # run all 183 tests
npm run test:unit           # 22 unit tests
npm run test:regression     # 69 regression tests
npm run test:fuzz           # 38 fuzz tests
npm run test:integration    # 54 integration tests
```

| Suite | Tests | What it covers |
|---|---|---|
| `test/test-crypto.mjs` | 22 | Address derivation, mnemonic round-trip, bech32m, tx hash, signature cross-verification, encrypted storage |
| `test/test-regression.mjs` | 69 | Prevents known bugs from returning: prehash trap, max_fee_amount size, bech32m fromWords, expires field, nonce entropy, BigInt JSON, formatAmount, manifest, theme system, syntax checks, session persistence, dApp opt-in manifest |
| `test/test-fuzz.mjs` | 38 | Invalid inputs: bad mnemonics, invalid addresses, negative amounts, wrong-length keys, XSS names, large amounts, multi-input tx |
| `test/test-integration.mjs` | 54 | Create→unlock→verify, import→verify, wrong password, build→sign→verify, lock cycle, duplicate detection, send validation, contacts |

## Architecture

```
popup.html / wallet.html  (UI)
       ↓
  wallet-app.js           (wallet logic)
      ├── wallet-store.js     (encrypted storage: localStorage / chrome.storage)
      ├── mmx-node-api.js    (public RPC: rpc.mmx.network)
      ├── mmx-tx.js          (tx serialization + signing)
      └── theme.css           (dark/light CSS variables)
```

All crypto runs in pure JavaScript — no native bindings, no WebAssembly, no server calls.

### Key Derivation Chain

Ported from `mmx-node` `ECDSA_Wallet.h`:

```
seed (32 bytes, random or from mnemonic)
  → passphrase_hash = SHA256("MMX/seed/" + passphrase)
  → master = KDF_HMAC_SHA512(seed, passphrase_hash, 4096 iters)
  → chain = HMAC_SHA512_N(master.first, master.second, 11337)
  → account = HMAC_SHA512_N(chain.first, chain.second, account_index)
  → key = HMAC_SHA512_N(account.first, account.second, address_index)
  → skey = key.first (32 bytes)
  → pubkey = secp256k1_compressed(skey) (33 bytes)
  → address = bech32m("mmx", SHA256(pubkey))
```

MMX stores hashes in little-endian (`bytes_t::from_uint` with `big_endian=false`).

### Transaction Signing

Ported from `mmx-node` `Transaction::hash_serialize()`:

1. Serialize transaction to VNX binary format (BinaryWriter)
2. `tx_id = SHA256(serialization)` (without solutions)
3. Sign `tx_id` with ECDSA (`prehash: false` — tx_id is already a hash)
4. `content_hash = SHA256(serialization_with_solutions)`
5. Submit to node via `POST /transaction/broadcast`

Key details:
- `max_fee_amount` is `uint32` (8 bytes promoted to uint64), **not** uint128 —
  this is the MAX fee you're willing to pay, not the actual fee. The node
  determines the real fee during validation (`exec_result.total_fee`). For
  standard transfers: 50000 sat = min_txfee(20000) + input + output + solution
- `expires` is an **absolute block height** (current + 100), not a relative offset
- MMX is **account-based**: input amount = output amount, fee deducted separately
- `@noble/secp256k1` v3 defaults to `prehash: true` — must override to `false`
- `nonce` is a 64-bit BigInt — must call `.toString()` before `JSON.stringify`

### Public RPC

The wallet talks directly to `https://rpc.mmx.network` — CORS enabled, no API token.

| Endpoint | Method | Purpose |
|---|---|---|
| `/balance?id=<addr>` | GET | Token balances for address |
| `/headers?limit=1` | GET | Latest block height |
| `/transactions?addr=<addr>&limit=N&offset=N` | GET | Transaction history |
| `/transaction/validate` | POST | Validate a transaction |
| `/transaction/broadcast` | POST | Broadcast a transaction |

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3, Firefox + Chrome) |
| `popup.html` / `popup.js` | Extension popup UI |
| `wallet.html` | Full-page wallet UI + logic |
| `wallet-app.js` | Wallet logic: keys, tx, balance, history, contacts |
| `wallet-store.js` | Encrypted storage (AES-GCM), address book |
| `mmx-tx.js` | Transaction serialization & signing (VNX binary) |
| `mmx-node-api.js` | Public RPC client |
| `theme.css` | CSS variables for dark/light themes |
| `background.js` | Extension background (session persistence, dApp request routing, content script registration) |
| `content.js` / `inject.js` | dApp integration (`window.mmx` API) — only loaded when user opts in |
| `lib/bech32-esm.js` | bech32m encoder/decoder |
| `lib/buffer-esm.js` | Buffer polyfill for browser |
| `wordlist.txt` | BIP-0039 wordlist (2048 words) |

## Security

- **Keys never leave the device.** All crypto via `@noble/secp256k1` (pure JS, audited).
- **Wallets encrypted at rest** with AES-GCM. Password via PBKDF2 (600k iterations, OWASP).
- **No server, no backend.** Talks directly to public MMX RPC node.
- **Auto-lock** after 5 minutes of inactivity.
- **Password re-entry** required for mnemonic reveal and wallet deletion.
- **dApp deny-by-default** — sites need explicit approval to read wallet address.
- **64-bit crypto nonce** per transaction.
- **skey zeroed** after signing.

### Security Warnings

- This is MVP software. **Do not store large amounts** yet.
- Always **save your 24-word mnemonic** — it's the only way to recover your wallet.
- The password encrypts the wallet locally. If forgotten, the wallet is unrecoverable (but the mnemonic still works on any MMX wallet).
- Firefox temporary extensions lose all data on reload — each "Load Temporary Add-on" creates a new extension ID, wiping `chrome.storage.local`. Always save your 24-word mnemonic to re-import. For persistent storage, use the web page version (`wallet.html` with `localStorage`) or install the extension permanently (requires signing).

## Dependencies

| Package | Size | What we use |
|---|---|---|
| `@noble/secp256k1` | 56 KB | `getPublicKey`, `sign`, `verify` |
| `@noble/hashes` | 56 KB | `sha256`, `sha512`, `hmac` |
| **Total external** | **112 KB** | 6 functions |

All pure JavaScript — no native bindings, no WebAssembly. The `bech32` and `secp256k1` npm packages are used in tests only for cross-verification.

## dApp Integration (Opt-In)

dApp integration is **off by default** — no content script runs, no `window.mmx` is injected.
Users enable it via a toggle in the dashboard, which requests `<all_urls>` permission at runtime
and dynamically registers the content script via the `chrome.scripting` API.

When enabled, the extension injects `window.mmx` into web pages:

```javascript
if (window.mmx) {
  const address = await window.mmx.getAddress();
  console.log("Wallet address:", address);
}
```

Requests are denied by default — the user must approve each site.

## Store Submission

### Firefox Add-ons (AMO)

1. Create a free account at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/)
2. Run `./pack.sh` to build `mmx-wallet-v1.0.0.zip`
3. Submit the ZIP at [addons.mozilla.org/developers/add-new](https://addons.mozilla.org/developers/add-new)
4. Provide privacy policy URL: link to `PRIVACY.md` in this repo
5. Review takes ~1-5 days. Firefox AMO requires source code access (open source, link to repo)

### Chrome Web Store

1. Pay $5 one-time fee at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
2. Run `./pack.sh` to build `mmx-wallet-v1.0.0.zip`
3. Upload the ZIP, provide screenshots (1280×800px) and privacy policy URL
4. Review takes days to weeks. The `<all_urls>` permission is now opt-in (not at install time),
   which significantly reduces review friction. Reviewers see minimal install permissions
   (`storage`, `activeTab`, `scripting`, RPC host only). dApp injection is user-activated.

### Packaging

```bash
./pack.sh    # creates mmx-wallet-v1.0.0.zip (352KB)
```

The ZIP includes all production files + `@noble` crypto libs. Test files, dev docs, and private keys are excluded.

## License

MIT
