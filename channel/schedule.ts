/**
 * Scheduled jobs: the assistant can arrange to say something, or to be asked something, later or regularly ("every
 * school day at 7:45 tell them to get their shoes on", "at five, ask me to check the weather for the walk"). Kept in
 * ~/.config/froghub/schedule.json and checked by the channel server every few seconds, in the house's time zone.
 *
 * Each job has a cron expression ("minute hour day-of-month month day-of-week"); one-offs ("at 17:00", "in 20
 * minutes") are a cron entry that runs once and goes. When one is due, `say` is announced as it is, and `prompt` goes
 * to the assistant like an announcement request (server.ts). A run missed while the server was down is skipped.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { clean } from './common.ts'
import { instance } from './instance.ts'

export type Job = {
  id: string
  cron: string
  once: boolean
  label: string
  say?: string
  prompt?: string
  to?: string // a display's name; all of them if left out
  at_night: boolean
  last?: string // the house-time minute it last ran, so it runs once per minute
}

const FILE = `${homedir()}/.config/froghub/schedule.json`
const MAX_JOBS = 30
const MAX_PER_HOUR = 4 // a repeating job runs at most this many times an hour

const load = (): Job[] => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [])
const save = (jobs: Job[]) => writeFileSync(FILE, JSON.stringify(jobs, null, 1))

// ---- cron ----

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of the month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of the week', min: 0, max: 7 },
] as const

type Cron = { sets: Set<number>[]; anyDay: boolean; anyWeekday: boolean }

/** Parses "m h dom mon dow" (numbers, *, lists, ranges, steps; Sunday is 0 or 7); throws saying what's wrong. */
export function parseCron(cron: string): Cron {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('cron needs five fields: minute hour day-of-month month day-of-week')
  const sets = parts.map((part, i) => {
    const { name, min, max } = FIELDS[i]
    const set = new Set<number>()
    for (const item of part.split(',')) {
      const m = item.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/)
      if (!m) throw new Error(`can't read the ${name} "${part}"`)
      const from = m[1] === '*' ? min : Number(m[2])
      const to = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : from
      const step = m[4] ? Number(m[4]) : 1
      if (from < min || to > max || from > to || step < 1) throw new Error(`the ${name} must be ${min}-${max}`)
      for (let v = from; v <= to; v += step) set.add(i === 4 && v === 7 ? 0 : v)
    }
    return set
  })
  return { sets, anyDay: parts[2] === '*', anyWeekday: parts[4] === '*' }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
let formatter: Intl.DateTimeFormat | undefined

/** The house-time minute, hour, day, month and weekday of `ms`, and a key for that minute. */
export function houseParts(ms: number) {
  formatter ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: instance.timeZone || undefined, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23',
  })
  const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  const values = [Number(p.minute), Number(p.hour), Number(p.day), Number(p.month), WEEKDAYS.indexOf(p.weekday)]
  return { values, key: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` }
}

/** Whether `cron` is due in the house-time minute `values` (day of month and weekday: either, if both are given). */
export function cronMatches(c: Cron, values: number[]): boolean {
  const [minute, hour, day, month, weekday] = values
  if (!c.sets[0].has(minute) || !c.sets[1].has(hour) || !c.sets[3].has(month)) return false
  if (c.anyDay || c.anyWeekday) return c.sets[2].has(day) && c.sets[4].has(weekday)
  return c.sets[2].has(day) || c.sets[4].has(weekday)
}

/** When it next runs, within the next eight days (else undefined). */
function nextRun(cron: string, after = Date.now()): number | undefined {
  const c = parseCron(cron)
  const start = Math.floor(after / 60_000 + 1) * 60_000
  for (let t = start; t < start + 8 * 24 * 3_600_000; t += 60_000) if (cronMatches(c, houseParts(t).values)) return t
}

// ---- the assistant's tools ----

export const scheduleTools = [
  {
    name: 'schedule',
    description:
      'Arrange for something to happen later or regularly, on the displays, without anyone asking at the time. Give ' +
      'exactly one of cron, at or in_minutes, and one of say or prompt. Only when a grown-up asks (mode="admin" or ' +
      'audience="grown-ups"), or for something clearly harmless a child asks for once; never for repeated silliness. ' +
      'For something that should ring, use set_alarm instead.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'A short name for it, e.g. "Shoes on for school"' },
        cron: { type: 'string', description: 'Repeating, in house time: "minute hour day-of-month month day-of-week", e.g. "45 7 * * 1-5" for 7:45 on weekdays' },
        at: { type: 'string', description: 'Once, at "HH:MM" (the next time it is that time) or "YYYY-MM-DD HH:MM"' },
        in_minutes: { type: 'number', description: 'Once, this many minutes from now (1 to 1440)' },
        say: { type: 'string', description: 'Exact words to say and show then' },
        prompt: { type: 'string', description: 'Or: what you will be asked then, to answer like an announcement (for anything that should be worked out at the time, e.g. "tell them the weather for the walk")' },
        to: { type: 'string', description: "One display's name; leave out for all of them" },
        at_night: { type: 'boolean', description: 'Speak it during night hours too (otherwise it is only shown then)' },
      },
      required: ['label'],
    },
  },
  {
    name: 'list_schedule',
    description: 'The scheduled jobs, with their ids and when they next run.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_schedule',
    description: 'Cancel a scheduled job by its id (from list_schedule or schedule).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
]

const when = (ms: number | undefined) =>
  ms === undefined ? 'not in the next week' : new Intl.DateTimeFormat('en-GB', {
    timeZone: instance.timeZone || undefined, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(ms)

function describe(j: Job): string {
  const what = j.say ? `says "${j.say}"` : `asks you "${j.prompt}"`
  return `${j.id}: "${j.label}" ${j.once ? 'once' : `on "${j.cron}"`}, ${what}${j.to ? ` on ${j.to}` : ''}; next ${when(nextRun(j.cron))}`
}

/** "HH:MM" or "YYYY-MM-DD HH:MM", or minutes from now, as a cron entry for that one minute (house time). */
function onceCron(at: unknown, inMinutes: unknown): string {
  if (inMinutes !== undefined) {
    const minutes = Number(inMinutes)
    if (!(minutes >= 1 && minutes <= 1440)) throw new Error('in_minutes must be between 1 and 1440')
    const [minute, hour, day, month] = houseParts(Date.now() + Math.round(minutes) * 60_000).values
    return `${minute} ${hour} ${day} ${month} *`
  }
  const m = String(at).trim().match(/^(?:(\d{4})-(\d{1,2})-(\d{1,2})\s+)?(\d{1,2}):(\d{2})$/)
  if (!m || Number(m[4]) > 23 || Number(m[5]) > 59) throw new Error('at must be "HH:MM" or "YYYY-MM-DD HH:MM"')
  return m[1] ? `${Number(m[5])} ${Number(m[4])} ${Number(m[3])} ${Number(m[2])} *` : `${Number(m[5])} ${Number(m[4])} * * *`
}

/** Runs one of the tools above; returns the text for the assistant (throws on bad input). */
export function runScheduleTool(name: string, args: Record<string, unknown>): string {
  const jobs = load()
  if (name === 'list_schedule') return jobs.length ? jobs.map(describe).join('\n') : 'Nothing is scheduled.'
  if (name === 'cancel_schedule') {
    const gone = jobs.find(j => j.id === args.id)
    if (!gone) throw new Error(`No scheduled job with id ${args.id}. Use list_schedule.`)
    save(jobs.filter(j => j !== gone))
    return `Cancelled ${describe(gone)}`
  }
  if (name !== 'schedule') throw new Error(`unknown tool: ${name}`)
  if (jobs.length >= MAX_JOBS) throw new Error(`There are already ${MAX_JOBS} scheduled jobs; cancel some first.`)
  const ways = ['cron', 'at', 'in_minutes'].filter(k => args[k] !== undefined && args[k] !== '')
  if (ways.length !== 1) throw new Error('Give exactly one of cron, at or in_minutes.')
  const say = clean(args.say, 300)
  const prompt = clean(args.prompt, 1000)
  if (!say === !prompt) throw new Error('Give exactly one of say or prompt.')
  const once = ways[0] !== 'cron'
  const cron = once ? onceCron(args.at, args.in_minutes) : String(args.cron).trim()
  const c = parseCron(cron)
  if (!once && c.sets[0].size > MAX_PER_HOUR) throw new Error(`A repeating job can run at most ${MAX_PER_HOUR} times an hour.`)
  if (nextRun(cron) === undefined && once) throw new Error("That time doesn't come round in the next week.")
  const job: Job = {
    id: Math.random().toString(36).slice(2, 6),
    cron,
    once,
    label: clean(args.label, 60) || 'Reminder',
    ...(say ? { say } : { prompt }),
    ...(args.to ? { to: clean(args.to, 60) } : {}),
    at_night: args.at_night === true,
    last: houseParts(Date.now()).key, // not again this minute
  }
  save([...jobs, job])
  return `Scheduled ${describe(job)}`
}

// ---- running them ----

/** Runs the jobs that are due now (each once per minute); one-offs go afterwards. */
export async function runDue(run: (job: Job) => void | Promise<void>, now = Date.now()): Promise<void> {
  const { values, key } = houseParts(now)
  const jobs = load()
  const due = jobs.filter(j => j.last !== key && cronMatches(parseCron(j.cron), values))
  if (!due.length) return
  for (const j of due) j.last = key
  save(jobs.filter(j => !(j.once && due.includes(j))))
  for (const j of due) await run(j)
}

/** Checks every 15 seconds from now on. */
export function startSchedule(run: (job: Job) => void | Promise<void>): void {
  setInterval(() => runDue(run).catch(() => {}), 15_000)
}
