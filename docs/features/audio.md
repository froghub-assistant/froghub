# Radio, sounds and audio

`play_audio` and `stop_audio` play a sound, song or radio stream from an **https** link on the displays: the one that
asked, one by name, or all of them. It goes out like an announcement, so a scheduled job can do it too.

The server checks the link really is audio first. While it plays, the display shows the title with a stop button,
uses its own volume (turned down while someone talks to it), and stays quiet at night unless `at_night` is set.

Anything on the server can play audio as well:

```sh
curl -s 127.0.0.1:8790/local/announce -d '{"audio": "https://example.com/birdsong.mp3", "title": "Birdsong", "to": "Kitchen"}'
curl -s 127.0.0.1:8790/local/announce -d '{"stop_audio": true}'
```

## Radio

"Play Radio 1", "put on some jazz": `play_radio` finds a station by name or genre on
[radio-browser.info](https://www.radio-browser.info), a free, open directory of internet radio, and plays it like
`play_audio`. `country` (a two-letter code such as `GB`) prefers that country's stations.

The displays' page is https, so a station that's only http is tried over https first and, if it doesn't answer
there, relayed through the Frog Hub server (`/api/radio/<id>`, only ever for a station `play_radio` chose). HLS
stations, such as the BBC's, play through [hls.js](https://github.com/video-dev/hls.js), which the display only
loads when it needs it.

## Sound clips

"What does a humpback whale sound like?": `find_sound` searches [Wikimedia Commons](https://commons.wikimedia.org)
and, with an API key, [Freesound](https://freesound.org) at the same time, and lists clips with their length, credit
and licence. The assistant picks the one that fits and plays it with `play_audio`, credit and all. Commons' many
one-word pronunciation recordings are left out.

Commons needs no key. For Freesound, make a free account, apply for an API key at
[freesound.org/apiv2/apply](https://freesound.org/apiv2/apply) and give it to setup (it's kept in
`~/.config/froghub/freesound.key`; `FROGHUB_FREESOUND_KEY` overrides it).

Audio, radio and sound clips are all off with the grown-ups' "Play music" switch.

To play music by name on a speaker in the room (an Echo or a Music Assistant speaker), see
[Room devices and music](/features/devices-music#music-by-name).
