#!/bin/sh
# Frog Hub installer for a fresh Raspberry Pi OS / Debian / Ubuntu or Fedora / RHEL / CentOS Stream / Rocky / Alma machine:
#   curl -fsSL https://raw.githubusercontent.com/froghub-assistant/froghub/master/install.sh | sh
# Installs what Frog Hub needs (git, Bun, Caddy, tmux, rsync), fetches it to ~/froghub (or updates it), then runs
# `bun run setup`, which asks the questions. Run it again to update; your settings in ~/.config/froghub are kept.
# (Without the questions: ~/froghub/upgrade.sh. To take it all off again: ~/froghub/remove.sh.)
#
# Everything it installs or changes that wasn't there before (packages, including the ones they pulled in, Bun, Claude
# Code, lines added to your shell's startup files, the docker group, firewall and SELinux settings) is written down in
# ~/.local/share/froghub/installed, so remove.sh can undo exactly that and leave alone what was already there.
set -eu
REPO=${FROGHUB_REPO:-https://github.com/froghub-assistant/froghub.git}
DIR=${FROGHUB_DIR:-$HOME/froghub}
STATE=${XDG_DATA_HOME:-$HOME/.local/share}/froghub
MANIFEST=$STATE/installed
RC_FILES="$HOME/.profile $HOME/.bash_profile $HOME/.bashrc $HOME/.zshrc $HOME/.config/fish/config.fish"

say() { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
ask() { printf '%s ' "$1" >/dev/tty; read -r answer </dev/tty; case "$answer" in [Nn]*) return 1 ;; *) return 0 ;; esac; }
note() { grep -qxF "$*" "$MANIFEST" 2>/dev/null || echo "$*" >>"$MANIFEST"; }

# The installed packages, one name per line (rpm's gpg-pubkey "packages" are keys, so by their full name)
packages() {
	if [ "$pm" = apt ]; then
		dpkg-query -W -f '${db:Status-Abbrev} ${binary:Package}\n' | awk '$1 == "ii" { print $2 }'
	else
		rpm -qa --qf '%{NAME}\n' | grep -vx gpg-pubkey
		rpm -q gpg-pubkey --qf '%{NAME}-%{VERSION}-%{RELEASE}\n' 2>/dev/null || true
	fi | sort -u
}

# Bun's and Claude Code's installers add PATH lines to the shell's startup files: keep what they added
rc_before() { for f in $RC_FILES; do cp "$f" "$STATE/.rc-before.$(basename "$f")" 2>/dev/null || :>"$STATE/.rc-before.$(basename "$f")"; done; }
rc_after() {
	for f in $RC_FILES; do
		before="$STATE/.rc-before.$(basename "$f")"
		n=$(wc -c <"$before")
		if [ -f "$f" ] && [ "$(wc -c <"$f")" -gt "$n" ] && head -c "$n" "$f" | cmp -s - "$before"; then
			added="$STATE/rc-added$(echo "$f" | tr / _)"
			tail -c +"$((n + 1))" "$f" >>"$added"
			note "rc $f $added"
		fi
		rm -f "$before"
	done
}

[ "$(id -u)" -eq 0 ] && { echo "Run this as your normal user, not root (it uses sudo where needed)."; exit 1; }
if command -v apt-get >/dev/null; then
	pm=apt
elif command -v dnf >/dev/null; then
	pm=dnf
else
	echo "This installer needs apt (Raspberry Pi OS, Debian, Ubuntu) or dnf (Fedora, RHEL, CentOS Stream, Rocky, Alma, Oracle Linux)."
	exit 1
fi
made=$(LC_ALL=C mkdir -pv "$STATE" | sed -n "s/^mkdir: created directory '\(.*\)'$/\1/p")
printf '%s\n' "$made" | while read -r d; do [ -z "$d" ] || note "dir $d"; done
packages >"$STATE/.packages-before"
getent group docker >/dev/null || had_no_docker_group=yes

say "🐸 Installing what Frog Hub needs (sudo may ask for your password)"
if [ "$pm" = apt ]; then
	sudo apt-get update -qq
	sudo apt-get install -y -qq git curl unzip tmux rsync caddy
else
	# Fedora has Caddy; the RHEL family (RHEL, CentOS Stream, Rocky, Alma, Oracle) gets it from EPEL, which wants
	# CRB (CodeReady Builder) on too. Rocky, Alma and CentOS ship epel-release; RHEL itself needs it by URL.
	if ! grep -q '^ID=fedora' /etc/os-release && ! rpm -q epel-release >/dev/null 2>&1; then
		sudo dnf install -y -q dnf-plugins-core
		for repo in crb powertools; do
			dnf repolist --enabled 2>/dev/null | awk '{ print $1 }' | grep -qx "$repo" && break
			sudo dnf config-manager --set-enabled "$repo" 2>/dev/null && { note "repo $repo"; break; }
		done
		major=$(. /etc/os-release && echo "${VERSION_ID%%.*}")
		sudo dnf install -y -q epel-release ||
			sudo dnf install -y -q "https://dl.fedoraproject.org/pub/epel/epel-release-latest-$major.noarch.rpm" ||
			echo "(Couldn't add EPEL; see https://docs.fedoraproject.org/en-US/epel/)"
	fi
	curl=curl # (RHEL 9's images have curl-minimal, which conflicts with the full curl)
	command -v curl >/dev/null && curl=''
	sudo dnf install -y -q git $curl unzip tmux rsync caddy
	systemctl is-enabled -q caddy || { sudo systemctl enable --now caddy && note "service caddy"; }
	if systemctl is-active -q firewalld && ask "Open the firewall for the web server (http and https)? [Y/n]"; then
		for service in http https; do
			sudo firewall-cmd -q --permanent --query-service=$service ||
				{ sudo firewall-cmd -q --permanent --add-service=$service && note "firewall $service"; }
		done
		sudo firewall-cmd -q --reload
	fi
	# SELinux: let Caddy pass /api/ on to Frog Hub's server on 127.0.0.1:8790
	if command -v setsebool >/dev/null && [ "$(getenforce 2>/dev/null)" = Enforcing ] &&
		getsebool httpd_can_network_connect | grep -q 'off$'; then
		sudo setsebool -P httpd_can_network_connect 1 && note "sebool httpd_can_network_connect"
	fi
fi

if ! command -v bun >/dev/null && [ ! -x "$HOME/.bun/bin/bun" ]; then
	say "Installing Bun"
	rc_before
	curl -fsSL https://bun.sh/install | bash
	note "bun"
	rc_after
fi
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

if ! command -v docker >/dev/null && ! command -v podman-compose >/dev/null &&
	ask "Install containers too, for the local voice (wake word, speech, voices)? [Y/n]"; then
	if [ "$pm" = apt ]; then
		sudo apt-get install -y -qq docker.io docker-compose
		sudo usermod -aG docker "$USER"
		note "group docker"
		[ "${had_no_docker_group:-}" = yes ] && note "groupadd docker"
		echo "(Docker works without sudo after you log out and in again; setup uses sudo until then if needed.)"
	else
		sudo dnf install -y -q podman podman-compose # Red Hat's own; no daemon, no docker group
	fi
fi

if ! command -v claude >/dev/null && ask "Install Claude Code, for the Claude subscription assistant? (No = API or a local model) [Y/n]"; then
	[ -e "$HOME/.claude" ] || [ -e "$HOME/.claude.json" ] || note "claude-home"
	[ -d "$HOME/.local/bin" ] || note "dir $HOME/.local/bin"
	rc_before
	curl -fsSL https://claude.ai/install.sh | bash
	note "claude"
	rc_after
	echo "Run 'claude' once after setup to log in."
fi

# Every package that's new since the start, including the ones the ones above pulled in
packages | comm -13 "$STATE/.packages-before" - | while read -r p; do note "pkg $p"; done
rm -f "$STATE/.packages-before"

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
