# Announcements and schedules

## Messages between displays

Displays can message each other. The megaphone button (bottom left) sends typed text to every other display or one of them,
and the assistant has a `send_message` tool ("tell the kitchen I'm hungry"). The sender never shows its own message.

## Announcements

Anything on the server can make the displays speak up: the assistant, a script, or a Home Assistant automation. The
displays check every 5 seconds, wait until nobody is mid-conversation, then show and say it in their current
personality's voice.

```sh
# exact words, optionally with a card (same fields as show_on_screen)
curl -s 127.0.0.1:8790/local/announce -d '{"say": "Dinner is ready!", "show": {"emoji": "🍝", "title": "Dinner!"}}'
# or let the assistant word it (it can add a card or room actions; waits for its reply, up to 45 s)
curl -s 127.0.0.1:8790/local/announce -d '{"prompt": "Tell Sam it is time to get ready for school, and show the weather"}'
```

| Option | Meaning |
| --- | --- |
| `to` | one display's name |
| `area` | only displays set to that room |
| `at_night: true` | speak during night hours too (otherwise it's only shown, quietly) |
| `personality` | for a prompt; by default the shared one |

Announcements over 10 minutes old are dropped. `/local/announce` is only reachable on the server itself (Caddy only
passes on `/api/*`). From Home Assistant (with host networking), use a `rest_command` pointing at the same URL:

```yaml
rest_command:
  froghub_announce:
    url: http://127.0.0.1:8790/local/announce
    method: POST
    content_type: application/json
    payload: '{"say": "{{ text }}"}'
```

The assistant's own `announce` tool does the same, for one display or all of them.

## Scheduled jobs

`schedule` sets up jobs for later or for regularly: "every school day at 7:45, tell them to get their shoes on". A job
has a cron expression, a time or minutes from now, and either exact words or a prompt given to the assistant at the
time. A prompt is answered like an announcement, so "tell them the weather for the walk" is worked out then.

Jobs are kept in `~/.config/froghub/schedule.json`, run in the house's time zone and survive restarts. There can be at
most 30, and a repeating one runs at most 4 times an hour. `list_schedule` and `cancel_schedule` manage them.

Messages, announcements and schedules are all off with the grown-ups' "Pass messages on to the other Frog Hubs"
switch.
