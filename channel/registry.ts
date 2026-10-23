/**
 * Every Frog Hub display that has ever checked in (~/.config/froghub/displays.json), for the admin page. Displays
 * check in with each announcements poll (announce.ts, every 5 s); the file is only rewritten when something about a
 * display changes, or at most once a minute for "last seen".
 *
 * A grown-up can queue things for a display, which it picks up on its next check-in:
 *   wipe     erase all its settings (localStorage) and reload into the welcome, as a brand-new display; its entry
 *            here goes at the same time (it comes back under a new id)
 *   welcome  open the welcome again (keeping its settings)
 *   set      change its own settings: deviceName, name (who it's for), area, micMuted, volume (0-100)
 * "forget" just drops the entry, for a tablet that's never coming back.
 *
 *   GET  /api/admin/displays                                   admin only
 *   POST /api/admin/displays {id, action: wipe|welcome|forget|cancel|set, set?: {...}}   admin only
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { adminValid, clean, json, log } from './common.ts'
import { isGrownUps, setGrownUps } from './store.ts'

export type Pending = { wipe?: true; welcome?: true; set?: Record<string, string | number | boolean> }
export type Entry = {
  id: string
  name: string // what the other displays call it
  who: string // who it's for
  area: string
  areaName: string
  personality: string
  micMuted?: boolean // its microphone is switched off
  volume?: number // 0-100 (displays from before it was a setting don't say)
  firstSeen: number
  lastSeen: number
  pending?: Pending
}

const FILE = `${homedir()}/.config/froghub/displays.json`
const ONLINE_MS = 60 * 1000
const SEEN_SAVE_MS = 60 * 1000
const SETTABLE = { deviceName: 'text', name: 'text', area: 'text', micMuted: 'flag', volume: 'level' } as const

let entries: Record<string, Entry> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}
let savedAt = 0

function save(): void {
  writeFileSync(FILE, JSON.stringify(entries, null, 1))
  savedAt = Date.now()
}

/** A display checking in. Returns anything queued for it (and clears it). */
export function checkIn(id: string, info: Omit<Entry, 'id' | 'firstSeen' | 'lastSeen' | 'pending'>): Pending | undefined {
  const old = entries[id]
  const now = Date.now()
  const entry: Entry = { ...info, id, firstSeen: old?.firstSeen ?? now, lastSeen: now, ...(old?.pending ? { pending: old.pending } : {}) }
  const changed = !old || (['name', 'who', 'area', 'areaName', 'personality', 'micMuted', 'volume'] as const).some(k => old[k] !== entry[k])
  const pending = entry.pending
  delete entry.pending
  if (pending?.wipe) {
    delete entries[id]
    setGrownUps(id, false)
    log(`registry: wiping ${id} (${entry.name})`)
    save()
    return pending
  }
  entries[id] = entry
  if (changed || pending || now - savedAt > SEEN_SAVE_MS) save()
  return pending
}

export async function handleRegistry(req: Request, pathname: string): Promise<Response> {
  if (pathname !== '/api/admin/displays') return new Response('not found', { status: 404 })
  if (!adminValid(req.headers.get('x-admin-token'))) return json({ error: 'admin mode needed' }, 403)
  if (req.method === 'GET') {
    const now = Date.now()
    return json(Object.values(entries)
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map(e => ({ ...e, online: now - e.lastSeen < ONLINE_MS, grownUps: isGrownUps(e.id) })))
  }
  if (req.method !== 'POST') return new Response('not found', { status: 404 })
  const body = await req.json().catch(() => ({}))
  const entry = entries[String(body.id)]
  if (!entry) return json({ error: 'no display with that id' }, 404)
  const action = String(body.action)
  if (action === 'forget') {
    delete entries[entry.id]
    setGrownUps(entry.id, false)
  } else if (action === 'cancel') {
    delete entry.pending
  } else if (action === 'wipe' || action === 'welcome') {
    entry.pending = { ...entry.pending, [action]: true }
  } else if (action === 'set') {
    const set: Record<string, string | number | boolean> = {}
    for (const [k, kind] of Object.entries(SETTABLE)) {
      const value = body.set?.[k]
      if (kind === 'text' && typeof value === 'string') set[k] = clean(value, 60)
      if (kind === 'flag' && typeof value === 'boolean') set[k] = value
      if (kind === 'level' && typeof value === 'number' && Number.isFinite(value)) set[k] = Math.round(Math.min(100, Math.max(0, value)))
    }
    if (!Object.keys(set).length) return json({ error: 'nothing to set' }, 400)
    entry.pending = { ...entry.pending, set: { ...entry.pending?.set, ...set } }
  } else {
    return json({ error: 'unknown action' }, 400)
  }
  log(`registry: ${action} ${entry.id} (${entry.name})`)
  save()
  return json({ ok: true })
}
