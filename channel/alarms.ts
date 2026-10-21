/**
 * Alarms and timers. They're kept on the server (~/.config/froghub/alarms.json), so they survive the display reloading.
 * The assistant sets them with the tools below; the display polls GET /api/alarms, rings when one is due, then
 * POSTs /api/alarms/done (Stop) or /api/alarms/snooze. Times are the server's local time (set it to the house's time zone).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { adminValid, json } from './common.ts'
import { houseTime } from './instance.ts'

type Repeat = 'once' | 'daily' | 'weekdays' | 'weekends'
type Alarm = { id: string; label: string; time: string; repeat: Repeat; next: number } // time '' = a timer

const FILE = `${homedir()}/.config/froghub/alarms.json`
const MAX_ALARMS = 20
const MISSED_MS = 30 * 60 * 1000 // the display was off when it was due: don't ring half an hour late
const SNOOZE_MIN = 9
const REPEATS: Repeat[] = ['once', 'daily', 'weekdays', 'weekends']

const load = (): Alarm[] => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [])
const save = (alarms: Alarm[]) => writeFileSync(FILE, JSON.stringify(alarms, null, 1))

/** The first time after `after` that's `time` (HH:MM) on a day the repeat allows. */
function nextAt(time: string, repeat: Repeat, after = Date.now()): number {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(after)
  d.setHours(h, m, 0, 0)
  for (let i = 0; i < 9; i++) {
    const day = d.getDay()
    const allowed = repeat === 'weekdays' ? day >= 1 && day <= 5 : repeat === 'weekends' ? day === 0 || day === 6 : true
    if (d.getTime() > after && allowed) return d.getTime()
    d.setDate(d.getDate() + 1)
    d.setHours(h, m, 0, 0) // again, in case the clocks changed
  }
  throw new Error(`no time for ${time} ${repeat}`)
}

const when = (ms: number) => houseTime(ms, { weekday: 'long', hour: '2-digit', minute: '2-digit' })

function describe(a: Alarm): string {
  const what = a.time ? `alarm "${a.label}" at ${a.time}${a.repeat === 'once' ? '' : `, ${a.repeat}`}` : `timer "${a.label}"`
  return `${a.id}: ${what}; rings ${when(a.next)}`
}

// ---- the assistant's tools ----

export const alarmTools = [
  {
    name: 'set_alarm',
    description: 'Set an alarm on the display, at a time of day (UK time). It rings on the tablet with Stop and Snooze buttons.',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: 'string', description: '24-hour HH:MM, e.g. "07:30"' },
        label: { type: 'string', description: 'What it is for, shown and read on the screen, e.g. "School" (default "Alarm")' },
        repeat: { type: 'string', enum: REPEATS, description: 'Default once' },
      },
      required: ['time'],
    },
  },
  {
    name: 'set_timer',
    description: 'Start a countdown timer on the display (e.g. "10 minutes for the cookies"). It rings like an alarm.',
    inputSchema: {
      type: 'object',
      properties: {
        minutes: { type: 'number', description: 'How long, in minutes (fractions are fine: 0.5 = 30 seconds); at most 720' },
        label: { type: 'string', description: 'What it is for (default "Timer")' },
      },
      required: ['minutes'],
    },
  },
  {
    name: 'list_alarms',
    description: 'The alarms and timers that are set, with their ids and when they next ring.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_alarm',
    description: 'Cancel an alarm or timer by its id (from list_alarms or set_alarm/set_timer).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
]

const label = (v: unknown, fallback: string) =>
  (typeof v === 'string' ? v.replace(/[\r\n<>"]/g, ' ').trim().slice(0, 40) : '') || fallback

/** Runs one of the tools above; returns the text for the assistant (throws on bad input). */
export function runAlarmTool(name: string, args: Record<string, unknown>): string {
  const alarms = load()
  const id = () => Math.random().toString(36).slice(2, 6)
  if (name === 'list_alarms') return alarms.length ? alarms.map(describe).join('\n') : 'No alarms or timers are set.'
  if (name === 'cancel_alarm') {
    const gone = alarms.find(a => a.id === args.id)
    if (!gone) throw new Error(`No alarm with id ${args.id}. Use list_alarms.`)
    save(alarms.filter(a => a !== gone))
    return `Cancelled ${describe(gone)}`
  }
  if (alarms.length >= MAX_ALARMS) throw new Error(`There are already ${MAX_ALARMS} alarms; cancel some first.`)
  if (name === 'set_alarm') {
    const m = String(args.time ?? '').match(/^(\d{1,2}):(\d{2})$/)
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('time must be 24-hour HH:MM')
    const time = `${m[1].padStart(2, '0')}:${m[2]}`
    const repeat = REPEATS.includes(args.repeat as Repeat) ? (args.repeat as Repeat) : 'once'
    const alarm: Alarm = { id: id(), label: label(args.label, 'Alarm'), time, repeat, next: nextAt(time, repeat) }
    save([...alarms, alarm])
    return `Set ${describe(alarm)}`
  }
  if (name === 'set_timer') {
    const minutes = Number(args.minutes)
    if (!(minutes > 0 && minutes <= 720)) throw new Error('minutes must be between 0 and 720')
    const alarm: Alarm = { id: id(), label: label(args.label, 'Timer'), time: '', repeat: 'once', next: Date.now() + minutes * 60_000 }
    save([...alarms, alarm])
    return `Set ${describe(alarm)}`
  }
  throw new Error(`unknown tool: ${name}`)
}

// ---- the display's side ----

/** After an alarm rang (or was missed): one-offs go, repeating ones move on to their next time. */
function finished(alarms: Alarm[], a: Alarm): Alarm[] {
  if (a.repeat === 'once') return alarms.filter(x => x !== a)
  a.next = nextAt(a.time, a.repeat, Math.max(Date.now(), a.next) + 60_000)
  return alarms
}

export async function handleAlarms(req: Request, pathname: string): Promise<Response> {
  let alarms = load()
  if (req.method === 'GET' && pathname === '/api/alarms') {
    const missed = alarms.filter(a => a.next < Date.now() - MISSED_MS)
    if (missed.length) {
      for (const a of missed) alarms = finished(alarms, a)
      save(alarms)
    }
    return json({ now: Date.now(), alarms: alarms.map(({ id, label, time, repeat, next }) => ({ id, label, time, repeat, timer: !time, next })) })
  }
  if (req.method !== 'POST') return new Response('not found', { status: 404 })
  const body = await req.json().catch(() => ({}))
  // The admin page: { tool: set_alarm | set_timer | cancel_alarm, args } (same rules as the assistant's tools)
  if (pathname === '/api/alarms/manage') {
    if (!adminValid(req.headers.get('x-admin-token'))) return json({ error: 'admin mode needed' }, 403)
    if (!['set_alarm', 'set_timer', 'cancel_alarm'].includes(body.tool)) return json({ error: 'unknown tool' }, 400)
    try {
      return json({ ok: true, text: runAlarmTool(body.tool, body.args ?? {}) })
    } catch (err) {
      return json({ error: (err as Error).message }, 400)
    }
  }
  const alarm = alarms.find(a => a.id === body.id)
  if (!alarm || alarm.next > Date.now() + 60_000) return json({ ok: false }) // not ringing (e.g. a stale tap)
  if (pathname === '/api/alarms/done') save(finished(alarms, alarm))
  else if (pathname === '/api/alarms/snooze') {
    alarm.next = Date.now() + SNOOZE_MIN * 60_000
    save(alarms)
  } else return new Response('not found', { status: 404 })
  return json({ ok: true })
}
