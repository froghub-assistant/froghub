/**
 * Shared by the Claude Code channel (server.ts) and the standalone brain (standalone.ts): request cleaning,
 * room actions, and admin mode (PIN unlock, sliding-expiry tokens, lockout after wrong PINs).
 */
import { randomBytes } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export const PERSONALITIES = new Set(['frog', 'verity', 'falsity', 'lovity'])
export const SERVICES = new Set(['turn_on', 'turn_off', 'toggle', 'brightness', 'media_play_pause', 'media_next_track', 'volume', 'play_music'])

export type Action = { entity_id: string; service: string; value?: number; query?: string }
export type Reply = { text: string; continue_conversation: boolean; actions: Action[]; display?: unknown }

const PIN_FILE = join(homedir(), '.config', 'froghub', 'pin')
const ADMIN_IDLE_MS = 10 * 60 * 1000
const MAX_FAILURES = 5
const LOCKOUT_MS = 5 * 60 * 1000

export function log(msg: string): void {
  process.stderr.write(`froghub: ${msg}\n`)
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

export function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\r\n"<>]/g, ' ').trim().slice(0, max) : ''
}

/** Only well-formed actions with a known service, with just the fields the display uses. */
export function cleanActions(actions: unknown): Action[] {
  return (Array.isArray(actions) ? actions : [])
    .filter((a): a is Action => !!a && typeof a.entity_id === 'string' && SERVICES.has(a.service))
    .map(a => ({
      entity_id: a.entity_id,
      service: a.service,
      ...(typeof a.value === 'number' ? { value: a.value } : {}),
      ...(typeof a.query === 'string' ? { query: a.query.slice(0, 100) } : {}),
    }))
}

/** "Lamp (light.lamp): on" lines for the room's devices sent by the display. */
export function deviceLines(devices: unknown): string[] {
  return (Array.isArray(devices) ? devices : [])
    .slice(0, 12)
    .map((d: Record<string, unknown>) => `${clean(d.name, 40)} (${clean(d.id, 60)}): ${clean(d.state, 30)}`)
    .filter(d => !d.startsWith(' ('))
}

export { houseTime as londonTime } from './instance.ts' // the house's time zone, not necessarily London

// --- Admin mode -------------------------------------------------------------------------------------------

const adminTokens = new Map<string, number>() // token -> expiry (ms)
let failures = 0
let lockedUntil = 0

export function adminValid(token: string | null): boolean {
  if (!token) return false
  const expiry = adminTokens.get(token)
  if (!expiry || expiry < Date.now()) {
    adminTokens.delete(token ?? '')
    return false
  }
  adminTokens.set(token, Date.now() + ADMIN_IDLE_MS) // sliding expiry
  return true
}

export async function handleUnlock(req: Request): Promise<Response> {
  if (!existsSync(PIN_FILE)) return json({ error: 'No PIN has been set yet. Run: bun channel/set-pin.ts' }, 409)
  if (Date.now() < lockedUntil) {
    return json({ error: 'Too many wrong PINs. Try again in a few minutes.', retry_in: Math.ceil((lockedUntil - Date.now()) / 1000) }, 429)
  }
  let pin = ''
  try {
    pin = String((await req.json()).pin ?? '')
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  const ok = /^\d{4,6}$/.test(pin) && (await Bun.password.verify(pin, readFileSync(PIN_FILE, 'utf8').trim()))
  if (!ok) {
    failures++
    if (failures >= MAX_FAILURES) {
      failures = 0
      lockedUntil = Date.now() + LOCKOUT_MS
      log('admin PIN locked out after too many wrong attempts')
    }
    return json({ error: 'Wrong PIN' }, 403)
  }
  failures = 0
  const token = randomBytes(24).toString('hex')
  adminTokens.set(token, Date.now() + ADMIN_IDLE_MS)
  return json({ token, idle_timeout: ADMIN_IDLE_MS / 1000 })
}

export async function handleAdminCheck(req: Request): Promise<Response> {
  return json({ admin: adminValid(req.headers.get('x-admin-token')) })
}

export function handleLock(req: Request): Response {
  adminTokens.delete(req.headers.get('x-admin-token') ?? '')
  return json({ ok: true })
}
