# Setting up a display

Any tablet with a modern-ish browser will do, down to old Fire tablets on Fire OS 5. Open your Frog Hub site on it,
full screen: in [Fully Kiosk Browser](https://www.fully-kiosk.com), or in [Frog Hub's own Android app](/developers/android),
which keeps the screen on, plays sound without a tap and copes with Fire OS 5's certificate problems.

## The welcome

A display with no Home Assistant token opens the welcome: hello, connect, pick a personality, who it's for and which
room, a microphone check, then confetti.

There are three ways to connect it:

- **📱 Scan with a phone.** The display shows a QR code. A grown-up scans it, types the PIN on their phone and taps
  *Pair it*; the display copies the connection and settings from the other Frog Hubs.
- **🏠 Log in with Home Assistant.** It goes to Home Assistant's login page and comes back with a long-lived token made
  just for that display. Nothing to set up in Home Assistant.
- **The PIN, or a token.** A grown-up's PIN on the display copies the connection and settings from the other Frog
  Hubs, or type Home Assistant's address and a token yourself.

::: tip Trying the welcome again
Admin Settings has "✨ Show the welcome again". `?welcome` on the address (or `?welcome=mic`, a step's name) opens it
on any display to try it out.
:::

## Without Home Assistant

Home Assistant is optional ("Skip: use it without Home Assistant"). Without it there's no voice (wake word, speech and
replies all go through Home Assistant), no room buttons and no weather; typed questions are answered on screen, and
alarms, 📢 messages and cards still work. Adding Home Assistant's address and a token in Settings later turns the
voice on.

## Its name and room

Each display has a random id and a name (Settings → "This display's name", by default its room's name). The name is
how you send it messages or announcements, and the room decides which devices it can control.

## Grown-ups' displays

Admin Settings → 🧑 Grown-ups display marks just that display (kept on the server by its id), so the assistant drops
the children's rules there.

## Mic and volume

Each display has a 🎙️ button that switches its microphone off: the browser's microphone is closed, so nothing is heard
or sent. Typed questions, announcements and alarms still work. The 🔊 slider sets its volume (alarms never go below
20%). Both can be changed from the admin page too.
