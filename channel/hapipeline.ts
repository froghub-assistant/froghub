/**
 * The Home Assistant side of custom personalities (personas.ts): each one gets its own voice pipeline,
 * "Frog Hub · <Name>", copied from an existing Frog Hub pipeline (same wake word and speech-to-text) with the Piper
 * voice the personality was given. Uses the shared HA token (store.ts), which must belong to an HA admin to change
 * pipelines; without one, the personality still works with the default pipeline's voice.
 */
import { instance } from './instance.ts'
import { sharedSettings, sharedToken } from './store.ts'

const TIMEOUT = 15_000
const PREFIX = 'Frog Hub · '

export type Voice = { id: string; name: string; language: string }
type Pipeline = Record<string, unknown> & { id: string; name: string }
type Call = (msg: Record<string, unknown>) => Promise<any>

/** Runs `work` with a call function on HA's websocket, then closes it. Throws a sentence a grown-up can act on. */
async function withHomeAssistant<T>(work: (call: Call) => Promise<T>): Promise<T> {
  const base = String(sharedSettings().haUrl || instance.haUrl || '').replace(/\/+$/, '')
  const token = sharedToken()
  if (!base || !token) throw new Error('Frog Hub has no Home Assistant token to make the voice with (save one from admin mode on a display).')
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/api/websocket')
  let id = 0
  const waiting = new Map<number, (m: any) => void>()
  try {
    await within(new Promise<void>((ready, fail) => {
      ws.onmessage = ev => {
        const m = JSON.parse(String(ev.data))
        if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }))
        else if (m.type === 'auth_ok') ready()
        else if (m.type === 'auth_invalid') fail(new Error('Home Assistant said the token is invalid.'))
        else if (m.type === 'result') (waiting.get(m.id)?.(m), waiting.delete(m.id))
      }
      ws.onerror = () => fail(new Error(`Couldn't connect to Home Assistant at ${base}.`))
      ws.onclose = () => fail(new Error('Home Assistant closed the connection.'))
    }), "Home Assistant didn't answer.")
    const call: Call = msg => within(new Promise<any>(done => {
      waiting.set(++id, done)
      ws.send(JSON.stringify({ ...msg, id }))
    }), `Home Assistant didn't answer ${String(msg.type)}.`)
    return await work(call)
  } finally {
    ws.close()
  }
}

/** The pipeline to copy: Frog's if there is one, else any Frog Hub one, else HA's preferred one. */
async function template(call: Call): Promise<{ all: Pipeline[]; base: Pipeline }> {
  const r = (await call({ type: 'assist_pipeline/pipeline/list' })).result ?? {}
  const all: Pipeline[] = r.pipelines ?? []
  const base = all.find(p => p.name === `${PREFIX}Frog`) ?? all.find(p => p.name.startsWith(PREFIX)) ??
    all.find(p => p.id === r.preferred_pipeline) ?? all[0]
  if (!base) throw new Error('Home Assistant has no voice pipelines to copy yet (run Frog Hub setup first).')
  return { all, base }
}

/** The voices of the TTS engine the Frog Hub pipelines use, in British and American English. */
export async function listVoices(): Promise<Voice[]> {
  return withHomeAssistant(async call => {
    const { base } = await template(call)
    const voices: Voice[] = []
    for (const language of ['en_GB', 'en_US']) {
      const r = await call({ type: 'tts/engine/voices', engine_id: base.tts_engine, language })
      for (const v of r.result?.voices ?? []) voices.push({ id: String(v.voice_id), name: String(v.name), language })
    }
    return voices
  })
}

/** Makes (or updates) "Frog Hub · <name>" with `voice`. Returns what happened, for the admin page. */
export async function savePipeline(name: string, voice: string, previousName?: string): Promise<string> {
  const pipelineName = PREFIX + name
  return withHomeAssistant(async call => {
    const { all, base } = await template(call)
    const language = /^([a-z]{2}_[A-Z]{2})-/.exec(voice)?.[1] ?? String(base.tts_language ?? 'en_GB')
    const fields: Record<string, unknown> = {}
    for (const k of ['language', 'conversation_engine', 'conversation_language', 'stt_engine', 'stt_language', 'tts_engine',
      'wake_word_entity', 'wake_word_id', 'prefer_local_intents']) if (k in base) fields[k] = base[k]
    Object.assign(fields, { name: pipelineName, tts_language: language, tts_voice: voice })
    const same = all.find(p => p.name === pipelineName) ?? (previousName ? all.find(p => p.name === PREFIX + previousName) : undefined)
    const r = same
      ? await call({ type: 'assist_pipeline/pipeline/update', pipeline_id: same.id, ...fields })
      : await call({ type: 'assist_pipeline/pipeline/create', ...fields })
    if (!r.success) {
      const why = String(r.error?.message ?? r.error?.code ?? 'unknown error')
      throw new Error(/unauthori[sz]ed|admin/i.test(why)
        ? "Home Assistant wouldn't let Frog Hub's token change pipelines (it needs to belong to an HA admin)."
        : `Home Assistant wouldn't make the pipeline: ${why}`)
    }
    return `${same ? 'Updated' : 'Made'} the "${pipelineName}" voice pipeline in Home Assistant.`
  })
}

/** Removes "Frog Hub · <name>" if it's there. Never touches the four built-in ones. */
export async function deletePipeline(name: string): Promise<void> {
  if (['Frog', 'Verity', 'Falsity', 'Lovity'].includes(name)) return
  await withHomeAssistant(async call => {
    const { all } = await template(call)
    const same = all.find(p => p.name === PREFIX + name)
    if (same) await call({ type: 'assist_pipeline/pipeline/delete', pipeline_id: same.id })
  })
}

/** The promise, or a rejection with `why` after the time limit. */
function within<T>(promise: Promise<T>, why: string): Promise<T> {
  let timer: Timer | undefined
  return Promise.race([promise, new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new Error(why)), TIMEOUT) })])
    .finally(() => clearTimeout(timer))
}
