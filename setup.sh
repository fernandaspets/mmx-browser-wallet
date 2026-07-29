#!/bin/bash
# Setup script for MMX Browser Wallet
# Run this after cloning the repo to install dependencies

set -e

echo "Installing npm dependencies..."
npm install

echo "Copying @noble packages into lib/ (for Firefox compatibility)..."
mkdir -p lib/@noble
for pkg in secp256k1 hashes; do
  if [ -d "node_modules/@noble/$pkg" ]; then
    cp -rL "node_modules/@noble/$pkg" "lib/@noble/" 2>/dev/null || true
  fi
done

echo "Running tests..."
for t in test/*.mjs; do
  node "$t" 2>&1 | tail -1
done

echo ""
echo "Setup complete!"
echo ""
echo "To load as browser extension:"
echo "  Firefox: about:debugging → Load Temporary Add-on → select manifest.json"
echo "  Chrome:  chrome://extensions → Developer mode → Load unpacked → select folder"
echo ""
echo "To run as web page:"
echo "  python3 -m http.server 8060"
echo "  Open http://localhost:8060/dapp/app.html"
