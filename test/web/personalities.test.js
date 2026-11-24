import { describe, expect, test } from 'bun:test'
import { PERSONALITIES } from '../../channel/common.ts'
import { POLICY_DEFAULTS } from '../../channel/store.ts'
import { personalities, personality, setCustom } from '../../src/lib/personalities.js'
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

describe('custom personalities (made on the admin page)', () => {
  const cloud = {
    id: 'nimbus', name: 'Nimbus', pipeline: 'Frog Hub · Nimbus', pitch: 0.9, face: 'custom', svg: '<svg></svg>',
    colours: { bg: '#101828', bg2: '#1d2b44', fg: '#f4f8ff', muted: '#a9b8d6', accent: '#7cc4ff', faceFill: '#e8f1ff', faceInk: '#1d2b44' },
    greeting: 'Hello {name} ☁️', listening: 'Listening', thinking: 'Hmm', error: 'Oops',
  }

  test('are added next to the built-in ones, in the same shape', () => {
    setCustom([cloud])
    const p = personality('nimbus')
    expect(p).toMatchObject({ name: 'Nimbus', face: 'custom', svg: '<svg></svg>', pitch: 0.9, custom: true })
    expect(p.greeting('Sam')).toBe('Hello Sam ☁️')
    expect(Object.keys(personalities)).toEqual(['frog', 'verity', 'falsity', 'lovity', 'nimbus'])
  })

  test('a new list replaces the old one, and can never replace a built-in one', () => {
    setCustom([cloud])
    setCustom([{ ...cloud, id: 'verity', name: 'Fake Verity' }])
    expect(personality('verity').name).toBe('Verity')
    expect(personality('nimbus')).toBe(personalities.frog)
    setCustom(null)
    expect(Object.keys(personalities)).toEqual(['frog', 'verity', 'falsity', 'lovity'])
  })
})
