import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { handleRadio } from '../../channel/radio.ts'
import { runTool } from '../../channel/tools.ts'
import { CONFIG, read, request } from '../helpers.ts'
import { routes } from '../../channel/app.ts'

// Stations, and what each address answers: [status, content-type]
let stations: object[] = []
let byTag: object[] = []
let answers: Record<string, [number, string]> = {}
const asked: string[] = []
const station = (name: string, url: string, extra: object = {}) => ({
  stationuuid: `id-${name}`, name, url_resolved: url, codec: 'MP3', hls: 0, countrycode: 'GB', tags: 'pop,chart,hits,more', lastcheckok: 1, ...extra,
})
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
  const url = String(input)
  asked.push(url)
  if (url.includes('/stations/search')) return Response.json(url.includes('tag=') ? byTag : stations)
  if (url.includes('/json/url/')) return Response.json({ ok: true })
  const [status, type] = answers[url] ?? [404, 'text/html']
  return new Response(status === 200 ? 'audio bytes' : '', { status, headers: { 'content-type': type } })
}) as typeof fetch)
afterAll(() => fetchSpy.mockRestore())
beforeEach(() => {
  asked.length = 0
  stations = []
  byTag = []
  answers = {}
  writeFileSync(join(CONFIG, 'policy.json'), '{}')
})

const handle = routes(async () => null)
const lastAudio = async () => {
  const { items } = await read(handle(request('GET', '/api/announcements?after=0&device=radio1&name=Radio')))
  return items.at(-1)?.audio
}

describe('play_radio', () => {
  test('an https station plays as it is, and the play is counted', async () => {
    stations = [station('Jazz FM', 'https://jazz.test/live.mp3')]
    answers['https://jazz.test/live.mp3'] = [200, 'audio/mpeg']
    const text = (await runTool('play_radio', { station: 'jazz fm' }, {}))!.text
    expect(text).toBe('Playing Jazz FM (GB; pop, chart, hits) on every display that is on (within 5 seconds).')
    expect(await lastAudio()).toEqual({ url: 'https://jazz.test/live.mp3', title: 'Jazz FM' })
    expect(asked.some(u => u.endsWith('/json/url/id-Jazz FM'))).toBe(true)
  })

  test('an http station: https if it answers there, else relayed (only that station)', async () => {
    stations = [station('Upgradable', 'http://up.test/s'), station('Http only', 'http://old.test/s')]
    answers['https://up.test/s'] = [404, 'text/html']
    answers['https://old.test/s'] = [401, 'text/html']
    answers['http://up.test/s'] = [500, '']
    answers['http://old.test/s'] = [200, 'audio/aacp']
    const text = (await runTool('play_radio', { station: 'oldies' }, {}))!.text
    expect(text).toStartWith('Playing Http only')
    const { url } = await lastAudio()
    expect(url).toMatch(/^\/api\/radio\/[0-9a-f]{24}$/)
    const res = await handle(request('GET', url))
    expect(res.headers.get('content-type')).toBe('audio/aacp')
    expect(await res.text()).toBe('audio bytes')
    expect((await handleRadio(request('GET', '/api/radio/0123456789abcdef01234567'), '/api/radio/0123456789abcdef01234567')).status).toBe(404)
  })

  test("HLS goes to the display's hls.js, and an http-only HLS station is skipped", async () => {
    stations = [station('Plain http HLS', 'http://a.test/x.m3u8', { hls: 1 }), station('Radio 1', 'http://b.test/one.m3u8', { hls: 1 })]
    answers['https://b.test/one.m3u8'] = [200, 'application/x-mpegurl']
    expect((await runTool('play_radio', { station: 'radio 1' }, {}))!.text).toStartWith('Playing Radio 1')
    expect(await lastAudio()).toEqual({ url: 'https://b.test/one.m3u8', title: 'Radio 1', hls: true })
  })

  test('by genre when no station has that name, and nothing playable is an error', async () => {
    byTag = [station('Smooth', 'https://s.test/a'), station('Smoother', 'https://s.test/b')]
    answers['https://s.test/a'] = [200, 'audio/mpeg']
    expect((await runTool('play_radio', { station: 'jazz' }, {}))!.text).toEndWith('Other jazz stations: Smoother.')
    byTag = []
    stations = [station('Dead', 'https://dead.test/')]
    const r = await runTool('play_radio', { station: 'dead' }, {})
    expect(r).toEqual({ isError: true, text: 'Found 1 station for "dead", but none would play on the displays right now.' })
  })

  test('off with the music switch', async () => {
    writeFileSync(join(CONFIG, 'policy.json'), JSON.stringify({ music: false }))
    expect((await runTool('play_radio', { station: 'x' }, {}))?.isError).toBe(true)
    expect(asked).toEqual([])
  })
})
