#!/bin/sh
# Frog Hub installer for a fresh Raspberry Pi OS / Debian / Ubuntu or Fedora / RHEL / CentOS Stream / Rocky / Alma machine:
#   curl -fsSL https://raw.githubusercontent.com/froghub-assistant/froghub/master/install.sh | sh
# Installs what Frog Hub needs (git, Bun, Caddy, tmux, rsync), fetches it to ~/froghub (or updates it), then runs
# `bun run setup`, which asks the questions. Run it again to update; your settings in ~/.config/froghub are kept.
# (Without the questions: ~/froghub/upgrade.sh. To take it all off again: ~/froghub/remove.sh.)
# --dry-run asks the same questions, says what it would install and change, and changes nothing (setup's dry run too,
# if Frog Hub is already here):
#   curl -fsSL https://raw.githubusercontent.com/froghub-assistant/froghub/master/install.sh | sh -s -- --dry-run
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

dry=no
for arg in "$@"; do
	case "$arg" in
	--dry-run) dry=yes ;;
	*) echo "Unknown option: $arg (try --dry-run)"; exit 1 ;;
	esac
done

say() { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
ask() { printf '%s ' "$1" >/dev/tty; read -r answer </dev/tty; case "$answer" in [Nn]*) return 1 ;; *) return 0 ;; esac; }
note() { [ "$dry" = yes ] || grep -qxF "$*" "$MANIFEST" 2>/dev/null || echo "$*" >>"$MANIFEST"; }
# A command that changes something: in a dry run, only say it
run() { if [ "$dry" = yes ]; then echo "  would run: $*"; else "$@"; fi; }
# The same for an installer piped from the web into bash
run_installer() { if [ "$dry" = yes ]; then echo "  would run: curl -fsSL $1 | bash"; else curl -fsSL "$1" | bash; fi; }

# Install packages; a dry run lists the new ones (apt works out what they'd pull in too, dnf needs root for that)
add_packages() {
	if [ "$dry" = no ]; then
		if [ "$pm" = apt ]; then sudo apt-get install -y -qq "$@"; else sudo dnf install -y -q "$@"; fi
		return
	fi
	if [ "$pm" = apt ]; then
		new=$(apt-get install -s "$@" 2>/dev/null | sed -n 's/^Inst \([^ ]*\).*/\1/p')
	else
		new=$(for p in "$@"; do rpm -q "$p" >/dev/null 2>&1 || echo "$p"; done)
	fi
	if [ -z "$new" ]; then echo "  already installed: $*"; else echo "  would install:" $new; fi
	[ "$pm" = apt ] || [ -z "$new" ] || echo "  (and what they need)"
}

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
if [ "$dry" = no ]; then
	made=$(LC_ALL=C mkdir -pv "$STATE" | sed -n "s/^mkdir: created directory '\(.*\)'$/\1/p")
	printf '%s\n' "$made" | while read -r d; do [ -z "$d" ] || note "dir $d"; done
	packages >"$STATE/.packages-before"
	say "🐸 Installing what Frog Hub needs (sudo may ask for your password)"
else
	say "🐸 Dry run: what installing Frog Hub would do here (nothing is changed)"
fi
getent group docker >/dev/null || had_no_docker_group=yes

if [ "$pm" = apt ]; then
	run sudo apt-get update -qq
	add_packages git curl unzip tmux rsync caddy
else
	# Fedora (and what's built on it: Ultramarine, Nobara…) has Caddy; the RHEL family (RHEL, CentOS Stream, Rocky,
	# Alma, Oracle) gets it from EPEL, which wants CRB (CodeReady Builder) on too. Rocky, Alma and CentOS ship
	# epel-release; RHEL itself needs it by URL. (Oracle's ID_LIKE is just "fedora", hence its own ID.)
	rhel=$(. /etc/os-release && case " $ID ${ID_LIKE:-} " in *" rhel "* | *" centos "* | " ol "*) echo yes ;; esac)
	if [ "$rhel" = yes ] && ! rpm -q epel-release >/dev/null 2>&1; then
		add_packages dnf-plugins-core
		for repo in crb powertools; do
			dnf repolist --enabled 2>/dev/null | awk '{ print $1 }' | grep -qx "$repo" && break
			if [ "$dry" = yes ]; then
				dnf repolist --all 2>/dev/null | awk '{ print $1 }' | grep -qx "$repo" && { run sudo dnf config-manager --set-enabled "$repo"; break; }
			elif sudo dnf config-manager --set-enabled "$repo" 2>/dev/null; then
				note "repo $repo"
				break
			fi
		done
		major=$(. /etc/os-release && echo "${VERSION_ID%%.*}")
		add_packages epel-release ||
			add_packages "https://dl.fedoraproject.org/pub/epel/epel-release-latest-$major.noarch.rpm" ||
			echo "(Couldn't add EPEL; see https://docs.fedoraproject.org/en-US/epel/)"
	fi
	curl=curl # (RHEL 9's images have curl-minimal, which conflicts with the full curl)
	command -v curl >/dev/null && curl=''
	add_packages git $curl unzip tmux rsync caddy
	systemctl is-enabled -q caddy 2>/dev/null || { run sudo systemctl enable --now caddy && note "service caddy"; }
	if systemctl is-active -q firewalld && ask "Open the firewall for the web server (http and https)? [Y/n]"; then
		for service in http https; do
			{ [ "$dry" = no ] && sudo firewall-cmd -q --permanent --query-service=$service; } ||
				{ run sudo firewall-cmd -q --permanent --add-service=$service && note "firewall $service"; }
		done
		run sudo firewall-cmd -q --reload
	fi
	# SELinux: let Caddy pass /api/ on to Frog Hub's server on 127.0.0.1:8790
	if command -v setsebool >/dev/null && [ "$(getenforce 2>/dev/null)" = Enforcing ] &&
		getsebool httpd_can_network_connect | grep -q 'off$'; then
		run sudo setsebool -P httpd_can_network_connect 1 && note "sebool httpd_can_network_connect"
	fi
fi

if ! command -v bun >/dev/null && [ ! -x "$HOME/.bun/bin/bun" ]; then
	say "Installing Bun"
	[ "$dry" = yes ] || rc_before
	run_installer https://bun.sh/install
	note "bun"
	[ "$dry" = yes ] || rc_after
fi
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

if ! command -v docker >/dev/null && ! command -v podman-compose >/dev/null &&
	ask "Install containers too, for the local voice (wake word, speech, voices)? [Y/n]"; then
	if [ "$pm" = apt ]; then
		add_packages docker.io docker-compose
		run sudo usermod -aG docker "$USER"
		note "group docker"
		[ "${had_no_docker_group:-}" = yes ] && note "groupadd docker"
		[ "$dry" = yes ] || echo "(Docker works without sudo after you log out and in again; setup uses sudo until then if needed.)"
	else
		# Red Hat's own; no daemon, no docker group. iptables-nft by name, or EPEL's iptables-legacy can win, which
		# rootless podman can't use
		add_packages podman podman-compose iptables-nft
	fi
fi

if ! command -v claude >/dev/null && ask "Install Claude Code, for the Claude subscription assistant? (No = API or a local model) [Y/n]"; then
	[ -e "$HOME/.claude" ] || [ -e "$HOME/.claude.json" ] || note "claude-home"
	[ -d "$HOME/.local/bin" ] || note "dir $HOME/.local/bin"
	[ "$dry" = yes ] || rc_before
	run_installer https://claude.ai/install.sh
	note "claude"
	[ "$dry" = yes ] || rc_after
	[ "$dry" = yes ] || echo "Run 'claude' once after setup to log in."
fi

if [ "$dry" = yes ]; then
	if [ -d "$DIR/.git" ] && command -v bun >/dev/null; then
		echo "  would update Frog Hub in $DIR (git pull), then run its setup:"
		cd "$DIR"
		exec bun run setup --dry-run </dev/tty
	fi
	echo "  would fetch Frog Hub into $DIR, then run: bun run setup (it asks its questions then)"
	say "That's all; nothing was changed."
	exit 0
fi

# Every package that's new since the start, including the ones the installs above pulled in
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
