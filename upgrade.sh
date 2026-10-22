#!/bin/sh
# Frog Hub upgrader: brings this computer's Frog Hub up to date, keeping your settings (~/.config/froghub). Nothing is
# asked; to change your answers (the assistant, the PIN, Home Assistant, ...) run `bun run setup` instead.
#   ~/froghub/upgrade.sh
#   curl -fsSL https://raw.githubusercontent.com/froghub-assistant/froghub/master/upgrade.sh | sh
# Pulls the new code, rebuilds and publishes the web app, restarts the assistant if its server changed, and updates
# the voice containers (--no-voice leaves them alone). --force does it all even when there's no new code.
set -eu

# The voice services setup installed on other computers over SSH, one "target bind service" line each
remote_voice() {
	[ -f "$HOME/.config/froghub/instance.json" ] && command -v bun >/dev/null || return 0
	bun -e 'const i = await Bun.file(process.argv.at(-1)).json()
for (const [k, v] of Object.entries(i.voiceSsh || {})) console.log(v.ssh, v.bind, k)' "$HOME/.config/froghub/instance.json"
}
# ssh with a terminal when there is one (for sudo's password there)
ssh_tty() { if (: </dev/tty) 2>/dev/null; then ssh -t "$@" </dev/tty; else ssh "$@" </dev/null; fi; }

say() { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail() { printf '%s\n' "$*" >&2; exit 1; }

voice=yes
force=no
for arg in "$@"; do
	case "$arg" in
	--no-voice) voice=no ;;
	--force) force=yes ;;
	*) fail "Unknown option: $arg (try --no-voice or --force)" ;;
	esac
done

[ "$(id -u)" -eq 0 ] && fail "Run this as your normal user, not root (it uses sudo where needed)."
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"

# The Frog Hub this script is in, else FROGHUB_DIR or ~/froghub (as install.sh uses)
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || here=
if [ -n "$here" ] && [ -f "$here/setup/setup.ts" ]; then DIR=$here; else DIR=${FROGHUB_DIR:-$HOME/froghub}; fi
[ -d "$DIR/.git" ] || fail "There's no Frog Hub in $DIR. Install it with install.sh (see the README), or set FROGHUB_DIR."
[ -f "$HOME/.config/froghub/instance.json" ] || fail "Frog Hub isn't set up yet: cd $DIR && bun run setup"
command -v bun >/dev/null || fail "Bun isn't installed (install.sh installs it)."
cd "$DIR"
git diff --quiet HEAD || fail "$DIR has changes of your own (git status shows them). Commit or stash them, then run this again."

say "🐸 Fetching the latest Frog Hub"
old=$(git rev-parse HEAD)
git pull --ff-only
new=$(git rev-parse HEAD)
[ "$old" = "$new" ] || git log --oneline --no-decorate "$old..$new"
changed() { [ "$force" = yes ] || ! git diff --quiet "$old" "$new" -- "$@"; }

if changed .; then
	say "Rebuilding the web app"
	bun install --no-summary
	(cd channel && bun install --no-summary)
	./deploy.sh

	if changed channel setup/agent; then
		for unit in froghub-agent froghub-standalone; do
			if systemctl --user is-enabled -q "$unit" 2>/dev/null; then
				say "Restarting the assistant ($unit)"
				systemctl --user restart "$unit"
			fi
		done
	fi
	if [ "$old" != "$new" ] && ! git diff --quiet "$old" "$new" -- setup/agent setup/standalone setup/voice/pipelines.json; then
		echo
		echo "Setup's templates changed too. To use them, run: cd $DIR && bun run setup (Enter keeps each answer)."
	fi
fi

# The voice containers, if setup started them: newer images, on the same address Home Assistant reaches them on
if [ "$voice" = yes ]; then
	sudo=
	if command -v docker >/dev/null; then
		engine=docker
		docker info >/dev/null 2>&1 || sudo=sudo # just after install.sh, the docker group isn't active yet
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
	# only the ones running here (any of them can be on another computer instead)
	services='' bind=''
	for service in openwakeword:10400 whisper:10300 piper:10200; do
		name=${service%:*}
		if [ -n "$compose" ] && $sudo $engine container inspect "froghub-$name" >/dev/null 2>&1; then
			services="$services $name"
			[ -n "$bind" ] || bind=$($sudo $engine port "froghub-$name" "${service#*:}" | head -n 1)
		fi
	done
	if [ -n "$services" ]; then
		bind=${bind%:*}
		say "Updating the voice containers"
		$sudo env VOICE_BIND="${bind:-127.0.0.1}" $compose -f setup/voice/compose.yaml pull $services
		$sudo env VOICE_BIND="${bind:-127.0.0.1}" $compose -f setup/voice/compose.yaml up -d $services
	fi
	remote_voice | while read -r target bind service; do
		say "Updating $service on $target"
		copied=yes
		# shellcheck disable=SC2029 # $f is meant to expand here
		for f in compose.yaml voice.sh; do ssh "$target" "mkdir -p froghub-voice && cat > froghub-voice/$f" <"setup/voice/$f" || copied=no; done
		[ "$copied" = yes ] && ssh_tty "$target" sh froghub-voice/voice.sh up "$bind" "$service" || echo "(Couldn't update $service on $target.)"
	done
fi

say "Done 🐸"
