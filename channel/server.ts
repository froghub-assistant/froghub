#!/usr/bin/env bun
/**
 * Frog Hub channel for Claude Code: the display's own assistant (a separate, locked-down session).
 *
 * The Frog Hub web app POSTs what was heard to /ask (through the web server at <site>/api/, which only
 * lets the home network in). Each request becomes a <channel source="froghub"> event in the session,
 * and the HTTP request stays open until Claude calls the reply tool (or the timeout passes).
 *
 * Admin mode: POST /api/admin/unlock with the PIN (hash in ~/.config/froghub/pin, set with `bun set-pin.ts`)
 * returns a token; requests carrying it in X-Admin-Token are marked mode="admin". Tokens expire after 10 idle
 * minutes, and 5 wrong PINs lock unlocking for 5 minutes.
 *
 * Besides answering, the assistant can think harder (thinker.ts), announce on the displays unprompted, and schedule
 * jobs for later (schedule.ts). After FROGHUB_CLEAR_AFTER quiet minutes it gets a fresh conversation (/clear typed
 * into its tmux), so old chat doesn't pile up; its memory files stay.
 *
 * Environment:
 *   FROGHUB_PORT         listen port on 127.0.0.1 (default 8790)
 *   FROGHUB_TIMEOUT      seconds to wait for a reply (default 45)
 *   FROGHUB_CLEAR_AFTER  quiet minutes before a fresh conversation (default 30; 0 never)
 *   FROGHUB_BIG_MODEL    the model think_harder asks (default sonnet; "none" turns it off)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { spawnSync } from 'child_process'
import { randomBytes } from 'crypto'
import { THINK_DESCRIPTION, bigModel, thinkHarder } from './thinker.ts'
import { type Job, runScheduleTool, scheduleTools, startSchedule } from './schedule.ts'
import { weatherTool, getWeather } from './weather.ts'
import { findRecipe, recipeTool } from './recipes.ts'
import { alarmTools, runAlarmTool, handleAlarms } from './alarms.ts'
import { handleStore, isGrownUps, policy, sharedSettings } from './store.ts'
import { handleRegistry } from './registry.ts'
import { handleMemory } from './memory.ts'
import { handleInstance } from './instance.ts'
import { handlePair } from './pair.ts'
import { type Display, displayTool, cleanDisplay } from './display.ts'
import { handleSamples } from './samples.ts'
import { type Screen, announce, findDisplay, handleAnnouncements, message, onlineDisplays, screenFor } from './announce.ts'
import { PERSONALITIES, SERVICES, type Reply, adminValid, clean, cleanActions, deviceLines, handleAdminCheck, handleLock, handleUnlock, json, log, londonTime } from './common.ts'

const PORT = Number(process.env.FROGHUB_PORT || 8790)
const TIMEOUT_MS = Number(process.env.FROGHUB_TIMEOUT || 45) * 1000
const CLEAR_AFTER_MS = Number(process.env.FROGHUB_CLEAR_AFTER ?? 30) * 60_000

const pending = new Map<string, (reply: Reply) => void>()
const displays = new Map<string, Display>() // what show_on_screen put up for a request, sent along with its reply
const askedFrom = new Map<string, Screen>() // which display each open request came from (for send_message)

const mcp = new Server(
  { name: 'froghub', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} },
    },
    instructions: [
      'Things said to the Frog Hub display arrive as <channel source="froghub" request_id="..." personality="..." speaker="..." time="..." [mode="admin"] [audience="grown-ups"]>. mode="admin" means a grown-up unlocked admin mode with the PIN; audience="grown-ups" means a grown-up marked that display as a grown-ups one, so the kids\' rules don\'t apply there (see CLAUDE.md). ' +
        'Answer with the reply tool, passing request_id back. The display waits ' +
        TIMEOUT_MS / 1000 +
        ' seconds at most, so reply promptly.',
      'The reply is spoken aloud and shown in big text: one to three short sentences of plain spoken English, no markdown, emoji, URLs or lists. ' +
        'Speak as the personality named in the tag (see CLAUDE.md). Set continue_conversation when you ask a question, so the display keeps listening.',
      'A tag with kind="announcement" is not someone talking to the display: a grown-up at home wants you to tell the room something unprompted. ' +
        'Its text says what; your reply is spoken out of the blue, so make it make sense on its own. Never set continue_conversation for one.',
      'A tag with kind="scheduled" is a job you scheduled earlier coming due: its text is the prompt you saved. Answer it like an announcement.',
    ].join('\n'),
  },
)

const { request_id: _, ...cardFields } = displayTool.inputSchema.properties

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Answer something said to the Frog Hub display. It is spoken aloud and shown on screen.',
      inputSchema: {
        type: 'object',
        properties: {
          request_id: { type: 'string', description: 'request_id from the <channel source="froghub"> tag' },
          text: { type: 'string', description: 'Plain spoken text; no markdown, emoji or URLs' },
          continue_conversation: { type: 'boolean', description: 'Keep listening for an answer (use when asking a question)' },
          actions: {
            type: 'array',
            description: "Control devices from the request's [Room devices: …] list. The display only carries out actions on those.",
            items: {
              type: 'object',
              properties: {
                entity_id: { type: 'string' },
                service: { type: 'string', enum: [...SERVICES] },
                value: { type: 'number', description: '0-100, for brightness and volume' },
                query: {
                  type: 'string',
                  description: 'For play_music on an Echo media_player: what to play, e.g. "Taylor Swift", "relaxing piano", "the Frozen soundtrack". It plays from Spotify.',
                },
              },
              required: ['entity_id', 'service'],
            },
          },
        },
        required: ['request_id', 'text'],
      },
    },
    weatherTool,
    recipeTool,
    ...alarmTools,
    displayTool,
    ...(bigModel('sonnet') ? [{
      name: 'think_harder',
      description: `${THINK_DESCRIPTION} Put the answer it gives in your own words in your reply. If it fails, answer yourself.`,
      inputSchema: {
        type: 'object',
        properties: { question: { type: 'string', description: 'The question, with whatever it needs to know from the conversation (it sees nothing else)' } },
        required: ['question'],
      },
    }] : []),
    {
      name: 'announce',
      description:
        'Say and show something on the displays now, without anyone having asked there (e.g. while answering a ' +
        'scheduled job, or "tell everyone tea is ready" from the admin page). For passing on a message from the ' +
        'display you were asked at, use send_message instead.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'What they will hear, making sense on its own' },
          show: { type: 'object', properties: cardFields, description: 'A card to show with it (as show_on_screen)' },
          to: { type: 'string', description: "One display's name; leave out for all of them" },
          at_night: { type: 'boolean', description: 'Speak it during night hours too (otherwise it is only shown then)' },
        },
        required: ['text'],
      },
    },
    ...scheduleTools,
    {
      name: 'send_message',
      description:
        'Pass a message on to the other Frog Hub displays (e.g. "tell the kitchen I am hungry"): they say it aloud and show it. ' +
        'Not shown on the display you were asked from. Then reply as usual to say it is sent.',
      inputSchema: {
        type: 'object',
        properties: {
          request_id: { type: 'string' },
          text: { type: 'string', description: 'What they will hear, making sense on its own, e.g. "Sam says they are hungry!"' },
          to: { type: 'string', description: "One display's name, from the [Other displays: …] list; leave out for all of them" },
        },
        required: ['request_id', 'text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const off = (what: string) => ({ isError: true, content: [{ type: 'text' as const, text: `A grown-up has turned off ${what} in Frog Hub's settings.` }] })
  if (req.params.name === 'get_weather') {
    if (!policy().weather) return off('the weather')
    try {
      return { content: [{ type: 'text', text: await getWeather(req.params.arguments ?? {}) }] }
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Couldn't get the weather: ${(err as Error).message}` }] }
    }
  }
  if (req.params.name === 'find_recipe') {
    try {
      return { content: [{ type: 'text', text: await findRecipe(req.params.arguments ?? {}) }] }
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] }
    }
  }
  if (req.params.name === 'show_on_screen') {
    if (!policy().screen) return off('showing things on the screen')
    const a = (req.params.arguments ?? {}) as Record<string, unknown>
    if (!pending.has(String(a.request_id))) return { isError: true, content: [{ type: 'text', text: 'No open request with that id: call show_on_screen before reply.' }] }
    try {
      displays.set(String(a.request_id), await cleanDisplay(a))
      return { content: [{ type: 'text', text: 'It will appear on the screen with your reply.' }] }
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] }
    }
  }
  if (req.params.name === 'send_message') {
    if (!policy().announce) return off('sending messages to the other displays')
    const a = (req.params.arguments ?? {}) as Record<string, unknown>
    const id = String(a.request_id)
    if (!pending.has(id)) return { isError: true, content: [{ type: 'text', text: 'No open request with that id.' }] }
    const text = clean(a.text, 300)
    if (!text) return { isError: true, content: [{ type: 'text', text: 'Nothing to send.' }] }
    const from = askedFrom.get(id)
    const others = onlineDisplays(from?.id)
    if (!others.length) return { isError: true, content: [{ type: 'text', text: 'No other Frog Hub displays are on right now.' }] }
    const to = a.to ? findDisplay(String(a.to), from?.id) : undefined
    if (a.to && !to) {
      return { isError: true, content: [{ type: 'text', text: `No display called "${a.to}" is on. Displays that are on: ${others.map(s => s.name).join(', ')}.` }] }
    }
    message(text, from, to)
    return { content: [{ type: 'text', text: `Sent to ${to ? to.name : others.map(s => s.name).join(', ')}.` }] }
  }
  if (req.params.name === 'think_harder') {
    try {
      return { content: [{ type: 'text', text: await thinkHarder(clean((req.params.arguments ?? {}).question, 4000)) }] }
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] }
    }
  }
  if (req.params.name === 'announce') {
    if (!policy().announce) return off('announcements')
    const a = (req.params.arguments ?? {}) as Record<string, unknown>
    const text = clean(a.text, 500)
    if (!text) return { isError: true, content: [{ type: 'text', text: 'Nothing to say.' }] }
    const to = a.to ? findDisplay(String(a.to)) : undefined
    if (a.to && !to) return { isError: true, content: [{ type: 'text', text: `No display called "${a.to}" is on. Displays that are on: ${onlineDisplays().map(s => s.name).join(', ') || 'none'}.` }] }
    try {
      const display = a.show && typeof a.show === 'object' ? await cleanDisplay({ ...(a.show as Record<string, unknown>) }) : undefined
      announce({ text, display, to: to?.id, at_night: a.at_night === true })
      return { content: [{ type: 'text', text: `Announced on ${to ? to.name : 'every display that is on'}.` }] }
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] }
    }
  }
  if (scheduleTools.some(t => t.name === req.params.name)) {
    if (!policy().announce) return off('announcements')
    try {
      return { content: [{ type: 'text', text: runScheduleTool(req.params.name, req.params.arguments ?? {}) }] }
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] }
    }
  }
  if (alarmTools.some(t => t.name === req.params.name)) {
    if (!policy().alarms) return off('alarms and timers')
    try {
      return { content: [{ type: 'text', text: runAlarmTool(req.params.name, req.params.arguments ?? {}) }] }
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] }
    }
  }
  if (req.params.name !== 'reply') {
    throw new Error(`unknown tool: ${req.params.name}`)
  }
  const args = (req.params.arguments ?? {}) as { request_id?: string; text?: string; continue_conversation?: boolean; actions?: unknown }
  const resolve = pending.get(String(args.request_id))
  if (!resolve) {
    return { isError: true, content: [{ type: 'text', text: 'No open request with that id: it timed out or was already answered.' }] }
  }
  const allowed = policy()
  const actions = cleanActions(args.actions)
    .filter(a => allowed.devices && (allowed.music || a.service !== 'play_music'))
  const display = displays.get(String(args.request_id))
  displays.delete(String(args.request_id))
  resolve({ text: String(args.text ?? ''), continue_conversation: Boolean(args.continue_conversation), actions, ...(display ? { display } : {}) })
  return { content: [{ type: 'text', text: 'sent' }] }
})

await mcp.connect(new StdioServerTransport())

async function handleAsk(req: Request): Promise<Response> {
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
    !allowed.alarms && 'alarms and timers', !allowed.devices && 'room devices', allowed.devices && !allowed.music && 'playing music',
    !allowed.announce && 'sending messages to other displays',
  ].filter(Boolean)

  const answer = await askAssistant(
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

/** Hands text to the assistant as a channel event and waits for its reply tool call (null if it times out). */
async function askAssistant(content: string, meta: Record<string, string>, from?: Screen): Promise<Reply | null> {
  const request_id = randomBytes(4).toString('hex')
  lastActivity = Date.now()
  if (from) askedFrom.set(request_id, from)
  const reply = new Promise<Reply | null>(resolve => {
    const timer = setTimeout(() => {
      pending.delete(request_id)
      displays.delete(request_id)
      askedFrom.delete(request_id)
      resolve(null)
    }, TIMEOUT_MS)
    pending.set(request_id, r => {
      clearTimeout(timer)
      lastActivity = Date.now()
      pending.delete(request_id)
      askedFrom.delete(request_id)
      resolve(r)
    })
  })
  await mcp.notification({ method: 'notifications/claude/channel', params: { content, meta: { request_id, ...meta } } })
  return reply
}

// POST /api/admin/remember {text}: the admin page asking the assistant to remember (or change, or forget) something.
// Its memory is its own to keep tidy, so a grown-up asks rather than editing the files; the reply says what it did.
async function handleRemember(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const text = clean(body.text, 1000)
  if (!text) return json({ error: 'nothing to remember' }, 400)
  const wanted = String(sharedSettings().personality)
  const answer = await askAssistant(
    `${text}\n\n[From the admin page, not a display: a grown-up wants your memory updated. Save, change or forget ` +
      'what they ask with your memory tools (house rules marked as house rules), then reply with one short plain ' +
      'sentence saying what you did.]',
    { kind: 'admin-page', mode: 'admin', personality: PERSONALITIES.has(wanted) ? wanted : 'frog', speaker: 'a grown-up', time: londonTime() },
  )
  if (!answer?.text) return json({ error: 'the assistant did not answer in time' }, 504)
  return json({ ok: true, text: answer.text })
}

// POST /local/announce (see announce.ts). Only the server can reach it: Caddy just proxies /api/*.
async function handleAnnounce(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ error: 'invalid JSON' }, 400)
  const area = clean(body.area, 60) || undefined
  const at_night = body.at_night === true
  const target = body.to ? findDisplay(String(body.to)) : undefined
  if (body.to && !target) return json({ error: `no display called "${body.to}" is on`, on: onlineDisplays().map(s => s.name) }, 404)
  const to = target?.id
  const say = clean(body.say, 500)
  const prompt = clean(body.prompt, 1000)
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
  const answer = await announceFromPrompt(prompt, 'announcement', 'a grown-up at home', { personality: body.personality, area, to, at_night })
  if (!answer) return json({ error: 'the assistant did not answer in time' }, 504)
  return json({ ok: true, ...answer })
}

/** Asks the assistant `prompt` as an announcement (or a scheduled job) and announces its reply. */
async function announceFromPrompt(prompt: string, kind: string, speaker: string,
  o: { personality?: unknown; area?: string; to?: string; at_night: boolean }): Promise<{ id: number; text: string } | null> {
  const wanted = String(o.personality ?? sharedSettings().personality)
  const answer = await askAssistant(prompt, { kind, personality: PERSONALITIES.has(wanted) ? wanted : 'frog', speaker, time: londonTime() })
  if (!answer?.text) return null
  const id = announce({ text: answer.text, display: answer.display as Display | undefined, actions: answer.actions, area: o.area, to: o.to, at_night: o.at_night })
  return { id, text: answer.text }
}

// Scheduled jobs (schedule.ts): exact words are announced as they are, prompts go to the assistant first
startSchedule(async (job: Job) => {
  if (!policy().announce) return log(`schedule: announcements are off, skipped "${job.label}"`)
  const to = job.to ? findDisplay(job.to) : undefined
  if (job.to && !to) return log(`schedule: "${job.label}" is for ${job.to}, which isn't on`)
  if (job.say) announce({ text: job.say, display: { emoji: '🗓️', title: job.label, text: job.say, seconds: 60 }, to: to?.id, at_night: job.at_night })
  else if (job.prompt && !(await announceFromPrompt(job.prompt, 'scheduled', 'nobody (a job you scheduled)', { to: to?.id, at_night: job.at_night })))
    log(`schedule: the assistant didn't answer "${job.label}"`)
})

// A fresh conversation after a quiet spell: /clear typed into the assistant's tmux (setup/agent/start runs it there),
// only while no request is open. Its memory files and CLAUDE.md come back with it.
let lastActivity = Date.now()
let lastClear = Date.now()
if (CLEAR_AFTER_MS > 0) {
  setInterval(() => {
    if (pending.size || lastClear >= lastActivity || Date.now() - lastActivity < CLEAR_AFTER_MS) return
    const tmux = (...args: string[]) => spawnSync('tmux', ['-L', 'froghub', ...args]).status === 0
    if (tmux('send-keys', '-t', 'froghub', '-l', '/clear') && tmux('send-keys', '-t', 'froghub', 'Enter')) log('quiet for a while: cleared the conversation')
    lastClear = Date.now()
  }, 60_000)
}


try {
  Bun.serve({
    port: PORT,
    hostname: '127.0.0.1', // only reachable through Caddy, which only admits the home network
    idleTimeout: Math.min(255, TIMEOUT_MS / 1000 + 10),
    async fetch(req) {
      const { pathname } = new URL(req.url)
      if (req.method === 'GET' && pathname === '/api/ping') return json({ ok: true })
      if (req.method === 'GET' && pathname === '/api/instance') return handleInstance()
      if (req.method === 'POST' && pathname === '/api/ask') return handleAsk(req)
      if (req.method === 'POST' && pathname === '/api/admin/unlock') return handleUnlock(req)
      if (req.method === 'POST' && pathname === '/api/admin/check') return handleAdminCheck(req)
      if (req.method === 'POST' && pathname === '/api/admin/lock') return handleLock(req)
      if (pathname.startsWith('/api/alarms')) return handleAlarms(req, pathname)
      if (['/api/policy', '/api/settings', '/api/audience'].includes(pathname)) return handleStore(req, pathname)
      if (['/api/announcements', '/api/displays', '/api/announce'].includes(pathname)) return handleAnnouncements(req, pathname)
      if (pathname.startsWith('/api/wakeword/')) return handleSamples(req, pathname)
      if (pathname === '/api/admin/displays') return handleRegistry(req, pathname)
      if (pathname === '/api/pair' || pathname === '/api/admin/pair') return handlePair(req, pathname)
      if (pathname === '/api/admin/memory') return handleMemory(req)
      if (req.method === 'POST' && pathname === '/local/announce') return handleAnnounce(req)
      if (req.method === 'POST' && pathname === '/api/admin/remember') {
        return adminValid(req.headers.get('x-admin-token')) ? handleRemember(req) : json({ error: 'admin mode needed' }, 403)
      }
      // The admin page can announce like the server can (say or prompt, to, at_night), behind the PIN
      if (req.method === 'POST' && pathname === '/api/admin/announce') {
        return adminValid(req.headers.get('x-admin-token')) ? handleAnnounce(req) : json({ error: 'admin mode needed' }, 403)
      }
      return new Response('not found', { status: 404 })
    },
  })
  log(`listening on 127.0.0.1:${PORT}`)
} catch (err) {
  log(`could not listen on :${PORT}: ${err}`)
}
