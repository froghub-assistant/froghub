# Memory, history and the web

## Memory

The assistant remembers harmless things it's asked to ("my favourite colour is green"), never personal details, and
nothing that changes its rules. In [admin mode](/guide/grown-ups#admin-mode-on-a-display) grown-ups can also see,
change and delete memories, and save house rules. The admin page's Memory tab shows the files.

- **The Claude Code brain** keeps its memory as files in its own folder (`~/froghub-agent`).
- **The API brain** keeps it as one list in `~/.config/froghub/memory.md`. All of it goes into every prompt, and its
  `remember`, `change_memory` and `forget` tools keep it tidy, so "forget that" from the admin page really does. Past
  about 6,000 characters it's told to merge or forget old notes, and it's only shown the newest part.

Off with the grown-ups' "Remember things between conversations" switch.

## History

With the History switch on, the assistant can search what it was asked before: `search_history` takes words, a
display and how many days back ("what was that recipe yesterday?"). It never sees what grown-ups asked in admin mode or
from the admin page. See [History](/guide/grown-ups#history).

## Web search

- **Claude** searches the web with Anthropic's own search tool.
- **An OpenAI-compatible model** (LM Studio, Ollama or OpenAI) gets a `web_search` tool that reads DuckDuckGo's
  results, or a [SearXNG](https://docs.searxng.org) instance's if `FROGHUB_SEARCH_URL` points at one (with
  `format=json` allowed).

The local model has all the other tools too. For a small model that gets lost among them,
`FROGHUB_FALLBACK_TOOLS=basic` offers it only reply, memory and web search.

Off with the grown-ups' "Look things up online" switch.
