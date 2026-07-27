# Contributing to MMX Browser Wallet

## Getting Started

```bash
git clone https://github.com/fernandaspets/mmx-browser-wallet.git
cd mmx-browser-wallet
./setup.sh
```

## Running Tests

```bash
npm test              # all 169 tests
npm run test:unit     # crypto unit tests
npm run test:regression  # regression tests (prevents past bugs)
npm run test:fuzz      # fuzz tests (invalid inputs)
npm run test:integration  # integration tests (components together)
```

All tests must pass before submitting changes.

## Project Structure

```
wallet-app.js          Wallet logic (keys, tx, balance, history)
wallet-store.js         Encrypted storage (AES-GCM + PBKDF2)
mmx-tx.js               Transaction serialization (VNX binary format)
mmx-node-api.js         Public RPC client (rpc.mmx.network)
theme.css                Dark/light theme CSS variables
popup.html / popup.js   Extension popup UI
wallet.html              Web page wallet UI + logic
background.js            Extension background (session persistence, dApp message routing, content script registration)
content.js / inject.js   dApp integration (window.mmx API) — opt-in only, loaded when user enables
lib/                     bech32m encoder, Buffer polyfill
test/                    Test suites (169 tests)
wordlist.txt             BIP-0039 wordlist (MMX variant)
```

## Key Design Decisions

- **Pure JavaScript** — no native bindings, no WebAssembly. All crypto via `@noble` libraries.
- **No server** — talks directly to public MMX RPC node (CORS enabled).
- **Keys never leave the device** — all signing happens in the browser.
- **Browser-compatible imports** — bare specifiers don't work in browsers. Use full paths (e.g., `./node_modules/@noble/secp256k1/index.js`).
- **Firefox needs physical copies** — `node_modules/@noble/` must be physically copied, not symlinked.

## Adding a New Feature

1. Write the code
2. Add tests (regression test for each bug you find, fuzz test for edge cases)
3. Run `npm test` — all 169+ tests must pass
4. Update README if user-facing
5. Keep comments clean (no issue numbers, no AI artifacts)

## Security Considerations

- Never log private keys, seeds, or mnemonics
- Never use `prompt()`, `confirm()`, or `alert()` — use inline UI
- Always validate inputs (bech32m checksum, amount format, etc.)
- Zero skey after signing
- Password re-entry required for mnemonic reveal and wallet deletion
