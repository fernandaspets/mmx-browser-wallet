# MMX Browser Wallet

A lightweight, fully browser-based wallet for the [MMX](https://github.com/madMAx43v3r/mmx-node) cryptocurrency network. Keys are generated and stored locally — they **never leave the user's device**. No server, no backend, no custodial service.

Works as both a **browser extension** (Firefox/Chrome) and a **web page**.

## Features

- ✅ **Create wallet** — generates keys locally, encrypts with password (AES-GCM + PBKDF2)
- ✅ **Import from mnemonic** — restore any wallet from 24 words
- ✅ **Password-protected** — wallet locked at rest, auto-lock after 5 min inactivity
- ✅ **Send transactions** — builds, signs, and broadcasts entirely in the browser
- ✅ **Balance display** — fetches from public RPC (`rpc.mmx.network`), no proxy needed
- ✅ **Multi-wallet** — create/import/switch between multiple wallets
- ✅ **Mnemonic backup** — 24-word recovery phrase (MMX custom BIP-0039 format)
- ✅ **dApp integration** — `window.mmx` injector for web apps (like MetaMask's `window.ethereum`)
- ✅ **CORS-free** — talks directly to public RPC node, no backend required

## Quick Start

### Option A: Browser Extension (recommended)

1. **Clone the repo:**
   ```bash
   git clone <your-repo-url> mmx-wallet
   cd mmx-wallet
   ```

2. **Install dependencies** (copies `@noble` crypto libraries):
   ```bash
   npm install @noble/secp256k1 @noble/hashes
   mkdir -p node_modules/@noble
   cp -r ../node_modules/@noble/secp256k1 node_modules/@noble/secp256k1
   cp -r ../node_modules/@noble/hashes node_modules/@noble/hashes
   ```
   Or if you already have them in a parent `node_modules`:
   ```bash
   ln -sf ../node_modules node_modules
   ```

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
npm install @noble/secp256k1 @noble/hashes bech32 secp256k1
python3 -m http.server 5050
```

Open `http://localhost:5050/browser-wallet/wallet.html` in your browser.

### Run Tests

```bash
node test-crypto.mjs
```

## Architecture

```
┌─────────────────────────────────────────────┐
│  popup.html / wallet.html (UI)               │
│    ↓ imports                                  │
│  wallet-app.js (app logic)                    │
│    ├── wallet-store.js (encrypted storage)     │
│    │     localStorage OR chrome.storage.local  │
│    ├── mmx-node-api.js (public RPC client)    │
│    │     https://rpc.mmx.network (CORS enabled)│
│    ├── mmx-tx.js (transaction serialization)  │
│    │     BinaryWriter → VNX format → SHA256   │
│    └── wallet-app.js (key derivation inlined)    │
│          HMAC-SHA512 KDF chain → secp256k1     │
└─────────────────────────────────────────────┘
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

Note: MMX stores hashes in little-endian (`bytes_t::from_uint` with `big_endian=false`).

### Transaction Signing

Ported from `mmx-node` `Transaction::hash_serialize()`:

1. Serialize transaction to VNX binary format (BinaryWriter)
2. `tx_id = SHA256(serialization)` (without solutions)
3. Sign `tx_id` with ECDSA (`prehash: false` — tx_id is already a hash)
4. `content_hash = SHA256(serialization_with_solutions)`
5. Submit to node via `POST /transaction/broadcast`

Key details:
- `max_fee_amount` is `uint32` (8 bytes promoted to uint64), **not** uint128
- `expires` is an **absolute block height**, not a relative offset
- MMX is **account-based**: input amount = output amount, fee deducted separately
- `@noble/secp256k1` v3 defaults to `prehash: true` — must override to `false`

### Public RPC

The wallet talks directly to `https://rpc.mmx.network` — a public MMX node with CORS enabled (`Access-Control-Allow-Origin: *`). No API token needed.

| Endpoint | Method | Purpose |
|---|---|---|
| `/balance?id=<addr>` | GET | All token balances for address |
| `/headers?limit=1` | GET | Latest block height (for tx expires) |
| `/transaction/validate` | POST | Validate a transaction |
| `/transaction/broadcast` | POST | Broadcast a transaction |
| `/contract?id=<addr>&field=<name>` | GET | Read contract state |

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Browser extension manifest (MV3, Firefox + Chrome) |
| `popup.html` / `popup.js` | Extension popup UI |
| `wallet.html` | Full-page wallet UI (web page or extension tab) |
| `wallet-app.js` | Main app logic (create, import, unlock, send, balance) |
| `wallet-store.js` | Encrypted wallet storage (localStorage / chrome.storage) |
| `wallet-app.js` | Main app logic + key derivation (inlined from mmx-crypto) |
| `mmx-tx.js` | Transaction serialization & signing (VNX binary format) |
| `mmx-node-api.js` | Public RPC client (rpc.mmx.network) |
| `background.js` | Extension background script |
| `content.js` / `inject.js` | dApp integration (`window.mmx` API) |
| `lib/bech32-esm.js` | bech32m encoder/decoder (ESM) |
| `lib/buffer-esm.js` | Buffer polyfill for browser |
| `wordlist.txt` | BIP-0039 English wordlist (2048 words) |
| `test-crypto.mjs` | Unit tests (`node test-crypto.mjs`) |

## Security

- **Keys never leave the device.** All crypto happens in the browser via `@noble/secp256k1`.
- **Wallets encrypted at rest** with AES-GCM. Password derived via PBKDF2 (100,000 iterations).
- **No server, no backend.** The wallet talks directly to the public MMX RPC node.
- **No tracking, no analytics.** Pure client-side app.
- **Auto-lock** after 5 minutes of inactivity.

### Security Warnings

- This is MVP software. **Do not store large amounts** yet.
- Always **save your 24-word mnemonic** — it's the only way to recover your wallet.
- The password encrypts the wallet locally. If you forget it, the wallet is unrecoverable (but the mnemonic still works).
- Browser extensions are "temporary" in Firefox — they unload on browser restart. The wallet data persists in `chrome.storage.local`, but you'll need to reload the extension.

## Dependencies

### Dependency Analysis

| What | Size | Files | What we use |
|---|---|---|---|
| `@noble/secp256k1` | 56 KB | 1 file | `getPublicKey`, `sign`, `verify` |
| `@noble/hashes` (loaded) | 56 KB | 5 files | `sha256`, `sha512`, `hmac` |
| `@noble/hashes` (full package) | 1.1 MB | 19 files | Only 5 of 19 loaded; rest never imported |
| **Our code** | 92 KB | 10 files | Everything else |

**Total external code loaded: ~112 KB.** The entire wallet including dependencies is ~200 KB.

We use **6 functions** from external libraries:

- `secp.getPublicKey(skey)` — derive public key
- `secp.sign(hash, skey)` — sign transaction
- `secp.verify(sig, hash, pubkey)` — verify signature (tests only)
- `sha256(data)` — hash for addresses, tx ids
- `sha512(data)` — HMAC-SHA512 for key derivation
- `hmac(hash, key, data)` — HMAC for key derivation

All external code is **pure JavaScript** — no native bindings, no WebAssembly, no binary blobs. Works in any browser. The `@noble` libraries are well-audited and widely used (Bitcoin projects, Ethereum wallets, etc.).

The 1.1 MB `@noble/hashes` package includes algorithms we don't need (blake, sha3, scrypt, etc.) but the browser only loads what we import — 5 files, 56 KB. The rest is dead weight on disk but never loaded at runtime.

### npm packages

| Package | Purpose | Why |
|---|---|---|
| `@noble/secp256k1` | ECDSA signing | Pure JS, no native bindings, browser-compatible |
| `@noble/hashes` | SHA256, SHA512, HMAC | Pure JS, browser-compatible |
| `bech32` (npm) | Reference for bech32m | Used in tests only; wallet uses custom `lib/bech32-esm.js` |
| `secp256k1` (npm) | Native libsecp256k1 | Used in tests only (cross-verification) |

The wallet itself only needs `@noble/*` packages. The `bech32` and `secp256k1` npm packages are only used by `test-crypto.mjs` for cross-verification.

## dApp Integration

The extension injects `window.mmx` into web pages, allowing dApps to request the wallet address:

```javascript
// Check if MMX wallet is available
if (window.mmx) {
  const address = await window.mmx.getAddress();
  console.log("Wallet address:", address);
}
```

## License

MIT
