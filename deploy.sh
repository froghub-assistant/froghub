#!/bin/sh
# Build and publish to the web root (webRoot in ~/.config/froghub/instance.json, set by `bun run setup`).
set -eu
cd "$(dirname "$0")"
git pull
root=$(bun -e 'const f = Bun.file(`${process.env.HOME}/.config/froghub/instance.json`); console.log((await f.exists() && (await f.json()).webRoot) || "/var/www/froghub")')
bun run build
if [ -w "$root" ]; then rsync -a --delete dist/ "$root/"; else sudo rsync -a --delete dist/ "$root/"; fi
# Whichever brain this house runs (only one of the units exists, so a failed restart mustn't stop the script)
for unit in froghub-agent froghub-standalone; do
  if systemctl --user cat "$unit.service" >/dev/null 2>&1; then systemctl --user restart "$unit.service"; fi
done
echo "Deployed to $root. Reload the page on the tablets (Fully Kiosk: swipe from the left → Reload)."
