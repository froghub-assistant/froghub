/**
 * The play_radio tool: finds a radio station by name or genre on radio-browser.info (a free, open directory of internet
 * radio) and plays it on the displays like play_audio. The displays' page is https, so a station that's only http is
 * tried over https first, else relayed through the server:
 *
 *   GET /api/radio/<id>   the stream of a station this tool chose (never any other address); ids last a day
 *
 * HLS stations (the BBC's, for one) are played with hls.js on the display. Off with the grown-ups' music switch; quiet
 * at night unless at_night.
 */
import { randomBytes } from 'crypto'
import { clean, json, log } from './common.ts'
import { type Screen, announce } from './announce.ts'
import { instance } from './instance.ts'
import type { Tool } from './tools.ts'

export const radioTool: Tool = {
  name: 'play_radio',
  description:
    'Play an internet radio station on the displays, found by name ("BBC Radio 1", "Classic FM") or by genre ' +
    '("jazz", "relaxing", "kids"). Goes to the display you were asked at, the one named in to, or every display. ' +
    'stop_audio stops it.',
  inputSchema: {
    type: 'object',
    properties: {
      station: { type: 'string', description: 'A station\'s name, or a genre or mood' },
      country: { type: 'string', description: 'Two-letter country code to prefer, e.g. "GB" (optional)' },
      to: { type: 'string', description: "One display's name ('all' for every display)" },
      at_night: { type: 'boolean', description: 'Play it during night hours too (otherwise it is not played then)' },
    },
    required: ['station'],
  },
}

const API = 'https://all.api.radio-browser.info/json'
const CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'OPUS', 'UNKNOWN'])
const TRIES = 4 // stations tried before giving up
const RELAY_DAY = 24 * 3600_000
const headers = () => ({ 'User-Agent': `FrogHub/0.1 (home display${instance.site ? `; ${instance.site}` : ''})` })

type Station = {
  stationuuid: string; name: string; url_resolved: string; codec: string; hls: number; countrycode: string
  tags: string; lastcheckok: number
}

async function search(params: Record<string, string>): Promise<Station[]> {
  const q = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '15', ...params })
  const r = await fetch(`${API}/stations/search?${q}`, { headers: headers(), signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`radio-browser.info answered ${r.status}`)
  return ((await r.json()) as Station[]).filter(s => s.lastcheckok === 1 && CODECS.has(s.codec.toUpperCase()) && s.url_resolved)
}

const isHls = (url: string, type = '') => /\.m3u8($|\?)/i.test(url) || /mpegurl/i.test(type)

/** Whether `url` answers with something playable: {type} if so (redirects followed), else null. */
export async function probe(url: string): Promise<{ type: string; url: string } | null> {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), 6000)
  try {
    const r = await fetch(url, { signal: stop.signal, headers: { ...headers(), 'Icy-MetaData': '0' } })
    const type = (r.headers.get('content-type') ?? '').toLowerCase()
    stop.abort()
    const playable = type.startsWith('audio/') || type === 'application/ogg' || /mpegurl/.test(type) ||
      type.startsWith('application/octet-stream') || !type
    return r.ok && playable ? { type, url: r.url || url } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// The relayed streams: id -> the station's http address and when it was chosen
const relays = new Map<string, { url: string; at: number }>()

function relay(url: string): string {
  const now = Date.now()
  for (const [id, r] of relays) if (now - r.at > RELAY_DAY) relays.delete(id)
  while (relays.size >= 50) relays.delete(relays.keys().next().value!)
  const id = randomBytes(12).toString('hex')
  relays.set(id, { url, at: now })
  return `/api/radio/${id}`
}

/** An address the displays can play the station from (https, or the relay), and whether it's HLS; null if none. */
export async function playable(s: Station): Promise<{ url: string; hls: boolean } | null> {
  const url = s.url_resolved.trim()
  const https = url.replace(/^http:/i, 'https:')
  const found = await probe(https)
  if (found && found.url.startsWith('https:')) return { url: found.url, hls: s.hls === 1 || isHls(found.url, found.type) }
  if (url === https || s.hls === 1 || isHls(url)) return null // an HLS playlist's pieces can't be relayed one by one
  return (await probe(url)) ? { url: relay(url), hls: false } : null
}

/** GET /api/radio/<id>: a station's http stream, passed on as it comes. */
export async function handleRadio(req: Request, pathname: string): Promise<Response> {
  const found = relays.get(pathname.slice('/api/radio/'.length))
  if (req.method !== 'GET' || !found) return json({ error: 'no such stream' }, 404)
  try {
    const r = await fetch(found.url, { headers: { ...headers(), 'Icy-MetaData': '0' }, signal: req.signal })
    if (!r.ok || !r.body) return json({ error: `the station answered ${r.status}` }, 502)
    return new Response(r.body, {
      headers: { 'content-type': r.headers.get('content-type') || 'audio/mpeg', 'cache-control': 'no-store' },
    })
  } catch (err) {
    log(`radio relay: ${err}`)
    return json({ error: "the station didn't answer" }, 502)
  }
}

/** Runs play_radio; returns the text for the assistant (throws when nothing could be played). */
export async function playRadio(args: Record<string, unknown>, to: Screen | undefined, where: string): Promise<string> {
  const station = clean(args.station, 100)
  if (!station) throw new Error('Which station?')
  const country = clean(args.country, 2).toUpperCase()
  const byCountry = /^[A-Z]{2}$/.test(country) ? { countrycode: country } : {}
  let found = await search({ name: station, ...byCountry })
  if (!found.length && byCountry.countrycode) found = await search({ name: station })
  const byGenre = !found.length
  if (byGenre) found = await search({ tag: station.toLowerCase(), ...byCountry })
  if (!found.length) throw new Error(`radio-browser.info has no station called "${station}", nor any ${station} stations.`)
  // The same station is often listed more than once; try each address once
  const seen = new Set<string>()
  const candidates = found.filter(s => !seen.has(s.url_resolved) && seen.add(s.url_resolved))
  for (const s of candidates.slice(0, TRIES)) {
    const ok = await playable(s)
    if (!ok) continue
    // radio-browser.info counts plays this way (its clients are asked to)
    fetch(`${API}/url/${s.stationuuid}`, { headers: headers(), signal: AbortSignal.timeout(5000) }).catch(() => {})
    const title = clean(s.name, 80)
    announce({ text: '', audio: { url: ok.url, title, ...(ok.hls ? { hls: true } : {}) }, to: to?.id, at_night: args.at_night === true })
    const others = candidates.filter(c => c !== s).slice(0, 4).map(c => clean(c.name, 50))
    return `Playing ${title}${s.countrycode ? ` (${s.countrycode}${s.tags ? `; ${s.tags.split(',').slice(0, 3).join(', ')}` : ''})` : ''} ` +
      `on ${where} (within 5 seconds).${others.length ? ` Other ${byGenre ? `${station} stations` : 'matches'}: ${others.join('; ')}.` : ''}`
  }
  throw new Error(`Found ${candidates.length} station${candidates.length === 1 ? '' : 's'} for "${station}", but none would play on the displays right now.`)
}
