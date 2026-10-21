/**
 * This Frog Hub instance's own details, so nothing about one house is baked into the code:
 * ~/.config/froghub/instance.json, written by `bun run setup` (setup/setup.ts). Anything missing falls back to the
 * defaults below. The displays fetch the public part (GET /api/instance) for things like Home Assistant's address.
 *
 *   site       where the displays open Frog Hub, e.g. "https://hub.example.com"
 *   haUrl      Home Assistant, the default for new displays ("" = none; displays can still go without it)
 *   timeZone   the house's time zone (the displays use it too: an old Fire tablet's own time zone setting can be stuck)
 *   kids       the children the kids' rules are about, e.g. ["Sam"] (for examples on the admin page)
 *   agentDir   the Claude Code assistant's folder (the "claude-code" brain); its memory lives under ~/.claude/projects
 */
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export type Instance = { site: string; haUrl: string; timeZone: string; kids: string[]; agentDir: string }

export const INSTANCE_FILE = join(homedir(), '.config', 'froghub', 'instance.json')

const DEFAULTS: Instance = {
  site: '',
  haUrl: '',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  kids: [],
  agentDir: join(homedir(), 'froghub-agent'),
}

export const instance: Instance = {
  ...DEFAULTS,
  ...(existsSync(INSTANCE_FILE) ? JSON.parse(readFileSync(INSTANCE_FILE, 'utf8')) : {}),
}

/** Where Claude Code keeps a folder's sessions and memory: ~/.claude/projects/<path with every non-alphanumeric as ->. */
export const agentMemoryDir = join(homedir(), '.claude', 'projects', instance.agentDir.replace(/[^a-zA-Z0-9]/g, '-'), 'memory')

/** "Wednesday 21 October, 18:05" in the house's time zone. */
export function houseTime(ms = Date.now(), options: Intl.DateTimeFormatOptions = { weekday: 'long', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long' }): string {
  return new Date(ms).toLocaleString('en-GB', { timeZone: instance.timeZone, ...options })
}

/** GET /api/instance: what a display (or the admin page) needs to know; nothing secret. */
export function handleInstance(): Response {
  const { site, haUrl, timeZone, kids } = instance
  return Response.json({ site, haUrl, timeZone, kids })
}
