#!/usr/bin/env bun
/**
 * Frog Hub's assistant without Claude Code: answers /api/ask itself by calling a model API. For a house without
 * Claude Code (`bun run setup` → the API brain). The same HTTP API (app.ts) and tools (tools.ts) as server.ts, so the
 * web app doesn't know the difference.
 *
 * Brain: Claude via the Anthropic API when ANTHROPIC_API_KEY is set, otherwise (or when that fails) an
 * OpenAI-compatible API at FROGHUB_FALLBACK_URL: LM Studio (http://<pc>:1234/v1), Ollama (http://<pc>:11434/v1) or
 * OpenAI itself (https://api.openai.com/v1, with FROGHUB_FALLBACK_KEY).
 *
 * Environment (put secrets in an EnvironmentFile, not the unit):
 *   ANTHROPIC_API_KEY       Anthropic API key (optional)
 *   FROGHUB_MODEL           Claude model (default claude-haiku-5-5)
 *   FROGHUB_BIG_MODEL       the bigger one it hands hard questions to (default claude-sonnet-5-5; "none" turns it off)
 *   FROGHUB_FALLBACK_URL    OpenAI-compatible base URL, e.g. http://192.168.1.20:1234/v1 (optional)
 *   FROGHUB_FALLBACK_MODEL  model name there
 *   FROGHUB_FALLBACK_KEY    its API key, if it wants one (OpenAI does; LM Studio and Ollama don't)
 *   FROGHUB_FALLBACK_TOOLS  "basic" offers the local model only reply, memory and web search, for a small model
 *                           that gets lost among many tools (default: all of them)
 *   FROGHUB_SEARCH_URL      a SearXNG instance for the local model's web search (default DuckDuckGo; see websearch.ts)
 *   FROGHUB_PROMPT          the assistant's instructions (default ~/.config/froghub/assistant.md)
 *   FROGHUB_MEMORY          its memory file (default ~/.config/froghub/memory.md; see notes.ts)
 *   FROGHUB_PORT            listen port on 127.0.0.1 (default 8790)
 */
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { SERVICES, type Reply, clean, log } from './common.ts'
import type { Display } from './display.ts'
import type { Screen } from './announce.ts'
import { policy } from './store.ts'
import { THINK_DESCRIPTION, bigModel } from './thinker.ts'
import { type Tool, type ToolContext, type ToolResult, allowedActions, runTool, tools } from './tools.ts'
import { memoryForPrompt, memoryTools, runMemoryTool } from './notes.ts'
import { webSearch, webSearchTool } from './websearch.ts'
import { serve } from './app.ts'

const PORT = Number(process.env.FROGHUB_PORT || 8790)
const API_KEY = process.env.ANTHROPIC_API_KEY || ''
const MODEL = process.env.FROGHUB_MODEL || 'claude-haiku-5-5'
const BIG_MODEL = bigModel('claude-sonnet-5-5')
const FALLBACK_URL = (process.env.FROGHUB_FALLBACK_URL || '').replace(/\/+$/, '')
const FALLBACK_MODEL = process.env.FROGHUB_FALLBACK_MODEL || ''
const FALLBACK_KEY = process.env.FROGHUB_FALLBACK_KEY || ''
const PROMPT_FILE = process.env.FROGHUB_PROMPT || join(homedir(), '.config', 'froghub', 'assistant.md')
const FALLBACK_ALL = process.env.FROGHUB_FALLBACK_TOOLS !== 'basic'
const TIMEOUT_MS = 40_000
const HISTORY_TURNS = 6 // per conversation, which the display resets after 5 quiet minutes

type Turn = { role: 'user' | 'assistant'; content: string }
const conversations = new Map<string, { turns: Turn[]; at: number }>()

const REPLY_TOOL: Tool = {
  name: 'reply',
  description: 'Answer what was said to the Frog Hub display. It is spoken aloud and shown on screen.',
  inputSchema: {
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

// What the brain is told about each request (server.ts says the same in its MCP instructions)
const KINDS: Record<string, string> = {
  announcement: 'This is not someone talking to the display: a grown-up at home wants you to tell the room something ' +
    'unprompted. The message says what; your reply is spoken out of the blue, so make it make sense on its own. Never ' +
    'set continue_conversation.',
  scheduled: 'This is a job you scheduled earlier coming due: the message is the prompt you saved. Answer it like an ' +
    'announcement: spoken out of the blue, making sense on its own, never continue_conversation.',
  'admin-page': "This comes from the admin page on a grown-up's phone or computer, not from a display.",
}

function systemPrompt(meta: Record<string, string>): string {
  const rules = existsSync(PROMPT_FILE) ? readFileSync(PROMPT_FILE, 'utf8') : 'You are Frog Hub, a friendly smart display.'
  return [
    rules,
    `Right now you are the "${meta.personality}" personality, talking to ${meta.speaker}. It is ${meta.time}.`,
    meta.mode === 'admin' ? 'This request is in admin mode (a grown-up unlocked it with the PIN).' : 'This request is not in admin mode.',
    ...(meta.audience === 'grown-ups' ? ["This display is a grown-ups' one: the children's rules don't apply here."] : []),
    ...(KINDS[meta.kind] ? [KINDS[meta.kind]] : []),
    memoryForPrompt(),
    'Always answer by calling the reply tool (after any other tools you need).',
  ].join('\n\n')
}

/** Runs a tool either model called: its memory, web search (the local model's), or the shared ones. */
async function useTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const allowed = policy()
  const off = (what: string) => ({ isError: true, text: `A grown-up has turned off ${what} in Frog Hub's settings.` })
  try {
    if (memoryTools.some(t => t.name === name)) return allowed.memory ? { text: runMemoryTool(name, args) } : off('remembering things')
    if (name === 'web_search') return allowed.webSearch ? { text: await webSearch(String(args.query ?? '')) } : off('web search')
  } catch (err) {
    return { isError: true, text: (err as Error).message }
  }
  return (await runTool(name, args, ctx)) ?? { isError: true, text: `unknown tool: ${name}` }
}

type Block = { type: string; id?: string; name?: string; input?: Record<string, unknown> }

/** Asks Claude, running the tools it calls, until it replies (or hands the question to BIG_MODEL). */
async function askClaude(system: string, messages: Turn[], from: Screen | undefined, model = MODEL): Promise<Reply> {
  const convo: unknown[] = messages.map(m => ({ role: m.role, content: m.content }))
  const canThink = Boolean(BIG_MODEL) && model !== BIG_MODEL
  const allowed = policy()
  const offered = [REPLY_TOOL, ...(allowed.memory ? memoryTools : []), ...tools({ requestIds: false, think: false })]
  let card: Display | undefined
  for (let round = 0; round < 6; round++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        system,
        messages: convo,
        tools: [
          ...offered.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })), ...(canThink ? [THINK_TOOL] : []),
          ...(allowed.webSearch ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }] : []),
        ],
        tool_choice: { type: 'any' },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const content = (await r.json()).content as Block[]
    const uses = content.filter(b => b.type === 'tool_use')
    if (canThink && uses.some(u => u.name === 'think_harder')) {
      log(`thinking harder with ${BIG_MODEL}: ${clean(uses.find(u => u.name === 'think_harder')?.input?.why, 200)}`)
      return askClaude(system, messages, from, BIG_MODEL)
    }
    // The other tools first (show_on_screen's card goes with the reply), then the reply if there is one
    const results: unknown[] = []
    for (const u of uses.filter(u => u.name !== 'reply')) {
      const out = await useTool(String(u.name), u.input ?? {}, { from, show: c => void (card = c) })
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out.text, ...(out.isError ? { is_error: true } : {}) })
    }
    const reply = uses.find(u => u.name === 'reply')
    if (reply) {
      const i = reply.input ?? {}
      return { text: String(i.text ?? ''), continue_conversation: Boolean(i.continue_conversation), actions: allowedActions(i.actions), ...(card ? { display: card } : {}) }
    }
    convo.push({ role: 'assistant', content }, {
      role: 'user',
      content: results.length ? results : 'Now answer with the reply tool.',
    })
  }
  throw new Error('no reply from the model')
}

/** Asks the local OpenAI-compatible model, running the tools it calls, until it replies. */
async function askFallback(system: string, messages: Turn[], from: Screen | undefined): Promise<Reply> {
  const allowed = policy()
  const offered: Tool[] = [REPLY_TOOL, ...(allowed.memory ? memoryTools : []), ...(allowed.webSearch ? [webSearchTool] : []),
    ...(FALLBACK_ALL ? tools({ requestIds: false, think: false }) : [])]
  const convo: unknown[] = [{ role: 'system', content: system }, ...messages]
  let card: Display | undefined
  for (let round = 0; round < 5; round++) {
    const r = await fetch(`${FALLBACK_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(FALLBACK_KEY ? { authorization: `Bearer ${FALLBACK_KEY}` } : {}) },
      body: JSON.stringify({
        model: FALLBACK_MODEL,
        // OpenAI's own API wants the newer name (its reasoning models refuse max_tokens); local servers the older one
        ...(new URL(FALLBACK_URL).hostname === 'api.openai.com' ? { max_completion_tokens: 600 } : { max_tokens: 600 }),
        messages: convo,
        tools: offered.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
        tool_choice: 'required',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) throw new Error(`fallback ${r.status}`)
    const msg = (await r.json()).choices?.[0]?.message ?? {}
    const calls: { id?: string; function: { name: string; arguments?: string } }[] = msg.tool_calls ?? []
    const args = (c: (typeof calls)[number]) => {
      try {
        return JSON.parse(c.function.arguments || '{}') as Record<string, unknown>
      } catch {
        return {}
      }
    }
    const results: unknown[] = []
    for (const c of calls.filter(c => c.function.name !== 'reply')) {
      const out = await useTool(c.function.name, args(c), { from, show: d => void (card = d) })
      results.push({ role: 'tool', tool_call_id: c.id, content: out.text })
    }
    const reply = calls.find(c => c.function.name === 'reply')
    if (reply) {
      const a = args(reply)
      return { text: String(a.text ?? ''), continue_conversation: Boolean(a.continue_conversation), actions: allowedActions(a.actions), ...(card ? { display: card } : {}) }
    }
    // A local model that just talks instead of calling reply: that's the answer
    if (!calls.length) {
      if (typeof msg.content === 'string' && msg.content.trim() && !/[{}]/.test(msg.content))
        return { text: msg.content.trim().slice(0, 300), continue_conversation: false, actions: [], ...(card ? { display: card } : {}) }
      break
    }
    convo.push({ role: 'assistant', content: msg.content ?? null, tool_calls: calls }, ...results)
  }
  throw new Error('fallback gave no reply')
}

/** app.ts's way of asking: with this conversation's last few exchanges (none for announcements and scheduled jobs). */
async function askAssistant(content: string, meta: Record<string, string>, from?: Screen): Promise<Reply | null> {
  // (forget the stale ones first: a new conversation's `at` is 0 until it's answered)
  for (const [key, c] of conversations) if (Date.now() - c.at > 10 * 60_000) conversations.delete(key)
  const id = meta.kind ? '' : meta.conversation_id || 'default'
  const convo = (id && conversations.get(id)) || { turns: [], at: 0 }
  if (id) conversations.set(id, convo)
  const messages = [...convo.turns, { role: 'user' as const, content }]
  const system = systemPrompt(meta)

  let answer: Reply | null = null
  if (API_KEY) {
    try {
      answer = await askClaude(system, messages, from)
    } catch (err) {
      log(`Claude failed: ${err}`)
    }
  }
  if (!answer && FALLBACK_URL) {
    try {
      answer = await askFallback(system, messages, from)
    } catch (err) {
      log(`fallback failed: ${err}`)
    }
  }
  if (!answer) return null

  convo.turns.push({ role: 'user', content }, { role: 'assistant', content: answer.text })
  convo.turns = convo.turns.slice(-HISTORY_TURNS * 2)
  convo.at = Date.now()
  return answer
}

serve(askAssistant, { port: PORT, idleTimeout: 60, ping: () => ({ ok: true, brain: API_KEY ? MODEL : FALLBACK_MODEL || 'none' }) })
log(`standalone brain: ${API_KEY ? `Claude ${MODEL}` : 'no API key'}${FALLBACK_URL ? `, fallback ${FALLBACK_MODEL}` : ''}`)
