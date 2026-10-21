#!/bin/sh
# Frog Hub installer for a fresh Raspberry Pi OS / Debian / Ubuntu machine:
#   curl -fsSL https://raw.githubusercontent.com/froghub-assistant/froghub/master/install.sh | sh
# Installs what Frog Hub needs (git, Bun, Caddy, tmux, rsync), fetches it to ~/froghub (or updates it), then runs
# `bun run setup`, which asks the questions. Run it again to update; your settings in ~/.config/froghub are kept.
set -eu
REPO=${FROGHUB_REPO:-https://github.com/froghub-assistant/froghub.git}
DIR=${FROGHUB_DIR:-$HOME/froghub}

say() { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
ask() { printf '%s ' "$1" >/dev/tty; read -r answer </dev/tty; case "$answer" in [Nn]*) return 1 ;; *) return 0 ;; esac; }

[ "$(id -u)" -eq 0 ] && { echo "Run this as your normal user, not root (it uses sudo where needed)."; exit 1; }
command -v apt-get >/dev/null || { echo "This installer needs a Debian-based system (Raspberry Pi OS, Debian, Ubuntu)."; exit 1; }

say "🐸 Installing what Frog Hub needs (sudo may ask for your password)"
sudo apt-get update -qq
sudo apt-get install -y -qq git curl unzip tmux rsync caddy

if ! command -v bun >/dev/null && [ ! -x "$HOME/.bun/bin/bun" ]; then
	say "Installing Bun"
	curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

if ! command -v docker >/dev/null && ask "Install Docker too, for the local voice (wake word, speech, voices)? [Y/n]"; then
	sudo apt-get install -y -qq docker.io docker-compose
	sudo usermod -aG docker "$USER"
	echo "(Docker works without sudo after you log out and in again; setup uses sudo until then if needed.)"
fi

if ! command -v claude >/dev/null && ask "Install Claude Code, for the Claude subscription assistant? (No = API or a local model) [Y/n]"; then
	curl -fsSL https://claude.ai/install.sh | bash
	echo "Run 'claude' once after setup to log in."
fi

if [ -d "$DIR/.git" ]; then
	say "Updating Frog Hub in $DIR"
	git -C "$DIR" pull --ff-only
else
	say "Fetching Frog Hub into $DIR"
	git clone --depth 1 "$REPO" "$DIR"
fi

say "Setting it up"
cd "$DIR"
exec bun run setup </dev/tty
