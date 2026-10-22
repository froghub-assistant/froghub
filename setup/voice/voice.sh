#!/bin/sh
# Runs Frog Hub's voice containers on a computer that isn't Frog Hub's own. Setup copies this and compose.yaml to
# ~/froghub-voice there and runs it over SSH; upgrade.sh and remove.sh do too.
#   sh voice.sh engine               install Docker (apt) or Podman (dnf) if neither is here
#   sh voice.sh up <bind> <service>…  start or update them (openwakeword, whisper, piper) on address <bind>
#   sh voice.sh down <service>…       remove them, their images and their data
set -eu
cd "$(dirname "$0")"

# Finds the compose command ($c), its engine ($engine) and whether they need sudo ($s)
compose() {
	s=''
	if command -v docker >/dev/null; then
		engine=docker
		if docker compose version >/dev/null 2>&1; then c="docker compose"
		elif command -v docker-compose >/dev/null; then c=docker-compose
		else return 1
		fi
		docker info >/dev/null 2>&1 || s=sudo # (the docker group isn't active until you log in again)
	elif command -v podman-compose >/dev/null; then
		c=podman-compose engine=podman
	else
		return 1
	fi
}

action=${1:-}
[ $# -gt 0 ] && shift
case "$action" in
engine)
	if compose; then echo "Already has $c."; exit 0; fi
	if command -v apt-get >/dev/null; then
		sudo apt-get update -qq
		sudo apt-get install -y -qq docker.io docker-compose
		sudo usermod -aG docker "$USER"
	elif command -v dnf >/dev/null; then
		sudo dnf install -y -q podman podman-compose iptables-nft # (by name, or EPEL's iptables-legacy can win)
	else
		echo "Install Docker (with compose) or podman-compose here by hand, then run setup again."
		exit 1
	fi
	;;
up)
	bind=$1
	shift
	compose || { echo "No Docker or podman-compose here."; exit 1; }
	$s $c -f compose.yaml pull "$@"
	$s env VOICE_BIND="$bind" $c -f compose.yaml up -d "$@"
	;;
down)
	compose || exit 0
	for service in "$@"; do
		$s $engine rm -f "froghub-$service" >/dev/null 2>&1 || true
		$s $engine rmi "docker.io/rhasspy/wyoming-$service:latest" >/dev/null 2>&1 || true
		rm -rf "data/$service" 2>/dev/null || sudo rm -rf "data/$service"
		echo "Removed $service."
	done
	# The last one gone: its network (and podman's pod), then this folder too
	if ! $s $engine ps -a --format '{{.Names}}' 2>/dev/null | grep -q '^froghub-'; then
		$s $c -f compose.yaml down >/dev/null 2>&1 || true
		here=$(pwd)
		cd ..
		rm -rf "$here" 2>/dev/null || sudo rm -rf "$here"
	fi
	;;
*)
	echo "Usage: sh voice.sh engine | up <bind address> <service>... | down <service>..."
	exit 1
	;;
esac
