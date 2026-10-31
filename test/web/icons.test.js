import { describe, expect, test } from 'bun:test'
import { markShapes } from '../../src/lib/icons.js'

/** A stand-in for an SVG path that runs from `start` to `end`. */
function path(start, end, length = 10) {
  const attributes = {}
  return {
    attributes,
    getTotalLength: () => length,
    getPointAtLength: (at) => (at === 0 ? start : end),
    setAttribute: (name, value) => (attributes[name] = value),
  }
}

const page = (paths) => ({ querySelectorAll: () => paths })

describe('two-tone icons', () => {
  test('paths that end where they start are closed, the rest are open', () => {
    const house = path({ x: 3, y: 10 }, { x: 3, y: 10 })
    const nearly = path({ x: 20.985, y: 12.486 }, { x: 21.3, y: 12.6 }) // the moon ends just short of its start
    const chevron = path({ x: 9, y: 18 }, { x: 9, y: 6 })
    markShapes(page([house, nearly, chevron]))
    expect(house.attributes['data-shape']).toBe('closed')
    expect(nearly.attributes['data-shape']).toBe('closed')
    expect(chevron.attributes['data-shape']).toBe('open')
  })

  test('a dot or a path that cannot be measured stays a line', () => {
    const dot = path({ x: 12, y: 17 }, { x: 12, y: 17 }, 0)
    const broken = { ...path({ x: 0, y: 0 }, { x: 0, y: 0 }), getTotalLength: () => { throw new Error('not rendered') } }
    broken.attributes = {}
    broken.setAttribute = (name, value) => (broken.attributes[name] = value)
    markShapes(page([dot, broken]))
    expect(dot.attributes['data-shape']).toBe('open')
    expect(broken.attributes['data-shape']).toBe('open')
  })
})
