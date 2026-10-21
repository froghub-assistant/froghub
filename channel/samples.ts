/**
 * Real voice recordings for training a wake word ("Hey Verity"): the first model, trained only on computer voices,
 * didn't recognise real people at all. Settings → 🎙️ (admin mode) records short clips through the same microphone
 * path the wake word hears, and they're kept on the server as 16 kHz WAVs, for training only:
 *   ~/.config/froghub/wakeword-samples/{wake,other}/<speaker>-<time>.wav
 *
 *   POST /api/wakeword/sample?kind=wake|other&speaker=<name>   raw 16-bit 16 kHz mono PCM; admin only
 *   GET  /api/wakeword/counts                                   admin only
 */
import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { adminValid, clean, json } from './common.ts'

const DIR = `${homedir()}/.config/froghub/wakeword-samples`
const KINDS = ['wake', 'other']
const MAX_BYTES = 6 * 16000 * 2 // six seconds
const MAX_FILES = 2000

function wav(pcm: Uint8Array): Uint8Array {
  const head = new DataView(new ArrayBuffer(44))
  const text = (at: number, s: string) => [...s].forEach((c, i) => head.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  head.setUint32(4, 36 + pcm.length, true)
  text(8, 'WAVEfmt ')
  head.setUint32(16, 16, true)
  head.setUint16(20, 1, true) // PCM
  head.setUint16(22, 1, true) // mono
  head.setUint32(24, 16000, true)
  head.setUint32(28, 32000, true)
  head.setUint16(32, 2, true)
  head.setUint16(34, 16, true)
  text(36, 'data')
  head.setUint32(40, pcm.length, true)
  const out = new Uint8Array(44 + pcm.length)
  out.set(new Uint8Array(head.buffer))
  out.set(pcm, 44)
  return out
}

function counts(): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {}
  for (const kind of KINDS) {
    mkdirSync(`${DIR}/${kind}`, { recursive: true })
    for (const f of readdirSync(`${DIR}/${kind}`)) {
      const who = f.replace(/-\d+\.wav$/, '')
      result[who] ??= { wake: 0, other: 0 }
      result[who][kind]++
    }
  }
  return result
}

export async function handleSamples(req: Request, pathname: string): Promise<Response> {
  if (!adminValid(req.headers.get('x-admin-token'))) return json({ error: 'admin mode needed' }, 403)
  if (req.method === 'GET' && pathname === '/api/wakeword/counts') return json(counts())
  if (req.method !== 'POST' || pathname !== '/api/wakeword/sample') return new Response('not found', { status: 404 })
  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') ?? ''
  const speaker = clean(url.searchParams.get('speaker'), 30).replace(/[^\w ]/g, '').trim().replace(/ /g, '_') || 'someone'
  if (!KINDS.includes(kind)) return json({ error: 'kind must be wake or other' }, 400)
  const pcm = new Uint8Array(await req.arrayBuffer())
  if (pcm.length < 16000 || pcm.length > MAX_BYTES || pcm.length % 2) return json({ error: 'expected 0.5-6 s of 16-bit 16 kHz audio' }, 400)
  const all = counts()
  if (Object.values(all).reduce((n, c) => n + c.wake + c.other, 0) >= MAX_FILES) return json({ error: 'that is plenty of recordings' }, 400)
  writeFileSync(`${DIR}/${kind}/${speaker}-${Date.now()}.wav`, wav(pcm))
  return json({ ok: true, counts: counts()[speaker] })
}
