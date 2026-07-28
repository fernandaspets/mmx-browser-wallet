# Crypto Paywall

The TrailShare dApp includes a paywall in the unified app (`dapp/app.html` → Content tab). It works standalone — no extension needed.

## How It Works

1. **Unlock wallet** — user enters password to unlock their wallet (stored in browser localStorage)
2. **Check balance** — shows user's TRAIL balance, disables button if insufficient
3. **Pay 1 TRAIL** — sends to Morpheus address via `wallet-app.js` → public RPC
4. **Content unlocks** — on broadcast success, locked SVG animates and blur clears
5. **TX link** — links to `explore.mmx.network/#/explore/transaction/<TXID>`

Also supports extension mode: if `window.mmx` is detected (extension with dApp enabled), uses `window.mmx.send()` instead of direct wallet unlock.

## Running Locally

```bash
# From the repo root:
python3 -m http.server 8060
# Visit http://localhost:8060/dapp/app.html → Content tab
```

## Hosting

`app.html` is fully self-contained — no server, no database, no build step. Host on any static file server (GitHub Pages, Netlify, etc.).

The only requirement: the visitor has a wallet (create one at `wallet.html` first, or use the extension).

## Customizing

Edit `dapp/app.html` to change:

- **Payment address** — replace the `MORPHEUS` constant with your address
- **Token** — replace `TRAIL_CONTRACT` with your token contract address
- **Price** — change `PRICE_TRAIL`
- **Locked content** — replace the SVG with your own content (image, video, text, etc.)
