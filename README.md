# Frog Hub

A homemade smart display (like an Echo Show / Nest Hub) for children's tablets (even old ones on Fire OS 5), with switchable personalities:
**Verity** (default), **Falsity**, **Lovity** and **Frog**.

## Installing it in another house

Needs a Linux computer that's always on (a Raspberry Pi 4 or 5 is plenty), [Bun](https://bun.sh), a web server with
HTTPS (browsers only allow the microphone over HTTPS; Caddy gets certificates for you), and ideally Home Assistant
and Docker for the voice. Then:

```sh
curl -fsSL https://raw.githubusercontent.com/froghub-assistant/froghub/master/install.sh | sh
```

`install.sh` works on Raspberry Pi OS, Debian and Ubuntu (apt) and on Fedora, RHEL, CentOS Stream, Rocky, Alma and Oracle Linux (dnf; it also
sets up firewalld and SELinux for Caddy). It installs git, Bun, Caddy, tmux and rsync (and, if you say yes, Docker or
Podman for the voice, and Claude Code), fetches Frog Hub
to `~/froghub`, then runs `bun run setup`. Already have it? `bun run setup` in the repo does the same questions.
To see what it would install and change first, without changing anything: `curl -fsSL … | sh -s -- --dry-run` (it asks
the same questions; if Frog Hub is already there, it goes on to setup's own `--dry-run`).

It asks for the site's address, Home Assistant's, the time zone, the children's names, a town for the weather, the
admin PIN and which brain to use, then:

- writes `~/.config/froghub/` (`instance.json`, `weather.json`, `pin`);
- installs the assistant as a systemd user service: **Claude Code** on Haiku with your Claude subscription
  (`setup/agent/` → `~/froghub-agent`, unit `froghub-agent`), or **standalone** (`channel/standalone.ts`: the
  Anthropic API and/or a local OpenAI-compatible model such as LM Studio; key in `~/.config/froghub/standalone.env`,
  rules in `~/.config/froghub/assistant.md`, unit `froghub-standalone`);
- builds the web app and copies it to the web root;
- adds a site block to `/etc/caddy/Caddyfile` (asks first, keeps a `.bak-froghub`) or prints it for you;
- starts the voice containers (`setup/voice/compose.yaml`: openWakeWord, Whisper, Piper) and, with a Home
  Assistant token it doesn't keep, adds them to HA and creates the four `Frog Hub · <Personality>` pipelines. Any of
  the three can be on another computer instead (Whisper on a faster PC, say): answer with its `host:port`, and setup
  offers to install it there over SSH (Docker or Podman too, if it has neither; files in `~/froghub-voice` there).
  `upgrade.sh` and `remove.sh` reach it the same way. Or run it there yourself, from a copy of this repo:
  `VOICE_BIND=0.0.0.0 docker compose -f setup/voice/compose.yaml up -d whisper`.

Run it again to change anything; each answer defaults to what's set now (`bun run setup --dry-run` asks the same questions and shows what it would do, changing nothing). The
assistant's rules (`CLAUDE.md` / `assistant.md`) are only replaced if you say so, since they're yours to tweak.
Then open the site on each tablet and follow the welcome.

**Updating:** `~/froghub/upgrade.sh` pulls the new code, rebuilds and publishes the web app, restarts the assistant if
its server changed and updates the voice containers, keeping every setting (`--no-voice` leaves the containers alone).
It asks nothing; it says when setup's templates changed, so you can run `bun run setup` again to use them.

**Removing:** `~/froghub/remove.sh` undoes setup: the assistant's service, the voice containers, the web app and the
Caddy block (a copy is kept as `.bak-froghub-remove`). It asks before each part. Your settings, the assistant's memory
and Frog Hub's own folder are only deleted if you say so. Then it offers to undo what `install.sh` added that wasn't
there before (it keeps a list in `~/.local/share/froghub/installed`): the packages, Bun, Claude Code, the PATH lines,
the docker group and the firewall and SELinux settings. Packages something else has come to need stay.

## How it fits together

```
Tablet (Fully Kiosk Browser or android/) ── https://<site> (Caddy on the server, ideally home network only)
  │  Svelte app: clock, weather, room buttons, animated face
  │
  ├─ HA WebSocket (non-admin token, from the welcome or the tablet's settings)
  │    pipeline "Frog Hub · <Personality>": openWakeWord ("hey jarvis") → Whisper → … → Piper voice
  │
  ├─ /api/ask → channel/server.ts (127.0.0.1:8790) → Frog Hub's own Claude Code session
  │    (Haiku, tmux "froghub", ~/froghub-agent: own CLAUDE.md + memory, no shell, no other MCP servers)
  │    replies with text + optional actions, which the app runs only for devices in its room
  │
  └─ /tts/* → HA tts_proxy (same origin, so the app can pitch-shift each personality's voice)
```

- Wake word and speech-to-text: one pipeline run (`wake_word` → `stt`), audio streamed as 16 kHz PCM.
- The answer: `POST /api/ask` with the text, personality, speaker name and the room's devices.
- Speech: a second pipeline run (`tts` only) with the personality's Piper voice, played back at its `pitch`.

## Where things are

| What | Where |
| --- | --- |
| Web app (this repo) | `./deploy.sh` builds and copies `dist/` to the web root (`webRoot` in `instance.json`, default `/var/www/froghub`) |
| Channel server | `channel/`, started by the agent session via `~/froghub-agent/mcp.json` |
| Assistant session | `~/froghub-agent/start`, user unit `froghub-agent.service`, `tmux -L froghub attach -t froghub` (its own tmux server) |
| Standalone assistant | instead of the session above: `channel/standalone.ts`, user unit `froghub-standalone.service` |
| Settings | `~/.config/froghub/` (`instance.json`, `weather.json`, `pin`, displays, alarms, policy) |
| Voice | `setup/voice/compose.yaml` (Docker, Wyoming: wake word 10400, Whisper 10300, Piper 10200) |
| Caddy site | your site's block in `/etc/caddy/Caddyfile` (see `bun run setup`) |

## Tests

`bun run test` runs the unit tests in `test/` (`channel/` for the server, `web/` for `src/lib`). They get a throwaway
HOME, so they never touch the real `~/.config/froghub`, and a fake `systemctl`, so they never restart the assistant.
A plain `bun test` refuses to run for that reason. Extra arguments go to `bun test`, e.g. `bun run test alarms`.

## Setting up a new display

A display with no Home Assistant token opens the welcome (`src/lib/Onboarding.svelte`): hello, connect (a grown-up's
PIN copies the connection and settings from the other Frog Hubs, or type HA's address and a token), pick a
personality, who it's for and which room, a microphone check, then confetti. Admin Settings has "✨ Show the welcome
again"; `?welcome` (or `?welcome=mic`, a step name) opens it on any display to try it out.

Two ways to connect without typing a token: **📱 Scan with a phone** shows a QR code of `<site>/admin/#pair=<code>`
(`channel/pair.ts`); a grown-up scans it, types the PIN on their phone and taps Pair it, and the display copies the
connection and settings. **🏠 Log in with Home Assistant** goes to HA's login page and comes back with a long-lived
token made just for that display (`src/lib/connect.js`; no setup in HA needed).

Home Assistant is optional ("Skip: use it without Home Assistant"). Without it there's no voice (wake word, speech
and replies all go through HA), room buttons or weather: typed questions are answered on screen, and alarms, 📢
messages and cards still work. Adding HA's address and token in Settings later turns the voice on.

Grown-ups displays: admin Settings → 🧑 Grown-ups display marks just that display (kept on the server by its device id)
so the assistant drops the kids' rules there (`audience="grown-ups"`, see `~/froghub-agent/CLAUDE.md`).

## Announcements (saying things without being asked)

Anything on the server can make every display speak up. `POST http://127.0.0.1:8790/local/announce`: Caddy only proxies
`/api/*`, so this isn't reachable from the network. The displays poll `GET /api/announcements` every 5 s, wait until
nobody is mid-conversation, then show and say it in their current personality's voice.

```sh
# exact words, optionally with a card (same fields as show_on_screen)
curl -s 127.0.0.1:8790/local/announce -d '{"say": "Dinner is ready!", "show": {"emoji": "🍝", "title": "Dinner!"}}'
# or let the assistant word it (it can add a card or room actions; waits for its reply, up to 45 s)
curl -s 127.0.0.1:8790/local/announce -d '{"prompt": "Tell Sam it is time to get ready for school, and show the weather"}'
```

Options: `to` (one display's name), `area` (only displays set to that room), `at_night: true` (speak during night hours too; otherwise
it's only shown, quietly), `personality` (for a prompt; default the shared one). Announcements over 10 minutes
old are dropped. From Home Assistant (host networking): a `rest_command` pointing at the same URL.

Displays can message each other too: the 📢 button (bottom left) sends typed text to every other display or one
of them, and the assistant has a `send_message` tool ("tell the kitchen I'm hungry"; policy switch `announce`).
Each display has a random id and a name (Settings → "This display's name", default its room's name), sent with
every poll, which is also how `GET /api/displays` knows which are on. The sender never shows its own message.

The assistant can speak up by itself as well: its `announce` tool says (and shows) something on one display or all of
them, and `schedule` sets up jobs for later or regularly ("every school day at 7:45, tell them to get their shoes on"):
a cron expression, a time or minutes from now, with exact words or a prompt it's given at the time (answered like an
announcement, so "tell them the weather for the walk" is worked out then). Jobs are kept in
`~/.config/froghub/schedule.json`, run in the house's time zone and survive restarts; at most 30, and a repeating one
at most 4 times an hour. `list_schedule` and `cancel_schedule` manage them. Both use the `announce` policy switch.

## Recipes

The assistant's `find_recipe` tool uses [TheMealDB](https://www.themealdb.com): a recipe by name, ideas by main
ingredient, category (Dessert, Vegetarian…) or cuisine (British, Indian…), or one at random. It can put the picture and
the ingredients on screen (`show_on_screen` accepts TheMealDB's pictures) and say the measures in grams and °C. It uses
TheMealDB's free key `1` (personal and educational use); set `FROGHUB_MEALDB_KEY` for your own. Claude Code brain only,
like the weather and alarms.

## Thinking harder, and a fresh start

The assistant is Haiku, which is quick. For what needs real thought (homework, a careful explanation, planning) it can
call `think_harder`, which hands that one question to a bigger model and puts the answer in its own words. The Claude
Code brain runs a one-shot, locked-down `claude -p` (no tools, no settings, no saved session; given 25 s); the API
brain re-asks the bigger model with the whole conversation. `FROGHUB_BIG_MODEL` picks it (default Sonnet; `none` turns
it off). On a subscription, Sonnet uses up the limits faster than Haiku.

The Claude Code brain's conversation is cleared (`/clear`, typed into its tmux) after 30 quiet minutes with no request
open (`FROGHUB_CLEAR_AFTER`, in minutes; 0 never), so old chat doesn't pile up; its memory files stay. The API brain
only ever keeps the last six exchanges of a conversation, which the display starts afresh after 5 quiet minutes.

## Admin page and app

`<site>/admin` (`admin/index.html`, `src/admin/`), behind the PIN: every Frog Hub that has ever checked
in (`channel/registry.ts`, `~/.config/froghub/displays.json`) with edit / show the welcome / wipe (erases its
localStorage and starts it again as a new display) / forget, plus announcements, alarms, what the assistant can use,
its memory files and the wake word recordings. Displays pick up queued changes on their next poll (5 s).

`android-admin/` wraps it as a phone app (`party.froghub.admin`, asks for the site on first start, minSdk 22 = Android 5.1, with the same Let's Encrypt check as the tablet app). Build it like the tablet app (`android-admin/build.sh`).

## Android app (instead of Fully Kiosk)

`android/` is a tiny app (`party.froghub`, minSdk 22 = Fire OS 5): a full-screen WebView that keeps the
screen on, plays sound without a tap, gives the mic to Frog Hub's own site only, stays on that site, retries every
10 s when the server is unreachable, and never closes on Back. **Five quick taps in the top-left corner** open its
settings (address, open on startup, exit). Debug it with `chrome://inspect` over adb.

Fire OS 5 doesn't trust Let's Encrypt's roots (ISRG Root X1/X2), so its WebView refuses sites using
them and shows a black page. The app bundles both roots (`res/raw/`) and, when the only error is "untrusted", checks the
site again itself (`IsrgTrust.java`: full chain against those roots, hostname, same certificate) before going ahead.
Its WebView is Chrome 59, which has no ES modules, so `vite.config.js` targets the legacy build at Chrome 59.

Build with `android/build.sh` on an x86 computer with the Android SDK (its build tools don't run on ARM). It signs
with that computer's debug key, so updates built there install over the old one.
It asks for Frog Hub's address on first start (or `adb shell am start -n party.froghub/.MainActivity -e url https://...`).

## Adding a personality

Add it to `src/lib/personalities.js`, to `PERSONALITIES` in `channel/server.ts`, describe it in
`~/froghub-agent/CLAUDE.md`, and create an HA pipeline `Frog Hub · <Name>` with its Piper voice.
