/**
 * Audio from a URL on the displays (a sound, a song, a radio stream): play_audio and stop_audio for the assistant, and
 * {audio} on POST /local/announce for anything else on the server (a Home Assistant automation, a script). It goes out
 * like an announcement, so it works without anyone asking: to the display that asked, one display, or all of them.
 * Only https (the displays' page is https), and only what the server says is audio. Off with the grown-ups' music
 * switch; quiet at night unless at_night.
 */
import { clean } from './common.ts'
import { type Screen, announce, findDisplay, onlineDisplays } from './announce.ts'
import { playRadio } from './radio.ts'
import type { Tool } from './tools.ts'

export const audioTools: Tool[] = [
  {
    name: 'play_audio',
    description:
      'Play audio from a URL on the displays: a sound, a song, a radio stream (an https link to an audio file or ' +
      'stream, e.g. .mp3, .ogg, .m4a). Goes to the display you were asked at, or the one named in to, or every ' +
      'display if neither (e.g. from a scheduled job). Plays over anything already playing there.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        title: { type: 'string', description: 'What it is, shown while it plays' },
        to: { type: 'string', description: "One display's name ('all' for every display)" },
        at_night: { type: 'boolean', description: 'Play it during night hours too (otherwise it is not played then)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'stop_audio',
    description: 'Stop audio playing on the displays (the one you were asked at, the one named in to, or all).',
    inputSchema: { type: 'object', properties: { to: { type: 'string', description: "One display's name ('all' for every display)" } } },
  },
]

const AUDIO_FILE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/i

/** Checks `url` is an https link the server says is audio (an Icecast stream too); returns it tidied, or throws. */
export async function checkAudioUrl(raw: unknown): Promise<string> {
  const url = clean(raw, 500)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('That is not a link.')
  }
  if (parsed.protocol !== 'https:') throw new Error('Only https links can play on the displays.')
  if (parsed.username || parsed.password) throw new Error('Links with a password in them are not allowed.')
  // GET, stopped once the headers are in: a stream never ends, and some servers don't answer HEAD
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), 8000)
  try {
    const r = await fetch(url, { signal: stop.signal, headers: { 'User-Agent': 'FrogHub/0.1 (home display)', Range: 'bytes=0-0' } })
    const type = (r.headers.get('content-type') ?? '').toLowerCase()
    stop.abort()
    if (!r.ok) throw new Error(`That link answered ${r.status}.`)
    const audio = type.startsWith('audio/') || type === 'application/ogg' ||
      ((type.startsWith('application/octet-stream') || !type) && AUDIO_FILE.test(parsed.pathname))
    if (!audio) throw new Error(`That link is not audio (it is ${type || 'of no stated type'}).`)
    return url
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error("That link didn't answer in time.")
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Where it goes: the named display, all of them, the asking one, or all when nobody asked. Throws for an unknown name. */
function target(to: unknown, from: Screen | undefined): Screen | undefined {
  const name = clean(to, 60)
  if (name && name.toLowerCase() !== 'all') {
    const found = findDisplay(name)
    if (!found) throw new Error(`No display called "${name}" is on. Displays that are on: ${onlineDisplays().map(s => s.name).join(', ') || 'none'}.`)
    return found
  }
  return name ? undefined : from
}

/** Runs play_audio, play_radio or stop_audio; returns the text for the assistant (throws on a bad link or display). */
export async function runAudioTool(name: string, args: Record<string, unknown>, from?: Screen): Promise<string> {
  const to = target(args.to, from)
  const where = to ? to.name : 'every display that is on'
  if (name === 'stop_audio') {
    announce({ text: '', audio: { stop: true }, to: to?.id, at_night: true })
    return `Stopped on ${where}.`
  }
  if (name === 'play_radio') return playRadio(args, to, where)
  const url = await checkAudioUrl(args.url)
  const title = clean(args.title, 80)
  announce({ text: '', audio: { url, ...(title ? { title } : {}) }, to: to?.id, at_night: args.at_night === true })
  return `Playing on ${where} (within 5 seconds).`
}
