import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { fakeFetch, settle, visit } from './browser.js'
import { finishHaLogin, newPairing, pendingHaLogin, startHaLogin, waitForPairing } from '../../src/lib/connect.js'

const realFetch = globalThis.fetch

beforeEach(() => {
  visit('https://hub.example.com/')
  sessionStorage.clear()
})
afterEach(() => {
  globalThis.fetch = realFetch
  jest.useRealTimers()
})

describe('Log in with Home Assistant', () => {
  test("goes to HA's login page with Frog Hub as the client", () => {
    startHaLogin('http://ha.local:8123//', { step: 'connect' })
    const to = new URL(location.href)
    expect(to.origin + to.pathname).toBe('http://ha.local:8123/auth/authorize')
    expect(to.searchParams.get('response_type')).toBe('code')
    expect(to.searchParams.get('client_id')).toBe('https://hub.example.com/')
    expect(to.searchParams.get('redirect_uri')).toBe('https://hub.example.com/')
    expect(to.searchParams.get('state')).toMatch(/^[0-9a-f]{24}$/)
  })

  test('on coming back, says where it was going and what to keep', () => {
    expect(pendingHaLogin()).toBeNull()
    startHaLogin('http://ha.local:8123', { step: 'connect' })
    const state = new URL(location.href).searchParams.get('state')
    visit(`https://hub.example.com/?code=abc&state=${state}`)
    expect(pendingHaLogin()).toEqual({ haUrl: 'http://ha.local:8123', keep: { step: 'connect' } })
  })

  test("a state that doesn't match is refused, and the code is taken out of the address", async () => {
    startHaLogin('http://ha.local:8123')
    visit('https://hub.example.com/?code=abc&state=forged')
    const calls = fakeFetch(() => [200, {}])
    await expect(finishHaLogin('Kitchen')).rejects.toThrow('That login didn’t match')
    expect(location.href).toBe('https://hub.example.com/')
    expect(sessionStorage.getItem('froghub-ha-login')).toBeNull()
    expect(calls).toEqual([])
  })

  test('no code means the login was cancelled', async () => {
    startHaLogin('http://ha.local:8123')
    const state = new URL(location.href).searchParams.get('state')
    visit(`https://hub.example.com/?error=access_denied&state=${state}`)
    await expect(finishHaLogin('Kitchen')).rejects.toThrow('Home Assistant didn’t log in')
  })

  test("HA refusing the code is passed on", async () => {
    startHaLogin('http://ha.local:8123')
    const state = new URL(location.href).searchParams.get('state')
    visit(`https://hub.example.com/?code=abc&state=${state}`)
    const calls = fakeFetch(() => [400, { error: 'invalid_request' }])
    await expect(finishHaLogin('Kitchen')).rejects.toThrow('Home Assistant said 400 to the login')
    const [url, init] = calls[0]
    expect(url).toBe('http://ha.local:8123/auth/token')
    expect(Object.fromEntries(init.body)).toEqual({ grant_type: 'authorization_code', code: 'abc', client_id: 'https://hub.example.com/' })
  })
})

describe('pairing', () => {
  test('a code and a QR code of the admin page with it', async () => {
    fakeFetch(() => [200, { code: 'ABCD2345', expiresIn: 600000 }])
    const pairing = await newPairing()
    expect(pairing.code).toBe('ABCD2345')
    expect(pairing.url).toBe('https://hub.example.com/admin/#pair=ABCD2345')
    expect(pairing.svg).toStartWith('<svg')
  })

  test("the server's error is passed on", async () => {
    fakeFetch(() => [429, { error: 'too many displays pairing at once' }])
    await expect(newPairing()).rejects.toThrow('too many displays pairing at once')
  })

  test('polls every 2 seconds until approved, riding out a server hiccup', async () => {
    jest.useFakeTimers()
    const answers = [[200, { waiting: true }], 'down', [200, { waiting: true }], [200, { settings: { personality: 'verity' }, token: 't' }]]
    const calls = fakeFetch(() => {
      const next = answers.shift()
      if (next === 'down') throw new Error('unreachable')
      return next
    })
    let result
    waitForPairing('ABCD 2345').then((r) => (result = r))
    for (let i = 0; i < 4; i++) {
      await settle()
      jest.advanceTimersByTime(2000)
    }
    await settle()
    expect(result).toEqual({ settings: { personality: 'verity' }, token: 't' })
    expect(calls).toHaveLength(4)
    expect(calls[0][0]).toBe('/api/pair?code=ABCD%202345')
  })

  test('gives up when the code runs out, or is cancelled', async () => {
    fakeFetch(() => [404, { error: 'expired' }])
    await expect(waitForPairing('ABCD2345')).rejects.toThrow('The code ran out')
    const stop = new AbortController()
    stop.abort()
    await expect(waitForPairing('ABCD2345', stop.signal)).rejects.toThrow('cancelled')
  })
})
