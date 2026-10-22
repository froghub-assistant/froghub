#!/usr/bin/env bun
/**
 * Frog Hub's assistant without Claude Code: answers /api/ask itself by calling a model API. For a house without
 * Claude Code (`bun run setup` → the API brain). Same HTTP API as server.ts, so the
 * web app doesn't know the difference.
 *
 * Brain: Claude via the Anthropic API when ANTHROPIC_API_KEY is set, otherwise (or when that fails) an
 * OpenAI-compatible server such as LM Studio at FROGHUB_FALLBACK_URL.
 *
 * Environment (put secrets in an EnvironmentFile, not the unit):
 *   ANTHROPIC_API_KEY       Anthropic API key (optional)
 *   FROGHUB_MODEL           Claude model (default claude-haiku-5-5)
 *   FROGHUB_BIG_MODEL       the bigger one it hands hard questions to (default claude-sonnet-5-5; "none" turns it off)
 *   FROGHUB_FALLBACK_URL    OpenAI-compatible base URL, e.g. http://192.168.1.20:1234/v1 (optional)
 *   FROGHUB_FALLBACK_MODEL  model name there
 *   FROGHUB_PROMPT          the assistant's instructions (default ~/.config/froghub/assistant.md)
 *   FROGHUB_MEMORY          its memory file (default ~/.config/froghub/memory.md)
 *   FROGHUB_PORT            listen port on 127.0.0.1 (default 8790)
 */
import { appendFileSync, existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { PERSONALITIES, SERVICES, type Reply, adminValid, clean, cleanActions, deviceLines, handleAdminCheck, handleLock, handleUnlock, json, log, londonTime } from './common.ts'
import { handleInstance } from './instance.ts'
import { THINK_DESCRIPTION, bigModel } from './thinker.ts'

const PORT = Number(process.env.FROGHUB_PORT || 8790)
const API_KEY = process.env.ANTHROPIC_API_KEY || ''
const MODEL = process.env.FROGHUB_MODEL || 'claude-haiku-5-5'
const BIG_MODEL = bigModel('claude-sonnet-5-5')
const FALLBACK_URL = (process.env.FROGHUB_FALLBACK_URL || '').replace(/\/+$/, '')
const FALLBACK_MODEL = process.env.FROGHUB_FALLBACK_MODEL || ''
const PROMPT_FILE = process.env.FROGHUB_PROMPT || join(homedir(), '.config', 'froghub', 'assistant.md')
const MEMORY_FILE = process.env.FROGHUB_MEMORY || join(homedir(), '.config', 'froghub', 'memory.md')
const TIMEOUT_MS = 40_000
const HISTORY_TURNS = 6 // per conversation, which the display resets after 5 quiet minutes
const MAX_MEMORY_CHARS = 6000

type Turn = { role: 'user' | 'assistant'; content: string }
const conversations = new Map<string, { turns: Turn[]; at: number }>()

const REPLY_TOOL = {
  name: 'reply',
  description: 'Answer what was said to the Frog Hub display. It is spoken aloud and shown on screen.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'One to three short spoken sentences; no markdown, emoji or URLs' },
      continue_conversation: { type: 'boolean', description: 'Keep listening for an answer (use when asking a question)' },
      actions: {
        type: 'array',
        description: 'Control devices from the [Room devices: …] list. The display only carries out actions on those.',
        items: {
          type: 'object',
          properties: {
            entity_id: { type: 'string' },
            service: { type: 'string', enum: [...SERVICES] },
            value: { type: 'number', description: '0-100, for brightness and volume' },
            query: { type: 'string', description: 'For play_music on an Echo: what to play, e.g. "Sandstorm by Darude"' },
          },
          required: ['entity_id', 'service'],
        },
      },
    },
    required: ['text'],
  },
}

// Asking for it hands the whole request to BIG_MODEL, which then replies itself
const THINK_TOOL = {
  name: 'think_harder',
  description: THINK_DESCRIPTION,
  input_schema: { type: 'object', properties: { why: { type: 'string', description: 'What needs the extra thought' } } },
}

const REMEMBER_TOOL = {
  name: 'remember',
  description: 'Save a short note to your long-term memory (things people ask you to remember, preferences).',
  input_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
}

function systemPrompt(personality: string, speaker: string, admin: boolean): string {
  const rules = existsSync(PROMPT_FILE) ? readFileSync(PROMPT_FILE, 'utf8') : 'You are Frog Hub, a friendly smart display.'
  const memory = existsSync(MEMORY_FILE) ? readFileSync(MEMORY_FILE, 'utf8').slice(-MAX_MEMORY_CHARS) : ''
  return [
    rules,
    `Right now you are the "${personality}" personality, talking to ${speaker}. It is ${londonTime()}.`,
    admin ? 'This request is in admin mode (a grown-up unlocked it with the PIN).' : 'This request is not in admin mode.',
    memory ? `## Your memory\n\n${memory}` : 'Your memory is empty so far.',
    'Always answer by calling the reply tool.',
  ].join('\n\n')
}

function remember(note: string): void {
  const line = clean(note, 300)
  if (line) appendFileSync(MEMORY_FILE, `- ${line}\n`)
}

async function askClaude(system: string, messages: Turn[], model = MODEL): Promise<Reply> {
  const convo: unknown[] = messages.map(m => ({ role: m.role, content: m.content }))
  const canThink = Boolean(BIG_MODEL) && model !== BIG_MODEL
  for (let round = 0; round < 3; round++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system,
        messages: convo,
        tools: [REPLY_TOOL, REMEMBER_TOOL, ...(canThink ? [THINK_TOOL] : []), { type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
        tool_choice: { type: 'any' },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const content = (await r.json()).content as { type: string; id?: string; name?: string; input?: Record<string, unknown> }[]
    const uses = content.filter(b => b.type === 'tool_use')
    for (const u of uses) if (u.name === 'remember') remember(String(u.input?.note ?? ''))
    if (canThink && uses.some(u => u.name === 'think_harder')) {
      log(`thinking harder with ${BIG_MODEL}: ${clean(uses.find(u => u.name === 'think_harder')?.input?.why, 200)}`)
      return askClaude(system, messages, BIG_MODEL)
    }
    const reply = uses.find(u => u.name === 'reply')
    if (reply) {
      const i = reply.input ?? {}
      return { text: String(i.text ?? ''), continue_conversation: Boolean(i.continue_conversation), actions: cleanActions(i.actions) }
    }
    // Only remembered something (or searched): tell it that went fine and ask again for the reply.
    convo.push({ role: 'assistant', content }, {
      role: 'user',
      content: uses.map(u => ({ type: 'tool_result', tool_use_id: u.id, content: 'done' })),
    })
  }
  throw new Error('no reply from the model')
}

async function askFallback(system: string, messages: Turn[]): Promise<Reply> {
  const tool = (t: typeof REPLY_TOOL | typeof REMEMBER_TOOL) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })
  const r = await fetch(`${FALLBACK_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: FALLBACK_MODEL,
      max_tokens: 400,
      messages: [{ role: 'system', content: system }, ...messages],
      tools: [tool(REPLY_TOOL), tool(REMEMBER_TOOL)],
      tool_choice: 'required',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`fallback ${r.status}`)
  const msg = (await r.json()).choices?.[0]?.message ?? {}
  let reply: Reply | null = null
  for (const c of msg.tool_calls ?? []) {
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(c.function.arguments || '{}') } catch {}
    if (c.function.name === 'remember') remember(String(args.note ?? ''))
    if (c.function.name === 'reply') reply = { text: String(args.text ?? ''), continue_conversation: Boolean(args.continue_conversation), actions: cleanActions(args.actions) }
  }
  if (!reply && typeof msg.content === 'string' && msg.content.trim() && !/[{}]/.test(msg.content)) {
    reply = { text: msg.content.trim().slice(0, 300), continue_conversation: false, actions: [] }
  }
  if (!reply) throw new Error('fallback gave no reply')
  return reply
}

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
  const speaker = clean(body.speaker, 40) || 'someone'
  const devices = deviceLines(body.devices)
  const admin = adminValid(req.headers.get('x-admin-token'))

  const id = clean(body.conversation_id, 60) || 'default'
  // (forget the stale ones first: a new conversation's `at` is 0 until it's answered)
  for (const [key, c] of conversations) if (Date.now() - c.at > 10 * 60_000) conversations.delete(key)
  const convo = conversations.get(id) ?? { turns: [], at: 0 }
  conversations.set(id, convo)

  const user = devices.length ? `${text}\n\n[Room devices: ${devices.join('; ')}]` : text
  const messages = [...convo.turns, { role: 'user' as const, content: user }]
  const system = systemPrompt(personality, speaker, admin)

  let answer: Reply | null = null
  if (API_KEY) {
    try {
      answer = await askClaude(system, messages)
    } catch (err) {
      log(`Claude failed: ${err}`)
    }
  }
  if (!answer && FALLBACK_URL) {
    try {
      answer = await askFallback(system, messages)
    } catch (err) {
      log(`fallback failed: ${err}`)
    }
  }
  if (!answer) return json({ text: '', continue_conversation: false, actions: [], timed_out: true })

  convo.turns.push({ role: 'user', content: user }, { role: 'assistant', content: answer.text })
  convo.turns = convo.turns.slice(-HISTORY_TURNS * 2)
  convo.at = Date.now()
  return json(answer)
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1', // only reachable through Caddy, which only admits the home network
  idleTimeout: 60,
  async fetch(req) {
    const { pathname } = new URL(req.url)
    if (req.method === 'GET' && pathname === '/api/ping') return json({ ok: true, brain: API_KEY ? MODEL : FALLBACK_MODEL || 'none' })
    if (req.method === 'GET' && pathname === '/api/instance') return handleInstance()
    if (req.method === 'POST' && pathname === '/api/ask') return handleAsk(req)
    if (req.method === 'POST' && pathname === '/api/admin/unlock') return handleUnlock(req)
    if (req.method === 'POST' && pathname === '/api/admin/check') return handleAdminCheck(req)
    if (req.method === 'POST' && pathname === '/api/admin/lock') return handleLock(req)
    return new Response('not found', { status: 404 })
  },
})
log(`standalone brain listening on 127.0.0.1:${PORT} (${API_KEY ? `Claude ${MODEL}` : 'no API key'}${FALLBACK_URL ? `, fallback ${FALLBACK_MODEL}` : ''})`)
