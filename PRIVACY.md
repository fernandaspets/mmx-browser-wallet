# Privacy Policy — MMX Browser Wallet

**Last updated: July 26, 2026**

## Overview

MMX Browser Wallet is a non-custodial cryptocurrency wallet that runs entirely in your browser. Your private keys, seeds, and passwords **never leave your device**. We do not collect, store, or transmit your personal data.

## What Data We Access

### Stored on Your Device Only

- **Encrypted wallet seed** — stored in `chrome.storage.local` (extension) or `localStorage` (web page), encrypted with AES-GCM using your password. We cannot read this.
- **Wallet metadata** — wallet name and public address (not sensitive, visible on the MMX blockchain anyway).
- **Address book** — contact names and addresses you manually save.
- **Theme preference** — dark or light mode.

### Network Requests

The extension makes requests **only** to the public MMX RPC node:

- `https://rpc.mmx.network` — to check balances, fetch transaction history, and broadcast signed transactions.

No other servers are contacted. No analytics, no tracking, no telemetry.

### What We Do NOT Access

- We do **not** collect your name, email, or any personal information.
- We do **not** read, store, or transmit your private keys, seeds, or passwords.
- We do **not** access page content on websites you visit. The content script only listens for `mmx-inject` postMessage events from our own `inject.js` — it never reads the DOM. By default, no content script runs at all (dApp integration is off).
- We do **not** use cookies, analytics SDKs, or third-party scripts.
- We do **not** sell, share, or transfer any data to third parties.

## dApp Integration (Opt-In)

The extension can inject a `window.mmx` object into web pages so that websites can request your wallet address or ask you to approve transactions. This works like MetaMask's `window.ethereum`. **dApp integration is off by default** — you must explicitly enable it via a toggle in the wallet dashboard. When enabled, a content script is registered dynamically that injects `window.mmx`. When disabled, the content script is unregistered and no injection occurs.

- **`window.mmx.getAddress()`** — websites can request your address. You see an Allow/Deny prompt. We never share your address without your explicit approval.
- **`window.mmx.send()`** — websites can request a transaction. You see a confirmation dialog with amount, destination, and fee. We never sign or broadcast without your explicit approval.

Permissions are per-site and deny-by-default. You can revoke any site's permission at any time. You can disable dApp integration entirely via the toggle in the dashboard.

## Open Source

The entire extension is open source under the MIT license:
- **Source code:** https://github.com/fernandaspets/mmx-browser-wallet
- **License:** MIT

Anyone can audit the code to verify the claims in this privacy policy.

## Security

- **AES-GCM encryption** with PBKDF2 key derivation (600,000 iterations, per OWASP) protects your seed at rest.
- **Auto-lock** after 5 minutes of inactivity.
- **Password re-entry** required for sensitive actions (reveal mnemonic, delete wallet).
- **No remote code loading** — all JavaScript is bundled in the extension. No `eval()`, no dynamic imports from remote URLs.

## Changes to This Policy

If we change this privacy policy, we will update this file in the GitHub repository and note the change in the extension's release notes.

## Contact

For privacy questions, open an issue at: https://github.com/fernandaspets/mmx-browser-wallet/issues
