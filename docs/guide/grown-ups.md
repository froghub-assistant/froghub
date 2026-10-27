# Grown-ups' settings

## The admin page

`<your site>/admin`, behind the PIN. It has:

- **Displays:** every Frog Hub that has ever checked in, with edit (name, room, mic, volume), show the welcome,
  wipe (erases its storage and starts it again as a new display) and forget. Displays pick up changes on their next
  poll, within 5 seconds.
- **Announcements and alarms:** say something on the displays now, and see or cancel alarms and timers.
- **Assistant:** what the assistant may use (below), and which [lists](/features/lists) it may use.
- **Memory:** the assistant's memory files, and asking it to remember or forget something.
- **History:** what it was asked and what it answered.
- **Voices:** the wake word recordings.

There's a phone app for it too: see [the Android apps](/developers/android).

## What the assistant may use

Each switch applies to both brains:

| Switch | What it allows |
| --- | --- |
| Look things up online | Web search, the dictionary, Wikipedia and Wikidata |
| Remember things between conversations | Its memory |
| Check the weather | The weather |
| Set alarms and timers | Alarms and timers |
| See and control the room's devices | Lights, switches, fans and speakers in the display's room |
| Play music | Music on the room's speakers, and radio, sound clips and audio links on the displays |
| Know who it's talking to | The name of whoever the display is for |
| Show cards and pictures on the screen | Cards, pictures and recipes on screen |
| Pass messages on to the other Frog Hubs | Messages, announcements and scheduled jobs |
| Keep a log of questions and answers | The History tab (off by default) |
| Read and change the shared to-do and shopping lists | [Lists](/features/lists), only the ones you share |
| Find recipes on recipeapi.io | recipeapi.io rather than TheMealDB, when there's a key |

When something is switched off, the assistant is told, so it can say so kindly if asked.

## History

**History** lists everything the assistant was asked and what it answered, newest first: questions at the displays
(which one, who, and what it did or showed), the admin page's memory requests, announcements and scheduled jobs, and
any that got no answer in time. It can be searched and cleared there.

It's **off by default**: switch it on on that tab or the Assistant tab. Switching it off keeps what's there until
it's cleared (you're asked whether to clear it). While it's on, the assistant can search it too ("what was that
recipe yesterday?"), apart from what grown-ups asked in admin mode or from the admin page.

It's kept in `~/.config/froghub/history.jsonl`, readable only by Frog Hub's user, and only the newest 1,000 are kept.

## Admin mode on a display

Typing the PIN on a display (the gear button) unlocks admin mode there for a while, checked on the server, so nobody gets it by
saying they're a grown-up. In admin mode the assistant may also say what it remembers and change or delete memories
(otherwise it only adds new ones), save **house rules** ("bedtime is 8pm on school nights", "no scary stories") and
follow them afterwards even if a child asks otherwise, and talk plainly about how the display works.
