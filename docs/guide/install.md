# Installing

## What you need

- A Linux computer that's always on. A Raspberry Pi 4 or 5 is plenty.
- [Bun](https://bun.sh) (the installer adds it).
- A web server with HTTPS. Browsers only allow the microphone over HTTPS; [Caddy](https://caddyserver.com) gets
  certificates for you, and the installer can set it up.
- Ideally [Home Assistant](https://www.home-assistant.io), and Docker or Podman for the voice. Without Home Assistant
  there's no voice, but [typed questions still work](/guide/displays#without-home-assistant).
- A brain: [Claude Code](https://claude.com/claude-code) on your Claude subscription, or a model API (Anthropic, or
  an OpenAI-compatible one such as LM Studio, Ollama or OpenAI).

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/froghub-assistant/froghub/master/install.sh | sh
```

`install.sh` works on Raspberry Pi OS, Debian and Ubuntu (apt), and on Fedora, RHEL, CentOS Stream, Rocky, Alma and
Oracle Linux (dnf; it also sets up firewalld and SELinux for Caddy). It installs git, Bun, Caddy, tmux and rsync (and,
if you say yes, Docker or Podman for the voice, and Claude Code), fetches Frog Hub to `~/froghub`, then runs
`bun run setup`.

Already have it? `bun run setup` in the repo asks the same questions.

::: tip See what it would do first
`curl -fsSL … | sh -s -- --dry-run` asks the same questions and shows what it would install and change, without
changing anything. If Frog Hub is already there, it goes on to setup's own `--dry-run`.
:::

## What setup asks, and does

It asks for the site's address, Home Assistant's, the time zone, the children's names, a town for the weather, the
admin PIN and which brain to use. Then it:

- writes `~/.config/froghub/` (`instance.json`, `weather.json`, `pin`);
- installs the assistant as a systemd user service, either
  - **Claude Code** on Haiku with your Claude subscription (`setup/agent/` → `~/froghub-agent`, unit `froghub-agent`), or
  - **standalone**, the API brain (`channel/standalone.ts`: the Anthropic API and/or an OpenAI-compatible one; keys in
    `~/.config/froghub/standalone.env`, rules in `~/.config/froghub/assistant.md`, unit `froghub-standalone`).

  Both serve the same [HTTP API](/reference/http-api) and have the same tools;
- asks for a [recipeapi.io](/features/recipes) key and a [Freesound](/features/audio#sound-clips) key (both optional);
- builds the web app and copies it to the web root;
- adds a site block to `/etc/caddy/Caddyfile` (it asks first and keeps a `.bak-froghub`) or prints it for you;
- starts the voice containers (`setup/voice/compose.yaml`: openWakeWord, Whisper and Piper) and, with a Home Assistant
  token it doesn't keep, adds them to Home Assistant and creates the four `Frog Hub · <Personality>` pipelines.

### Voice on another computer

Any of the three voice services can run on another computer instead (Whisper on a faster PC, say): answer with its
`host:port`, and setup offers to install it there over SSH (Docker or Podman too, if it has neither; its files go in
`~/froghub-voice` there). `upgrade.sh` and `remove.sh` reach it the same way. Or run it there yourself, from a copy of
the repo:

```sh
VOICE_BIND=0.0.0.0 docker compose -f setup/voice/compose.yaml up -d whisper
```

## Changing things later

Run `bun run setup` again: each answer defaults to what's set now, and `bun run setup --dry-run` shows what it would
do without changing anything. The assistant's rules (`CLAUDE.md` or `assistant.md`) are only replaced if you say so,
since they're yours to tweak.

Then open the site on each tablet and follow the welcome: see [Setting up a display](/guide/displays).
