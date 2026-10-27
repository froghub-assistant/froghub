/**
 * The lists tool: the household's to-do and shopping lists in Home Assistant ("add milk to the shopping list", "what's
 * on the to-do list?", "tick off bread"). It reaches Home Assistant with the shared token the displays use (store.ts).
 * Only the lists a grown-up has allowed: Home Assistant's own Shopping list by default, others ticked on the admin page
 * (Home Assistant often has people's own lists too, from Google Tasks and the like):
 *
 *   GET  /api/admin/lists                 { lists: [{ id, name, items, allowed }] }   admin only
 *   POST /api/admin/lists { allowed: [ids] }                                          admin only
 *
 * Off with the grown-ups' lists switch.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { adminValid, clean, json, log } from './common.ts'
import { instance } from './instance.ts'
import { sharedSettings, sharedToken } from './store.ts'
import type { Tool } from './tools.ts'

export const listsTool: Tool = {
  name: 'lists',
  description:
    "The household's to-do and shopping lists: show what's on one, add items, tick items off as done, or remove them. " +
    'Without list, uses the only list there is, or says which lists there are.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['show', 'add', 'tick', 'remove'] },
      list: { type: 'string', description: 'Which list, by name, e.g. "shopping"' },
      items: { type: 'array', items: { type: 'string' }, description: 'For add, tick and remove, e.g. ["milk", "bread"]' },
    },
    required: ['action'],
  },
}

export const LISTS_FILE = join(homedir(), '.config', 'froghub', 'lists.json')
const DEFAULT_ALLOWED = ['todo.shopping_list'] // Home Assistant's own Shopping list
const MAX_ITEMS = 10 // added or ticked at once
const SHOWN = 30

type List = { id: string; name: string; items: number }

export function allowedLists(): string[] {
  try {
    if (existsSync(LISTS_FILE)) return JSON.parse(readFileSync(LISTS_FILE, 'utf8')).allowed ?? DEFAULT_ALLOWED
  } catch {}
  return DEFAULT_ALLOWED
}

/** Calls Home Assistant's REST API with the shared token. */
async function ha(path: string, body?: unknown): Promise<any> {
  const base = String(sharedSettings().haUrl || instance.haUrl || '').replace(/\/+$/, '')
  const token = sharedToken()
  if (!base || !token) throw new Error("Frog Hub isn't connected to Home Assistant, so there are no lists.")
  const r = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  if (r.status === 401) throw new Error("Home Assistant turned Frog Hub's token down.")
  if (!r.ok) throw new Error(`Home Assistant answered ${r.status}${r.status === 400 ? `: ${(await r.text()).slice(0, 150)}` : ''}`)
  return r.json()
}

/** Every to-do list in Home Assistant. */
async function allLists(): Promise<List[]> {
  const states: any[] = await ha('/api/states')
  return states.filter(s => s.entity_id.startsWith('todo.')).map(s => ({
    id: s.entity_id, name: String(s.attributes?.friendly_name ?? s.entity_id), items: Number(s.state) || 0,
  }))
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && w !== 'list')

/** The allowed list called `name` (by its words: "shopping" finds "Shopping list"), or the only one. */
export function pickList(lists: List[], name: string): List {
  if (!lists.length) throw new Error('No lists are shared with Frog Hub (a grown-up can choose some on the admin page).')
  const names = lists.map(l => l.name).join(', ')
  if (!name) {
    if (lists.length === 1) return lists[0]
    throw new Error(`Which list? There are: ${names}.`)
  }
  const want = words(name)
  const found = lists.filter(l => want.every(w => words(l.name).some(lw => lw.startsWith(w))))
  if (found.length === 1) return found[0]
  if (found.length > 1) {
    const exact = found.find(l => l.name.toLowerCase() === name.toLowerCase())
    if (exact) return exact
    throw new Error(`"${name}" could be ${found.map(l => l.name).join(' or ')}.`)
  }
  throw new Error(`There's no list called "${name}". There are: ${names}.`)
}

async function items(id: string): Promise<{ summary: string; uid: string }[]> {
  const r = await ha('/api/services/todo/get_items?return_response', { entity_id: id, status: ['needs_action'] })
  return r.service_response?.[id]?.items ?? []
}

/** Runs the tool; returns the text for the assistant (throws when it can't). */
export async function runLists(args: Record<string, unknown>): Promise<string> {
  const action = String(args.action)
  const allowed = new Set(allowedLists())
  const list = pickList((await allLists()).filter(l => allowed.has(l.id)), clean(args.list, 60))
  const given = (Array.isArray(args.items) ? args.items : []).map(i => clean(i, 100)).filter(Boolean).slice(0, MAX_ITEMS)
  if (action === 'show') {
    const open = await items(list.id)
    if (!open.length) return `${list.name} is empty.`
    return `${list.name} (${open.length}):\n${open.slice(0, SHOWN).map(i => `- ${i.summary}`).join('\n')}${open.length > SHOWN ? `\n…and ${open.length - SHOWN} more` : ''}`
  }
  if (!given.length) throw new Error(`Which items to ${action}?`)
  if (action === 'add') {
    for (const item of given) await ha('/api/services/todo/add_item', { entity_id: list.id, item })
    log(`lists: added ${given.length} to ${list.id}`)
    return `Added to ${list.name}: ${given.join(', ')}.`
  }
  if (action !== 'tick' && action !== 'remove') throw new Error(`Unknown action "${action}".`)
  const open = await items(list.id)
  const done: string[] = []
  const missing: string[] = []
  for (const want of given) {
    const w = want.toLowerCase()
    const match = open.find(i => i.summary.toLowerCase() === w) ?? open.find(i => i.summary.toLowerCase().includes(w))
    if (!match) {
      missing.push(want)
      continue
    }
    if (action === 'tick') await ha('/api/services/todo/update_item', { entity_id: list.id, item: match.uid, status: 'completed' })
    else await ha('/api/services/todo/remove_item', { entity_id: list.id, item: match.uid })
    open.splice(open.indexOf(match), 1)
    done.push(match.summary)
  }
  log(`lists: ${action} ${done.length} on ${list.id}`)
  return [
    done.length ? `${action === 'tick' ? 'Ticked off' : 'Removed from'} ${list.name}: ${done.join(', ')}.` : '',
    missing.length ? `Not on ${list.name}: ${missing.join(', ')}.` : '',
  ].filter(Boolean).join(' ')
}

export async function handleLists(req: Request): Promise<Response> {
  if (!adminValid(req.headers.get('x-admin-token'))) return json({ error: 'admin mode needed' }, 403)
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    if (!Array.isArray(body.allowed)) return json({ error: 'allowed: a list of ids' }, 400)
    const ids = body.allowed.filter((id: unknown) => typeof id === 'string' && /^todo\.[a-z0-9_]+$/.test(id))
    writeFileSync(LISTS_FILE, JSON.stringify({ allowed: ids }, null, 1))
    log(`lists: allowed ${ids.join(', ') || 'none'}`)
  }
  try {
    const allowed = new Set(allowedLists())
    return json({ lists: (await allLists()).map(l => ({ ...l, allowed: allowed.has(l.id) })) })
  } catch (err) {
    return json({ error: (err as Error).message }, 502)
  }
}
