import { describe, expect, test } from 'bun:test'
import { PERSONALITIES } from '../../channel/common.ts'
import { POLICY_DEFAULTS } from '../../channel/store.ts'
import { personalities, personality } from '../../src/lib/personalities.js'
import { POLICY } from '../../src/lib/policy.js'

describe('personalities', () => {
  test('the server knows the same ones as the display', () => {
    expect(Object.keys(personalities).sort()).toEqual([...PERSONALITIES].sort())
  })

  test.each(Object.entries(personalities))('%s has everything the display uses', (_, p) => {
    expect(p.pipeline).toBe(`Frog Hub · ${p.name}`)
    expect(p.pitch).toBeWithin(0.5, 1.5)
    expect(['frog', 'smiley']).toContain(p.face)
    for (const key of ['bg', 'bg2', 'fg', 'muted', 'accent', 'faceFill', 'faceInk']) expect(p.colours[key]).toMatch(/^#[0-9a-f]{6}$/)
    expect(p.greeting('Sam')).toContain('Sam')
    for (const key of ['listening', 'thinking', 'error']) expect(p[key]).toBeString()
  })

  test('an unknown one is Frog', () => {
    expect(personality('verity').name).toBe('Verity')
    expect(personality('gandalf')).toBe(personalities.frog)
    expect(personality(undefined)).toBe(personalities.frog)
  })
})

test("the settings list every switch in the server's policy, once", () => {
  expect(POLICY.map(([key]) => key)).toEqual(Object.keys(POLICY_DEFAULTS))
  for (const [, label] of POLICY) expect(label).not.toBe('')
})
