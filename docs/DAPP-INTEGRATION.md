# dApp Integration

dApp integration allows websites to request wallet address and payments via `window.mmx` — similar to MetaMask's `window.ethereum`.

## Opt-In

dApp integration is **off by default** — no content script runs, no `window.mmx` is injected. Users enable it via a toggle in the dashboard:

1. Open the wallet extension popup
2. Toggle "dApp Integration" ON
3. The background script dynamically registers the content script via `chrome.scripting.registerContentScripts()`
4. `window.mmx` is now available on all web pages

When toggled OFF, the content script is unregistered — zero page access.

`<all_urls>` is in `host_permissions` (granted at install time), but the content script only **runs** when the user opts in. No runtime permission dialog needed.

## API

### `window.mmx.getAddress()`

Requests the user's wallet address. The user sees an Allow/Deny prompt in the extension popup (per-site, deny-by-default).

```javascript
if (window.mmx) {
  const address = await window.mmx.getAddress();
  console.log("Wallet address:", address);
}
```

Returns: `string` (mmx1...) or `null` if denied/not unlocked.

### `window.mmx.send(params)`

Requests a transaction. The user sees a confirmation dialog with amount, destination, and fee.

```javascript
const result = await window.mmx.send({
  to: "mmx1vywfs5ymt9hfhkc3a37a3a5uw35mpl0j5l09qz59g3ek9t9az5sqgl8cq5",
  amount: "1",
  currency: "TRAIL"  // or "MMX"
});
console.log("TXID:", result.txid);
```

Returns: `{ txid: "ABCD..." }` or throws on rejection/error.

## Permissions

- Per-site, deny-by-default
- User must approve each site before `getAddress()` responds
- `send()` always requires explicit confirmation (even for approved sites)
- Permissions stored in `chrome.storage.local` under `mmx_dapp_permissions`

## Demo

See [`demo/paywall.html`](../demo/paywall.html) for a working paywall demo.
