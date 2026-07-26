#!/bin/bash
# Setup script for MMX Browser Wallet
# Run this after cloning the repo to install dependencies

set -e

echo "📦 Installing npm dependencies..."
npm install

echo "📋 Copying @noble packages into browser-wallet/node_modules..."
mkdir -p node_modules/@noble
cp -r node_modules/@noble/secp256k1 node_modules/@noble/secp256k1 2>/dev/null || true
cp -r ../../node_modules/@noble/secp256k1 node_modules/@noble/secp256k1 2>/dev/null || true
cp -r node_modules/@noble/hashes node_modules/@noble/hashes 2>/dev/null || true
cp -r ../../node_modules/@noble/hashes node_modules/@noble/hashes 2>/dev/null || true

echo "🧪 Running tests..."
node test-crypto.mjs

echo ""
echo "✅ Setup complete!"
echo ""
echo "To load as browser extension:"
echo "  Firefox: about:debugging → Load Temporary Add-on → select manifest.json"
echo "  Chrome:  chrome://extensions → Developer mode → Load unpacked → select folder"
echo ""
echo "To run as web page:"
echo "  python3 -m http.server 5050"
echo "  Open http://localhost:5050/browser-wallet/wallet.html"
