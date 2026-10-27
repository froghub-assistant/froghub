# Goodnight

Say "goodnight" (or "I'm going to bed") and Frog Hub says goodnight back. Once it has finished speaking, it:

- turns the room's lights off, or dims them, or leaves them be;
- keeps the screen dimmed and quiet until night mode ends in the morning (or until someone talks to it again);
- plays a sleep sound, rain, waves or white noise, which fades out over its last minute.

Ask for a bedtime story first and you'll get a short, gentle one. "Goodnight, can I have the sea sounds for an hour?"
picks the sound and the time for that night only.

## Settings

Each display has its own, under **Settings → 🌙 Goodnight**: what happens to the lights (and how dim), which sound and
for how long. **▶ Hear it** plays a few seconds of the sound. Night mode's hours, in the same Settings, decide when
the morning is.

The sleep sounds are made on the tablet itself, so they need no internet and never run out partway through.

The lights need the grown-ups' "See and control the room's devices" switch and the sound their "Play music" one;
with either off, the rest still happens.

## Every night at the same time

A [scheduled job](/features/announcements#scheduled-jobs) can do it: "every school night at half past seven, say
goodnight on the bedroom display". Or from the server, say from a Home Assistant automation:

```sh
curl -s 127.0.0.1:8790/local/announce -d '{"goodnight": true, "to": "Bedroom"}'
curl -s 127.0.0.1:8790/local/announce -d '{"goodnight": true, "to": "Bedroom", "sound": "waves", "minutes": 30, "say": "Bedtime!"}'
```

`sound` is `rain`, `waves`, `white noise` or `none`, and `minutes` is between 5 and 180; leave them out for the
display's own settings.

## Night mode

Every night, between the hours set in **Settings → Night mode** (9pm to 7am to begin with; every display shares them),
the screen dims and the frog looks sleepy. Announcements and audio are only shown, not said or played, unless they're
sent with `at_night`. Alarms still ring.
