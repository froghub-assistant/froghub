# Screensaver

When nobody has touched a display for a few minutes, Frog Hub can show a screensaver instead of its usual screen:

- **A big clock** with the date;
- **the personality's face**, floating about;
- **photos**, a slideshow (see below);
- **a mix**, two minutes of each in turn.

The clock and the face drift slowly round the screen, so nothing stays lit in the same place for hours (old screens
can burn in). A tap anywhere wakes it up, and that tap only wakes it: it never presses whatever is underneath.

It stays away while someone is talking to the assistant, an alarm is ringing, Settings or the keyboard are open, or a
card is full screen, and goes as soon as the wake word is heard or a message arrives. During night mode it's dimmed
like everything else.

## Settings

Under **Settings → Screensaver**, shared by every display like the look and night mode (a grown-up's Save in admin
mode updates them all):

| Setting | What it does |
| --- | --- |
| Screensaver when nobody's using it | The switch. Off to begin with |
| Show | A big clock, the face, photos, or a mix |
| After … idle minutes | How long nobody has touched it first (5 to begin with) |
| Dim the screen while it's on | Turns the screen down, and back up when it wakes |
| Only at certain times | From and to (say 07:00 to 21:00; it can go over midnight). Outside them, no screensaver |

In a browser there's no way to turn the screen itself down, so "dim" darkens the picture instead.

## In the Android app

[The display app](/developers/android) keeps its own screensaver settings, in its corner menu (tap the top-left
corner five times) and under **Settings → Screensaver** on that tablet, and Frog Hub uses those instead of the
shared ones. There, dimming turns the tablet's backlight down. The app's own screen-off comes after the screensaver:
if the screensaver is set to start at the same time or later, it starts a minute before the screen goes off instead
(the corner menu says so). Older versions of the app fall back to the shared settings.

## Photos

The slideshow shows, in a shuffled order, a new picture every 15 seconds from:

- **the server's photo folder**, `~/.config/froghub/photos` (or `photosDir` in `instance.json`): `.jpg`, `.jpeg`,
  `.png`, `.gif` and `.webp` files. Old tablets have little memory, so keep them about screen-sized;
- **a list of picture addresses**, which a grown-up types in under **Settings → Screensaver** in admin mode (one per
  line, `http://` or `https://`).

With no photos at all, the slideshow shows the clock.
