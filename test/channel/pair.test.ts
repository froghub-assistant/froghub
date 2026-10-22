import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test'
import { handlePair } from '../../channel/pair.ts'
import { handleStore } from '../../channel/store.ts'
import { asAdmin, read, removeConfig, request } from '../helpers.ts'

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.e30.pairpairpairpair'

const newCode = async () => (await read(handlePair(request('POST', '/api/pair'), '/api/pair'))).code as string
const check = (code: string) => handlePair(request('GET', `/api/pair?code=${code}`), '/api/pair')
const approve = async (code: string, admin = true) =>
  handlePair(request('POST', '/api/admin/pair', { code }, admin ? await asAdmin() : {}), '/api/admin/pair')

beforeAll(async () => {
  removeConfig('shared-settings.json', 'shared-token')
  await handleStore(request('POST', '/api/settings', { settings: { personality: 'lovity' }, token: TOKEN }, await asAdmin()), '/api/settings')
})
afterAll(() => setSystemTime())

describe('pairing a display', () => {
  test('codes are 8 easy-to-read characters', async () => {
    const code = await newCode()
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
  })

  test('the display waits until a grown-up says yes, then gets the settings and token once', async () => {
    const code = await newCode()
    expect(await read(check(code))).toEqual({ waiting: true })
    expect((await approve(code.toLowerCase())).status).toBe(200)
    const got = await read(check(code))
    expect(got.settings).toEqual({ personality: 'lovity' })
    expect(got.token).toBe(TOKEN)
    expect((await check(code)).status).toBe(404)
  })

  test('saying yes needs admin mode', async () => {
    const code = await newCode()
    expect((await approve(code, false)).status).toBe(403)
    expect(await read(check(code))).toEqual({ waiting: true })
  })

  test('unknown codes are refused', async () => {
    expect((await approve('NOTACODE')).status).toBe(404)
    expect((await check('NOTACODE')).status).toBe(404)
    expect((await handlePair(request('PUT', '/api/admin/pair', {}), '/api/admin/pair')).status).toBe(404)
  })

  test('codes run out after 10 minutes', async () => {
    const code = await newCode()
    setSystemTime(Date.now() + 10 * 60_000 + 1000)
    expect((await check(code)).status).toBe(404)
    expect((await approve(code)).status).toBe(404)
  })

  test('at most 20 displays pairing at once', async () => {
    setSystemTime(Date.now() + 11 * 60_000) // the earlier codes have gone
    for (let i = 0; i < 20; i++) await newCode()
    expect((await handlePair(request('POST', '/api/pair'), '/api/pair')).status).toBe(429)
    setSystemTime(Date.now() + 11 * 60_000)
    expect(await newCode()).toMatch(/^[A-Z2-9]{8}$/)
  })
})
