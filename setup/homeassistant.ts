/**
 * Setup's Home Assistant part: checks a long-lived token, adds the voice services (Wyoming integration) and creates or
 * updates the four personalities' pipelines. Every request has a time limit, so a wrong address or token can't hang
 * setup.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

export type Endpoint = { key: string; name: string; host: string; port: number }

const TIMEOUT = 15_000

/** Why the token won't do (wrong, or HA unreachable), or '' if it's fine. */
export async function checkToken(base: string, token: string): Promise<string> {
  try {
    const r = await fetch(`${base}/api/`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT) })
    if (r.status === 401 || r.status === 403) return 'Home Assistant said the token is invalid.'
    return r.ok ? '' : `Home Assistant answered ${r.status}.`
  } catch (err) {
    return `Couldn't reach Home Assistant at ${base}: ${(err as Error).message}`
  }
}

export async function setUpHomeAssistant(base: string, token: string, endpoints: Endpoint[], say: (text: string) => void): Promise<void> {
  const rest = (path: string, body?: unknown) => fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT),
  }).then(async r => (r.ok ? r.json() : Promise.reject(new Error(`${path}: ${r.status} ${await r.text()}`))))

  // The Wyoming integration, once per service (HA says "already configured" for one it has)
  const entries: Record<string, string> = {}
  for (const e of endpoints) {
    try {
      const flow = await rest('/api/config/config_entries/flow', { handler: 'wyoming', show_advanced_options: false })
      const done = await rest(`/api/config/config_entries/flow/${flow.flow_id}`, { host: e.host, port: e.port })
      if (done.type === 'create_entry' && done.result?.entry_id) entries[e.key] = done.result.entry_id
      say(done.type === 'create_entry' ? `Added ${e.name} (${e.host}:${e.port}) to Home Assistant.` : `${e.name}: ${done.reason || done.type}`)
    } catch (err) {
      say(`Couldn't add ${e.name} at ${e.host}:${e.port}: ${(err as Error).message}`)
    }
  }

  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/api/websocket')
  try {
    await pipelines(ws, rest, token, entries, say)
  } catch (err) {
    say(`Couldn't set up the pipelines: ${(err as Error).message}`)
  } finally {
    ws.close()
  }
}

async function pipelines(ws: WebSocket, rest: (path: string) => Promise<any>, token: string, entries: Record<string, string>,
  say: (text: string) => void): Promise<void> {
  let id = 0
  const waiting = new Map<number, (m: any) => void>()
  const call = (msg: object) => within(new Promise<any>(done => {
    waiting.set(++id, done)
    ws.send(JSON.stringify({ ...msg, id }))
  }), `no answer to ${(msg as { type: string }).type}`)
  await within(new Promise<void>((ready, fail) => {
    ws.onmessage = ev => {
      const m = JSON.parse(String(ev.data))
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }))
      else if (m.type === 'auth_ok') ready()
      else if (m.type === 'auth_invalid') fail(new Error('Home Assistant said the token is invalid'))
      else if (m.type === 'result') waiting.get(m.id)?.(m), waiting.delete(m.id)
    }
    ws.onerror = () => fail(new Error("couldn't connect to its websocket"))
    ws.onclose = () => fail(new Error('it closed the websocket'))
  }), "its websocket didn't answer")

  // The entity of the entry just added, if it was new (a service that moved keeps its old entry too); else by name
  const registry: { entity_id: string; config_entry_id: string | null }[] = (await call({ type: 'config/entity_registry/list' })).result ?? []
  const states: { entity_id: string }[] = await rest('/api/states')
  const ids = states.map(s => s.entity_id)
  const find = (domain: string, key: string) =>
    registry.find(r => entries[key] && r.config_entry_id === entries[key] && r.entity_id.startsWith(`${domain}.`))?.entity_id ??
    ids.find(id => id.startsWith(`${domain}.`) && id.includes(key)) ?? ids.find(id => id.startsWith(`${domain}.`))
  const stt = find('stt', 'whisper')
  const tts = find('tts', 'piper')
  const wake = find('wake_word', 'openwakeword')
  if (!stt || !tts || !wake)
    return say(`Couldn't find the speech entities in HA (stt: ${stt}, tts: ${tts}, wake word: ${wake}); give it a minute and run setup again.`)

  const existing: { id: string; name: string }[] = (await call({ type: 'assist_pipeline/pipeline/list' })).result?.pipelines ?? []
  for (const p of JSON.parse(readFileSync(join(import.meta.dir, 'voice', 'pipelines.json'), 'utf8'))) {
    const pipeline = {
      name: p.name, language: 'en', conversation_engine: 'conversation.home_assistant', conversation_language: 'en',
      stt_engine: stt, stt_language: 'en', tts_engine: tts, tts_language: p.tts_language, tts_voice: p.tts_voice,
      wake_word_entity: wake, wake_word_id: 'hey_jarvis', prefer_local_intents: false,
    }
    const same = existing.find(e => e.name === p.name)
    const result = same
      ? await call({ type: 'assist_pipeline/pipeline/update', pipeline_id: same.id, ...pipeline })
      : await call({ type: 'assist_pipeline/pipeline/create', ...pipeline })
    say(result.success ? `${same ? 'Updated' : 'Added'} the "${p.name}" pipeline.` : `"${p.name}": ${result.error?.message}`)
  }
}

/** The promise, or a rejection with `why` after the time limit. */
function within<T>(promise: Promise<T>, why: string): Promise<T> {
  let timer: Timer | undefined
  return Promise.race([promise, new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new Error(why)), TIMEOUT) })])
    .finally(() => clearTimeout(timer))
}
