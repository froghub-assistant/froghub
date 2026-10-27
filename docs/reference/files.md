# Files and settings

## Where things are

| What | Where |
| --- | --- |
| Frog Hub itself | `~/froghub` (the repo) |
| Web app | `./deploy.sh` builds it and copies `dist/` to the web root (`webRoot` in `instance.json`, by default `/var/www/froghub`) |
| Server | `channel/`, started by the assistant's session via `~/froghub-agent/mcp.json` (Claude Code) |
| Claude Code brain | `~/froghub-agent/start`, user unit `froghub-agent.service`, its own tmux server: `tmux -L froghub attach -t froghub` |
| API brain | `channel/standalone.ts`, user unit `froghub-standalone.service` |
| Voice | `setup/voice/compose.yaml` (Docker or Podman) |
| Caddy site | your site's block in `/etc/caddy/Caddyfile` |

## `~/.config/froghub/`

| File | What's in it |
| --- | --- |
| `instance.json` | The house: site, Home Assistant's address, time zone, children's names, web root |
| `weather.json` | Where the weather is for |
| `pin` | The admin PIN, hashed. Change it with `bun channel/set-pin.ts` |
| `policy.json` | The grown-ups' switches |
| `displays.json` | Every display that has checked in |
| `alarms.json` | Alarms and timers |
| `schedule.json` | Scheduled jobs |
| `history.jsonl` | The History log (owner-only; the newest 1,000) |
| `recipeapi.key` | The recipeapi.io key |
| `standalone.env` | The API brain's keys and settings (see [Environment variables](/reference/env)) |
| `assistant.md` | The API brain's rules, yours to tweak |
| `memory.md` | The API brain's memory |

The Claude Code brain's rules are `~/froghub-agent/CLAUDE.md`, also yours to tweak, and its memory is in its own
folder. Setup only replaces either set of rules if you say so.
