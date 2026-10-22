import { beforeEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { handleSamples } from '../../channel/samples.ts'
import { asAdmin, CONFIG, read } from '../helpers.ts'

const DIR = join(CONFIG, 'wakeword-samples')
const second = (seconds = 1) => new Uint8Array(seconds * 32000).fill(7) // 16-bit 16 kHz mono

async function send(query: string, pcm: Uint8Array, headers: Record<string, string> = {}) {
  const path = '/api/wakeword/sample'
  return handleSamples(new Request(`http://frog.test${path}?${query}`, { method: 'POST', headers, body: pcm }), path)
}

beforeEach(() => rmSync(DIR, { recursive: true, force: true }))

describe('wake word recordings', () => {
  test('need admin mode', async () => {
    expect((await send('kind=wake&speaker=Sam', second())).status).toBe(403)
  })

  test('are kept as 16 kHz mono WAVs, by kind and speaker', async () => {
    const r = await send('kind=wake&speaker=Sam', second(), await asAdmin())
    expect(await read(r)).toEqual({ ok: true, counts: { wake: 1, other: 0 } })
    const [file] = readdirSync(join(DIR, 'wake'))
    expect(file).toMatch(/^Sam-\d+\.wav$/)
    const wav = readFileSync(join(DIR, 'wake', file))
    const head = new DataView(wav.buffer, wav.byteOffset, 44)
    expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    expect(wav.subarray(8, 16).toString()).toBe('WAVEfmt ')
    expect(head.getUint16(22, true)).toBe(1) // mono
    expect(head.getUint32(24, true)).toBe(16000)
    expect(head.getUint16(34, true)).toBe(16) // bits
    expect(head.getUint32(40, true)).toBe(32000) // the data
    expect(wav.length).toBe(44 + 32000)
  })

  test("a speaker's name can't reach outside the folder", async () => {
    await send(`kind=other&speaker=${encodeURIComponent('../../Big Sam!')}`, second(), await asAdmin())
    expect(readdirSync(join(DIR, 'other'))[0]).toMatch(/^Big_Sam-\d+\.wav$/)
  })

  test('only wake or other, and half a second to six seconds of audio', async () => {
    const admin = await asAdmin()
    expect((await send('kind=music&speaker=Sam', second(), admin)).status).toBe(400)
    expect((await send('kind=wake&speaker=Sam', new Uint8Array(8000), admin)).status).toBe(400)
    expect((await send('kind=wake&speaker=Sam', second(7), admin)).status).toBe(400)
    expect((await send('kind=wake&speaker=Sam', new Uint8Array(16001), admin)).status).toBe(400) // half a sample
  })

  test('counts each speaker', async () => {
    const admin = await asAdmin()
    await send('kind=wake&speaker=Sam', second(), admin)
    await send('kind=other&speaker=Sam', second(), admin)
    await send('kind=wake&speaker=Jo', second(), admin)
    const path = '/api/wakeword/counts'
    const counts = await read(handleSamples(new Request(`http://frog.test${path}`, { headers: admin }), path))
    expect(counts).toEqual({ Sam: { wake: 1, other: 1 }, Jo: { wake: 1, other: 0 } })
  })
})
