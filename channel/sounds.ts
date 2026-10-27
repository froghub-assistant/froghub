/**
 * The find_sound tool: sound clips to play with play_audio (animal noises, instruments, birdsong, sound effects,
 * famous speeches...), from Wikimedia Commons and, with an API key, Freesound.org, searched together. Commons needs no
 * key; Freesound's is in ~/.config/froghub/freesound.key (FROGHUB_FREESOUND_KEY overrides it). Both are free-licensed;
 * the credit comes with each clip. Off with the grown-ups' music switch.
 */
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { clean, log } from './common.ts'
import { instance } from './instance.ts'
import type { Tool } from './tools.ts'

export const soundTool: Tool = {
  name: 'find_sound',
  description:
    'Find sound clips to play (e.g. "lion roar", "humpback whale", "steam train", "church bells", "applause"): ' +
    'searches Wikimedia Commons and Freesound and lists clips with their length, credit and link. Pick the one that ' +
    'fits and play it with play_audio (url, and a title with the credit).',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What it should sound like, in a few words' } },
    required: ['query'],
  },
}

export const FREESOUND_FILE = join(homedir(), '.config', 'froghub', 'freesound.key')
const EACH = 6 // clips from each source
const headers = () => ({ 'User-Agent': `FrogHub/0.1 (home display${instance.site ? `; ${instance.site}` : ''})` })

export type Clip = { title: string; url: string; seconds: number; credit: string; source: string }

function freesoundKey(): string {
  if (process.env.FROGHUB_FREESOUND_KEY) return process.env.FROGHUB_FREESOUND_KEY.trim()
  return existsSync(FREESOUND_FILE) ? readFileSync(FREESOUND_FILE, 'utf8').trim() : ''
}

// Commons is full of one-word pronunciation recordings (Lingua Libre's "LL-Q1860 (eng)-…", "En-us-lion.ogg")
const PRONUNCIATION = /^(LL-Q\d+|[A-Z][a-z]{1,2}(-[a-z]{2,4})?-)/
const plain = (html: string) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()

/** Commons' clips for `query`; its search wants every word, so with few it tries the longest words alone too. */
export async function commons(query: string): Promise<Clip[]> {
  const clips = await commonsSearch(query)
  if (clips.length >= 3) return clips
  const words = query.split(/\s+/).filter(w => w.length > 2).sort((a, b) => b.length - a.length).slice(0, 2)
  if (words.length < 2) return clips
  const more = (await Promise.all(words.map(w => commonsSearch(w).catch(() => [])))).flat()
  const seen = new Set(clips.map(c => c.url))
  return [...clips, ...more.filter(c => !seen.has(c.url) && seen.add(c.url))].slice(0, EACH)
}

async function commonsSearch(query: string): Promise<Clip[]> {
  const q = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrsearch: `${query} filetype:audio`, gsrnamespace: '6',
    gsrlimit: '30', prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist',
  })
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: headers(), signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`Wikimedia Commons answered ${r.status}`)
  const pages = Object.values<any>((await r.json()).query?.pages ?? {}).sort((a, b) => a.index - b.index)
  return pages.flatMap(p => {
    const info = p.imageinfo?.[0]
    const title = String(p.title).replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
    const seconds = Number(info?.duration) || 0
    if (!info?.url || PRONUNCIATION.test(title) || /midi/.test(info.mime) || seconds < 1.5 || seconds > 1200) return []
    const meta = info.extmetadata ?? {}
    const artist = plain(meta.Artist?.value ?? '').slice(0, 60)
    return [{
      title, url: String(info.url).split('?')[0], seconds, source: 'Wikimedia Commons',
      credit: [artist, meta.LicenseShortName?.value].filter(Boolean).join(', '),
    }]
  }).slice(0, EACH)
}

export async function freesound(query: string, key: string): Promise<Clip[]> {
  const q = new URLSearchParams({ query, fields: 'name,previews,duration,license,username', page_size: String(EACH), token: key })
  const r = await fetch(`https://freesound.org/apiv2/search/text/?${q}`, { headers: headers(), signal: AbortSignal.timeout(8000) })
  if (r.status === 401) throw new Error('Freesound turned the API key down')
  if (!r.ok) throw new Error(`Freesound answered ${r.status}`)
  const licence = (url: string) =>
    /zero/.test(url) ? 'CC0' : /by-nc/.test(url) ? 'CC BY-NC' : /by\//.test(url) ? 'CC BY' : /sampling/.test(url) ? 'Sampling+' : 'CC'
  return ((await r.json()).results ?? []).flatMap((s: any) => {
    const url = s.previews?.['preview-hq-mp3']
    return url ? [{
      title: String(s.name).replace(/\.(wav|mp3|ogg|flac|aiff?)$/i, ''), url, seconds: Number(s.duration) || 0,
      source: 'Freesound', credit: `${s.username}, ${licence(String(s.license))}`,
    }] : []
  })
}

const length = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`)

/** Runs the tool; returns the text for the assistant (throws when nothing was found). */
export async function findSound(args: Record<string, unknown>): Promise<string> {
  const query = clean(args.query, 100)
  if (!query) throw new Error('What should it sound like?')
  const key = freesoundKey()
  const searches = [commons(query), ...(key ? [freesound(query, key)] : [])]
  const results = await Promise.allSettled(searches)
  const clips = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []))
  const failed = results.flatMap(r => (r.status === 'rejected' ? [(r.reason as Error).message] : []))
  for (const f of failed) log(`find_sound: ${f}`)
  if (!clips.length) throw new Error(failed.length === results.length ? `Couldn't search for sounds: ${failed.join('; ')}` : `No clips of "${query}"; try other words.`)
  // Each source's best first, taking turns
  const bySource = [...new Set(clips.map(c => c.source))].map(s => clips.filter(c => c.source === s))
  const merged = Array.from({ length: EACH }, (_, i) => bySource.map(list => list[i])).flat().filter(Boolean) as Clip[]
  return `${merged.length} clips of "${query}":\n` +
    merged.map((c, i) => `${i + 1}. ${c.title} (${length(c.seconds)}; ${c.source}${c.credit ? `, ${c.credit}` : ''}): ${c.url}`).join('\n')
}
