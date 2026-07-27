#!/bin/bash
# pack.sh — Package the extension into a ZIP for store submission
#
# Usage:
#   ./pack.sh              # creates mmx-wallet-v1.0.0.zip
#   ./pack.sh --firefox     # same, but for Firefox (includes lib/ copies)
#
# What gets included:
#   - All source JS, HTML, CSS
#   - icon PNGs (16, 48, 128)
#   - wordlist.txt
#   - manifest.json
#   - lib/ (bech32-esm.js, buffer-esm.js — tracked)
#   - node_modules/@noble/ (physically copied for Firefox compatibility)
#
# What gets EXCLUDED:
#   - test/ directory (not needed in production)
#   - .git/, .gitignore, .editorconfig
#   - CODE-REVIEW.md, CONTRIBUTING.md (dev docs)
#   - test-wallet.json (contains private keys!)
#   - package.json, setup.sh (dev tooling)
#   - node_modules except @noble/

set -e

cd "$(dirname "$0")"

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"//;s/".*//')
ZIP_NAME="mmx-wallet-v${VERSION}.zip"
STAGING="dist-staging"

echo "Packaging MMX Wallet v${VERSION}..."

# Clean staging
rm -rf "$STAGING"
mkdir -p "$STAGING"

# Copy production files
for f in \
  manifest.json \
  background.js \
  content.js \
  inject.js \
  popup.html \
  popup.js \
  wallet.html \
  wallet-page.js \
  wallet-app.js \
  wallet-store.js \
  mmx-node-api.js \
  mmx-tx.js \
  theme.css \
  wordlist.txt \
  icon.png \
  icon16.png \
  icon48.png \
  icon128.png \
  PRIVACY.md \
  demo/paywall.html \
  lib/bech32-esm.js \
  lib/buffer-esm.js
do
  if [ -f "$f" ]; then
    cp "$f" "$STAGING/"
  else
    echo "WARNING: $f not found"
  fi
done

# Copy @noble dependencies (Firefox needs physical copies, not symlinks)
mkdir -p "$STAGING/node_modules/@noble"
for pkg in secp256k1 hashes; do
  if [ -d "node_modules/@noble/$pkg" ]; then
    cp -rL "node_modules/@noble/$pkg" "$STAGING/node_modules/@noble/"
  elif [ -d "lib/@noble/$pkg" ]; then
    cp -rL "lib/@noble/$pkg" "$STAGING/node_modules/@noble/"
  else
    echo "WARNING: @noble/$pkg not found"
  fi
done

# Create ZIP
rm -f "$ZIP_NAME"
cd "$STAGING"
zip -r "../$ZIP_NAME" . -x ".*"
cd ..

# Cleanup
rm -rf "$STAGING"

echo ""
echo "Created: $ZIP_NAME"
echo "Size: $(du -h "$ZIP_NAME" | cut -f1)"
echo ""
echo "Contents:"
unzip -l "$ZIP_NAME" | tail -n +4 | head -n -2 | awk '{print "  " $4}' | sort
