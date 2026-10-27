# Environment variables

Setup writes the ones you need. For the API brain they go in `~/.config/froghub/standalone.env`; keep secrets there
rather than in the service unit.

## Both brains

| Variable | Meaning | Default |
| --- | --- | --- |
| `FROGHUB_PORT` | The server's port on 127.0.0.1 | `8790` |
| `FROGHUB_BIG_MODEL` | The bigger model `think_harder` hands hard questions to; `none` turns it off | Sonnet |
| `FROGHUB_RECIPEAPI_KEY` | A recipeapi.io key, overriding `~/.config/froghub/recipeapi.key` | |
| `FROGHUB_MEALDB_KEY` | Your own TheMealDB key | `1` (the free one) |

## The Claude Code brain

| Variable | Meaning | Default |
| --- | --- | --- |
| `FROGHUB_TIMEOUT` | Seconds to wait for a reply | `45` |
| `FROGHUB_CLEAR_AFTER` | Minutes of quiet before its conversation is cleared; `0` never | `30` |

## The API brain

| Variable | Meaning | Default |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | An Anthropic API key. Without one, it uses the OpenAI-compatible API | |
| `FROGHUB_MODEL` | The Claude model | `claude-haiku-5-5` |
| `FROGHUB_FALLBACK_URL` | An OpenAI-compatible API's base URL, used without an Anthropic key or when it fails: LM Studio (`http://<pc>:1234/v1`), Ollama (`http://<pc>:11434/v1`) or OpenAI (`https://api.openai.com/v1`) | |
| `FROGHUB_FALLBACK_MODEL` | The model name there, e.g. `qwen3:8b` on Ollama | |
| `FROGHUB_FALLBACK_KEY` | Its API key, if it wants one (OpenAI does; LM Studio and Ollama don't) | |
| `FROGHUB_FALLBACK_TOOLS` | `basic` offers that model only reply, memory and web search, for a small model that gets lost among many tools | all of them |
| `FROGHUB_SEARCH_URL` | A [SearXNG](https://docs.searxng.org) instance for that model's web search, with `format=json` allowed | DuckDuckGo |
| `FROGHUB_PROMPT` | The assistant's rules | `~/.config/froghub/assistant.md` |
| `FROGHUB_MEMORY` | Its memory file | `~/.config/froghub/memory.md` |

## Installing

| Variable | Meaning | Default |
| --- | --- | --- |
| `FROGHUB_DIR` | Where `install.sh` puts Frog Hub (and `upgrade.sh` and `remove.sh` look for it) | `~/froghub` |
| `FROGHUB_REPO` | The git repo `install.sh` fetches | `https://github.com/froghub-assistant/froghub.git` |
| `VOICE_BIND` | The address the voice containers listen on, the one Home Assistant reaches them on | `127.0.0.1` |
