import { afterAll, describe, expect, setSystemTime, test } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { checkIn, handleRegistry } from '../../channel/registry.ts'
import { isGrownUps, setGrownUps } from '../../channel/store.ts'
import { asAdmin, CONFIG, read, request } from '../helpers.ts'

afterAll(() => setSystemTime())

const PATH = '/api/admin/displays'
const info = (name = 'Kitchen') => ({ name, who: 'Sam', area: 'kitchen', areaName: 'Kitchen', personality: 'frog' })
const list = async () => read(handleRegistry(request('GET', PATH, undefined, await asAdmin()), PATH))
const act = async (body: unknown) => handleRegistry(request('POST', PATH, body, await asAdmin()), PATH)

describe('checking in', () => {
  test('a new display is listed and saved', async () => {
    expect(checkIn('reg1', info())).toBeUndefined()
    const [entry] = (await list()).filter((e: { id: string }) => e.id === 'reg1')
    expect(entry).toMatchObject({ id: 'reg1', ...info(), online: true, grownUps: false })
    expect(JSON.parse(readFileSync(join(CONFIG, 'displays.json'), 'utf8')).reg1.name).toBe('Kitchen')
  })

  test('it keeps when it was first seen, and goes offline after a minute without a check-in', async () => {
    let now = Date.now()
    checkIn('reg2', info('Hall'))
    const first = (await list()).find((e: { id: string }) => e.id === 'reg2')
    setSystemTime((now += 30_000))
    checkIn('reg2', info('Hall'))
    setSystemTime((now += 61_000))
    const later = (await list()).find((e: { id: string }) => e.id === 'reg2')
    expect(later.firstSeen).toBe(first.firstSeen)
    expect(later.lastSeen).toBe(first.lastSeen + 30_000)
    expect(later.online).toBe(false)
  })

  test('the newest is listed first', async () => {
    checkIn('reg3', info('Old'))
    setSystemTime(Date.now() + 5000)
    checkIn('reg4', info('New'))
    const ids = (await list()).map((e: { id: string }) => e.id)
    expect(ids.indexOf('reg4')).toBeLessThan(ids.indexOf('reg3'))
  })
})

describe("a grown-up's commands", () => {
  test('need admin mode', async () => {
    checkIn('cmd0', info())
    expect((await handleRegistry(request('GET', PATH), PATH)).status).toBe(403)
    expect((await handleRegistry(request('POST', PATH, { id: 'cmd0', action: 'wipe' }), PATH)).status).toBe(403)
    expect(checkIn('cmd0', info())).toBeUndefined()
  })

  test('are handed over on the next check-in, once', async () => {
    checkIn('cmd1', info())
    expect((await act({ id: 'cmd1', action: 'welcome' })).status).toBe(200)
    expect(checkIn('cmd1', info())).toEqual({ welcome: true })
    expect(checkIn('cmd1', info())).toBeUndefined()
  })

  test('new settings are cleaned and add up', async () => {
    checkIn('cmd2', info())
    await act({ id: 'cmd2', action: 'set', set: { deviceName: 'Kitchen\nhub', colour: 'red' } })
    await act({ id: 'cmd2', action: 'set', set: { area: 'living_room', name: 'x'.repeat(80) } })
    expect(checkIn('cmd2', info())).toEqual({ set: { deviceName: 'Kitchen hub', area: 'living_room', name: 'x'.repeat(60) } })
  })

  test('the microphone and volume can be set, as a switch and a level from 0 to 100', async () => {
    checkIn('cmd6', info())
    await act({ id: 'cmd6', action: 'set', set: { micMuted: true, volume: 140.4 } })
    await act({ id: 'cmd6', action: 'set', set: { micMuted: 'no', volume: '50' } }) // wrong types are ignored
    expect(checkIn('cmd6', info())).toEqual({ set: { micMuted: true, volume: 100 } })
    await act({ id: 'cmd6', action: 'set', set: { volume: -3 } })
    expect(checkIn('cmd6', info())).toEqual({ set: { volume: 0 } })
  })

  test('the admin page sees whether a display is muted, and its volume', async () => {
    checkIn('cmd7', { ...info(), micMuted: true, volume: 35 })
    expect((await list()).find((d: { id: string }) => d.id === 'cmd7')).toMatchObject({ micMuted: true, volume: 35 })
  })

  test('cancel drops what was queued', async () => {
    checkIn('cmd3', info())
    await act({ id: 'cmd3', action: 'wipe' })
    await act({ id: 'cmd3', action: 'cancel' })
    expect(checkIn('cmd3', info())).toBeUndefined()
  })

  test('a wipe forgets the display and its grown-ups mark', async () => {
    checkIn('cmd4', info())
    setGrownUps('cmd4', true)
    await act({ id: 'cmd4', action: 'wipe' })
    expect(checkIn('cmd4', info())).toEqual({ wipe: true })
    expect((await list()).some((e: { id: string }) => e.id === 'cmd4')).toBe(false)
    expect(isGrownUps('cmd4')).toBe(false)
  })

  test('forget drops it straight away', async () => {
    checkIn('cmd5', info())
    setGrownUps('cmd5', true)
    await act({ id: 'cmd5', action: 'forget' })
    expect((await list()).some((e: { id: string }) => e.id === 'cmd5')).toBe(false)
    expect(isGrownUps('cmd5')).toBe(false)
  })

  test('mistakes are refused', async () => {
    checkIn('cmd6', info())
    expect((await act({ id: 'nobody', action: 'wipe' })).status).toBe(404)
    expect((await act({ id: 'cmd6', action: 'explode' })).status).toBe(400)
    expect((await act({ id: 'cmd6', action: 'set', set: { colour: 'red' } })).status).toBe(400)
    expect((await act({ id: 'cmd6', action: 'set' })).status).toBe(400)
    expect(checkIn('cmd6', info())).toBeUndefined()
  })
})

test('other routes are not found', async () => {
  expect((await handleRegistry(request('GET', '/api/admin/other', undefined, await asAdmin()), '/api/admin/other')).status).toBe(404)
  expect((await handleRegistry(request('DELETE', PATH, undefined, await asAdmin()), PATH)).status).toBe(404)
  expect(existsSync(join(CONFIG, 'displays.json'))).toBe(true)
})
