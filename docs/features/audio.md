# Playing audio

`play_audio` and `stop_audio` play a sound, song or radio stream from an **https** link on the displays: the one that
asked, one by name, or all of them. It goes out like an announcement, so a scheduled job can do it too.

The server checks the link really is audio first. While it plays, the display shows 🎵 with the title and a ⏹ button,
uses its own volume (turned down while someone talks to it), and stays quiet at night unless `at_night` is set.

Anything on the server can play audio as well:

```sh
curl -s 127.0.0.1:8790/local/announce -d '{"audio": "https://example.com/birdsong.mp3", "title": "Birdsong", "to": "Kitchen"}'
curl -s 127.0.0.1:8790/local/announce -d '{"stop_audio": true}'
```

Off with the grown-ups' "Play music" switch.

To play music by name on a speaker in the room (an Echo or a Music Assistant speaker), see
[Room devices and music](/features/devices-music#music-by-name).
