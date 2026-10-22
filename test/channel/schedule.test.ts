import { beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { type Job, cronMatches, houseParts, parseCron, runDue, runScheduleTool } from '../../channel/schedule.ts'
import { CONFIG } from '../helpers.ts'

// The tests run in Europe/London (test/run.ts); Thursday 22 October 2026 is in BST (UTC+1)
const at = (iso: string) => new Date(iso).getTime()

beforeEach(() => rmSync(join(CONFIG, 'schedule.json'), { force: true }))

describe('cron', () => {
  test('reads lists, ranges, steps and Sunday as 7', () => {
    const c = parseCron('0,30 7-9/2 * * 1-5,7')
    expect([...c.sets[0]]).toEqual([0, 30])
    expect([...c.sets[1]]).toEqual([7, 9])
    expect([...c.sets[4]].sort()).toEqual([0, 1, 2, 3, 4, 5])
  })

  test('says what is wrong', () => {
    expect(() => parseCron('0 7 * *')).toThrow('five fields')
    expect(() => parseCron('60 7 * * *')).toThrow('the minute must be 0-59')
    expect(() => parseCron('0 seven * * *')).toThrow(`can't read the hour "seven"`)
  })

  test('matches house time, not UTC', () => {
    // 07:45 in London is 06:45 UTC in October
    const { values } = houseParts(at('2026-10-22T06:45:00Z'))
    expect(cronMatches(parseCron('45 7 * * 4'), values)).toBe(true)
    expect(cronMatches(parseCron('45 6 * * 4'), values)).toBe(false)
  })

  test('day of the month or weekday, when both are given', () => {
    const { values } = houseParts(at('2026-10-22T06:45:00Z')) // Thursday the 22nd
    expect(cronMatches(parseCron('45 7 1 * 4'), values)).toBe(true) // the 1st, or a Thursday
    expect(cronMatches(parseCron('45 7 1 * *'), values)).toBe(false)
  })
})

describe('the tools', () => {
  test('schedules, lists and cancels', () => {
    const made = runScheduleTool('schedule', { label: 'Shoes on', cron: '45 7 * * 1-5', say: 'Shoes on, everyone!' })
    expect(made).toMatch(/^Scheduled \w{4}: "Shoes on" on "45 7 \* \* 1-5", says "Shoes on, everyone!"; next /)
    const id = made.split(' ')[1].replace(':', '')
    expect(runScheduleTool('list_schedule', {})).toContain(`${id}: "Shoes on"`)
    expect(runScheduleTool('cancel_schedule', { id })).toStartWith('Cancelled')
    expect(runScheduleTool('list_schedule', {})).toBe('Nothing is scheduled.')
  })

  test('wants one time and one thing to do', () => {
    expect(() => runScheduleTool('schedule', { label: 'x', say: 'hi' })).toThrow('exactly one of cron, at or in_minutes')
    expect(() => runScheduleTool('schedule', { label: 'x', at: '17:00', in_minutes: 5, say: 'hi' })).toThrow('exactly one of cron')
    expect(() => runScheduleTool('schedule', { label: 'x', at: '17:00' })).toThrow('exactly one of say or prompt')
    expect(() => runScheduleTool('schedule', { label: 'x', at: '17:00', say: 'a', prompt: 'b' })).toThrow('exactly one of say or prompt')
    expect(() => runScheduleTool('schedule', { label: 'x', at: '25:00', say: 'hi' })).toThrow('at must be')
  })

  test("won't repeat more than four times an hour", () => {
    expect(() => runScheduleTool('schedule', { label: 'spam', cron: '* * * * *', say: 'poo' })).toThrow('at most 4 times an hour')
    expect(runScheduleTool('schedule', { label: 'ok', cron: '*/15 * * * *', say: 'quarter' })).toStartWith('Scheduled')
  })
})

describe('running them', () => {
  test('runs what is due once a minute, and one-offs only once', async () => {
    // a minute two days from now, in house time ("YYYY-M-D H:MM")
    const due = Math.floor(Date.now() / 60_000 + 2 * 24 * 60) * 60_000
    const [date, time] = houseParts(due).key.split(' ')
    const [hour, minute] = time.split(':').map(Number)
    runScheduleTool('schedule', { label: 'Tea', at: `${date} ${time}`, say: 'Tea time!' })
    runScheduleTool('schedule', { label: 'Daily', cron: `${minute} ${hour} * * *`, prompt: 'Tell them about tomorrow' })
    const ran: Job[] = []
    const run = (j: Job) => void ran.push(j)
    await runDue(run, due - 10_000) // the minute before: not yet
    expect(ran).toHaveLength(0)
    await runDue(run, due + 5_000)
    await runDue(run, due + 40_000) // the same minute again
    expect(ran.map(j => j.label)).toEqual(['Tea', 'Daily'])
    expect(ran[0].say).toBe('Tea time!')
    expect(ran[1].prompt).toBe('Tell them about tomorrow')
    expect(runScheduleTool('list_schedule', {})).not.toContain('Tea')
    // the next day: only the repeating one (23, 24 or 25 hours on, if the clocks change in between)
    for (const hours of [23, 24, 25]) await runDue(run, due + hours * 3_600_000)
    expect(ran.map(j => j.label)).toEqual(['Tea', 'Daily', 'Daily'])
  })

  test('in_minutes counts from now', async () => {
    runScheduleTool('schedule', { label: 'Soon', in_minutes: 20, say: 'Twenty minutes are up' })
    const ran: Job[] = []
    await runDue(j => void ran.push(j), Date.now() + 20 * 60_000)
    expect(ran.map(j => j.label)).toEqual(['Soon'])
  })
})
