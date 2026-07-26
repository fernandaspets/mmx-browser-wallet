# MMX Browser Wallet

A lightweight MMX wallet that runs entirely in the browser. Keys are generated and stored locally — they never leave the user's device.

## What works

- ✅ Key generation (secp256k1 via @noble/secp256k1)
- ✅ Address derivation (SHA256 of compressed pubkey → bech32m)
- ✅ Mnemonic backup (24 words, MMX custom BIP-0039 format)
- ✅ Key derivation chain (HMAC-SHA512 KDF, 4096 iterations — matches mmx-node)
- ✅ Verified against real MMX node wallets
- ✅ Receives MMX on-chain

## What's in progress

- [ ] Transaction serialization (port Transaction::hash_serialize from C++ to JS)
- [ ] Send MMX from the browser
- [ ] Chrome extension packaging (manifest, popup, content scripts ready)
- [ ] dApp integration (window.mmx injector for web apps)
- [ ] Balance display (query node API with CORS)

## Architecture

All crypto is done in pure JavaScript:
- `@noble/secp256k1` — ECDSA signing
- `@noble/hashes` — SHA256, SHA512, HMAC
- Custom bech32m encoder (ported from bech32 npm package)
- Custom Buffer polyfill (for browser compatibility)
- MMX wordlist (BIP-0039 English, 2048 words)

### Key derivation chain (from mmx-node ECDSA_Wallet.h)

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

Note: MMX stores hashes in little-endian (bytes_t::from_uint with big_endian=false).

## Test page

Open `test.html` in a browser served from a local HTTP server to generate wallets and verify addresses on explore.mmx.network.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Chrome extension manifest (MV3) |
| `popup.html` / `popup.js` | Extension popup UI |
| `background.js` | Extension service worker |
| `content.js` / `inject.js` | dApp integration (window.mmx) |
| `mmx-crypto.js` | Core crypto: key derivation, signing, address encoding |
| `wallet.js` | Wallet state management + encrypted storage |
| `lib/bech32-esm.js` | bech32m encoder (ESM, ported from npm package) |
| `lib/buffer-esm.js` | Buffer polyfill for browser |
| `wordlist.txt` | BIP-0039 English wordlist (2048 words) |
| `test.html` | Standalone test page (no extension needed) |

## License

MIT
