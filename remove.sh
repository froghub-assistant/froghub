#!/bin/sh
# Frog Hub remover: takes Frog Hub off this computer, undoing `bun run setup`. It asks before each part, and whatever
# you say no to stays.
#   ~/froghub/remove.sh            (--yes says yes to everything, including deleting your settings and Frog Hub itself)
# It removes the assistant's service, the voice containers, the web app and Frog Hub's block in the Caddy config, and,
# only if you say so, your settings, the assistant's memory and Frog Hub's own folder. The programs install.sh
# installed (Caddy, Bun, Docker or Podman, tmux, rsync, Claude Code) stay, since other things may use them.
set -eu

say() { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }

all=no
for arg in "$@"; do
	case "$arg" in
	--yes) all=yes ;;
	*) fail "Unknown option: $arg (try --yes)" ;;
	esac
done

# ask "question" Y|N: yes or no, with the default in capitals
ask() {
	[ "$all" = yes ] && return 0
	if [ "$2" = Y ]; then hint='[Y/n]'; else hint='[y/N]'; fi
	printf '%s %s ' "$1" "$hint" >/dev/tty
	read -r answer </dev/tty
	case "$answer" in
	[Yy]*) return 0 ;;
	[Nn]*) return 1 ;;
	*) [ "$2" = Y ] ;;
	esac
}

# Deletes a folder, with sudo if it has to (the web root, or voice data the containers wrote as root)
delete() { rm -rf "$1" 2>/dev/null || sudo rm -rf "$1"; }

# Refuses folders that can't be Frog Hub's: /, the home folder, top-level folders, relative paths
safe() {
	case "$1" in
	/*/*) [ "$1" != "$HOME" ] && [ "$1" != "$HOME/" ] ;;
	*) return 1 ;;
	esac
}

[ "$(id -u)" -eq 0 ] && fail "Run this as your normal user, not root (it uses sudo where needed)."
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

here=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || here=
if [ -n "$here" ] && [ -f "$here/setup/setup.ts" ]; then DIR=$here; else DIR=${FROGHUB_DIR:-$HOME/froghub}; fi
CONFIG="$HOME/.config/froghub"
UNITS="$HOME/.config/systemd/user"

# What setup chose (instance.json), else its defaults
site='' webRoot=/var/www/froghub agentDir="$HOME/froghub-agent"
if [ -f "$CONFIG/instance.json" ] && command -v bun >/dev/null; then
	{ read -r s; read -r w; read -r a; } <<EOF
$(bun -e 'const i = await Bun.file(process.argv.at(-1)).json(); console.log([i.site, i.webRoot, i.agentDir].map(v => v || "").join("\n"))' "$CONFIG/instance.json")
EOF
	site=$s webRoot=${w:-$webRoot} agentDir=${a:-$agentDir}
fi
host=${site#*://}
host=${host%%/*}

echo "🐸 This takes Frog Hub off this computer${host:+ ($host)}. You'll be asked before each part."
ask "Go ahead?" N || exit 0

# ---- the assistant ----
for unit in froghub-agent froghub-standalone; do
	if [ -f "$UNITS/$unit.service" ]; then
		say "Removing the assistant's service ($unit)"
		systemctl --user disable --now "$unit" 2>/dev/null || true
		rm -f "$UNITS/$unit.service"
	fi
done
systemctl --user daemon-reload 2>/dev/null || true
command -v tmux >/dev/null && tmux -L froghub kill-server 2>/dev/null || true

# ---- the voice containers ----
sudo=
if command -v docker >/dev/null; then
	engine=docker
	docker info >/dev/null 2>&1 || sudo=sudo
	if docker compose version >/dev/null 2>&1; then compose="docker compose"
	elif command -v docker-compose >/dev/null; then compose=docker-compose
	else compose=
	fi
elif command -v podman-compose >/dev/null; then
	engine=podman
	compose=podman-compose
else
	compose=
fi
if [ -n "$compose" ] && $sudo $engine container inspect froghub-piper >/dev/null 2>&1 &&
	ask "Remove the voice containers (wake word, speech-to-text, voices) and their images?" Y; then
	say "Removing the voice containers"
	if [ -f "$DIR/setup/voice/compose.yaml" ]; then
		$sudo $compose -f "$DIR/setup/voice/compose.yaml" down --rmi all || $sudo $compose -f "$DIR/setup/voice/compose.yaml" down
	else
		$sudo $engine rm -f froghub-openwakeword froghub-whisper froghub-piper
	fi
	delete "$DIR/setup/voice/data"
fi

# ---- the web app ----
if safe "$webRoot" && [ -f "$webRoot/index.html" ] && ask "Delete the web app in $webRoot?" Y; then
	say "Deleting $webRoot"
	delete "$webRoot"
	command -v semanage >/dev/null && sudo semanage fcontext -d "$webRoot(/.*)?" 2>/dev/null || true
fi

# ---- Caddy ----
caddyfile=/etc/caddy/Caddyfile
if [ -n "$host" ] && [ -f "$caddyfile" ] && grep -qxF "$host {" "$caddyfile" &&
	ask "Take the $host block out of $caddyfile (a copy is kept as $caddyfile.bak-froghub-remove)?" Y; then
	say "Removing $host from Caddy"
	sudo cp "$caddyfile" "$caddyfile.bak-froghub-remove"
	# From the line "<host> {" to the first "}" on its own line: the block as setup wrote it
	awk -v start="$host {" 'skip == 0 && $0 == start { skip = 1; next } skip == 1 { if ($0 == "}") skip = 2; next } { print }' \
		"$caddyfile.bak-froghub-remove" | sudo tee "$caddyfile" >/dev/null
	if sudo caddy validate --config "$caddyfile" --adapter caddyfile >/dev/null 2>&1; then
		sudo systemctl reload caddy || true
	else
		sudo cp "$caddyfile.bak-froghub-remove" "$caddyfile"
		echo "Caddy didn't like the config without it, so it's unchanged. Take the $host block out by hand."
	fi
fi

# ---- your things ----
if [ -d "$CONFIG" ] && ask "Delete Frog Hub's settings too ($CONFIG: the PIN, alarms, the displays, the shared Home Assistant token)?" N; then
	say "Deleting $CONFIG"
	rm -rf "$CONFIG"
fi
memory="$HOME/.claude/projects/$(printf %s "$agentDir" | sed 's/[^a-zA-Z0-9]/-/g')"
if safe "$agentDir" && [ -d "$agentDir" ] && ask "Delete the assistant's folder ($agentDir), its memory and its conversations?" N; then
	say "Deleting $agentDir"
	rm -rf "$agentDir" "$memory"
fi
if safe "$DIR" && [ -f "$DIR/setup/setup.ts" ] && ask "Delete Frog Hub itself ($DIR)?" N; then
	say "Deleting $DIR"
	cd /
	delete "$DIR"
fi

say "Done 🐸"
cat <<EOF
Left for you to tidy up, if you want:
  - In Home Assistant: the "Frog Hub · ..." voice assistants (Settings → Voice assistants), and the Wyoming
    integrations for ports 10400, 10300 and 10200 if setup added them.
  - The Frog Hub app or kiosk browser on each tablet.
  - The programs install.sh installed, and its firewall and SELinux changes (http/https open,
    httpd_can_network_connect) on Fedora and the RHEL family.
EOF
