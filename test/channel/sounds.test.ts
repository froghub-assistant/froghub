import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { FREESOUND_FILE, findSound } from '../../channel/sounds.ts'
import { runTool } from '../../channel/tools.ts'
import { CONFIG } from '../helpers.ts'

const asked: string[] = []
let freesoundStatus = 200
const page = (index: number, title: string, duration: number, extra: object = {}) => ({
  index, title: `File:${title}`,
  imageinfo: [{ url: `https://upload.wikimedia.org/c/${title}?utm_source=x`, mime: 'application/ogg', duration, extmetadata: { LicenseShortName: { value: 'CC0' }, Artist: { value: '<a href="/u">Ann</a>' } }, ...extra }],
})
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
  const url = String(input)
  asked.push(url)
  if (url.startsWith('https://commons.wikimedia.org/')) {
    return Response.json({ query: { pages: {
      1: page(3, 'Lion roar.ogg', 9.1),
      2: page(1, 'LL-Q1860 (eng)-Someone-lion.wav', 2),
      3: page(2, 'En-us-lion.ogg', 2),
      4: page(4, 'Short.ogg', 0.8),
      5: page(5, 'Lion tune.mid', 30, { mime: 'audio/midi' }),
      6: page(6, 'Lions at the zoo.ogg', 75),
    } } })
  }
  if (freesoundStatus !== 200) return new Response('', { status: freesoundStatus })
  return Response.json({ results: [
    { name: 'big roar.wav', duration: 4.2, username: 'bob', license: 'http://creativecommons.org/publicdomain/zero/1.0/', previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/1/roar-hq.mp3' } },
    { name: 'no preview', duration: 3, username: 'x', license: '', previews: {} },
  ] })
}) as typeof fetch)
afterAll(() => fetchSpy.mockRestore())
beforeEach(() => {
  asked.length = 0
  freesoundStatus = 200
  writeFileSync(join(CONFIG, 'policy.json'), '{}')
})
afterEach(() => rmSync(FREESOUND_FILE, { force: true }))

describe('find_sound', () => {
  test('Commons alone without a Freesound key, without pronunciations, MIDI or blips', async () => {
    expect(await findSound({ query: 'lion roar' })).toBe([
      '2 clips of "lion roar":',
      '1. Lion roar (9 s; Wikimedia Commons, Ann, CC0): https://upload.wikimedia.org/c/Lion roar.ogg',
      '2. Lions at the zoo (1 min 15 s; Wikimedia Commons, Ann, CC0): https://upload.wikimedia.org/c/Lions at the zoo.ogg',
    ].join('\n'))
    // Under 3 clips, so it tried the words alone too (the same clips here, not repeated)
    expect(asked.map(u => new URL(u).searchParams.get('gsrsearch'))).toEqual(['lion roar filetype:audio', 'lion filetype:audio', 'roar filetype:audio'])
  })

  test('with a key, both at once, taking turns', async () => {
    writeFileSync(FREESOUND_FILE, 'k3y\n')
    const lines = (await findSound({ query: 'lion roar' })).split('\n')
    expect(lines[0]).toBe('3 clips of "lion roar":')
    expect(lines[2]).toBe('2. big roar (4 s; Freesound, bob, CC0): https://cdn.freesound.org/previews/1/roar-hq.mp3')
    expect(asked.find(u => u.startsWith('https://freesound.org/'))).toContain('token=k3y')
  })

  test("one source failing still gives the other's", async () => {
    writeFileSync(FREESOUND_FILE, 'bad')
    freesoundStatus = 401
    expect(await findSound({ query: 'lion' })).toStartWith('2 clips of "lion":')
  })

  test('off with the music switch', async () => {
    writeFileSync(join(CONFIG, 'policy.json'), JSON.stringify({ music: false }))
    expect((await runTool('find_sound', { query: 'lion' }, {}))?.isError).toBe(true)
    expect(asked).toEqual([])
  })
})
