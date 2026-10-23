import { beforeEach, describe, expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { type Ask, routes, runJob } from '../../channel/app.ts'
import { asAdmin, CONFIG, read, request } from '../helpers.ts'

// The HTTP side both brains share, with a pretend assistant that writes down what it was asked
let answer: Awaited<ReturnType<Ask>> = { text: 'Ribbit.', continue_conversation: false, actions: [] }
const asked: { content: string; meta: Record<string, string> }[] = []
const ask: Ask = async (content, meta) => {
  asked.push({ content, meta })
  return answer
}
const handle = routes(ask)
const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => handle(request('POST', path, body, headers))
const policy = (p: Record<string, boolean>) => writeFileSync(join(CONFIG, 'policy.json'), JSON.stringify(p))
// A display polling for announcements is how the server knows it's on
const poll = async (device: string, name: string) => read(handle(request('GET', `/api/announcements?device=${device}&name=${name}&after=0`)))

beforeEach(() => {
  asked.length = 0
  answer = { text: 'Ribbit.', continue_conversation: false, actions: [] }
  rmSync(join(CONFIG, 'policy.json'), { force: true })
})

describe('/api/ask', () => {
  test('passes on what was said, the room, the other displays and who is asking', async () => {
    await poll('kitchen1', 'Kitchen')
    const r = await read(post('/api/ask', {
      text: 'Lights on please', personality: 'verity', speaker: 'Sam', device: 'lounge1', conversation_id: 'c1',
      devices: [{ id: 'light.lounge', name: 'Lounge light', state: 'off' }],
    }))
    expect(r.text).toBe('Ribbit.')
    const [{ content, meta }] = asked
    expect(content).toBe('Lights on please\n\n[Room devices: Lounge light (light.lounge): off]\n\n[Other displays: Kitchen]')
    expect(meta).toMatchObject({ personality: 'verity', speaker: 'Sam', conversation_id: 'c1' })
    expect(meta.mode).toBeUndefined()
  })

  test("admin mode, and what the grown-ups turned off, go with it", async () => {
    policy({ devices: false, weather: false })
    await post('/api/ask', { text: 'Hello', devices: [{ id: 'light.x', name: 'X', state: 'on' }] }, await asAdmin())
    const [{ content, meta }] = asked
    expect(content).not.toContain('[Room devices')
    expect(content).toEndWith('[Turned off by a grown-up: the weather, room devices. Say so kindly if asked.]')
    expect(meta.mode).toBe('admin')
  })

  test('an unknown personality is the frog; no answer in time says so', async () => {
    answer = null
    expect(await read(post('/api/ask', { text: 'Hi', personality: 'nobody' }))).toMatchObject({ text: '', timed_out: true })
    expect(asked[0].meta.personality).toBe('frog')
  })

  test('bad requests', async () => {
    expect((await post('/api/ask', { text: '' })).status).toBe(400)
    expect((await handle(new Request('http://frog.test/api/ask', { method: 'POST', body: '{' }))).status).toBe(400)
    expect((await handle(request('GET', '/api/nothing'))).status).toBe(404)
  })
})

describe('announcements', () => {
  test('exact words go straight out', async () => {
    const r = await read(post('/local/announce', { say: 'Dinner is ready!' }))
    expect(r.ok).toBe(true)
    expect(asked).toHaveLength(0)
    expect((await poll('hall1', 'Hall')).items.at(-1)).toMatchObject({ id: r.id, text: 'Dinner is ready!' })
  })

  test('a prompt is worded by the assistant, as an announcement', async () => {
    answer = { text: 'Sam, shoes on!', continue_conversation: false, actions: [] }
    const r = await read(post('/local/announce', { prompt: 'Tell Sam to put shoes on' }))
    expect(r).toMatchObject({ ok: true, text: 'Sam, shoes on!' })
    expect(asked[0]).toMatchObject({ content: 'Tell Sam to put shoes on', meta: { kind: 'announcement', speaker: 'a grown-up at home' } })
  })

  test('the admin page needs admin mode to announce', async () => {
    expect((await post('/api/admin/announce', { say: 'Hi' })).status).toBe(403)
    expect((await post('/api/admin/announce', { say: 'Hi' }, await asAdmin())).status).toBe(200)
  })
})

describe('scheduled jobs', () => {
  const job = { id: 'j1', cron: '0 8 * * *', once: false, label: 'Morning', at_night: false }

  test('exact words are announced with a card', async () => {
    await runJob(ask, { ...job, say: 'Good morning!' })
    expect((await poll('hall1', 'Hall')).items.at(-1)).toMatchObject({ text: 'Good morning!', display: { emoji: '🗓️', title: 'Morning' } })
  })

  test('a prompt goes to the assistant as a scheduled job, and its reply is announced', async () => {
    answer = { text: 'It will rain at four.', continue_conversation: false, actions: [] }
    await runJob(ask, { ...job, prompt: 'Tell them the weather for the walk' })
    expect(asked[0].meta.kind).toBe('scheduled')
    expect((await poll('hall1', 'Hall')).items.at(-1).text).toBe('It will rain at four.')
  })

  test('nothing happens while announcements are turned off', async () => {
    policy({ announce: false })
    await runJob(ask, { ...job, prompt: 'Anything' })
    expect(asked).toHaveLength(0)
  })
})
