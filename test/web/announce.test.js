import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { fakeFetch, settle } from './browser.js'
import { otherDisplays, sendMessage, startAnnouncements } from '../../src/lib/announce.js'

const realFetch = globalThis.fetch
const me = { ready: true, id: 'kitchen1', name: 'Kitchen', area: 'kitchen', areaName: 'Kitchen', who: 'Sam & Jo', personality: 'frog' }

let timer
beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  clearInterval(timer)
  jest.useRealTimers()
  globalThis.fetch = realFetch
})

/** Starts polling with the server answering each poll from `answers`; returns what was played and run. */
async function run(answers, getMe = () => me) {
  const played = []
  const commands = []
  const calls = fakeFetch(() => [200, answers.shift() ?? { latest: 0, items: [] }])
  timer = startAnnouncements(getMe, (a) => played.push(a.text), (c) => commands.push(c))
  await settle()
  return { played, commands, calls, next: async () => (jest.advanceTimersByTime(5000), await settle()) }
}

describe('announcements', () => {
  test("each poll says who this display is", async () => {
    const { calls } = await run([])
    expect(calls[0][0]).toBe('/api/announcements?after=0&device=kitchen1&name=Kitchen&area=kitchen&areaName=Kitchen&who=Sam%20%26%20Jo&personality=frog')
  })

  test("what was there before it started isn't played; what comes after is", async () => {
    const { played, calls, next } = await run([
      { latest: 4, items: [{ id: 4, text: 'old news' }] },
      { latest: 6, items: [{ id: 5, text: 'Dinner!' }, { id: 6, text: 'Bath time' }] },
    ])
    expect(played).toEqual([])
    await next()
    expect(calls[1][0]).toStartWith('/api/announcements?after=4&')
    expect(played).toEqual(['Dinner!', 'Bath time'])
  })

  test('after the server restarts (it counts from 0 again), its announcements are all new', async () => {
    const { played, calls, next } = await run([
      { latest: 40, items: [] },
      { latest: 2, items: [] },
      { latest: 2, items: [{ id: 1, text: 'one' }, { id: 2, text: 'two' }] },
    ])
    await next()
    expect(calls.map(([url]) => url.match(/after=(\d+)/)[1])).toEqual(['0', '40', '0'])
    expect(played).toEqual(['one', 'two'])
  })

  test("a grown-up's command is handed on", async () => {
    const { commands } = await run([{ latest: 0, items: [], command: { welcome: true } }])
    expect(commands).toEqual([{ welcome: true }])
  })

  test("a display that hasn't finished the welcome stays quiet", async () => {
    const { calls, next } = await run([], () => ({ ...me, ready: false }))
    await next()
    expect(calls).toEqual([])
  })

  test('an unreachable server is tried again next time', async () => {
    let up = false
    const calls = []
    globalThis.fetch = async (url) => {
      calls.push(url)
      if (!up) throw new Error('unreachable')
      return Response.json({ latest: 0, items: [] })
    }
    timer = startAnnouncements(() => me, () => {})
    await settle()
    up = true
    jest.advanceTimersByTime(5000)
    await settle()
    expect(calls).toHaveLength(2)
  })
})

describe('the 📢 button', () => {
  test('sends the message with who it is from', async () => {
    const calls = fakeFetch(() => [200, { ok: true, to: 'everyone' }])
    expect(await sendMessage(me, 'Bedtime!', '')).toBe('')
    expect(calls[0][0]).toBe('/api/announce')
    expect(JSON.parse(calls[0][1].body)).toEqual({ text: 'Bedtime!', device: 'kitchen1', name: 'Kitchen' })
  })

  test("returns the server's error, or that it couldn't reach it", async () => {
    fakeFetch(() => [429, { error: 'slow down a bit' }])
    expect(await sendMessage(me, 'hi', 'bedroom1')).toBe('slow down a bit')
    fakeFetch(() => {
      throw new Error('unreachable')
    })
    expect(await sendMessage(me, 'hi', '')).toBe("Couldn't reach the server")
  })

  test('lists the other displays, or none when the server is unreachable', async () => {
    const calls = fakeFetch(() => [200, [{ id: 'bedroom1', name: 'Bedroom' }]])
    expect(await otherDisplays('kitchen1')).toEqual([{ id: 'bedroom1', name: 'Bedroom' }])
    expect(calls[0][0]).toBe('/api/displays?except=kitchen1')
    fakeFetch(() => {
      throw new Error('unreachable')
    })
    expect(await otherDisplays('kitchen1')).toEqual([])
  })
})
