import { describe, expect, test } from 'bun:test'
import {
  SAVER_DEFAULTS, cleanSaver, driftTarget, fromApp, idleMinutes, inActiveHours, modeAt, MIX_MS, nextPhoto, parseTime,
  shouldShow, toApp,
} from '../../src/lib/screensaver.js'

const on = { ...SAVER_DEFAULTS, saverOn: true }
const MIN = 60000

describe('screensaver settings', () => {
  test('off by default, after 5 minutes, dimmed, clock', () => {
    expect(SAVER_DEFAULTS).toMatchObject({ saverOn: false, saverMinutes: 5, saverMode: 'clock', saverDim: true, saverHours: false })
  })

  test('broken settings go back to the defaults', () => {
    expect(cleanSaver({ saverOn: 'yes', saverMode: 'disco', saverMinutes: -3, saverFrom: '25:00', saverTo: 'later', saverDim: 1 }))
      .toEqual(SAVER_DEFAULTS)
    expect(cleanSaver(null)).toEqual(SAVER_DEFAULTS)
    expect(cleanSaver({ saverMinutes: '12.4' }).saverMinutes).toBe(12)
    expect(cleanSaver({ saverMinutes: 9999 }).saverMinutes).toBe(240)
  })

  test('times', () => {
    expect(parseTime('07:30')).toBe(450)
    expect(parseTime('7:05')).toBe(425)
    expect(parseTime('23:59')).toBe(1439)
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('')).toBeNull()
    expect(parseTime(undefined)).toBeNull()
  })

  test("the Android app's settings, there and back", () => {
    const app = { enabled: true, mode: 'photos', minutes: 3, activeHours: true, from: '08:00', to: '20:00', dim: false, screenOffMinutes: 10 }
    const s = fromApp(JSON.stringify(app))
    expect(s).toEqual({ saverOn: true, saverMode: 'photos', saverMinutes: 3, saverHours: true, saverFrom: '08:00', saverTo: '20:00', saverDim: false, screenOffMinutes: 10 })
    const { screenOffMinutes, ...rest } = app
    expect(screenOffMinutes).toBe(10)
    expect(toApp(s)).toEqual(rest)
  })

  test("an app without the setting (or not ready yet) means the display's own settings", () => {
    expect(fromApp('')).toBeNull()
    expect(fromApp(undefined)).toBeNull()
    expect(fromApp('{}')).toBeNull()
    expect(fromApp('not json')).toBeNull()
    expect(fromApp('{"enabled": true}')).toMatchObject({ saverOn: true, saverMinutes: 5, screenOffMinutes: 0 })
  })
})

describe('when it comes on', () => {
  test('it starts before the app turns the screen off', () => {
    expect(idleMinutes(5, 0)).toBe(5) // the screen never goes off
    expect(idleMinutes(3, 5)).toBe(3)
    expect(idleMinutes(5, 5)).toBe(4)
    expect(idleMinutes(30, 10)).toBe(9)
    expect(idleMinutes(5, 1)).toBe(0.5)
  })

  test('only after the idle minutes, only when switched on, and never when something is going on', () => {
    const at = { minuteOfDay: 600, blocked: false }
    expect(shouldShow({ s: on, idleMs: 4.9 * MIN, ...at })).toBe(false)
    expect(shouldShow({ s: on, idleMs: 5 * MIN, ...at })).toBe(true)
    expect(shouldShow({ s: SAVER_DEFAULTS, idleMs: 60 * MIN, ...at })).toBe(false)
    expect(shouldShow({ s: on, idleMs: 60 * MIN, minuteOfDay: 600, blocked: true })).toBe(false)
    expect(shouldShow({ s: null, idleMs: 60 * MIN, ...at })).toBe(false)
    // the app's screen goes off after 5 minutes, so it comes on at 4
    expect(shouldShow({ s: on, idleMs: 4 * MIN, ...at, screenOffMinutes: 5 })).toBe(true)
  })

  test('active hours, over midnight too', () => {
    const day = { ...on, saverHours: true, saverFrom: '08:00', saverTo: '20:00' }
    expect(inActiveHours(day, 7 * 60 + 59)).toBe(false)
    expect(inActiveHours(day, 8 * 60)).toBe(true)
    expect(inActiveHours(day, 20 * 60)).toBe(false)
    const night = { ...on, saverHours: true, saverFrom: '21:00', saverTo: '07:00' }
    expect(inActiveHours(night, 23 * 60)).toBe(true)
    expect(inActiveHours(night, 6 * 60)).toBe(true)
    expect(inActiveHours(night, 12 * 60)).toBe(false)
    expect(inActiveHours({ ...on, saverHours: false, saverFrom: '08:00', saverTo: '09:00' }, 0)).toBe(true)
    expect(shouldShow({ s: day, idleMs: 60 * MIN, minuteOfDay: 22 * 60, blocked: false })).toBe(false)
  })
})

describe('what it shows', () => {
  test('photos without any photos shows the clock', () => {
    expect(modeAt('photos', 0, false)).toBe('clock')
    expect(modeAt('photos', 0, true)).toBe('photos')
    expect(modeAt('face', 0, false)).toBe('face')
    expect(modeAt('nonsense', 0, true)).toBe('clock')
  })

  test('mix takes turns, skipping photos when there are none', () => {
    expect([0, 1, 2, 3].map((n) => modeAt('mix', n * MIX_MS + 1, true))).toEqual(['clock', 'face', 'photos', 'clock'])
    expect([0, 1, 2].map((n) => modeAt('mix', n * MIX_MS + 1, false))).toEqual(['clock', 'face', 'clock'])
  })

  test('drifting stays within reach and always moves a little', () => {
    let at = { x: 0, y: 0 }
    for (let i = 0; i < 200; i++) {
      const next = driftTarget(at, 0.25)
      expect(Math.abs(next.x)).toBeLessThanOrEqual(0.25)
      expect(Math.abs(next.y)).toBeLessThanOrEqual(0.25)
      at = next
    }
    // a random number that would keep it still is tried again
    const rolls = [0.5, 0.5, 0.5, 0.5, 1, 0]
    const moved = driftTarget({ x: 0, y: 0 }, 0.25, () => rolls.shift())
    expect(moved).toEqual({ x: 0.25, y: -0.25 })
  })

  test('the next photo is never the same one twice in a row', () => {
    expect(nextPhoto([], '')).toBe('')
    expect(nextPhoto(['a'], 'a')).toBe('a')
    for (let i = 0; i < 50; i++) expect(nextPhoto(['a', 'b', 'c'], 'b')).not.toBe('b')
    expect(nextPhoto(['a', 'b', 'c'], 'a', () => 0.99)).toBe('c')
  })
})
