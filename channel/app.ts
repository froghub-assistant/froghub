/**
 * Frog Hub's HTTP API, the same whichever brain answers: server.ts (Claude Code, over the channel) and standalone.ts
 * (a model API) each give `serve` their way of asking the assistant something, and everything else (alarms,
 * announcements, displays, pairing, settings, scheduled jobs...) is here.
 */
import { type Reply, PERSONALITIES, adminValid, clean, deviceLines, handleAdminCheck, handleLock, handleUnlock, json, log, londonTime } from './common.ts'
import { handleAlarms } from './alarms.ts'
import { handleStore, isGrownUps, policy, sharedSettings } from './store.ts'
import { handleRegistry } from './registry.ts'
import { handleMemory } from './memory.ts'
import { handleHistory, logged } from './history.ts'
import { handleInstance } from './instance.ts'
import { handlePair } from './pair.ts'
import { type Display, cleanDisplay } from './display.ts'
import { handleSamples } from './samples.ts'
import { type Screen, announce, findDisplay, handleAnnouncements, onlineDisplays, screenFor } from './announce.ts'
import { type Job, startSchedule } from './schedule.ts'
import { checkAudioUrl } from './audio.ts'
import { goodnightOptions } from './goodnight.ts'
import { handleRadio } from './radio.ts'
import { handleLists } from './lists.ts'

/** Hands `content` to the assistant (meta: personality, speaker, time, and kind, mode, audience, conversation_id
 * when they apply) and waits for its reply; null if it didn't answer in time. */
export type Ask = (content: string, meta: Record<string, string>, from?: Screen) => Promise<Reply | null>

// POST /api/ask: what was said (or typed) at a display
async function handleAsk(req: Request, ask: Ask): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  const text = clean(body.text, 1000)
  if (!text) return json({ error: 'missing text' }, 400)
  const personality = PERSONALITIES.has(String(body.personality)) ? String(body.personality) : 'frog'
  const allowed = policy()
  const devices = allowed.devices ? deviceLines(body.devices) : []
  const from = screenFor(body.device)
  const others = allowed.announce ? onlineDisplays(from?.id).map(s => s.name) : []
  const offList = [
    !allowed.webSearch && 'web search', !allowed.memory && 'remembering things', !allowed.weather && 'the weather',
    !allowed.alarms && 'alarms and timers', !allowed.lists && 'the shared lists', !allowed.devices && 'room devices', allowed.devices && !allowed.music && 'playing music',
    !allowed.announce && 'sending messages to other displays',
  ].filter(Boolean)

  const answer = await ask(
    [
      text,
      ...(devices.length ? [`[Room devices: ${devices.join('; ')}]`] : []),
      ...(others.length ? [`[Other displays: ${others.join(', ')}]`] : []),
      ...(offList.length ? [`[Turned off by a grown-up: ${offList.join(', ')}. Say so kindly if asked.]`] : []),
    ].join('\n\n'),
    {
      personality,
      speaker: (allowed.name && clean(body.speaker, 40)) || 'someone',
      time: londonTime(),
      ...(clean(body.conversation_id, 60) ? { conversation_id: clean(body.conversation_id, 60) } : {}),
      ...(adminValid(req.headers.get('x-admin-token')) ? { mode: 'admin' } : {}),
      ...(isGrownUps(body.device) ? { audience: 'grown-ups' } : {}),
    },
    from,
  )
  if (!answer) return json({ text: '', continue_conversation: false, actions: [], timed_out: true })
  return json(answer)
}

// POST /api/admin/remember {text}: the admin page asking the assistant to remember (or change, or forget) something.
// Its memory is its own to keep tidy, so a grown-up asks rather than editing the files; the reply says what it did.
async function handleRemember(req: Request, ask: Ask): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const text = clean(body.text, 1000)
  if (!text) return json({ error: 'nothing to remember' }, 400)
  const wanted = String(sharedSettings().personality)
  const answer = await ask(
    `${text}\n\n[From the admin page, not a display: a grown-up wants your memory updated. Save, change or forget ` +
      'what they ask with your memory tools (house rules marked as house rules), then reply with one short plain ' +
      'sentence saying what you did.]',
    { kind: 'admin-page', mode: 'admin', personality: PERSONALITIES.has(wanted) ? wanted : 'frog', speaker: 'a grown-up', time: londonTime() },
  )
  if (!answer?.text) return json({ error: 'the assistant did not answer in time' }, 504)
  return json({ ok: true, text: answer.text })
}

// POST /local/announce (see announce.ts). Only the server can reach it: Caddy just proxies /api/*.
async function handleAnnounce(req: Request, ask: Ask): Promise<Response> {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ error: 'invalid JSON' }, 400)
  const area = clean(body.area, 60) || undefined
  const at_night = body.at_night === true
  const target = body.to ? findDisplay(String(body.to)) : undefined
  if (body.to && !target) return json({ error: `no display called "${body.to}" is on`, on: onlineDisplays().map(s => s.name) }, 404)
  const to = target?.id
  const say = clean(body.say, 500)
  const prompt = clean(body.prompt, 1000)
  if (body.audio !== undefined) {
    if (!policy().music) return json({ error: 'a grown-up has turned off playing music' }, 403)
    try {
      const url = await checkAudioUrl(body.audio)
      const title = clean(body.title, 80)
      return json({ ok: true, id: announce({ text: say, audio: { url, ...(title ? { title } : {}) }, area, to, at_night }) })
    } catch (err) {
      return json({ error: (err as Error).message }, 400)
    }
  }
  if (body.goodnight === true) return json({ ok: true, id: announce({ text: say, goodnight: goodnightOptions(body), area, to, at_night: true }) })
  if (body.stop_audio === true) return json({ ok: true, id: announce({ text: '', audio: { stop: true }, area, to, at_night: true }) })
  if (say) {
    let display: Display | undefined
    try {
      if (body.show) display = await cleanDisplay({ ...body.show })
    } catch (err) {
      return json({ error: (err as Error).message }, 400)
    }
    return json({ ok: true, id: announce({ text: say, display, area, to, at_night }) })
  }
  if (!prompt) return json({ error: 'give "say" (the exact words) or "prompt" (what the assistant should tell the room)' }, 400)
  const answer = await announceFromPrompt(ask, prompt, 'announcement', 'a grown-up at home', { personality: body.personality, area, to, at_night })
  if (!answer) return json({ error: 'the assistant did not answer in time' }, 504)
  return json({ ok: true, ...answer })
}

/** Asks the assistant `prompt` as an announcement (or a scheduled job) and announces its reply. */
async function announceFromPrompt(ask: Ask, prompt: string, kind: string, speaker: string,
  o: { personality?: unknown; area?: string; to?: string; at_night: boolean }): Promise<{ id: number; text: string } | null> {
  const wanted = String(o.personality ?? sharedSettings().personality)
  const answer = await ask(prompt, { kind, personality: PERSONALITIES.has(wanted) ? wanted : 'frog', speaker, time: londonTime() })
  if (!answer?.text) return null
  const id = announce({ text: answer.text, display: answer.display as Display | undefined, actions: answer.actions, area: o.area, to: o.to, at_night: o.at_night })
  return { id, text: answer.text }
}

/** Runs a scheduled job (schedule.ts): exact words are announced as they are, prompts go to the assistant first. */
export async function runJob(ask: Ask, job: Job): Promise<void> {
  if (!policy().announce) return log(`schedule: announcements are off, skipped "${job.label}"`)
  const to = job.to ? findDisplay(job.to) : undefined
  if (job.to && !to) return log(`schedule: "${job.label}" is for ${job.to}, which isn't on`)
  if (job.say) announce({ text: job.say, display: { emoji: '🗓️', title: job.label, text: job.say, seconds: 60 }, to: to?.id, at_night: job.at_night })
  else if (job.prompt && !(await announceFromPrompt(ask, job.prompt, 'scheduled', 'nobody (a job you scheduled)', { to: to?.id, at_night: job.at_night })))
    log(`schedule: the assistant didn't answer "${job.label}"`)
}

/** The request handler: every route, with `ask` for the ones that need the assistant (each one logged). */
export function routes(unlogged: Ask, ping: () => Record<string, unknown> = () => ({ ok: true })) {
  const ask = logged(unlogged)
  return async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url)
    if (req.method === 'GET' && pathname === '/api/ping') return json(ping())
    if (req.method === 'GET' && pathname === '/api/instance') return handleInstance()
    if (req.method === 'POST' && pathname === '/api/ask') return handleAsk(req, ask)
    if (req.method === 'POST' && pathname === '/api/admin/unlock') return handleUnlock(req)
    if (req.method === 'POST' && pathname === '/api/admin/check') return handleAdminCheck(req)
    if (req.method === 'POST' && pathname === '/api/admin/lock') return handleLock(req)
    if (pathname.startsWith('/api/alarms')) return handleAlarms(req, pathname)
    if (['/api/policy', '/api/settings', '/api/audience'].includes(pathname)) return handleStore(req, pathname)
    if (['/api/announcements', '/api/displays', '/api/announce'].includes(pathname)) return handleAnnouncements(req, pathname)
    if (pathname.startsWith('/api/wakeword/')) return handleSamples(req, pathname)
    if (pathname.startsWith('/api/radio/')) return handleRadio(req, pathname)
    if (pathname === '/api/admin/displays') return handleRegistry(req, pathname)
    if (pathname === '/api/pair' || pathname === '/api/admin/pair') return handlePair(req, pathname)
    if (pathname === '/api/admin/memory') return handleMemory(req)
    if (pathname === '/api/admin/history') return handleHistory(req)
    if (pathname === '/api/admin/lists') return handleLists(req)
    if (req.method === 'POST' && pathname === '/local/announce') return handleAnnounce(req, ask)
    if (req.method === 'POST' && pathname === '/api/admin/remember') {
      return adminValid(req.headers.get('x-admin-token')) ? handleRemember(req, ask) : json({ error: 'admin mode needed' }, 403)
    }
    // The admin page can announce like the server can (say or prompt, to, at_night), behind the PIN
    if (req.method === 'POST' && pathname === '/api/admin/announce') {
      return adminValid(req.headers.get('x-admin-token')) ? handleAnnounce(req, ask) : json({ error: 'admin mode needed' }, 403)
    }
    return new Response('not found', { status: 404 })
  }
}

/** Listens on 127.0.0.1:`port` (only reachable through Caddy, which only admits the home network) and runs the
 * scheduled jobs. */
export function serve(ask: Ask, o: { port: number; idleTimeout: number; ping?: () => Record<string, unknown> }): void {
  try {
    Bun.serve({ port: o.port, hostname: '127.0.0.1', idleTimeout: o.idleTimeout, fetch: routes(ask, o.ping) })
    log(`listening on 127.0.0.1:${o.port}`)
  } catch (err) {
    log(`could not listen on :${o.port}: ${err}`)
  }
  const asked = logged(ask)
  startSchedule(job => runJob(asked, job))
}
