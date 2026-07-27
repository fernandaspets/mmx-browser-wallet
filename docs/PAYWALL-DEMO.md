# Crypto Paywall Demo

The repo includes a standalone paywall demo at `demo/paywall.html` — a fully functional example of dApp integration with zero server infrastructure.

## How It Works

1. **Detects wallet** — checks for `window.mmx` (extension with dApp enabled)
2. **Gets address** — calls `window.mmx.getAddress()` (user approves per-site)
3. **Requests payment** — calls `window.mmx.send({to: Morpheus, amount: "1", currency: "TRAIL"})`
4. **User confirms** — extension popup shows amount, destination, fee
5. **Content unlocks** — on broadcast (TXID returned, ~1s), no block confirmation wait needed
6. **TX link** — links to `explore.mmx.network/#/explore/transaction/<TXID>`

## Running Locally

```bash
# From the repo root:
python3 -m http.server 8080
# Visit http://localhost:8080/demo/paywall.html
```

The extension must be installed with dApp integration enabled.

## Hosting

`paywall.html` is fully self-contained — no server, no database, no build step. Host it on any static file server:

- GitHub Pages
- Netlify
- Any web server

The only requirement: the visitor has the MMX Browser Wallet extension installed with dApp integration enabled.

## Customizing

Edit `demo/paywall.html` to change:

- **Payment address** — replace the `MORPHEUS` constant with your address
- **Token** — replace `TRAIL_CONTRACT` and `currency: "TRAIL"` with your token
- **Price** — change `PRICE_TRAIL`
- **Locked content** — replace the SVG with your own content (image, video, text, etc.)

## Other Demos

The repo also includes:

- [`demo/swap-pools.html`](../demo/swap-pools.html) — live swap pool explorer (reserves, prices, APY, fees, trade estimator). All from public RPC, no wallet needed.
- [`demo/offers.html`](../demo/offers.html) — live offer book (open offers, prices, owners, pair filters). All from public RPC, no wallet needed.
