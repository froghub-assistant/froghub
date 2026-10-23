import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { lookUp } from '../../channel/wikipedia.ts'
import { runTool } from '../../channel/tools.ts'
import { CONFIG } from '../helpers.ts'

const asked: string[] = []
let answers: Record<string, unknown> = {}
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
  const url = String(input)
  asked.push(url)
  const key = Object.keys(answers).find(k => url.includes(k))
  return Response.json(key ? answers[key] : {})
}) as typeof fetch)
afterAll(() => fetchSpy.mockRestore())
beforeEach(() => {
  asked.length = 0
  answers = {
    'search/page': { pages: [{ title: 'Red panda', description: 'Mammal' }, { title: 'Giant panda' }] },
    'page/summary/Red_panda': {
      type: 'standard', title: 'Red panda', description: 'Small mammal from the Himalayas', extract: 'The red panda is a small mammal.',
      thumbnail: { source: 'https://upload.wikimedia.org/x/Red_panda.jpg' }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Red_panda' } },
    },
  }
})

describe('wikipedia', () => {
  test("the best match's summary, picture, link and the other matches", async () => {
    expect(await lookUp({ query: 'red panda' })).toBe([
      'Red panda: Small mammal from the Himalayas', 'The red panda is a small mammal.',
      'Picture: https://upload.wikimedia.org/x/Red_panda.jpg', 'Link: https://en.wikipedia.org/wiki/Red_panda', 'Other matches: Giant panda',
    ].join('\n'))
    expect(asked[0]).toBe('https://en.wikipedia.org/w/rest.php/v1/search/page?limit=5&q=red%20panda')
  })

  test('Simple English, and the article itself, cut to length', async () => {
    answers['action=query'] = { query: { pages: { 1: { extract: 'Para one.\n\n\nPara two. ' + 'x'.repeat(7000) } } } }
    const text = await lookUp({ query: 'red panda', simple: true, more: true })
    expect(asked.every(u => u.startsWith('https://simple.wikipedia.org/'))).toBe(true)
    expect(text).toStartWith('Red panda (https://simple.wikipedia.org/wiki/Red_panda)\nPara one.\nPara two.')
    expect(text).toContain('…\nOther matches: Giant panda')
  })

  test('a word with several meanings lists them', async () => {
    answers['search/page'] = { pages: [{ title: 'Mercury' }, { title: 'Mercury (planet)', description: 'Planet' }, { title: 'Mercury (element)' }] }
    answers['page/summary/Mercury'] = { type: 'disambiguation', title: 'Mercury' }
    expect(await lookUp({ query: 'mercury' })).toBe('"Mercury" could mean several things: Mercury (planet) (Planet); Mercury (element).')
  })

  test('nothing found, nothing asked, and switched off with looking things up online', async () => {
    answers['search/page'] = { pages: [] }
    await expect(lookUp({ query: 'zzqx' })).rejects.toThrow('Wikipedia has nothing for "zzqx"')
    await expect(lookUp({})).rejects.toThrow('Look up what?')
    writeFileSync(join(CONFIG, 'policy.json'), JSON.stringify({ webSearch: false }))
    try {
      expect(await runTool('wikipedia', { query: 'x' }, {})).toMatchObject({ isError: true, text: expect.stringContaining('looking things up online') })
    } finally {
      rmSync(join(CONFIG, 'policy.json'))
    }
  })
})
