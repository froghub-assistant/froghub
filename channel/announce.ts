/**
 * Announcements: Frog Hub speaking up without being asked ("Dinner's ready!"), on every display or just one.
 *
 * Who can send one:
 *   - Something on the server (a grown-up, a Home Assistant automation, a script): POST /local/announce. Caddy never proxies
 *     it (it only passes /api/*), so only the server itself can reach it.
 *       { say: "text", show?: {title, text, emoji, items, picture_of, image_url, seconds} }
 *       or { prompt: "what the assistant should tell the room" }: it goes to the assistant like a question and its
 *       reply (with any card or room actions) is announced
 *       or { audio: "https://…mp3", title? }: played on the displays (audio.ts); { stop_audio: true } stops it
 *       optional: to (a display's name), area (only displays set to that room), at_night (speak during night hours
 *       too; otherwise it's only shown), personality (for a prompt; default the shared one)
 *   - Someone at a display, with the 📢 button: POST /api/announce { text, to?, device, name }
 *   - The assistant, with the send_message tool (when someone asks it to tell another room something)
 * The sending display never shows its own message.
 *
 * Each display polls GET /api/announcements?after=<id>&device=<id>&name=<its name>&area=<its room>&..., which is also how
 * the server knows which displays are on (GET /api/displays) and keeps its registry of them (registry.ts); anything a
 * grown-up queued for that display (wipe, welcome, new settings) comes back as `command`.
 */
import { clean, json } from './common.ts'
import { checkIn } from './registry.ts'
import type { Display } from './display.ts'

export type Announcement = {
  id: number
  text: string
  display?: Display
  actions?: unknown[]
  area?: string
  to?: string // a display's id: only that one
  from?: string // the sending display's id: never shown there
  audio?: { url?: string; title?: string; hls?: true; stop?: true } // play_audio, play_radio and stop_audio (audio.ts, radio.ts)
  at_night: boolean
  at: number
}
export type Screen = { id: string; name: string; area: string; seen: number }

const KEEP_MS = 10 * 60 * 1000 // a display that was off for longer doesn't announce stale news when it comes back
const MAX = 20
const ONLINE_MS = 60 * 1000 // displays poll every 5 s
const BUTTON_GAP_MS = 3000 // the 📢 button: at most one message every 3 seconds

let queue: Announcement[] = []
let lastId = 0
const screens = new Map<string, Screen>()
let lastButton = 0

export function announce(a: Omit<Announcement, 'id' | 'at'>): number {
  queue = [...queue.filter(x => x.at > Date.now() - KEEP_MS), { ...a, id: ++lastId, at: Date.now() }].slice(-MAX)
  return lastId
}

/** The displays that are on, apart from `except` (a display id). */
export function onlineDisplays(except = ''): Screen[] {
  return [...screens.values()].filter(s => s.id !== except && s.seen > Date.now() - ONLINE_MS)
}

/** A display that's on, by its id or (case-insensitively, whole or in part) its name. */
export function findDisplay(wanted: string, except = ''): Screen | undefined {
  const on = onlineDisplays(except)
  const w = wanted.trim().toLowerCase()
  return on.find(s => s.id === wanted) ?? on.find(s => s.name.toLowerCase() === w) ?? on.find(s => s.name.toLowerCase().includes(w))
}

/** A message from one display (or the assistant on its behalf) to the others, with a 📢 card saying where from. */
export function message(text: string, from: Screen | undefined, to: Screen | undefined, spoken = text): number {
  const where = from ? `From ${from.name}` : 'Message'
  return announce({ text: spoken, display: { emoji: '📢', title: where, text, seconds: 60 }, from: from?.id, to: to?.id, at_night: false })
}

export function screenFor(id: unknown): Screen | undefined {
  return typeof id === 'string' ? screens.get(id) : undefined
}

export async function handleAnnouncements(req: Request, pathname: string): Promise<Response> {
  const url = new URL(req.url)
  if (req.method === 'GET' && pathname === '/api/displays') {
    return json(onlineDisplays(url.searchParams.get('except') || '').map(({ id, name }) => ({ id, name })))
  }
  if (req.method === 'GET' && pathname === '/api/announcements') {
    const device = clean(url.searchParams.get('device'), 40)
    const area = url.searchParams.get('area') || ''
    const name = clean(url.searchParams.get('name'), 40) || 'Frog Hub'
    let command
    if (device) {
      screens.set(device, { id: device, name, area, seen: Date.now() })
      command = checkIn(device, {
        name,
        area,
        who: clean(url.searchParams.get('who'), 40),
        areaName: clean(url.searchParams.get('areaName'), 60),
        personality: clean(url.searchParams.get('personality'), 20),
        micMuted: url.searchParams.get('micMuted') === 'true',
        ...(/^\d{1,3}$/.test(url.searchParams.get('volume') ?? '') ? { volume: Math.min(100, Number(url.searchParams.get('volume'))) } : {}),
      })
      if (command?.wipe) screens.delete(device)
    }
    const after = Number(url.searchParams.get('after')) || 0
    const items = queue.filter(a =>
      a.id > after && a.at > Date.now() - KEEP_MS && a.from !== device && (!a.to || a.to === device) && (!a.area || a.area === area))
    return json({ latest: lastId, items, ...(command ? { command } : {}) })
  }
  if (req.method === 'POST' && pathname === '/api/announce') {
    const body = await req.json().catch(() => ({}))
    const text = clean(body.text, 300)
    if (!text) return json({ error: 'nothing to send' }, 400)
    if (Date.now() - lastButton < BUTTON_GAP_MS) return json({ error: 'slow down a bit' }, 429)
    const from = screenFor(body.device)
    const to = body.to ? findDisplay(String(body.to), from?.id) : undefined
    if (body.to && !to) return json({ error: "that display isn't on" }, 404)
    lastButton = Date.now()
    message(text, from, to, from ? `Message from ${from.name}. ${text}` : text)
    return json({ ok: true, to: to?.name ?? 'everyone' })
  }
  return new Response('not found', { status: 404 })
}
