import { describe, expect, test } from 'bun:test'
import { forSpeaking, gist, TOO_LONG } from '../../src/lib/speech.js'

const long = 'Volcanoes form where magma reaches the surface. Most sit where tectonic plates meet. ' +
  'Some, like Hawaii, sit over hot spots in the middle of a plate. ' + 'The magma builds up in a chamber until the pressure is too much. '.repeat(5)

describe('what is said of a reply', () => {
  test('a short reply is said whole, with no card', () => {
    expect(forSpeaking('Ribbit! It is sunny.', 'Weather?')).toEqual({ spoken: 'Ribbit! It is sunny.', card: null })
    expect(forSpeaking('x'.repeat(TOO_LONG)).card).toBeNull()
  })

  test('a long one: the first sentences said, and all of it on a card titled with the question', () => {
    const { spoken, card } = forSpeaking(long, 'How do volcanoes work?')
    expect(spoken).toBe('Volcanoes form where magma reaches the surface. Most sit where tectonic plates meet. ' +
      'Some, like Hawaii, sit over hot spots in the middle of a plate. The rest is on the screen.')
    expect(card).toEqual({ emoji: '📝', title: 'How do volcanoes work?', text: long, seconds: 300 })
    expect(forSpeaking(long, 'q'.repeat(80)).card.title).toBe('q'.repeat(59) + '…')
    expect(forSpeaking(long).card.title).toBeUndefined()
  })

  test('at least one sentence, cut at a word if it goes on and on', () => {
    expect(gist('A very long first sentence that goes on. Then more.')).toBe('A very long first sentence that goes on. Then more.')
    const rambling = 'and then '.repeat(60).trim()
    const said = gist(rambling)
    expect(said.length).toBeLessThanOrEqual(201)
    expect(said).toEndWith('then…')
  })
})
