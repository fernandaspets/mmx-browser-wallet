# Architecture

## Overview

```
popup.html / wallet.html / dapp/app.html  (UI)
       ↓
  wallet-app.js           (wallet logic)
      ├── wallet-store.js     (encrypted storage: localStorage / chrome.storage)
      ├── mmx-node-api.js    (public RPC: rpc.mmx.network)
      ├── mmx-tx.js          (tx serialization + signing)
      └── theme.css           (dark/light CSS variables)
```

All crypto runs in pure JavaScript — no native bindings, no WebAssembly, no server calls.

## Key Derivation Chain

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

## Transaction Signing

Ported from `mmx-node` `Transaction::hash_serialize()`:

1. Serialize transaction to VNX binary format (BinaryWriter)
2. `tx_id = SHA256(serialization)` (without solutions)
3. Sign `tx_id` with ECDSA (`prehash: false` — tx_id is already a hash)
4. `content_hash = SHA256(serialization_with_solutions)`
5. Submit to node via `POST /transaction/broadcast`

Key details:
- `max_fee_amount` is computed via `calcMaxFee(static_cost)` — `cost_to_fee(static_cost + gas_limit, fee_ratio)`. Must not be left at 0 or the node rejects the tx.
- `expires` is an **absolute block height** (current + 100), not a relative offset
- MMX is **account-based**: input amount = output amount, fee deducted separately
- `@noble/secp256k1` v3 defaults to `prehash: true` — must override to `false`
- `nonce` is a 64-bit BigInt — must call `.toString()` before `JSON.stringify`
- Deposit operations (swap trade, offer trade/accept) must have `outputs: []` — the node auto-creates the deposit output during validation
- Offer trade/accept: `user` field must be `null` (not offer owner) — the official Wallet.cpp doesn't set `options.user`
- Offer cancel: `user` = offer owner, `solution` = 0 (our PubKey solution index)

## Public RPC

The wallet talks directly to `https://rpc.mmx.network` — CORS enabled, no API token.

| Endpoint | Method | Purpose |
|---|---|---|
| `/balance?id=<addr>` | GET | Token balances for address |
| `/headers?limit=1` | GET | Latest block height |
| `/address/history?id=<addr>&limit=N` | GET | Transaction history (paginated by height) |
| `/transaction/validate` | POST | Validate a transaction (dry-run, returns fees) |
| `/transaction/broadcast` | POST | Broadcast a transaction |
| `/offers?bid=<addr>&ask=<addr>&limit=N` | GET | Open offers filtered by pair |
| `/offer?id=<addr>` | GET | Single offer details |
| `/offer/trade_estimate?id=<addr>&amount=<human>` | GET | Estimate partial fill output |
| `/swap/list` | GET | All swap pools |
| `/swap/info?id=<addr>` | GET | Swap pool reserves and tokens |
| `/swap/trade_estimate?id=<addr>&index=<i>&amount=<human>` | GET | Estimate swap output |
| `/chain/info` | GET | Chain parameters (fee rates, decimals) |

## Offer Trading

Offers are fixed-price contracts on MMX. Each offer has a `bid_currency` (what they're offering) and `ask_currency` (what they want).

- **Trade** (partial fill): send some ask_currency, receive `floor(amount * inv_price >> 64)` bid_currency. Leftover ask_currency stays in the offer.
- **Accept** (full fill): send `offer.ask_amount`, receive all `bid_balance`, change returned.
- **Sweep**: client-side loop that walks offers sorted by price, using accept when affordable (change returned) and trade for partial fills.

For 0-decimal tokens (TRAIL), partial trades below the minimum threshold return 0 — the `trade_estimate` API returns `next_input` (the minimum for 1 whole unit).

## Session Persistence (Extension)

The popup's JS context is destroyed when it closes. To avoid re-entering the
password on every popup reopen, the background script holds the unlocked seed
in memory (not in persistent storage):

1. Popup sends `SESSION_SET` to background after successful unlock
2. Popup asks `SESSION_GET` on init — if valid, restores without password
3. Background has its own 5-min auto-lock timer (resets on popup activity via `SESSION_PING`)
4. Lock/switch/delete sends `SESSION_CLEAR` to background

The seed lives in background memory only — never written to disk.

## File Reference

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3, Firefox + Chrome) |
| `popup.html` / `popup.js` | Extension popup UI |
| `wallet.html` | Full-page wallet UI (opened via "Open Tab" button) |
| `wallet-page.js` | Full-page wallet logic (external script for CSP compliance) |
| `wallet-app.js` | Wallet logic: keys, tx, balance, history, contacts, swap, offers |
| `wallet-store.js` | Encrypted storage (AES-GCM), address book |
| `mmx-tx.js` | Transaction serialization & signing (VNX binary), Deposit/Execute/Executable hashing |
| `mmx-node-api.js` | Public RPC client (balance, validate, broadcast, swap, offer APIs) |
| `theme.css` | CSS variables for dark/light themes |
| `background.js` | Extension background (session persistence, dApp request routing, content script registration) |
| `content.js` / `inject.js` | dApp integration (`window.mmx` API) — only loaded when user opts in |
| `dapp/app.html` | Unified TrailShare dApp (wallet + swap + offers + paywall) |
| `lib/bech32-esm.js` | bech32m encoder/decoder |
| `lib/buffer-esm.js` | Buffer polyfill for browser |
| `wordlist.txt` | BIP-0039 wordlist (2048 words) |

## Dependencies

| Package | Size | What we use |
|---|---|---|
| `@noble/secp256k1` | 56 KB | `getPublicKey`, `sign`, `verify` |
| `@noble/hashes` | 56 KB | `sha256`, `sha512`, `hmac` |
| **Total external** | **112 KB** | 6 functions |

All pure JavaScript — no native bindings, no WebAssembly. The `bech32` and `secp256k1` npm packages are used in tests only for cross-verification.
