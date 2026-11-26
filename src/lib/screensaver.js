// The screensaver's rules (Screensaver.svelte draws it): when it comes on, which mode it shows, and where things drift.
// Plain functions, so the tests can run them without a browser.
//
// Its settings come from the display's own settings (synced between displays like the others), or, inside the Android
// app, from the app's settings (the five-tap dialog), which the app hands over as JSON: FrogHubApp.getScreensaverSettings().

export const MODES = ['clock', 'face', 'photos', 'mix']

export const SAVER_DEFAULTS = {
  saverOn: false, // the switch: off until a grown-up turns it on
  saverMode: 'clock', // clock, face, photos or mix
  saverMinutes: 5, // after this many idle minutes
  saverHours: false, // only between saverFrom and saverTo (outside them, no screensaver)
  saverFrom: '07:00',
  saverTo: '21:00',
  saverDim: true, // dim the screen while it's on (back to normal on waking)
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** '07:30' → 450 (minutes since midnight); null if it isn't a time. */
export function parseTime(text) {
  const m = TIME.exec(String(text == null ? '' : text).trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function bool(v, fallback) {
  return typeof v === 'boolean' ? v : fallback
}

/** Settings in the display's own names (saverOn, ...), with anything missing or broken put back to its default. */
export function cleanSaver(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  const minutes = Number(s.saverMinutes)
  return {
    saverOn: bool(s.saverOn, SAVER_DEFAULTS.saverOn),
    saverMode: MODES.indexOf(s.saverMode) >= 0 ? s.saverMode : SAVER_DEFAULTS.saverMode,
    saverMinutes: Number.isFinite(minutes) && minutes >= 1 ? Math.min(240, Math.round(minutes)) : SAVER_DEFAULTS.saverMinutes,
    saverHours: bool(s.saverHours, SAVER_DEFAULTS.saverHours),
    saverFrom: parseTime(s.saverFrom) === null ? SAVER_DEFAULTS.saverFrom : String(s.saverFrom).trim(),
    saverTo: parseTime(s.saverTo) === null ? SAVER_DEFAULTS.saverTo : String(s.saverTo).trim(),
    saverDim: bool(s.saverDim, SAVER_DEFAULTS.saverDim),
  }
}

/**
 * The Android app's JSON ({enabled, mode, minutes, activeHours, from, to, dim, screenOffMinutes}) as display settings,
 * plus screenOffMinutes (when the app turns the screen off; 0 = never). null when there's nothing usable: an app too
 * old to have the setting, or the full app's bridge before it has heard from the app.
 */
export function fromApp(json) {
  if (!json) return null
  let a
  try {
    a = typeof json === 'string' ? JSON.parse(json) : json
  } catch {
    return null
  }
  if (!a || typeof a !== 'object' || typeof a.enabled !== 'boolean') return null
  const s = cleanSaver({
    saverOn: a.enabled, saverMode: a.mode, saverMinutes: a.minutes, saverHours: a.activeHours,
    saverFrom: a.from, saverTo: a.to, saverDim: a.dim,
  })
  const off = Number(a.screenOffMinutes)
  s.screenOffMinutes = Number.isFinite(off) && off > 0 ? off : 0
  return s
}

/** Display settings back into the app's JSON, for FrogHubApp.setScreensaverSettings(). */
export function toApp(s) {
  const c = cleanSaver(s)
  return {
    enabled: c.saverOn, mode: c.saverMode, minutes: c.saverMinutes, activeHours: c.saverHours,
    from: c.saverFrom, to: c.saverTo, dim: c.saverDim,
  }
}

/**
 * The idle minutes before it comes on. It has to start before the app turns the screen off, so when it wouldn't, it
 * comes on a minute before that (half a minute before, with the screen going off after one minute).
 */
export function idleMinutes(minutes, screenOffMinutes) {
  if (!(screenOffMinutes > 0) || minutes < screenOffMinutes) return minutes
  return screenOffMinutes > 1 ? screenOffMinutes - 1 : screenOffMinutes / 2
}

/** Whether `minuteOfDay` is inside the active hours (always, when they're off). From 21:00 to 07:00 goes over midnight. */
export function inActiveHours(s, minuteOfDay) {
  if (!s.saverHours) return true
  const from = parseTime(s.saverFrom)
  const to = parseTime(s.saverTo)
  if (from === null || to === null || from === to) return true
  return from < to ? minuteOfDay >= from && minuteOfDay < to : minuteOfDay >= from || minuteOfDay < to
}

/**
 * Whether the screensaver should be showing: switched on, inside its hours, nothing in the way (`blocked`: someone
 * talking to it, an alarm, settings open...) and idle for long enough.
 */
export function shouldShow({ s, idleMs, minuteOfDay, blocked, screenOffMinutes = 0 }) {
  if (!s || !s.saverOn || blocked || !inActiveHours(s, minuteOfDay)) return false
  return idleMs >= idleMinutes(s.saverMinutes, screenOffMinutes) * 60000
}

export const MIX_MS = 2 * 60 * 1000 // mix: each mode for two minutes

/** The mode to draw now: mix takes turns (photos only when there are some), and photos without any falls back to the clock. */
export function modeAt(mode, shownMs, hasPhotos) {
  if (mode === 'photos') return hasPhotos ? 'photos' : 'clock'
  if (mode !== 'mix') return mode === 'face' ? 'face' : 'clock'
  const turns = hasPhotos ? ['clock', 'face', 'photos'] : ['clock', 'face']
  return turns[Math.floor(Math.max(0, shownMs) / MIX_MS) % turns.length]
}

/**
 * Somewhere new to drift to: an offset from the middle of the screen as fractions of its width and height, at most
 * `reach` (so something half the screen wide stays on it), and at least a fifth of the way across from `from`, so
 * it always visibly moves.
 */
export function driftTarget(from = { x: 0, y: 0 }, reach = 0.25, random = Math.random) {
  let to = { x: 0, y: 0 }
  for (let i = 0; i < 8; i++) {
    to = { x: (random() * 2 - 1) * reach, y: (random() * 2 - 1) * reach }
    if (Math.abs(to.x - from.x) + Math.abs(to.y - from.y) >= reach * 0.4) break
  }
  return to
}

/** The next photo, in a shuffled order that doesn't show one twice in a row. */
export function nextPhoto(photos, current, random = Math.random) {
  if (!photos.length) return ''
  if (photos.length === 1) return photos[0]
  const others = photos.filter((p) => p !== current)
  return others[Math.floor(random() * others.length)]
}
