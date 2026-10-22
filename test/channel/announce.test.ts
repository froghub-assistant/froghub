import { afterAll, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test'
import { announce, findDisplay, handleAnnouncements, message, onlineDisplays, screenFor } from '../../channel/announce.ts'
import { handleRegistry } from '../../channel/registry.ts'
import { asAdmin, read, request } from '../helpers.ts'

// The 📢 button's rate limit remembers when it was last used, so the clock here only moves forwards.
let now = Date.now()
const tick = (ms: number) => setSystemTime((now += ms))
afterAll(() => setSystemTime())

type Item = { id: number; text: string; display?: { title: string; text: string } }

/** A display's poll, as src/lib/announce.js sends it. */
async function poll(device: string, name: string, area = '', after = 0) {
  const query = new URLSearchParams({ after: String(after), device, name, area, areaName: '', who: '', personality: 'frog' })
  return read(handleAnnouncements(request('GET', `/api/announcements?${query}`), '/api/announcements'))
}
const texts = async (device: string, name: string, area = '', after = 0) =>
  ((await poll(device, name, area, after)).items as Item[]).map(i => i.text)

/** All three displays poll, so they're on. */
async function wake() {
  await poll('bedroom1', 'Bedroom', 'bedroom')
  await poll('kitchen1', 'Kitchen', 'kitchen')
  await poll('kitchen2', 'Kitchen hub', 'kitchen')
}

const press = (body: unknown) => handleAnnouncements(request('POST', '/api/announce', body), '/api/announce')

beforeAll(wake)

describe('which displays are on', () => {
  test('every display that polled in the last minute', async () => {
    expect(onlineDisplays().map(s => s.id).sort()).toEqual(['bedroom1', 'kitchen1', 'kitchen2'])
    expect(onlineDisplays('bedroom1').map(s => s.id).sort()).toEqual(['kitchen1', 'kitchen2'])
    const listed = await read(handleAnnouncements(request('GET', '/api/displays?except=kitchen1'), '/api/displays'))
    expect(listed).toContainEqual({ id: 'bedroom1', name: 'Bedroom' })
    expect(listed).not.toContainEqual({ id: 'kitchen1', name: 'Kitchen' })
  })

  test('found by id, by whole name before part of one, any case', () => {
    expect(findDisplay('kitchen2')?.id).toBe('kitchen2')
    expect(findDisplay('KITCHEN')?.id).toBe('kitchen1')
    expect(findDisplay('hub')?.id).toBe('kitchen2')
    expect(findDisplay('Kitchen', 'kitchen1')?.id).toBe('kitchen2')
    expect(findDisplay('garage')).toBeUndefined()
    expect(screenFor('bedroom1')?.name).toBe('Bedroom')
    expect(screenFor(42)).toBeUndefined()
  })
})

describe('announcements', () => {
  test('go to every display, once', async () => {
    const { latest } = await poll('bedroom1', 'Bedroom', 'bedroom')
    const id = announce({ text: "Dinner's ready!", at_night: false })
    expect(id).toBe(latest + 1)
    expect(await texts('bedroom1', 'Bedroom', 'bedroom', latest)).toEqual(["Dinner's ready!"])
    expect(await texts('kitchen1', 'Kitchen', 'kitchen', latest)).toEqual(["Dinner's ready!"])
    expect(await texts('kitchen1', 'Kitchen', 'kitchen', id)).toEqual([])
  })

  test('only to the room, or the display, they are for, and never back to the sender', async () => {
    const { latest } = await poll('bedroom1', 'Bedroom', 'bedroom')
    announce({ text: 'kitchen only', area: 'kitchen', at_night: false })
    announce({ text: 'for kitchen2', to: 'kitchen2', at_night: false })
    announce({ text: 'from bedroom1', from: 'bedroom1', at_night: false })
    expect(await texts('bedroom1', 'Bedroom', 'bedroom', latest)).toEqual([])
    expect(await texts('kitchen1', 'Kitchen', 'kitchen', latest)).toEqual(['kitchen only', 'from bedroom1'])
    expect(await texts('kitchen2', 'Kitchen hub', 'kitchen', latest)).toEqual(['kitchen only', 'for kitchen2', 'from bedroom1'])
  })

  test('old news is dropped after 10 minutes', async () => {
    const { latest } = await poll('bedroom1', 'Bedroom', 'bedroom')
    announce({ text: 'stale', at_night: false })
    tick(10 * 60_000 + 1000)
    expect(await texts('bedroom1', 'Bedroom', 'bedroom', latest)).toEqual([])
  })

  test('only the last 20 are kept', async () => {
    const { latest } = await poll('bedroom1', 'Bedroom', 'bedroom')
    for (let i = 0; i < 25; i++) announce({ text: `n${i}`, at_night: false })
    const got = await texts('bedroom1', 'Bedroom', 'bedroom', latest)
    expect(got).toHaveLength(20)
    expect(got[0]).toBe('n5')
  })

  test('a message carries a 📢 card saying where it came from', async () => {
    const { latest } = await poll('kitchen1', 'Kitchen', 'kitchen')
    message('Come down', screenFor('bedroom1'), undefined, 'Message from Bedroom. Come down')
    const [item] = (await poll('kitchen1', 'Kitchen', 'kitchen', latest)).items as Item[]
    expect(item.text).toBe('Message from Bedroom. Come down')
    expect(item.display).toMatchObject({ emoji: '📢', title: 'From Bedroom', text: 'Come down', seconds: 60 })
  })
})

describe('the 📢 button', () => {
  beforeEach(wake)

  test('sends to one display by name', async () => {
    tick(5000)
    const { latest } = await poll('kitchen1', 'Kitchen', 'kitchen')
    expect(await read(press({ text: 'Bedtime!', to: 'hub', device: 'bedroom1' }))).toEqual({ ok: true, to: 'Kitchen hub' })
    expect(await texts('kitchen1', 'Kitchen', 'kitchen', latest)).toEqual([])
    expect(await texts('kitchen2', 'Kitchen hub', 'kitchen', latest)).toEqual(['Message from Bedroom. Bedtime!'])
  })

  test('at most once every 3 seconds', async () => {
    tick(5000)
    expect((await press({ text: 'one', device: 'bedroom1' })).status).toBe(200)
    tick(2000)
    expect((await press({ text: 'two', device: 'bedroom1' })).status).toBe(429)
    tick(1500)
    expect(await read(press({ text: 'three', device: 'bedroom1' }))).toEqual({ ok: true, to: 'everyone' })
  })

  test('refuses an empty message or a display that is off', async () => {
    tick(5000)
    expect((await press({ text: '   ', device: 'bedroom1' })).status).toBe(400)
    expect((await press({ text: 'hello?', to: 'garage', device: 'bedroom1' })).status).toBe(404)
  })
})

test("a queued wipe comes back with the display's poll, and it drops off the list", async () => {
  await handleRegistry(request('POST', '/api/admin/displays', { id: 'kitchen2', action: 'wipe' }, await asAdmin()), '/api/admin/displays')
  expect((await poll('kitchen2', 'Kitchen hub', 'kitchen')).command).toEqual({ wipe: true })
  expect(screenFor('kitchen2')).toBeUndefined()
})

test('displays that stop polling go offline after a minute', async () => {
  await poll('bedroom1', 'Bedroom', 'bedroom')
  tick(61_000)
  expect(onlineDisplays()).toEqual([])
})
