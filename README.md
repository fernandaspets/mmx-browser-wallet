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
- **dApp integration (opt-in)** — toggle in dashboard enables `window.mmx` injection for web apps
- **Dark/light theme** — toggle in header, choice persists across sessions
- **Session persistence** — stays unlocked across popup close/reopen (extension)

## Quick Start

### Browser Extension (recommended)

```bash
git clone https://github.com/fernandaspets/mmx-browser-wallet.git mmx-wallet
cd mmx-wallet
./setup.sh
```

**Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `manifest.json`

**Chrome:** `chrome://extensions` → Enable Developer mode → Load unpacked → select folder

### Web Page (development/testing)

```bash
npm install
python3 -m http.server 5050
# Open http://localhost:5050/browser-wallet/wallet.html
```

### Tests

```bash
npm test    # 205 tests across 4 suites
```

## Documentation

| Document | Description |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Key derivation, transaction signing, RPC, session persistence, file reference |
| [docs/SECURITY.md](docs/SECURITY.md) | Security notes, audit history, warnings |
| [docs/DAPP-INTEGRATION.md](docs/DAPP-INTEGRATION.md) | `window.mmx` API, opt-in toggle, permissions |
| [docs/PAYWALL-DEMO.md](docs/PAYWALL-DEMO.md) | How the crypto paywall demo works, hosting, customizing |
| [docs/STORE-SUBMISSION.md](docs/STORE-SUBMISSION.md) | Firefox AMO + Chrome Web Store submission guide |
| [CODE-REVIEW.md](CODE-REVIEW.md) | Full code review |
| [PRIVACY.md](PRIVACY.md) | Privacy policy (for store listing) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor guide |

## Demo

A standalone crypto paywall demo is included at `demo/paywall.html` — locked content that unlocks when the user pays 1 TRAIL via the wallet extension. See [docs/PAYWALL-DEMO.md](docs/PAYWALL-DEMO.md).

## License

MIT
