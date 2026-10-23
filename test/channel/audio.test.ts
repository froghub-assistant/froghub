import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { checkAudioUrl } from '../../channel/audio.ts'
import { handleAnnouncements } from '../../channel/announce.ts'
import { routes } from '../../channel/app.ts'
import { runTool } from '../../channel/tools.ts'
import { CONFIG, read, request } from '../helpers.ts'

let type = 'audio/mpeg'
let status = 206
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
  new Response('x', { status, headers: type ? { 'content-type': type } : {} })) as typeof fetch)
afterAll(() => fetchSpy.mockRestore())

const poll = async (device: string, name: string) =>
  (await read(handleAnnouncements(request('GET', `/api/announcements?after=0&device=${device}&name=${name}`), '/api/announcements'))).items
const latest = async (device: string, name: string) => (await poll(device, name)).at(-1)

beforeAll(async () => {
  await poll('hall1', 'Hall')
  await poll('den1', 'Den')
})
beforeEach(() => {
  type = 'audio/mpeg'
  status = 206
  rmSync(join(CONFIG, 'policy.json'), { force: true })
})

describe('which links can play', () => {
  test('https links the server says are audio, streams too', async () => {
    expect(await checkAudioUrl('https://example.com/song.mp3')).toBe('https://example.com/song.mp3')
    type = 'application/ogg'
    expect(await checkAudioUrl('https://radio.example/stream')).toBe('https://radio.example/stream')
    type = 'application/octet-stream' // some servers: fine for an audio file name
    expect(await checkAudioUrl('https://example.com/a/b.ogg')).toBe('https://example.com/a/b.ogg')
  })

  test('not http, passwords, other things, or broken links', async () => {
    await expect(checkAudioUrl('http://example.com/a.mp3')).rejects.toThrow('Only https links')
    await expect(checkAudioUrl('https://me:secret@example.com/a.mp3')).rejects.toThrow('password')
    await expect(checkAudioUrl('not a link')).rejects.toThrow('not a link')
    type = 'text/html'
    await expect(checkAudioUrl('https://example.com/page')).rejects.toThrow('not audio (it is text/html)')
    type = 'application/octet-stream'
    await expect(checkAudioUrl('https://example.com/file.zip')).rejects.toThrow('not audio')
    type = 'audio/mpeg'
    status = 404
    await expect(checkAudioUrl('https://example.com/gone.mp3')).rejects.toThrow('answered 404')
  })
})

describe('play_audio and stop_audio', () => {
  const den = { id: 'den1', name: 'Den', area: '', seen: Date.now() }

  test('to the display that asked, or one by name, or all; and stopping', async () => {
    expect(await runTool('play_audio', { url: 'https://example.com/a.mp3', title: 'Birdsong' }, { from: den })).toEqual({ text: 'Playing on Den (within 5 seconds).' })
    expect(await latest('den1', 'Den')).toMatchObject({ text: '', audio: { url: 'https://example.com/a.mp3', title: 'Birdsong' }, to: 'den1', at_night: false })
    expect((await runTool('play_audio', { url: 'https://example.com/b.mp3', to: 'hall' }, { from: den })).text).toBe('Playing on Hall (within 5 seconds).')
    expect((await runTool('play_audio', { url: 'https://example.com/c.mp3', to: 'all' }, { from: den })).text).toBe('Playing on every display that is on (within 5 seconds).')
    expect((await runTool('stop_audio', {}, {})).text).toBe('Stopped on every display that is on.')
    expect(await latest('hall1', 'Hall')).toMatchObject({ audio: { stop: true }, at_night: true })
  })

  test('says what is wrong, and is off with the music switch', async () => {
    expect(await runTool('play_audio', { url: 'https://example.com/a.mp3', to: 'Attic' }, {})).toMatchObject({ isError: true, text: expect.stringContaining('No display called "Attic"') })
    writeFileSync(join(CONFIG, 'policy.json'), JSON.stringify({ music: false }))
    expect(await runTool('play_audio', { url: 'https://example.com/a.mp3' }, {})).toMatchObject({ isError: true, text: expect.stringContaining('playing music') })
  })

  test('the server can play and stop it without anyone asking', async () => {
    const handle = routes(async () => null)
    const post = (body: unknown) => handle(request('POST', '/local/announce', body))
    expect(await read(post({ audio: 'https://example.com/news.mp3', title: 'News', to: 'Hall' }))).toMatchObject({ ok: true })
    expect(await latest('hall1', 'Hall')).toMatchObject({ audio: { url: 'https://example.com/news.mp3', title: 'News' }, to: 'hall1' })
    expect((await post({ audio: 'http://example.com/a.mp3' })).status).toBe(400)
    expect(await read(post({ stop_audio: true }))).toMatchObject({ ok: true })
    writeFileSync(join(CONFIG, 'policy.json'), JSON.stringify({ music: false }))
    expect((await post({ audio: 'https://example.com/a.mp3' })).status).toBe(403)
  })
})
