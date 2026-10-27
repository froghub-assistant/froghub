/**
 * The goodnight routine: someone says goodnight (or a scheduled job or Home Assistant does) and, once its reply has been
 * said, the display turns its room's lights off or down, stays in night mode until morning and plays a sleep sound
 * (rain, waves or white noise, made on the tablet itself) that fades out after a while. What it does is each display's
 * own setting (Settings → Goodnight); the assistant can pick another sound or time when asked. The lights need the
 * grown-ups' devices switch and the sound their music one.
 *
 * It goes out like an announcement ({goodnight}), so it reaches the display whether or not anyone asked there.
 */
import { clean } from './common.ts'
import { type Screen, announce, findDisplay, onlineDisplays } from './announce.ts'
import { policy } from './store.ts'
import type { Tool } from './tools.ts'

export const SLEEP_SOUNDS = ['rain', 'waves', 'white noise', 'none']
export type Goodnight = { lights: boolean; sound?: string; minutes?: number }

export const goodnightTool: Tool = {
  name: 'goodnight',
  description:
    "Start the goodnight routine on a display. Once your reply has been said, it turns the room's lights off or down " +
    '(as its settings say), stays dark until morning and plays a sleep sound that fades out. Use it when someone says ' +
    "goodnight or that they're going to bed. Goes to the display you were asked at, or the one named in to (needed " +
    'from a scheduled job; "all" for every display).',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: "One display's name, or 'all'" },
      sound: { type: 'string', enum: SLEEP_SOUNDS, description: "Only if they asked for a particular sound (or none); otherwise the display's own setting" },
      minutes: { type: 'number', description: "How long the sound plays, if they said (5 to 180); otherwise the display's own setting" },
    },
  },
}

/** The routine's options from a tool call or a /local/announce body, minus what the grown-ups turned off. */
export function goodnightOptions(args: Record<string, unknown>): Goodnight {
  const allowed = policy()
  const sound = clean(args.sound, 20).toLowerCase()
  const minutes = Number(args.minutes)
  return {
    lights: allowed.devices,
    ...(!allowed.music ? { sound: 'none' } : SLEEP_SOUNDS.includes(sound) ? { sound } : {}),
    ...(Number.isFinite(minutes) && minutes > 0 ? { minutes: Math.round(Math.min(180, Math.max(5, minutes))) } : {}),
  }
}

/** Runs the goodnight tool; returns the text for the assistant (throws for an unknown display, or none at all). */
export function runGoodnight(args: Record<string, unknown>, from?: Screen): string {
  const name = clean(args.to, 60)
  let to = from
  if (name.toLowerCase() === 'all') to = undefined
  else if (name) {
    to = findDisplay(name)
    if (!to) throw new Error(`No display called "${name}" is on. Displays that are on: ${onlineDisplays().map(s => s.name).join(', ') || 'none'}.`)
  } else if (!from) throw new Error('Say which display it is for (to), or "all".')
  const o = goodnightOptions(args)
  announce({ text: '', goodnight: o, to: to?.id, at_night: true })
  const sound = o.sound === 'none' ? 'no sound' : o.sound ? `${o.sound}${o.minutes ? ` for ${o.minutes} minutes` : ''}` : 'its usual sleep sound'
  return `Goodnight starts on ${to ? to.name : 'every display that is on'} once your reply has been said: ` +
    `${o.lights ? 'lights down, ' : ''}dark until morning, ${sound}. Keep your reply calm (a short bedtime story is fine if they asked for one).`
}
