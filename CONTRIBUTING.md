# Contributing to MMX Browser Wallet

## Getting Started

```bash
git clone https://github.com/fernandaspets/mmx-browser-wallet.git
cd mmx-browser-wallet
./setup.sh
```

## Running Tests

```bash
npm test              # all 281 tests across 7 suites
npm run test:crypto     # crypto unit tests (22)
npm run test:regression  # regression tests (131)
npm run test:fuzz        # fuzz tests (38)
npm run test:integration # integration tests (54)
npm run test:security    # security tests (10)
npm run test:dapp        # dApp UI tests (19)
npm run test:golden      # golden hash vectors (7)
```

All tests must pass before submitting changes.

## Project Structure

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture.

```
wallet-app.js          Wallet logic (keys, tx, balance, history, offers)
wallet-store.js         Encrypted storage (AES-GCM + PBKDF2)
mmx-tx.js               Transaction serialization (VNX binary format)
mmx-node-api.js         Public RPC client (rpc.mmx.network)
theme.css                Dark/light theme CSS variables
popup.html / popup.js   Extension popup UI
wallet.html              Web page wallet UI + logic
background.js            Extension background (session, dApp routing)
content.js / inject.js   dApp integration (window.mmx API) — opt-in only
dapp/app.html            Unified TrailShare dApp (wallet + swap + offers + paywall)
lib/                     bech32m encoder, Buffer polyfill, @noble crypto
test/                    7 test suites (281 tests)
docs/                    Documentation
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
2. Add tests (regression test for each bug, fuzz test for edge cases)
3. Run `npm test` — all 281 tests must pass
4. Update README if user-facing
5. Keep comments clean (no issue numbers, no AI artifacts)

## Security Considerations

- Never log private keys, seeds, or mnemonics
- Never use `prompt()`, `confirm()`, or `alert()` — use inline UI
- Always validate inputs (bech32m checksum, amount format, etc.)
- Zero skey after signing
- Password re-entry required for mnemonic reveal and wallet deletion
