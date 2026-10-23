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
import { SERVICES, type Reply, log } from './common.ts'
import type { Display } from './display.ts'
import type { Screen } from './announce.ts'
import { allowedActions, runTool, tools } from './tools.ts'
import { serve } from './app.ts'

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

const replyTool = {
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
}

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [replyTool, ...tools({ requestIds: true, think: true })] }))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  const id = String(args.request_id)
  if (req.params.name !== 'reply') {
    const result = await runTool(req.params.name, args, {
      from: askedFrom.get(id),
      show: pending.has(id) ? card => void displays.set(id, card) : undefined,
    })
    if (!result) throw new Error(`unknown tool: ${req.params.name}`)
    return { ...(result.isError ? { isError: true } : {}), content: [{ type: 'text', text: result.text }] }
  }
  const resolve = pending.get(id)
  if (!resolve) {
    return { isError: true, content: [{ type: 'text', text: 'No open request with that id: it timed out or was already answered.' }] }
  }
  const display = displays.get(id)
  displays.delete(id)
  resolve({ text: String(args.text ?? ''), continue_conversation: Boolean(args.continue_conversation), actions: allowedActions(args.actions), ...(display ? { display } : {}) })
  return { content: [{ type: 'text', text: 'sent' }] }
})

await mcp.connect(new StdioServerTransport())

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

serve(askAssistant, { port: PORT, idleTimeout: Math.min(255, TIMEOUT_MS / 1000 + 10) })
