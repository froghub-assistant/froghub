import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { type Ask, routes, runJob } from '../../channel/app.ts'
import { HISTORY_FILE, handleHistory, logged } from '../../channel/history.ts'
import { asAdmin, read, request } from '../helpers.ts'

let answer: Awaited<ReturnType<Ask>> = null
const ask: Ask = async () => answer
const handle = routes(ask)
const history = async (query = '') => read(handleHistory(request('GET', `/api/admin/history${query}`, undefined, await asAdmin())))

beforeEach(() => {
  rmSync(HISTORY_FILE, { force: true })
  answer = { text: 'Ribbit.', continue_conversation: false, actions: [] }
})

describe('the log of questions and answers', () => {
  test('a question at a display: what was said (without the notes for the assistant), where, who, and the answer', async () => {
    await read(handle(request('GET', '/api/announcements?device=lounge1&name=Lounge&after=0')))
    answer = {
      text: 'Lights on!', continue_conversation: false, display: { title: 'Lounge' },
      actions: [{ entity_id: 'light.lounge', service: 'light.turn_on' }],
    }
    await handle(request('POST', '/api/ask', {
      text: 'Lights on please', personality: 'verity', speaker: 'Sam', device: 'lounge1',
      devices: [{ id: 'light.lounge', name: 'Lounge light', state: 'off' }],
    }))
    const { items, more } = await history()
    expect(more).toBe(false)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'ask', display: 'Lounge', speaker: 'Sam', personality: 'verity', text: 'Lights on please', answer: 'Lights on!',
      actions: ['light.turn_on light.lounge'], shown: 'Lounge',
    })
    expect(items[0].at).toBeNumber()
    expect(items[0].admin).toBeUndefined()
    expect(statSync(HISTORY_FILE).mode & 0o777).toBe(0o600)
  })

  test('no answer in time, the admin page, announcements and scheduled jobs are logged too', async () => {
    answer = null
    await handle(request('POST', '/api/ask', { text: 'Hello?' }))
    answer = { text: 'Done.', continue_conversation: false, actions: [] }
    await handle(request('POST', '/api/admin/remember', { text: 'Bedtime is 8pm' }, await asAdmin()))
    await handle(request('POST', '/local/announce', { prompt: 'Tell them tea is ready' }))
    await runJob(logged(ask), { id: 'j1', cron: '0 8 * * *', once: false, label: 'Morning', at_night: false, prompt: 'Say good morning' })
    const { items } = await history()
    expect(items.map((e: { kind: string; text: string; answer: string | null }) => [e.kind, e.text, e.answer])).toEqual([
      ['scheduled', 'Say good morning', 'Done.'],
      ['announcement', 'Tell them tea is ready', 'Done.'],
      ['admin-page', 'Bedtime is 8pm', 'Done.'],
      ['ask', 'Hello?', null],
    ])
    expect(items[2].admin).toBe(true)
  })

  test('an assistant that fails is logged with the error', async () => {
    const broken = logged(async () => { throw new Error('the model is down') })
    await expect(broken('Hi', {})).rejects.toThrow('the model is down')
    expect((await history()).items[0]).toMatchObject({ text: 'Hi', answer: null, error: 'the model is down' })
  })

  test('pages back through older ones, and skips a broken line', async () => {
    writeFileSync(HISTORY_FILE, Array.from({ length: 5 }, (_, i) => JSON.stringify({ at: i + 1, kind: 'ask', text: `q${i + 1}`, answer: 'a', ms: 1 })).join('\n') + '\n{oops\n')
    const first = await history('?limit=2')
    expect(first.items.map((e: { text: string }) => e.text)).toEqual(['q5', 'q4'])
    expect(first.more).toBe(true)
    const rest = await history(`?limit=10&before=${first.items[1].at}`)
    expect(rest.items.map((e: { text: string }) => e.text)).toEqual(['q3', 'q2', 'q1'])
    expect(rest.more).toBe(false)
  })

  test('keeps the newest 1,000', async () => {
    writeFileSync(HISTORY_FILE, Array.from({ length: 1200 }, (_, i) => JSON.stringify({ at: i, kind: 'ask', text: `q${i}`, answer: 'a', ms: 1 })).join('\n') + '\n')
    await logged(ask)('One more', {})
    const lines = readFileSync(HISTORY_FILE, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1000)
    expect(JSON.parse(lines.at(-1)!).text).toBe('One more')
  })

  test('needs admin mode, and can be cleared', async () => {
    await logged(ask)('Hi', {})
    expect((await handleHistory(request('GET', '/api/admin/history'))).status).toBe(403)
    expect((await handleHistory(request('POST', '/api/admin/history', { clear: true }))).status).toBe(403)
    expect((await handleHistory(request('POST', '/api/admin/history', {}, await asAdmin()))).status).toBe(400)
    await read(handleHistory(request('POST', '/api/admin/history', { clear: true }, await asAdmin())))
    expect((await history()).items).toEqual([])
  })
})
