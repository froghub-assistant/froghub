#!/bin/sh
# Build and publish to the web root (webRoot in ~/.config/froghub/instance.json, set by `bun run setup`).
set -eu
cd "$(dirname "$0")"
root=$(bun -e 'const f = Bun.file(`${process.env.HOME}/.config/froghub/instance.json`); console.log((await f.exists() && (await f.json()).webRoot) || "/var/www/froghub")')
bun run build
if [ -w "$root" ]; then rsync -a --delete dist/ "$root/"; else sudo rsync -a --delete dist/ "$root/"; fi
echo "Deployed to $root. Reload the page on the tablets (Fully Kiosk: swipe from the left → Reload)."
