# Room devices and music

## The room's devices

Each display belongs to a room (a Home Assistant area). Its buttons show the room's lights, switches, fans and media
players, and the assistant can control **only those**: each request carries the room's devices, and the display only
carries out actions on them.

| Action | For | With |
| --- | --- | --- |
| `turn_on`, `turn_off`, `toggle` | lights, switches, fans | |
| `brightness` | lights | `value` 0–100 |
| `media_play_pause`, `media_next_track` | media players | |
| `volume` | media players | `value` 0–100 |
| `play_music` | speakers that play music by name | `query`, what to play |

Off with the grown-ups' "See and control the room's devices" switch.

## Music by name

"Play Sandstorm", "put on some relaxing piano", "play the Frozen soundtrack": `play_music` goes to a speaker in the
display's room.

- **An Echo** (Home Assistant's [Alexa Devices](https://www.home-assistant.io/integrations/alexa_devices/) integration)
  is told to play it from Spotify, by voice command, so it works without Spotify Premium.
- **A [Music Assistant](https://www.music-assistant.io/) player** gets `music_assistant.play_media`, which searches
  the music services you've added to Music Assistant for the best match.

The display marks such speakers "plays music by name" in the device list it sends, so the assistant knows where
`play_music` works. Speech-to-text often mishears song names ("Place and Storm" for "play Sandstorm"), so the
assistant makes its best guess and plays it, and they can just ask again.

Off with the grown-ups' "Play music" switch.

::: tip The speaker has to be in the room
A display only controls its own room's devices. To play music from the living room's display on a Music Assistant
speaker, put that speaker's device in the living room area in Home Assistant.
:::

To play a sound or a stream on the displays themselves, see [Playing audio](/features/audio).
