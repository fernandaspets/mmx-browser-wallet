# Store Submission

## Firefox Add-ons (AMO)

1. Create a free account at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/)
2. Run `./pack.sh` to build `mmx-wallet-v1.0.0.zip`
3. Submit the ZIP at [addons.mozilla.org/developers/add-new](https://addons.mozilla.org/developers/add-new)
4. Provide privacy policy URL: link to `PRIVACY.md` in this repo
5. Review takes ~1-5 days. Firefox AMO requires source code access (open source, link to repo)

## Chrome Web Store

1. Pay $5 one-time fee at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
2. Run `./pack.sh` to build `mmx-wallet-v1.0.0.zip`
3. Upload the ZIP, provide screenshots (1280×800px) and privacy policy URL
4. Review takes days to weeks. `<all_urls>` is in `host_permissions` but the content script
   is dynamically registered only when the user opts in. Justify in the store listing:
   "dApp integration (like MetaMask). Content script only runs when user enables it in settings.
   Off by default — no page access until user explicitly toggles it on."

## Packaging

```bash
./pack.sh    # creates mmx-wallet-v1.0.0.zip
```

The ZIP includes all production files + `@noble` crypto libs. Test files, dev docs, and private keys are excluded.
