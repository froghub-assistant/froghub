# Alarms and timers

"Wake me up at seven on school days", "ten minutes for the cookies".

- `set_alarm` sets an alarm at a time of day (24-hour `HH:MM`), with a label shown and read on the screen ("School")
  and a repeat: `once`, `daily`, `weekdays` or `weekends`.
- `set_timer` starts a countdown, in minutes (fractions are fine; at most 12 hours).
- `list_alarms` and `cancel_alarm` manage them, and grown-ups can see and cancel them on the admin page.

When one is due, the displays ring with **Stop** and **Snooze** (9 minutes) buttons. Alarms never ring quieter than 20%,
whatever the display's volume. If a display was off when an alarm was due, it doesn't ring more than half an hour
late.

They're kept on the server (`~/.config/froghub/alarms.json`), so they survive a display reloading, and run in the
house's time zone. There can be at most 20.

Off with the grown-ups' "Set alarms and timers" switch.
