/**
 * Custom personalities, made on the admin page's Personalities tab. A grown-up describes a character, Claude writes
 * everything a personality needs (how it talks, colours, the display's words, a voice and an animated SVG face), the
 * grown-up tweaks it ("make it rounder") and saves it. Saved ones live in ~/.config/froghub/personalities.json, next
 * to the four built-in ones (src/lib/personalities.js), and each gets its own Home Assistant voice pipeline
 * (hapipeline.ts).
 *
 * Claude: `claude -p` (Claude Code, so the house's own subscription, with no tools at all) when it's installed,
 * otherwise the Anthropic API with ANTHROPIC_API_KEY. FROGHUB_BUILDER=api forces the API.
 *
 * How the assistant learns who it is: every request for a custom personality carries a [Personality: …] note
 * (app.ts), so both brains pick it up straight away, with no restart. The kids' rules still come first.
 *
 *   GET  /api/personalities                 anyone: what the displays need (no prompt text)
 *   GET  /api/admin/personalities           admin: everything, for editing
 *   GET  /api/admin/personalities/voices    admin: the Piper voices Home Assistant has
 *   POST /api/admin/personalities/generate  admin: {description, feedback?, previous?} → {job}
 *   GET  /api/admin/personalities/job?id=   admin: {status: 'working' | 'done' | 'failed', draft?, error?}
 *   POST /api/admin/personalities           admin: {personality} → saves it, makes its pipeline
 *   POST /api/admin/personalities/delete    admin: {id}
 */
import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { PERSONALITIES, adminValid, json, log } from './common.ts'
import { cleanSvg } from './svg.ts'
import { type Voice, deletePipeline, listVoices, savePipeline } from './hapipeline.ts'

const FILE = join(homedir(), '.config', 'froghub', 'personalities.json')
const COLOURS = ['bg', 'bg2', 'fg', 'muted', 'accent', 'faceFill', 'faceInk'] as const
const MAX_CUSTOM = 20
const JOB_TIMEOUT_MS = 6 * 60 * 1000

// Voices for when Home Assistant can't be asked: the ones the built-in personalities use, which setup installs
const KNOWN_VOICES: Voice[] = [
  { id: 'en_GB-northern_english_male-medium', name: 'northern english male (medium)', language: 'en_GB' },
  { id: 'en_GB-jenny_dioco-medium', name: 'jenny dioco (medium)', language: 'en_GB' },
  { id: 'en_US-ryan-medium', name: 'ryan (medium)', language: 'en_US' },
  { id: 'en_US-kristin-medium', name: 'kristin (medium)', language: 'en_US' },
]

export type Persona = {
  id: string
  name: string
  description: string // what the grown-up asked for
  prompt: string // how it talks, for the assistant
  colours: Record<(typeof COLOURS)[number], string>
  greeting: string // with {name} where the person's name goes
  listening: string
  thinking: string
  error: string
  pitch: number
  voice: string // a Piper voice id, e.g. en_GB-alba-medium
  svg: string
  updated: number
}

const read = (): Persona[] => {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')).personalities ?? [] : []
  } catch {
    return []
  }
}
const write = (list: Persona[]) => writeFileSync(FILE, JSON.stringify({ personalities: list }, null, 1))

export function customPersonas(): Persona[] {
  return read()
}

/** `id` if it's a built-in or saved personality, else 'frog'. */
export function knownPersonality(id: unknown): string {
  const wanted = String(id ?? '')
  return PERSONALITIES.has(wanted) || read().some(p => p.id === wanted) ? wanted : 'frog'
}

const flat = (s: string, max: number) => s.replace(/[\r\n<>[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** The note that tells the assistant who a custom personality is; '' for the built-in ones (CLAUDE.md has those). */
export function personaNote(id: unknown): string {
  const p = PERSONALITIES.has(String(id)) ? undefined : read().find(c => c.id === id)
  if (!p) return ''
  return `[Personality: right now you are ${flat(p.name, 24)}, a personality a grown-up made for Frog Hub. ${flat(p.prompt, 1200)} ` +
    `Speak as ${flat(p.name, 24)}, not as one of the built-in personalities. The rules about looking after the children still come first.]`
}

// --- Checking a personality --------------------------------------------------------------------------------------

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '')

/** A clean personality from Claude's (or the admin page's) JSON, or the reason it won't do. */
export function checkPersona(raw: Record<string, any>): Omit<Persona, 'id' | 'updated'> | string {
  if (!raw || typeof raw !== 'object') return 'That isn\'t a personality.'
  const name = text(raw.name, 24).replace(/[^\p{L}\p{N} '’-]/gu, '').trim()
  if (!name) return 'It needs a name (letters and numbers).'
  const colours = {} as Persona['colours']
  for (const k of COLOURS) {
    const c = String(raw.colours?.[k] ?? '').toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(c)) return `The ${k} colour isn't a #rrggbb colour.`
    colours[k] = c
  }
  let greeting = text(raw.greeting, 100)
  if (!greeting.includes('{name}')) greeting = `Hi {name}! It's ${name}.`
  const pitch = Number(raw.pitch)
  const voice = text(raw.voice, 80)
  if (!/^[a-z]{2}_[A-Z]{2}-[\w]+-(x_low|low|medium|high)$/.test(voice)) return `"${voice}" isn't a Piper voice.`
  const svg = cleanSvg(String(raw.svg ?? ''))
  if (!svg) return 'The face drawing was missing, broken or too big.'
  return {
    name,
    description: text(raw.description, 600),
    prompt: text(raw.prompt, 1200) || `${name}, a friendly helper.`,
    colours,
    greeting,
    listening: text(raw.listening, 60) || 'Listening…',
    thinking: text(raw.thinking, 60) || 'Thinking…',
    error: text(raw.error, 60) || 'Oops, something went wrong.',
    pitch: Number.isFinite(pitch) ? Math.min(1.3, Math.max(0.7, Math.round(pitch * 100) / 100)) : 1,
    voice,
    svg,
  }
}

/** What a display needs (GET /api/personalities): not the description or the prompt. */
const forDisplay = (p: Persona) => ({
  id: p.id, name: p.name, pipeline: `Frog Hub · ${p.name}`, pitch: p.pitch, face: 'custom', svg: p.svg, colours: p.colours,
  greeting: p.greeting, listening: p.listening, thinking: p.thinking, error: p.error, updated: p.updated,
})

/** A new id from the name: lower case, never one of the built-in ones or another saved one. */
function newId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'custom'
  let id = base
  for (let n = 2; PERSONALITIES.has(id) || taken.has(id); n++) id = `${base}-${n}`
  return id
}

// --- Asking Claude --------------------------------------------------------------------------------------------------

const FACE_RULES = `The face is an SVG for an old Android tablet's browser (Chrome 59), shown as an <img>, so:
- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">, no width/height, transparent background. The character fills most of the square, centred, with a little room at the edges.
- Flat, simple, friendly shapes in the personality's faceFill (body) and faceInk (eyes, mouth, outlines) colours, plus a few accents. Cute, never scary. No text except a small "z" for tired.
- Frog Hub puts two classes on the root <svg>: the mood, one of mood-waiting, mood-listening, mood-thinking, mood-speaking, mood-error; and the feeling, one of feeling-happy, feeling-sad, feeling-tired (only matters while waiting). Every combination must look right.
- Draw each state with one <style> element: elements hidden or shown per state (display: none / inline), and CSS @keyframes animations. For example: .mouth-talk { display: none } .mood-speaking .mouth-talk { display: inline } .mood-speaking .mouth-smile { display: none }.
- What each state shows: waiting = calm, blinking every few seconds; listening = attentive (eyes wide or ears up); thinking = eyes looking up, maybe a little thought bubble; speaking = the mouth opening and closing about every 0.3 s; error = confused or dizzy; feeling-sad (while waiting) = a frown, maybe a tear; feeling-tired (while waiting) = half-closed eyes, a yawn, a floating "z". Happy is the default look.
- The display already gently pulses the whole face while listening and wobbles it while thinking: don't animate the whole <svg> for those.
- Chrome 59 limits: set transform-origin in viewBox units with px (e.g. transform-origin: 100px 80px), never transform-box; no CSS nesting, :is(), :where(), CSS variables, or the CSS d property. CSS transforms and opacity animate fine.
- Only shapes (circle, ellipse, rect, line, polyline, polygon, path, g), gradients, clipPath, mask, use (#id only), text, style, animate and animateTransform. No script, no event handlers, no links or outside files, no image, no foreignObject, no filters, no fonts.
- Keep it under 20 KB.`

function systemPrompt(voices: Voice[]): string {
  return `You design personalities for Frog Hub, a homemade smart display (a talking face on a tablet) that children use. A grown-up describes a character; you write everything Frog Hub needs for it, as JSON.

- name: the character's name, at most 20 characters.
- prompt: 3 to 6 sentences for the assistant (another Claude) on who it is and how it talks: its personality, way of speaking, favourite things, a catchphrase or two to use now and then (not every reply). Friendly and suitable for young children: never scary, mean, rude or creepy, and it never pretends to watch or follow anyone. If the description asks for something unsuitable for children, make the nearest friendly version instead.
- colours: the display's palette as #rrggbb. bg and bg2 are dark backgrounds (bg2 a little lighter), fg is near-white text, muted is softer text, accent is the bright highlight colour, faceFill is the face's main colour, faceInk is the dark colour for its eyes and mouth. Text must stay easy to read on bg.
- greeting: what the screen says when idle, with {name} where the person's name goes, plus one emoji. Short.
- listening, thinking, error: very short lines shown while it listens, thinks, or when something goes wrong, in character, each with at most one emoji.
- pitch: playback rate for its voice, 0.8 (deeper) to 1.2 (higher). 1 is normal.
- voice: the Piper voice that suits it best, one of: ${voices.map(v => v.id).join(', ')}.
- svg: its animated face, following these rules:
${FACE_RULES}

Answer with the JSON only.`
}

function schema(voices: Voice[]) {
  const line = { type: 'string' }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'prompt', 'colours', 'greeting', 'listening', 'thinking', 'error', 'pitch', 'voice', 'svg'],
    properties: {
      name: line,
      prompt: line,
      colours: {
        type: 'object',
        additionalProperties: false,
        required: [...COLOURS],
        properties: Object.fromEntries(COLOURS.map(k => [k, { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }])),
      },
      greeting: line,
      listening: line,
      thinking: line,
      error: line,
      pitch: { type: 'number', minimum: 0.7, maximum: 1.3 },
      voice: { type: 'string', enum: voices.map(v => v.id) },
      svg: line,
    },
  }
}

function request(input: { description: string; feedback?: string; previous?: Record<string, unknown> }): string {
  if (!input.previous || !input.feedback) return `The grown-up's description:\n${input.description}`
  const { svg, ...rest } = input.previous
  return `The grown-up's description:\n${input.description}\n\nThis is the current version:\n${JSON.stringify(rest, null, 1)}\n\n` +
    `Its face:\n${String(svg ?? '')}\n\nChange it like this: ${input.feedback}\n` +
    'Keep everything else the same unless the change needs it, and return the whole personality again.'
}

const claudeCli = () => Bun.which('claude') ?? (existsSync(join(homedir(), '.local', 'bin', 'claude')) ? join(homedir(), '.local', 'bin', 'claude') : null)

/** Which way Claude is reached, or null when there's neither Claude Code nor an API key. */
export function builder(): 'claude-code' | 'api' | null {
  if (process.env.FROGHUB_BUILDER !== 'api' && claudeCli()) return 'claude-code'
  return process.env.ANTHROPIC_API_KEY ? 'api' : null
}

/** `claude -p` with no tools, no MCP servers, no hooks and no saved session, in an empty folder. */
async function askClaudeCode(system: string, prompt: string, jsonSchema: object): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'froghub-builder-'))
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDECODE' && !k.startsWith('CLAUDE_CODE_')))
  try {
    const child = spawn(claudeCli()!, [
      '-p', prompt, '--model', process.env.FROGHUB_BUILDER_MODEL || 'opus', '--tools', '', '--strict-mcp-config',
      '--no-session-persistence', '--settings', JSON.stringify({ disableAllHooks: true }), '--output-format', 'json',
      '--json-schema', JSON.stringify(jsonSchema), '--system-prompt', system,
    ], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (err += d))
    const timer = setTimeout(() => child.kill(), JOB_TIMEOUT_MS)
    const code = await new Promise<number | null>(done => child.on('close', done))
    clearTimeout(timer)
    let result: Record<string, any>
    try {
      result = JSON.parse(out)
    } catch {
      throw new Error(code === null ? 'Claude took too long.' : `Claude Code failed: ${(err || out).trim().slice(0, 300)}`)
    }
    if (result.is_error || !result.structured_output) throw new Error(`Claude Code failed: ${String(result.result ?? result.subtype).slice(0, 300)}`)
    return result.structured_output
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The Anthropic API, made to answer through a tool so the answer is JSON in the schema. */
async function askApi(system: string, prompt: string, jsonSchema: object): Promise<unknown> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.FROGHUB_BUILDER_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      system,
      tools: [{ name: 'save_personality', description: 'Save the finished personality.', input_schema: jsonSchema }],
      tool_choice: { type: 'tool', name: 'save_personality' },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`The Anthropic API said ${r.status}: ${String(data.error?.message ?? '').slice(0, 300)}`)
  const call = (data.content ?? []).find((b: { type: string }) => b.type === 'tool_use')
  if (!call) throw new Error('Claude didn\'t send a personality back.')
  return call.input
}

/** Asks Claude for a personality (a new one, or `previous` changed as `feedback` says) and checks what comes back. */
export async function generate(input: { description: string; feedback?: string; previous?: Record<string, unknown> },
  voices: Voice[]): Promise<Omit<Persona, 'id' | 'updated'>> {
  const how = builder()
  if (!how) throw new Error('The personality builder needs Claude Code on this computer, or ANTHROPIC_API_KEY.')
  const system = systemPrompt(voices)
  const prompt = request(input)
  const raw = (how === 'claude-code' ? await askClaudeCode(system, prompt, schema(voices)) : await askApi(system, prompt, schema(voices))) as Record<string, unknown>
  const checked = checkPersona({ ...raw, description: input.description })
  if (typeof checked === 'string') throw new Error(`Claude's personality didn't pass the checks: ${checked} Try again.`)
  return checked
}

// --- Jobs (making one takes a minute or two) -----------------------------------------------------------------------

type Job = { status: 'working' | 'done' | 'failed'; draft?: Omit<Persona, 'id' | 'updated'>; error?: string; at: number }
const jobs = new Map<string, Job>()
let voiceCache: { voices: Voice[]; at: number } | null = null

async function voices(): Promise<Voice[]> {
  if (voiceCache && Date.now() - voiceCache.at < 10 * 60 * 1000) return voiceCache.voices
  try {
    const list = await listVoices()
    if (list.length) voiceCache = { voices: list, at: Date.now() }
    return list.length ? list : KNOWN_VOICES
  } catch (err) {
    log(`personalities: couldn't list voices: ${(err as Error).message}`)
    return KNOWN_VOICES
  }
}

function startJob(input: { description: string; feedback?: string; previous?: Record<string, unknown> }): string | null {
  for (const [id, j] of jobs) if (Date.now() - j.at > 30 * 60 * 1000) jobs.delete(id)
  if ([...jobs.values()].some(j => j.status === 'working')) return null
  const id = crypto.randomUUID()
  jobs.set(id, { status: 'working', at: Date.now() })
  log(`personalities: making one (${builder()})`)
  voices()
    .then(v => generate(input, v))
    .then(draft => jobs.set(id, { status: 'done', draft, at: Date.now() }))
    .catch(err => {
      log(`personalities: failed: ${(err as Error).message}`)
      jobs.set(id, { status: 'failed', error: (err as Error).message, at: Date.now() })
    })
  return id
}

// --- Routes ------------------------------------------------------------------------------------------------------

export async function handlePersonas(req: Request, pathname: string): Promise<Response> {
  if (req.method === 'GET' && pathname === '/api/personalities') return json({ personalities: read().map(forDisplay) })
  if (!adminValid(req.headers.get('x-admin-token'))) return json({ error: 'admin mode needed' }, 403)

  if (req.method === 'GET' && pathname === '/api/admin/personalities') return json({ personalities: read(), builder: builder() })
  if (req.method === 'GET' && pathname === '/api/admin/personalities/voices') return json({ voices: await voices() })
  if (req.method === 'GET' && pathname === '/api/admin/personalities/job') {
    const job = jobs.get(new URL(req.url).searchParams.get('id') ?? '')
    return job ? json(job) : json({ error: 'no such job (the server may have restarted): try again' }, 404)
  }
  if (req.method !== 'POST') return new Response('not found', { status: 404 })
  const body = await req.json().catch(() => ({}))

  if (pathname === '/api/admin/personalities/generate') {
    const description = text(body.description, 600)
    if (!description) return json({ error: 'Describe the personality first.' }, 400)
    const feedback = text(body.feedback, 600)
    const previous = body.previous && typeof body.previous === 'object' ? body.previous : undefined
    if (!builder()) return json({ error: 'The personality builder needs Claude Code on this computer, or ANTHROPIC_API_KEY.' }, 409)
    const id = startJob({ description, ...(feedback && previous ? { feedback, previous } : {}) })
    return id ? json({ job: id }) : json({ error: 'Already making one: wait for it to finish.' }, 409)
  }

  if (pathname === '/api/admin/personalities') {
    const checked = checkPersona(body.personality)
    if (typeof checked === 'string') return json({ error: checked }, 400)
    const list = read()
    const old = list.find(p => p.id === body.personality?.id)
    if (!old && list.length >= MAX_CUSTOM) return json({ error: `That's ${MAX_CUSTOM} already: delete one first.` }, 409)
    if (['frog', 'verity', 'falsity', 'lovity'].includes(checked.name.toLowerCase()) ||
      list.some(p => p.id !== old?.id && p.name.toLowerCase() === checked.name.toLowerCase()))
      return json({ error: `There's already a personality called ${checked.name}.` }, 409)
    const saved: Persona = { ...checked, id: old?.id ?? newId(checked.name, new Set(list.map(p => p.id))), updated: Date.now() }
    write(old ? list.map(p => (p.id === old.id ? saved : p)) : [...list, saved])
    log(`personalities: saved ${saved.id}`)
    let voice: string
    try {
      voice = await savePipeline(saved.name, saved.voice, old?.name)
    } catch (err) {
      voice = `Saved, but the voice isn't set up: ${(err as Error).message} Displays will use the usual voice for now.`
    }
    return json({ ok: true, personality: saved, voice })
  }

  if (pathname === '/api/admin/personalities/delete') {
    const list = read()
    const gone = list.find(p => p.id === body.id)
    if (!gone) return json({ error: 'There\'s no personality with that id.' }, 404)
    write(list.filter(p => p.id !== gone.id))
    log(`personalities: deleted ${gone.id}`)
    let note = ''
    await deletePipeline(gone.name).catch(err => (note = ` Its voice pipeline is still in Home Assistant: ${(err as Error).message}`))
    return json({ ok: true, note })
  }
  return new Response('not found', { status: 404 })
}
