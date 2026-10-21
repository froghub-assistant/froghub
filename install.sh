#!/bin/sh
# Frog Hub installer for a fresh Raspberry Pi OS / Debian / Ubuntu or Fedora / RHEL / CentOS Stream / Rocky / Alma machine:
#   curl -fsSL https://raw.githubusercontent.com/froghub-assistant/froghub/master/install.sh | sh
# Installs what Frog Hub needs (git, Bun, Caddy, tmux, rsync), fetches it to ~/froghub (or updates it), then runs
# `bun run setup`, which asks the questions. Run it again to update; your settings in ~/.config/froghub are kept.
set -eu
REPO=${FROGHUB_REPO:-https://github.com/froghub-assistant/froghub.git}
DIR=${FROGHUB_DIR:-$HOME/froghub}

say() { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
ask() { printf '%s ' "$1" >/dev/tty; read -r answer </dev/tty; case "$answer" in [Nn]*) return 1 ;; *) return 0 ;; esac; }

[ "$(id -u)" -eq 0 ] && { echo "Run this as your normal user, not root (it uses sudo where needed)."; exit 1; }
if command -v apt-get >/dev/null; then
	pm=apt
elif command -v dnf >/dev/null; then
	pm=dnf
else
	echo "This installer needs apt (Raspberry Pi OS, Debian, Ubuntu) or dnf (Fedora, RHEL, CentOS Stream, Rocky, Alma, Oracle Linux)."
	exit 1
fi

say "🐸 Installing what Frog Hub needs (sudo may ask for your password)"
if [ "$pm" = apt ]; then
	sudo apt-get update -qq
	sudo apt-get install -y -qq git curl unzip tmux rsync caddy
else
	# Fedora has Caddy; the RHEL family (RHEL, CentOS Stream, Rocky, Alma, Oracle) gets it from EPEL, which wants
	# CRB (CodeReady Builder) on too. Rocky, Alma and CentOS ship epel-release; RHEL itself needs it by URL.
	if ! grep -q '^ID=fedora' /etc/os-release && ! rpm -q epel-release >/dev/null 2>&1; then
		sudo dnf install -y -q dnf-plugins-core
		sudo dnf config-manager --set-enabled crb 2>/dev/null || sudo dnf config-manager --set-enabled powertools 2>/dev/null || true
		major=$(. /etc/os-release && echo "${VERSION_ID%%.*}")
		sudo dnf install -y -q epel-release ||
			sudo dnf install -y -q "https://dl.fedoraproject.org/pub/epel/epel-release-latest-$major.noarch.rpm" ||
			echo "(Couldn't add EPEL; see https://docs.fedoraproject.org/en-US/epel/)"
	fi
	sudo dnf install -y -q git curl unzip tmux rsync caddy
	sudo systemctl enable --now caddy
	if systemctl is-active -q firewalld && ask "Open the firewall for the web server (http and https)? [Y/n]"; then
		sudo firewall-cmd -q --permanent --add-service=http --add-service=https && sudo firewall-cmd -q --reload
	fi
	# SELinux: let Caddy pass /api/ on to Frog Hub's server on 127.0.0.1:8790
	command -v setsebool >/dev/null && [ "$(getenforce 2>/dev/null)" = Enforcing ] && sudo setsebool -P httpd_can_network_connect 1
fi

if ! command -v bun >/dev/null && [ ! -x "$HOME/.bun/bin/bun" ]; then
	say "Installing Bun"
	curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

if ! command -v docker >/dev/null && ! command -v podman-compose >/dev/null &&
	ask "Install containers too, for the local voice (wake word, speech, voices)? [Y/n]"; then
	if [ "$pm" = apt ]; then
		sudo apt-get install -y -qq docker.io docker-compose
		sudo usermod -aG docker "$USER"
		echo "(Docker works without sudo after you log out and in again; setup uses sudo until then if needed.)"
	else
		sudo dnf install -y -q podman podman-compose # Red Hat's own; no daemon, no docker group
	fi
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
