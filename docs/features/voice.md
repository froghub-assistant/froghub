# Voice and personalities

## The personalities

Each personality changes the look, the on-screen words, the voice, and how the assistant talks:

- **Verity** (the default)
- **Falsity**
- **Lovity**
- **Frog**

The display's personality is picked in the welcome or Settings, and the assistant is told it with every request.

## Making your own

The admin page's **Personalities** tab makes new ones. Describe a character ("a sleepy cloud who loves weather facts")
and Claude writes everything a personality needs:

- how it talks, for the assistant;
- the display's colours, and its words on screen (the greeting, and what it says while listening, thinking or when
  something goes wrong);
- a Piper voice and a pitch;
- an animated SVG face, with every mood the built-in faces have: waiting (blinking), listening, thinking, speaking
  and confused, plus happy, sad and tired.

The preview has buttons for each mood. Change anything by hand, or ask for something different ("make the face
rounder, and the voice less shouty") and Claude redraws it. **Save** adds it for every display (they pick it up with
the shared settings, within a minute) and makes its Home Assistant pipeline, `Frog Hub · <Name>`, copied from Frog's
with the new voice. That needs the shared Home Assistant token to belong to an HA admin; without it, the personality
still works with the usual voice.

Claude is reached through `claude -p` on your subscription (with no tools, MCP servers, hooks or saved session) when
Claude Code is installed, and the Anthropic API with `ANTHROPIC_API_KEY` otherwise. Making one takes a minute or two.

Safety, since it's for children's displays:

- Claude is told to keep it friendly and suitable for young children, and to make the nearest friendly version of
  anything that isn't.
- The face is rebuilt from an allowlist on the server: only shapes, gradients, text and CSS animations survive. No
  scripts, event handlers, links or outside files. Displays only ever show it as an image, where SVGs can't run
  anything anyway.
- The assistant is told who a custom personality is with each request, and the rules for looking after the children
  still come first, whatever it says. Grown-ups see and can edit all of it before saving.

## How a conversation goes

1. **Wake word and speech-to-text.** The display streams 16 kHz audio to Home Assistant in one pipeline run
   (`wake_word` → `stt`), with the personality's pipeline, `Frog Hub · <Personality>`: openWakeWord listens for
   "hey jarvis", then Whisper writes down what was said.
2. **The answer.** The display asks the assistant (`POST /api/ask`) with the text, the personality, who it's for and
   the room's devices. The reply is text, and maybe [room actions](/features/devices-music), a card for the screen or
   a follow-up question (then it keeps listening).
3. **Speech.** A second pipeline run (`tts` only) speaks it with the personality's Piper voice, played back at the
   personality's pitch.

Quick room commands ("lights off", "next song", "volume 30") are handled on the display itself in a few milliseconds,
without asking the assistant.

## Long answers

Long answers are fine: the assistant puts the main point first. A reply over 350 characters goes on a card, and only
the first part is spoken, followed by "The rest is on the screen."

## Cards on the screen

The assistant can put a card on the screen with its reply (`show_on_screen`): a title, an emoji or picture, text and
lists, such as a recipe's ingredients, how to spell a word or a times table. Cards scroll, and the full-screen button makes them fill the screen.

## Thinking harder

The assistant runs on Haiku, which is quick. For what needs real thought (homework, a careful explanation, planning)
it can call `think_harder`, which hands that one question to a bigger model and puts the answer in its own words.

- The Claude Code brain runs a one-shot, locked-down `claude -p` (no tools, no settings, no saved session; given 25 s).
- The API brain asks the bigger model again with the whole conversation. On an OpenAI-compatible API (no Anthropic
  key, or when Claude fails) that's `FROGHUB_FALLBACK_BIG_MODEL`, a bigger model at the same API; without it, the
  fallback answers everything itself.

`FROGHUB_BIG_MODEL` picks the bigger model (by default Sonnet; `none` turns it off). On a subscription, Sonnet uses up
the limits faster than Haiku.

## A fresh start

The Claude Code brain's conversation is cleared (`/clear`) after 30 quiet minutes with no request open
(`FROGHUB_CLEAR_AFTER`, in minutes; 0 never), so old chat doesn't pile up; its memory files stay. The API brain only
ever keeps the last six exchanges of a conversation, which the display starts afresh after 5 quiet minutes.

## Adding a personality

See [Working on Frog Hub](/developers/#adding-a-personality).
