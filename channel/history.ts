/**
 * A log of everything the assistant was asked and what it answered, for the admin page: questions at the displays,
 * the admin page's memory requests, announcements and scheduled jobs. One JSON line each in
 * ~/.config/froghub/history.jsonl (only the owner can read it), the newest 1,000 kept.
 *
 *   GET  /api/admin/history?before=<at>&limit=<n>   { items: newest first, more }   admin only
 *   POST /api/admin/history {clear: true}           forget it all                   admin only
 */
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { adminValid, json, log } from './common.ts'
import type { Ask } from './app.ts'

export const HISTORY_FILE = join(homedir(), '.config', 'froghub', 'history.jsonl')
const KEEP = 1000
const PAGE = 50

export type Entry = {
  at: number // when it was asked (ms)
  kind: string // ask (at a display), admin-page, announcement or scheduled
  display?: string
  speaker?: string
  personality?: string
  admin?: boolean
  text: string
  answer: string | null // null: no answer in time
  actions?: string[] // e.g. "light.turn_on light.lounge"
  shown?: string // the title of a card it put on the screen
  ms: number
  error?: string
}

const read = (): Entry[] =>
  existsSync(HISTORY_FILE) ? readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean).flatMap(l => {
    try {
      return [JSON.parse(l)]
    } catch {
      return []
    }
  }) : []

function add(entry: Entry): void {
  try {
    const fresh = !existsSync(HISTORY_FILE)
    appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n')
    if (fresh) chmodSync(HISTORY_FILE, 0o600)
    // Trimmed now and then rather than every time
    if (readFileSync(HISTORY_FILE, 'utf8').split('\n').length > KEEP * 1.2)
      writeFileSync(HISTORY_FILE, read().slice(-KEEP).map(e => JSON.stringify(e)).join('\n') + '\n')
  } catch (err) {
    log(`history: couldn't save (${err})`)
  }
}

/** `ask`, writing down each question and its answer. What was said is the part before the bracketed notes for the
 * assistant ([Room devices: …] and the like). */
export function logged(ask: Ask): Ask {
  return async (content, meta, from) => {
    const at = Date.now()
    const entry = (rest: Partial<Entry>): Entry => ({
      at, kind: meta.kind || 'ask', ...(from ? { display: from.name } : {}),
      ...(meta.speaker ? { speaker: meta.speaker } : {}), ...(meta.personality ? { personality: meta.personality } : {}),
      ...(meta.mode === 'admin' ? { admin: true } : {}),
      text: content.split('\n\n[')[0].trim(), answer: null, ms: Date.now() - at, ...rest,
    })
    try {
      const reply = await ask(content, meta, from)
      const shown = (reply?.display as { title?: unknown } | undefined)?.title
      add(entry({
        answer: reply ? reply.text : null,
        ...(reply?.actions.length ? { actions: reply.actions.map(a => `${a.service} ${a.entity_id}`) } : {}),
        ...(typeof shown === 'string' && shown ? { shown } : {}),
      }))
      return reply
    } catch (err) {
      add(entry({ error: (err as Error).message }))
      throw err
    }
  }
}

export async function handleHistory(req: Request): Promise<Response> {
  if (!adminValid(req.headers.get('x-admin-token'))) return json({ error: 'admin mode needed' }, 403)
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const before = Number(url.searchParams.get('before')) || Infinity
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || PAGE, 1), 200)
    const older = read().filter(e => e.at < before).reverse()
    return json({ items: older.slice(0, limit), more: older.length > limit })
  }
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    if (body?.clear !== true) return json({ error: 'nothing to do' }, 400)
    writeFileSync(HISTORY_FILE, '')
    return json({ ok: true })
  }
  return new Response('not found', { status: 404 })
}
