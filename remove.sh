#!/bin/sh
# Frog Hub remover: takes Frog Hub off this computer, undoing `bun run setup`. It asks before each part, and whatever
# you say no to stays.
#   ~/froghub/remove.sh            (--yes says yes to everything, including deleting your settings and Frog Hub itself)
# It removes the assistant's service, the voice containers, the web app and Frog Hub's block in the Caddy config, and,
# only if you say so, your settings, the assistant's memory and Frog Hub's own folder. Last, if you say so, it undoes
# what install.sh and setup added to the computer, as written down in ~/.local/share/froghub/installed: only what
# wasn't there before them (packages and what they pulled in, Bun, Claude Code, their lines in your shell's startup
# files, the docker group, firewall, SELinux and repository settings, folders). Packages something else has come to
# depend on since are left alone.
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
STATE=${XDG_DATA_HOME:-$HOME/.local/share}/froghub
MANIFEST=$STATE/installed
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
		sudo rm -f "$caddyfile.bak-froghub-remove"
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

# ---- what install.sh and setup added to the computer ----
# One line of the manifest per change. What's undone is dropped from it; anything left stays for another go.
if [ -s "$MANIFEST" ]; then
	list=$(awk '
		$1 == "pkg" { n++; if (n <= 8) names = names (n > 1 ? ", " : "") $2 }
		$1 == "bun" { print "  - Bun (~/.bun)" }
		$1 == "claude" { print "  - Claude Code (the program)" }
		$1 == "rc" { print "  - the lines its installers added to " $2 }
		$1 == "group" { print "  - you being in the " $2 " group" }
		$1 == "groupadd" { print "  - the " $2 " group" }
		$1 == "firewall" { fw = fw " " $2 }
		$1 == "sebool" { print "  - SELinux: " $2 " back off" }
		$1 == "repo" { print "  - the " $2 " repository, back off" }
		$1 == "service" { print "  - " $2 " starting at boot" }
		$1 == "file" { print "  - " $2 }
		$1 == "dir" { dirs++ }
		END {
			if (n) print "  - " n " packages: " names (n > 8 ? ", ..." : "")
			if (fw) print "  - the firewall openings for" fw
			if (dirs) print "  - " dirs " folders it made, if they are empty"
		}' "$MANIFEST")
	printf '\nWhat install.sh and setup added to this computer (only things that were not there before):\n%s\n' "$list"
	if ask "Undo all of that too?" N; then
		say "Undoing what install.sh added"
		keep=$(mktemp)
		kept() { echo "$1" >>"$keep"; }
		if command -v apt-get >/dev/null; then pm=apt; else pm=dnf; fi

		# lines added to shell startup files (before Bun goes: it may be what edits them)
		grep '^rc ' "$MANIFEST" | while read -r _ file added; do
			script='import os, sys
f, a = sys.argv[1:3]
text, add = open(f).read(), open(a).read()
if add not in text: sys.exit(1)
text = text.replace(add, "", 1)
if text.strip(): open(f, "w").write(text)
else: os.remove(f)'
			if [ ! -f "$file" ] || [ ! -f "$added" ]; then :
			elif command -v python3 >/dev/null && python3 -I -c "$script" "$file" "$added"; then :
			else kept "rc $file $added"; echo "Couldn't find what was added to $file any more; take it out by hand ($added)."
			fi
		done

		# settings, before the packages that provide their tools go
		while read -r kind what; do
			case "$kind" in
			sebool) sudo setsebool -P "$what" 0 || kept "$kind $what" ;;
			firewall) { sudo firewall-cmd -q --permanent --remove-service="$what" && reload_firewall=yes; } || kept "$kind $what" ;;
			repo) sudo dnf config-manager --set-disabled "$what" || kept "$kind $what" ;;
			service) sudo systemctl disable --now "$what" 2>/dev/null || true ;;
			group) ! id -nG "$USER" | grep -qw "$what" || sudo gpasswd -d "$USER" "$what" >/dev/null || kept "$kind $what" ;;
			esac
		done <"$MANIFEST"
		[ "${reload_firewall:-}" = yes ] && sudo firewall-cmd -q --reload

		# packages, only the ones still installed, and only if nothing else has come to need them. The system's own
		# (Essential, Priority required, or dnf's protected list) stay even if they arrived as something's dependency.
		protected=$(cat /etc/dnf/protected.d/*.conf 2>/dev/null || true)
		found=$(sed -n 's/^pkg //p' "$MANIFEST" | while read -r p; do
			if [ "$pm" = apt ]; then
				case "$(dpkg-query -W -f '${db:Status-Abbrev}|${Essential}|${Priority}|${Protected}' "$p" 2>/dev/null)" in
				ii*\|yes\|* | ii*\|required\|* | ii*\|yes) echo "system $p" ;;
				ii*) echo "$p" ;;
				esac
			else
				rpm -q "$p" >/dev/null 2>&1 || continue
				if printf '%s\n' "$protected" | grep -qxF "$p"; then echo "system $p"; else echo "$p"; fi
			fi
		done)
		system=$(printf '%s\n' "$found" | sed -n 's/^system //p')
		pkgs=$(printf '%s\n' "$found" | grep -v '^system ' || true)
		# If removing them would take (apt) or break (rpm) anything outside the list, that has come to need some of
		# them: keep what it needs and remove the rest, a few rounds until nothing outside is touched.
		held='' outside=''
		# the installed packages these need, all the way down
		needed_by() {
			# shellcheck disable=SC2068 # one word per package
			if [ "$pm" = apt ]; then
				apt-cache depends --recurse --installed --no-recommends --no-suggests --no-conflicts --no-breaks \
					--no-replaces --no-enhances $@ 2>/dev/null | grep -v '^ ' | tr -d '<>' | sed 's/:.*//'
			else
				dnf -q repoquery --installed --requires --resolve --recursive --qf '%{name}' $@ 2>/dev/null
			fi | sort -u
		}
		without() { printf '%s\n' "$pkgs" | awk -v drop="$1" 'BEGIN { split(drop, d, "\n"); for (i in d) skip[d[i]] = 1 }
			{ name = $0; sub(/:.*/, "", name) } !(name in skip)'; }
		# what the system's own need is part of the system now too: not ours to remove, or to remember
		[ -z "$system" ] || pkgs=$(without "$(needed_by $system)")
		for _ in 1 2 3 4 5 6; do
			[ -n "$pkgs" ] || break
			if [ "$pm" = apt ]; then
				# shellcheck disable=SC2086 # one word per package
				sim=$(apt-get -s purge $pkgs 2>/dev/null) || sim='Purg ?' # (can't plan it: keep them all)
				outside=$(printf '%s\n' "$sim" | sed -n 's/^Purg \([^ :]*\).*/\1/p' |
					grep -vxF "$(printf '%s\n' "$pkgs" | sed 's/:.*//')" | sort -u || true)
				[ -n "$outside" ] || break
			else
				# shellcheck disable=SC2086
				outside=$(rpm -e --test $pkgs 2>&1 | sed -n 's/.* is needed by (installed) //p' | sort -u)
				[ -n "$outside" ] || break
				outside=$(rpm -q --qf '%{NAME}\n' $outside | sort -u)
			fi
			needed=$(needed_by $outside)
			rest=$(without "$needed")
			[ "$rest" != "$pkgs" ] || rest= # can't tell what's needed: keep them all
			held="$held$(printf '%s\n' "$pkgs" | grep -vxF "${rest:-//}")
"
			pkgs=$rest
		done
		[ -z "$outside" ] || { held="$held$pkgs"; pkgs=; }
		if [ -n "$(printf '%s' "$held" | tr -d '\n')" ]; then
			echo "Kept $(printf '%s' "$held" | grep -c .) packages that other things here now need."
			printf '%s\n' "$held" | while read -r p; do [ -z "$p" ] || kept "pkg $p"; done
		fi
		if [ -n "$pkgs" ]; then
			say "Removing $(printf '%s\n' "$pkgs" | wc -l) packages"
			# shellcheck disable=SC2086
			if [ "$pm" = apt ]; then sudo apt-get purge -y -qq $pkgs; else sudo rpm -e $pkgs; fi ||
				printf '%s\n' "$pkgs" | while read -r p; do kept "pkg $p"; done
		fi

		while read -r kind what; do
			case "$kind" in
			groupadd)
				if getent group "$what" >/dev/null; then
					if [ -n "$(getent group "$what" | cut -d: -f4)" ] || ! sudo groupdel "$what"; then kept "$kind $what"; fi
				fi
				;;
			bun) rm -rf "$HOME/.bun" ;;
			claude) rm -rf "$HOME/.local/bin/claude" "$HOME/.local/share/claude" ;;
			claude-home)
				if [ -e "$HOME/.claude" ] || [ -e "$HOME/.claude.json" ]; then
					if ask "Also delete Claude Code's settings and login (~/.claude), including any assistant memory and conversations in it?" N; then
						rm -rf "$HOME/.claude" "$HOME/.claude.json"
					else kept "$kind"; fi
				fi
				;;
			file) sudo rm -f "$what" ;;
			esac
		done <"$MANIFEST"

		# folders last, innermost first, and only empty ones (the manifest's own folder included, once nothing's kept)
		dirs=$(sed -n 's/^dir //p' "$MANIFEST" | sort -r)
		if [ ! -s "$keep" ]; then
			rm -f "$MANIFEST" "$STATE"/rc-added*
		else
			mv "$keep" "$MANIFEST"
		fi
		printf '%s\n' "$dirs" | while read -r d; do
			[ -n "$d" ] && [ -d "$d" ] || continue
			rmdir "$d" 2>/dev/null || sudo rmdir "$d" 2>/dev/null || { [ -f "$MANIFEST" ] && echo "dir $d" >>"$MANIFEST"; }
		done
		rm -f "$keep"
	fi
fi

say "Done 🐸"
cat <<EOF
Left for you to tidy up, if you want:
  - In Home Assistant: the "Frog Hub · ..." voice assistants (Settings → Voice assistants), and the Wyoming
    integrations for ports 10400, 10300 and 10200 if setup added them.
  - The Frog Hub app or kiosk browser on each tablet.
EOF
if [ -s "$MANIFEST" ]; then echo "  - What install.sh added that's still here (listed in $MANIFEST; run this again to undo it)."; fi
