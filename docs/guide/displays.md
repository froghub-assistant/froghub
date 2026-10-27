# Setting up a display

Any tablet with a modern-ish browser will do, down to old Fire tablets on Fire OS 5. Open your Frog Hub site on it,
full screen: in [Fully Kiosk Browser](https://www.fully-kiosk.com), or in [Frog Hub's own Android app](/developers/android),
which keeps the screen on, plays sound without a tap and copes with Fire OS 5's certificate problems.

## Getting the app

<a class="download" href="https://github.com/froghub-assistant/froghub/releases/latest/download/froghub.apk"><svg class="lucide lucide-download" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /></svg> Download the display app (froghub.apk)</a>

On the tablet, open that link (or copy the file over), then allow installing from unknown sources when it asks: on a
Fire tablet that's **Settings → Security & Privacy → Apps from Unknown Sources**. It asks for your Frog Hub's address
on first start. There's an [admin app for phones](/developers/android#the-admin-app) too.

For an old tablet whose built-in web engine is out of date (such as a Fire on Fire OS 5), there's also the
[full display app](https://github.com/froghub-assistant/froghub/releases/latest/download/froghub-full.apk)
(froghub-full.apk). It brings Firefox's engine with it instead of using the tablet's old built-in one, so everything
works, including being a [Music Assistant speaker](/features/devices-music#the-displays-as-music-assistant-speakers)
the modern way. It's a much bigger download (about 80 MB), and a little slower to start.
[More about it](/developers/android#the-full-display-app).

## The welcome

A display with no Home Assistant token opens the welcome: hello, connect, pick a personality, who it's for and which
room, a microphone check, then confetti.

There are three ways to connect it:

- **Scan with a phone.** The display shows a QR code. A grown-up scans it, types the PIN on their phone and taps
  *Pair it*; the display copies the connection and settings from the other Frog Hubs.
- **Log in with Home Assistant.** It goes to Home Assistant's login page and comes back with a long-lived token made
  just for that display. Nothing to set up in Home Assistant.
- **The PIN, or a token.** A grown-up's PIN on the display copies the connection and settings from the other Frog
  Hubs, or type Home Assistant's address and a token yourself.

::: tip Trying the welcome again
Admin Settings has "Show the welcome again". `?welcome` on the address (or `?welcome=mic`, a step's name) opens it
on any display to try it out.
:::

## Without Home Assistant

Home Assistant is optional ("Skip: use it without Home Assistant"). Without it there's no voice (wake word, speech and
replies all go through Home Assistant), no room buttons and no weather; typed questions are answered on screen, and
alarms, messages and cards still work. Adding Home Assistant's address and a token in Settings later turns the
voice on.

## Its name and room

Each display has a random id and a name (Settings → "This display's name", by default its room's name). The name is
how you send it messages or announcements, and the room decides which devices it can control.

## Grown-ups' displays

Admin Settings → Grown-ups display marks just that display (kept on the server by its id), so the assistant drops
the children's rules there.

## Mic and volume

Each display has a microphone button that switches its microphone off: the browser's microphone is closed, so nothing is heard
or sent. Typed questions, announcements and alarms still work. The speaker button's slider sets its volume (alarms never go below
20%). Both can be changed from the admin page too.
