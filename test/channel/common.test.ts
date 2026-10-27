import { afterAll, describe, expect, setSystemTime, test } from 'bun:test'
import { adminValid, clean, cleanActions, deviceLines, handleAdminCheck, handleLock, handleUnlock } from '../../channel/common.ts'
import { PIN, read, removeConfig, request, setPin } from '../helpers.ts'

afterAll(() => setSystemTime())

describe('clean', () => {
  test('flattens lines and drops quotes and angle brackets', () => {
    expect(clean('  Hi\r\nthere "you" <b>  ', 100)).toBe('Hi  there  you   b')
  })
  test('cuts to the maximum length', () => {
    expect(clean('abcdef', 3)).toBe('abc')
  })
  test('anything but a string is empty', () => {
    expect(clean(42, 10)).toBe('')
    expect(clean(null, 10)).toBe('')
    expect(clean({ text: 'hi' }, 10)).toBe('')
  })
})

describe('cleanActions', () => {
  test('keeps only well-formed actions with a known service', () => {
    expect(cleanActions([
      { entity_id: 'light.lamp', service: 'turn_on' },
      { entity_id: 'light.lamp', service: 'self_destruct' },
      { service: 'turn_off' },
      null,
      'turn_on',
    ])).toEqual([{ entity_id: 'light.lamp', service: 'turn_on' }])
  })
  test('passes on a numeric value and a short query, and nothing else', () => {
    const [a] = cleanActions([{ entity_id: 'media_player.echo', service: 'play_music', value: 30, query: 'x'.repeat(150), extra: 'no' }])
    expect(a).toEqual({ entity_id: 'media_player.echo', service: 'play_music', value: 30, query: 'x'.repeat(100) })
  })
  test('drops a value that is not a number', () => {
    expect(cleanActions([{ entity_id: 'light.lamp', service: 'brightness', value: '50' }])).toEqual([{ entity_id: 'light.lamp', service: 'brightness' }])
  })
  test('anything but a list is no actions', () => {
    expect(cleanActions({ entity_id: 'light.lamp', service: 'turn_on' })).toEqual([])
    expect(cleanActions(undefined)).toEqual([])
  })
})

describe('deviceLines', () => {
  test('one line per device', () => {
    expect(deviceLines([{ name: 'Lamp', id: 'light.lamp', state: 'on' }])).toEqual(['Lamp (light.lamp): on'])
  })
  test('says which speakers can play music by name', () => {
    expect(deviceLines([{ name: 'Speaker', id: 'media_player.speaker', state: 'idle', music: true }, { name: 'TV', id: 'media_player.tv', state: 'off', music: 'yes' }]))
      .toEqual(['Speaker (media_player.speaker): idle, plays music by name', 'TV (media_player.tv): off'])
  })
  test('skips devices without a name and stops at 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `D${i}`, id: `switch.d${i}`, state: 'off' }))
    expect(deviceLines([{ id: 'light.nameless', state: 'on' }])).toEqual([])
    expect(deviceLines(many)).toHaveLength(12)
  })
  test('anything but a list is no devices', () => {
    expect(deviceLines('light.lamp')).toEqual([])
  })
})

describe('admin mode', () => {
  const unlock = (body: unknown) => handleUnlock(request('POST', '/api/unlock', body))

  test('asks for a PIN to be set first', async () => {
    removeConfig('pin')
    expect((await unlock({ pin: PIN })).status).toBe(409)
  })

  test('the right PIN gives a token that works until locked again', async () => {
    await setPin()
    const res = await unlock({ pin: PIN })
    expect(res.status).toBe(200)
    const { token, idle_timeout } = await res.json()
    expect(token).toMatch(/^[0-9a-f]{48}$/)
    expect(idle_timeout).toBe(600)
    expect(await read(handleAdminCheck(request('GET', '/api/admin', undefined, { 'x-admin-token': token })))).toEqual({ admin: true })
    handleLock(request('POST', '/api/lock', undefined, { 'x-admin-token': token }))
    expect(adminValid(token)).toBe(false)
  })

  test('wrong, malformed and missing PINs are refused', async () => {
    expect((await unlock({ pin: '0000' })).status).toBe(403)
    expect((await unlock({ pin: '12ab' })).status).toBe(403)
    expect((await unlock({})).status).toBe(403)
    expect((await handleUnlock(new Request('http://frog.test/api/unlock', { method: 'POST', body: '{nope' }))).status).toBe(400)
    expect(adminValid(null)).toBe(false)
    expect(adminValid('made-up')).toBe(false)
  })

  test('a token lasts 10 minutes after it was last used', async () => {
    let now = Date.now()
    const { token } = await read(unlock({ pin: PIN }))
    setSystemTime((now += 9 * 60_000))
    expect(adminValid(token)).toBe(true)
    setSystemTime((now += 9 * 60_000)) // 18 minutes in, but only 9 since it was used
    expect(adminValid(token)).toBe(true)
    setSystemTime((now += 11 * 60_000))
    expect(adminValid(token)).toBe(false)
  })

  test('five wrong PINs lock it for five minutes, even for the right PIN', async () => {
    let now = Date.now()
    for (let i = 0; i < 5; i++) expect((await unlock({ pin: '9999' })).status).toBe(403)
    const locked = await unlock({ pin: PIN })
    expect(locked.status).toBe(429)
    expect((await locked.json()).retry_in).toBe(300)
    setSystemTime((now += 5 * 60_000 + 1000))
    expect((await unlock({ pin: PIN })).status).toBe(200)
  })

  test('the right PIN clears the count of wrong ones', async () => {
    for (let i = 0; i < 4; i++) await unlock({ pin: '9999' })
    expect((await unlock({ pin: PIN })).status).toBe(200)
    for (let i = 0; i < 4; i++) await unlock({ pin: '9999' })
    expect((await unlock({ pin: PIN })).status).toBe(200)
  })
})
