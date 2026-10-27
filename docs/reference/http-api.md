# HTTP API

Both brains serve the same API on `127.0.0.1:8790` (`FROGHUB_PORT`). Caddy passes `/api/*` on to it from your site;
`/local/*` is only reachable from the server itself.

**Admin only** routes need an `X-Admin-Token` header: `POST /api/admin/unlock {"pin": "1234"}` returns one, and it
expires after a while. Too many wrong PINs lock it for a few minutes.

## Asking

| Route | What it does |
| --- | --- |
| `POST /api/ask` | A question from a display: `{text, personality, speaker, device, conversation_id, devices}`. Returns `{text, continue_conversation, actions, display?}` |
| `POST /api/admin/remember` | The admin page asking the assistant to remember, change or forget something: `{text}`. Admin only |

## Announcements and displays

| Route | What it does |
| --- | --- |
| `POST /local/announce` | Say something on the displays: `{say, show?}`, `{prompt}`, `{audio, title?}` or `{stop_audio: true}`, with optional `to`, `area`, `at_night`, `personality`. See [Announcements](/features/announcements) |
| `POST /api/announce` | A display's 📢 message: `{text, to?, device, name}` |
| `POST /api/admin/announce` | An announcement from the admin page. Admin only |
| `GET /api/announcements?after=&device=&name=&area=` | Each display's poll (every 5 s): new announcements, plus anything queued for it as `command` |
| `GET /api/displays` | The displays that are on |
| `GET /api/admin/displays` | Every display that has ever checked in. Admin only |
| `POST /api/admin/displays` | `{id, action: wipe \| welcome \| forget \| cancel \| set, set?}`. Admin only |

## Alarms

| Route | What it does |
| --- | --- |
| `GET /api/alarms` | The alarms and timers |
| `POST /api/alarms/done` | Stop a ringing one: `{id}` |
| `POST /api/alarms/snooze` | Snooze a ringing one for 9 minutes: `{id}` |
| `POST /api/alarms/manage` | `{tool: set_alarm \| set_timer \| cancel_alarm, args}`, with the same rules as the assistant's tools. Admin only |

## Settings and policy

| Route | What it does |
| --- | --- |
| `GET /api/instance` | The house: `{site, haUrl, timeZone, kids}` |
| `GET /api/policy` / `POST` | What the assistant may use. Posting is admin only |
| `GET /api/settings` / `POST` | Settings shared by every display (the Home Assistant token only with `X-Admin-Token`). Posting is admin only |
| `GET /api/audience?device=` / `POST {device, grownUps}` | Whether a display is a grown-ups' one. Posting is admin only |

## Pairing

| Route | What it does |
| --- | --- |
| `POST /api/pair` | A new pairing code for a display's QR code: `{code}` |
| `GET /api/pair?code=` | `{waiting: true}` until a grown-up approves it, then the shared settings and token, once |
| `POST /api/admin/pair {code}` | Approve it. Admin only |

## Admin

| Route | What it does |
| --- | --- |
| `POST /api/admin/unlock {pin}` | An admin token |
| `GET /api/admin/check` | `{admin}`: whether the token is still good |
| `POST /api/admin/lock` | End admin mode |
| `GET /api/admin/memory` | The assistant's memory files: `[{file, text, modified}]`. Admin only |
| `GET /api/admin/history?before=&limit=` | The [History](/guide/grown-ups#history), newest first: `{items, more}`. Admin only |
| `POST /api/admin/history {clear: true}` | Clear it. Admin only |
| `POST /api/wakeword/sample?kind=wake\|other&speaker=` | A wake word recording (raw 16-bit 16 kHz mono PCM). Admin only |
| `GET /api/wakeword/counts` | How many recordings there are. Admin only |
| `GET /api/ping` | Whether the server is up |
