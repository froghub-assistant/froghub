# Frog Hub

A homemade smart display (like an Echo Show / Nest Hub) for children's tablets (even old ones on Fire OS 5), with switchable personalities:
**Verity** (default), **Falsity**, **Lovity** and **Frog**.

**📖 Documentation: [froghub-assistant.github.io](https://froghub-assistant.github.io)**

- Talk to it: wake word, speech-to-text and voices run at home through Home Assistant.
- It runs the room: lights, switches, fans and speakers in the display's own room, and music by name on an Echo or a
  Music Assistant speaker.
- Alarms, timers, messages between displays, announcements and scheduled jobs.
- Recipes, exact sums and unit conversions, Wikipedia and Wikidata, with cards and pictures on the screen.
- Grown-ups decide: a PIN-protected admin page, and switches for everything the assistant may use.
- Your own server (a Raspberry Pi is plenty) and your own brain: Claude Code on your Claude subscription, or a model
  API (Anthropic, or an OpenAI-compatible one such as LM Studio, Ollama or OpenAI).

## Installing

On a Linux computer that's always on (Raspberry Pi OS, Debian, Ubuntu, Fedora or the RHEL family):

```sh
curl -fsSL https://raw.githubusercontent.com/froghub-assistant/froghub/master/install.sh | sh
```

It installs what it needs, fetches Frog Hub to `~/froghub` and asks a few questions. Add `-s -- --dry-run` after `sh`
to see what it would do first. Then open the site on each tablet and follow the welcome.

`~/froghub/upgrade.sh` updates it, keeping every setting, and `~/froghub/remove.sh` takes it away again. See
[Installing](https://froghub-assistant.github.io/guide/install) for the details.

## Working on it

`bun run dev` runs the display locally, `bun run test` the tests. The docs are in `docs/` (VitePress: `cd docs && bun
install && bun run dev`) and are published on each push. See
[Working on Frog Hub](https://froghub-assistant.github.io/developers/).

## Licence

MIT: see [LICENCE.md](LICENCE.md).
