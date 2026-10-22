// Times are the house's (the runner sets TZ=Europe/London): British Summer Time ends at 02:00 on Sunday 25 October 2026.
import { afterAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test'
import { handleAlarms, runAlarmTool } from '../../channel/alarms.ts'
import { asAdmin, read, removeConfig, request } from '../helpers.ts'

type Listed = { id: string; label: string; time: string; repeat: string; timer: boolean; next: number }

const local = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime() // October 2026
const FRIDAY = 23

beforeEach(() => {
  removeConfig('alarms.json')
  setSystemTime(local(FRIDAY, 8))
})
afterAll(() => setSystemTime())

const listed = async (): Promise<Listed[]> => (await read(handleAlarms(request('GET', '/api/alarms'), '/api/alarms'))).alarms
const idOf = (text: string) => text.match(/^(?:Set|Cancelled) (\w+):/)![1]
const post = (path: string, body: unknown) => handleAlarms(request('POST', path, body), path)

describe('set_alarm', () => {
  test('a one-off alarm rings next time the clock shows that time', async () => {
    runAlarmTool('set_alarm', { time: '9:05' })
    runAlarmTool('set_alarm', { time: '07:59' })
    const [later, tomorrow] = await listed()
    expect(later).toMatchObject({ time: '09:05', repeat: 'once', label: 'Alarm', timer: false, next: local(FRIDAY, 9, 5) })
    expect(tomorrow.next).toBe(local(FRIDAY + 1, 7, 59))
  })

  test('not at the very moment it was set', async () => {
    runAlarmTool('set_alarm', { time: '08:00' })
    expect((await listed())[0].next).toBe(local(FRIDAY + 1, 8))
  })

  test('weekdays skip the weekend (and the clocks going back)', async () => {
    runAlarmTool('set_alarm', { time: '07:30', repeat: 'weekdays' })
    expect((await listed())[0].next).toBe(local(26, 7, 30))
  })

  test('weekends wait for Saturday', async () => {
    setSystemTime(local(21, 12))
    runAlarmTool('set_alarm', { time: '07:30', repeat: 'weekends' })
    expect((await listed())[0].next).toBe(local(24, 7, 30))
  })

  test('an unknown repeat is a one-off; the label is tidied', async () => {
    runAlarmTool('set_alarm', { time: '10:00', repeat: 'fortnightly', label: ' School\n"run" <now> ' })
    expect((await listed())[0]).toMatchObject({ repeat: 'once', label: 'School  run   now' })
  })

  test('times that are not 24-hour HH:MM are refused', () => {
    for (const time of ['24:00', '12:60', '7.30', '7:3', 'noon', undefined]) {
      expect(() => runAlarmTool('set_alarm', { time })).toThrow('time must be 24-hour HH:MM')
    }
  })
})

describe('set_timer', () => {
  test('rings that many minutes from now', async () => {
    const text = runAlarmTool('set_timer', { minutes: 0.5, label: 'Cookies' })
    expect(text).toStartWith(`Set ${idOf(text)}: timer "Cookies"`)
    expect((await listed())[0]).toMatchObject({ label: 'Cookies', time: '', timer: true, next: local(FRIDAY, 8) + 30_000 })
  })

  test('between nothing and 12 hours', () => {
    for (const minutes of [0, -5, 721, 'ten', undefined]) {
      expect(() => runAlarmTool('set_timer', { minutes })).toThrow('minutes must be between 0 and 720')
    }
    expect(() => runAlarmTool('set_timer', { minutes: 720 })).not.toThrow()
  })
})

describe('list and cancel', () => {
  test('lists what is set, in words', () => {
    expect(runAlarmTool('list_alarms', {})).toBe('No alarms or timers are set.')
    const id = idOf(runAlarmTool('set_alarm', { time: '07:00', repeat: 'daily', label: 'Up' }))
    expect(runAlarmTool('list_alarms', {})).toBe(`${id}: alarm "Up" at 07:00, daily; rings Saturday 07:00`)
  })

  test('cancels by id', async () => {
    const id = idOf(runAlarmTool('set_timer', { minutes: 5 }))
    expect(runAlarmTool('cancel_alarm', { id })).toStartWith(`Cancelled ${id}: timer "Timer"`)
    expect(await listed()).toEqual([])
    expect(() => runAlarmTool('cancel_alarm', { id })).toThrow(`No alarm with id ${id}`)
  })

  test('at most 20, and only known tools', () => {
    for (let i = 0; i < 20; i++) runAlarmTool('set_timer', { minutes: i + 1 })
    expect(() => runAlarmTool('set_timer', { minutes: 1 })).toThrow('There are already 20 alarms')
    expect(() => runAlarmTool('snooze_everything', {})).toThrow('There are already 20 alarms')
    removeConfig('alarms.json')
    expect(() => runAlarmTool('snooze_everything', {})).toThrow('unknown tool: snooze_everything')
  })
})

describe("the display's Stop and Snooze", () => {
  test('a tap before it rings does nothing', async () => {
    const id = idOf(runAlarmTool('set_timer', { minutes: 10 }))
    expect(await read(post('/api/alarms/done', { id }))).toEqual({ ok: false })
    expect(await read(post('/api/alarms/done', { id: 'nope' }))).toEqual({ ok: false })
    expect(await listed()).toHaveLength(1)
  })

  test('Stop removes a one-off', async () => {
    const id = idOf(runAlarmTool('set_timer', { minutes: 10 }))
    setSystemTime(local(FRIDAY, 8, 10))
    expect(await read(post('/api/alarms/done', { id }))).toEqual({ ok: true })
    expect(await listed()).toEqual([])
  })

  test('Stop moves a repeating alarm to its next day, across the clocks going back', async () => {
    setSystemTime(local(24, 8))
    const id = idOf(runAlarmTool('set_alarm', { time: '07:00', repeat: 'daily' }))
    expect((await listed())[0].next).toBe(local(25, 7))
    setSystemTime(local(25, 7))
    await post('/api/alarms/done', { id })
    expect((await listed())[0].next).toBe(local(26, 7))
  })

  test('Snooze rings again in 9 minutes', async () => {
    const id = idOf(runAlarmTool('set_alarm', { time: '08:30' }))
    setSystemTime(local(FRIDAY, 8, 30))
    await post('/api/alarms/snooze', { id })
    expect((await listed())[0].next).toBe(local(FRIDAY, 8, 39))
  })

  test('one missed by more than half an hour is not rung late', async () => {
    runAlarmTool('set_alarm', { time: '08:30' })
    runAlarmTool('set_alarm', { time: '08:30', repeat: 'daily' })
    setSystemTime(local(FRIDAY, 8, 59))
    expect(await listed()).toHaveLength(2) // still ringing
    setSystemTime(local(FRIDAY, 9, 1))
    const left = await listed()
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ repeat: 'daily', next: local(FRIDAY + 1, 8, 30) })
  })
})

describe('the admin page', () => {
  test('uses the same tools, in admin mode', async () => {
    const manage = async (body: unknown, admin = true) =>
      handleAlarms(request('POST', '/api/alarms/manage', body, admin ? await asAdmin() : {}), '/api/alarms/manage')
    expect((await manage({ tool: 'set_timer', args: { minutes: 3 } }, false)).status).toBe(403)
    expect((await manage({ tool: 'list_alarms' })).status).toBe(400)
    expect((await manage({ tool: 'set_timer', args: { minutes: 0 } })).status).toBe(400)
    const ok = await read(manage({ tool: 'set_timer', args: { minutes: 3 } }))
    expect(ok.text).toStartWith('Set ')
    expect(await listed()).toHaveLength(1)
  })
})
