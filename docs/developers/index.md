# Working on Frog Hub

## The code

| Folder | What's there |
| --- | --- |
| `src/` | The display's web app (Svelte 5): `App.svelte`, and `src/lib/` for the voice, settings, the welcome, cards and the audio player |
| `src/admin/`, `admin/` | The admin page |
| `src/demo/`, `demo/` | [The demo](/demo/){target="_self"}: the display with a pretend server and Home Assistant, built with `vite build --mode demo` into `docs/public/demo` |
| `channel/` | The server: the HTTP API (`app.ts`), the Claude Code channel (`server.ts`), the API brain (`standalone.ts`) and a file per tool |
| `setup/` | `setup.ts`, the Claude Code brain's template (`agent/`), the API brain's (`standalone/`) and the voice containers (`voice/`) |
| `android/`, `android-admin/` | [The Android apps](/developers/android) |
| `test/` | Unit tests: `channel/` for the server, `web/` for `src/lib` |
| `docs/` | This site (VitePress) |

Run the display locally with `bun run dev`, and build it with `bun run build` (`./deploy.sh` builds and publishes it).

## Tests

```sh
bun run test            # all of them
bun run test alarms     # extra arguments go to bun test
```

The tests get a throwaway HOME, so they never touch the real `~/.config/froghub`, and a fake `systemctl`, so they
never restart the assistant. A plain `bun test` refuses to run for that reason.

## Adding a tool

Tools live in `channel/`, one file each, and are the same for both brains:

1. Write the tool in its own file: a `Tool` (name, description, JSON schema) and a function that runs it and returns
   the text for the assistant, throwing an `Error` with a message the assistant can pass on when it fails.
2. Add it to the list in `tools()` and to `runTool()` in `channel/tools.ts`, behind the grown-ups' switch that fits.
3. Allow it in the Claude Code brain's `setup/agent/settings.json` (`mcp__froghub__<name>`).
4. Mention it in the assistant's rules (`setup/agent/CLAUDE.md` and `setup/standalone/assistant.md`) if it needs
   explaining, and on this site.
5. Add tests in `test/channel/`.

## Adding a personality

Add it to `src/lib/personalities.js` and to `PERSONALITIES` in `channel/common.ts`, describe it in the assistant's
rules (`CLAUDE.md` or `assistant.md`), and create a Home Assistant pipeline `Frog Hub · <Name>` with its Piper voice.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org), with a scope where one fits:

`install` · `upgrade` · `remove` · `setup` · `voice` · `channel` · `web` · `test` · `docs`

For example `feat(channel): a wikidata tool for exact facts` or `fix(web): keep the card's buttons in view`.

## This site

```sh
cd docs
bun install
bun run dev     # http://localhost:5173
```

Pages are Markdown in `docs/`. Each push to `master` that changes `docs/` rebuilds the site and publishes it to
[froghub-assistant.github.io](https://froghub-assistant.github.io).
