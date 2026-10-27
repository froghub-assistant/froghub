# How it fits together

```
Tablet (Fully Kiosk Browser or the Android app) ── https://<site> (Caddy on the server, ideally home network only)
  │  Svelte app: clock, weather, room buttons, animated face
  │
  ├─ Home Assistant WebSocket (a non-admin token, from the welcome or the tablet's settings)
  │    pipeline "Frog Hub · <Personality>": openWakeWord ("hey jarvis") → Whisper → … → Piper voice
  │
  ├─ /api/ask → the Frog Hub server (127.0.0.1:8790) → the brain
  │    Claude Code: Haiku in its own session (~/froghub-agent: its own CLAUDE.md and memory, no shell, no other MCP servers)
  │    or the API brain: the Anthropic API and/or an OpenAI-compatible one
  │    replies with text and optional actions, which the display runs only for devices in its room
  │
  └─ /tts/* → Home Assistant's tts_proxy (same origin, so the app can pitch-shift each personality's voice)
```

- **The display** is a web app (Svelte). It talks to Home Assistant directly, with its own token, for the voice and the
  room's devices, and to the Frog Hub server for everything else. The server only talks to Home Assistant for the
  [lists](/features/lists), with the token the displays share.
- **The server** (`channel/`) serves the [HTTP API](/reference/http-api) and the assistant's tools, and keeps alarms,
  announcements, schedules, the displays' registry and the settings in `~/.config/froghub/`.
- **The brain** answers. With Claude Code, the server is an MCP channel of a long-running Claude Code session, which
  replies through a `reply` tool. With the API brain (`channel/standalone.ts`), the server calls the model itself. The
  display can't tell the difference.
- **The voice** runs in three containers (`setup/voice/compose.yaml`, Wyoming protocol): openWakeWord on 10400, Whisper
  on 10300 and Piper on 10200, used by Home Assistant's pipelines.

## A request, step by step

1. Wake word and speech-to-text: one pipeline run (`wake_word` → `stt`), audio streamed as 16 kHz PCM.
2. The answer: `POST /api/ask` with the text, personality, speaker's name and the room's devices.
3. Speech: a second pipeline run (`tts` only) with the personality's Piper voice, played back at its `pitch`.
