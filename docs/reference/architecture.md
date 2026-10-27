# How it fits together

```mermaid
flowchart TB
  app["The display (a web app on a tablet)"]
  subgraph server["Your server"]
    caddy["Caddy (https)"]
    fh["Frog Hub server (port 8790)"]
    brain["The brain (Claude Code or a model API)"]
  end
  subgraph ha["Home Assistant"]
    pipe["Frog Hub's pipelines"]
    voice["openWakeWord, Whisper, Piper"]
    devices["The room's devices"]
  end
  app -->|"questions, alarms, announcements"| caddy
  caddy --> fh
  fh <-->|"question, reply and actions"| brain
  app -->|"voice, with its own token"| pipe
  pipe --> voice
  app -->|"room actions"| devices
  fh -.->|"lists, with the shared token"| ha
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

```mermaid
sequenceDiagram
  participant D as Display
  participant HA as Home Assistant
  participant S as Frog Hub server
  participant B as Brain
  D->>HA: pipeline run (wake_word → stt), 16 kHz PCM
  HA-->>D: what was said
  D->>S: POST /api/ask (text, personality, speaker, room's devices)
  S->>B: the question
  B-->>S: reply (text, room actions, a card)
  S-->>D: the reply
  D->>HA: room actions (only this room's devices)
  D->>HA: pipeline run (tts) in the personality's Piper voice
  HA-->>D: audio, played at the personality's pitch
```
