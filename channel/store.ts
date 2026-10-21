/**
 * Things kept on the server for every Frog Hub display: what the assistant may use (the policy, set by a grown-up in
 * admin mode) and the shared settings that sync between displays. The HA token is shared too (copying it to
 * each tablet by hand is a pain), but it's kept in its own 0600 file and only handed to admin mode (PIN).
 *
 *   GET  /api/policy     anyone          POST /api/policy    admin only
 *   GET  /api/settings   anyone (token only with X-Admin-Token)      POST /api/settings  admin only
 *   GET  /api/audience?device=<id>  anyone   POST /api/audience {device, grownUps}  admin only
 *
 * Grown-ups displays: a grown-up can mark a display (by its random deviceId) as one where the kids' rules don't
 * apply. It's kept here, not on the tablet, so it can't be switched on without the PIN.
 */
import { spawn } from 'child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { adminValid, json, log } from './common.ts'
import { agentMemoryDir, instance } from './instance.ts'

const DIR = `${homedir()}/.config/froghub`
const POLICY_FILE = `${DIR}/policy.json`
const SETTINGS_FILE = `${DIR}/shared-settings.json`
const TOKEN_FILE = `${DIR}/shared-token`
const GROWN_UPS_FILE = `${DIR}/grown-up-displays.json`
const AGENT_SETTINGS = `${instance.agentDir}/settings.json`
const MEMORY = `/${agentMemoryDir}/**` // Claude Code permission paths: // = absolute

export const POLICY_DEFAULTS = {
  webSearch: true, // look things up online
  memory: true, // remember things between conversations
  weather: true,
  alarms: true,
  devices: true, // see and control the room's devices
  music: true, // play music on the Echo
  name: true, // be told who it's talking to
  screen: true, // show cards and pictures on the display
  announce: true, // pass messages on to the other displays
}
export type Policy = typeof POLICY_DEFAULTS

const SYNCED = ['personality', 'nightStart', 'nightEnd', 'haUrl'] as const // not area or name: each display has its own room and person

const read = (file: string) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)

/** The settings a grown-up last published from admin mode (personality, name, area, ...), or {}. */
export function sharedSettings(): Record<string, unknown> {
  return read(SETTINGS_FILE)?.settings ?? {}
}

export function policy(): Policy {
  return { ...POLICY_DEFAULTS, ...(read(POLICY_FILE) ?? {}) }
}

const deviceId = (v: unknown) => (typeof v === 'string' && /^[a-z0-9]{4,20}$/.test(v) ? v : '')

/** Whether this display is a grown-ups one (no kids' rules). Unknown or missing ids are kids' displays. */
export function isGrownUps(device: unknown): boolean {
  const id = deviceId(device)
  return Boolean(id) && ((read(GROWN_UPS_FILE) ?? []) as string[]).includes(id)
}

export function setGrownUps(device: unknown, on: boolean): boolean {
  const id = deviceId(device)
  if (!id) return false
  const ids = new Set<string>(read(GROWN_UPS_FILE) ?? [])
  if (ids.has(id) === on) return on
  if (on) ids.add(id)
  else ids.delete(id)
  writeFileSync(GROWN_UPS_FILE, JSON.stringify([...ids]))
  log(`audience: ${id} ${on ? 'grown-ups' : 'kids'}`)
  return on
}

/** Web search and memory are Claude Code tools, so they're switched in the assistant's own settings (then restart). */
function applyToAgent(p: Policy): boolean {
  const s = read(AGENT_SETTINGS)
  const allow = new Set<string>(s.permissions.allow)
  const deny = new Set<string>(s.permissions.deny)
  const toggle = (rules: string[], on: boolean) => {
    for (const r of rules) {
      if (on) (allow.add(r), deny.delete(r))
      else (allow.delete(r), deny.add(r))
    }
  }
  toggle(['WebSearch'], p.webSearch)
  toggle([`Read(${MEMORY})`, `Edit(${MEMORY})`], p.memory)
  const before = JSON.stringify(s.permissions)
  s.permissions.allow = [...allow]
  s.permissions.deny = [...deny]
  if (JSON.stringify(s.permissions) === before) return false
  writeFileSync(AGENT_SETTINGS, JSON.stringify(s, null, 2) + '\n')
  return true
}

export async function handleStore(req: Request, pathname: string): Promise<Response> {
  if (req.method === 'GET' && pathname === '/api/policy') return json(policy())
  if (req.method === 'GET' && pathname === '/api/audience') return json({ grownUps: isGrownUps(new URL(req.url).searchParams.get('device')) })
  if (req.method === 'GET' && pathname === '/api/settings') {
    const shared = read(SETTINGS_FILE) ?? { settings: null, updated: 0 }
    if (adminValid(req.headers.get('x-admin-token')) && existsSync(TOKEN_FILE)) shared.token = readFileSync(TOKEN_FILE, 'utf8').trim()
    return json(shared)
  }
  if (req.method !== 'POST') return new Response('not found', { status: 404 })
  if (!adminValid(req.headers.get('x-admin-token'))) return json({ error: 'admin mode needed' }, 403)
  const body = await req.json().catch(() => ({}))

  if (pathname === '/api/policy') {
    const next = { ...policy() }
    for (const k of Object.keys(POLICY_DEFAULTS) as (keyof Policy)[]) if (typeof body[k] === 'boolean') next[k] = body[k]
    writeFileSync(POLICY_FILE, JSON.stringify(next, null, 1))
    log(`policy: ${JSON.stringify(next)}`)
    const restart = applyToAgent(next)
    // The assistant only reads its settings when it starts. This server is part of it, so answer first.
    if (restart) setTimeout(() => spawn('systemctl', ['--user', 'restart', 'froghub-agent'], { detached: true, stdio: 'ignore' }).unref(), 500)
    return json({ ok: true, policy: next, restarting: restart })
  }
  if (pathname === '/api/settings') {
    const settings = Object.fromEntries(SYNCED.filter(k => body.settings && k in body.settings).map(k => [k, body.settings[k]]))
    const saved = { settings, updated: Date.now() }
    writeFileSync(SETTINGS_FILE, JSON.stringify(saved, null, 1))
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    if (/^[\w.-]{20,1000}$/.test(token)) {
      writeFileSync(TOKEN_FILE, token, { mode: 0o600 })
      chmodSync(TOKEN_FILE, 0o600)
    }
    return json(saved)
  }
  if (pathname === '/api/audience') {
    if (!deviceId(body.device)) return json({ error: 'missing device' }, 400)
    return json({ grownUps: setGrownUps(body.device, body.grownUps === true) })
  }
  return new Response('not found', { status: 404 })
}
