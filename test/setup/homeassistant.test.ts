import { afterAll, describe, expect, test } from 'bun:test'
import { checkToken, setUpHomeAssistant, type Endpoint } from '../../setup/homeassistant.ts'

// A pretend Home Assistant: the REST calls setup makes and its websocket. With a bad token, the websocket says
// auth_invalid and then stays open, as HA can, which used to leave setup waiting forever.
const GOOD = 'good-token'
const sent: any[] = []
let flows = 0
const ha = Bun.serve({
  port: 0,
  async fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === '/api/websocket') return server.upgrade(req) ? undefined : new Response('no', { status: 400 })
    if (req.headers.get('authorization') !== `Bearer ${GOOD}`) return new Response('401: Unauthorized', { status: 401 })
    if (url.pathname === '/api/') return Response.json({ message: 'API running.' })
    if (url.pathname === '/api/config/config_entries/flow') return Response.json({ flow_id: `f${++flows}` })
    if (url.pathname.startsWith('/api/config/config_entries/flow/')) {
      const { port } = await req.json()
      // Whisper is new (it moved to another computer); the other two HA already has
      return Response.json(port === 10300 ? { type: 'create_entry', result: { entry_id: 'new-whisper' } } : { type: 'abort', reason: 'already_configured' })
    }
    if (url.pathname === '/api/states')
      return Response.json(['stt.faster_whisper', 'stt.faster_whisper_2', 'tts.piper', 'wake_word.openwakeword'].map(entity_id => ({ entity_id })))
    return new Response('not found', { status: 404 })
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ type: 'auth_required' }))
    },
    message(ws, data) {
      const m = JSON.parse(String(data))
      if (m.type === 'auth') return ws.send(JSON.stringify({ type: m.access_token === GOOD ? 'auth_ok' : 'auth_invalid' }))
      sent.push(m)
      const result = m.type === 'config/entity_registry/list'
        ? [{ entity_id: 'stt.faster_whisper', config_entry_id: 'old-whisper' }, { entity_id: 'stt.faster_whisper_2', config_entry_id: 'new-whisper' }]
        : m.type === 'assist_pipeline/pipeline/list' ? { pipelines: [{ id: 'p1', name: 'Frog Hub · Frog' }] } : null
      ws.send(JSON.stringify({ type: 'result', id: m.id, success: true, result }))
    },
  },
})
afterAll(() => ha.stop(true))

const base = `http://127.0.0.1:${ha.port}`
const endpoints: Endpoint[] = [
  { key: 'openwakeword', name: 'openWakeWord', host: '127.0.0.1', port: 10400 },
  { key: 'whisper', name: 'Whisper', host: '192.168.1.23', port: 10300 },
  { key: 'piper', name: 'Piper', host: '127.0.0.1', port: 10200 },
]

describe('checkToken', () => {
  test('a good token is fine', async () => {
    expect(await checkToken(base, GOOD)).toBe('')
  })

  test('a bad token says so', async () => {
    expect(await checkToken(base, 'nope')).toBe('Home Assistant said the token is invalid.')
  })

  test("an address with nothing there says it couldn't reach it", async () => {
    expect(await checkToken('http://127.0.0.1:9', GOOD)).toStartWith("Couldn't reach Home Assistant at http://127.0.0.1:9")
  })
})

describe('setUpHomeAssistant', () => {
  test('a token the websocket turns down ends setup instead of waiting forever', async () => {
    const said: string[] = []
    await setUpHomeAssistant(base, 'nope', endpoints, t => said.push(t))
    expect(said.at(-1)).toBe("Couldn't set up the pipelines: Home Assistant said the token is invalid")
  }, 5000)

  test('adds the services and makes the pipelines with the newly added entry', async () => {
    const said: string[] = []
    sent.length = 0
    await setUpHomeAssistant(base, GOOD, endpoints, t => said.push(t))
    expect(said).toContain('Added Whisper (192.168.1.23:10300) to Home Assistant.')
    expect(said).toContain('Piper: already_configured')
    expect(said).toContain('Updated the "Frog Hub · Frog" pipeline.')
    expect(said).toContain('Added the "Frog Hub · Lovity" pipeline.')
    const made = sent.filter(m => m.type.startsWith('assist_pipeline/pipeline/') && m.type !== 'assist_pipeline/pipeline/list')
    expect(made).toHaveLength(4)
    // the Whisper that was just added, not the old entry that comes first by name
    for (const m of made) expect(m).toMatchObject({ stt_engine: 'stt.faster_whisper_2', tts_engine: 'tts.piper', wake_word_entity: 'wake_word.openwakeword' })
  })
})
