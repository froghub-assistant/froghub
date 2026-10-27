import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { define, plain } from '../../channel/dictionary.ts'
import { runTool } from '../../channel/tools.ts'
import { CONFIG } from '../helpers.ts'

const asked: string[] = []
let answer: (url: string) => Response
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
  asked.push(String(input))
  return answer(String(input))
}) as typeof fetch)
afterAll(() => fetchSpy.mockRestore())
beforeEach(() => {
  asked.length = 0
  writeFileSync(join(CONFIG, 'policy.json'), '{}')
  answer = () => Response.json({
    en: [
      {
        partOfSpeech: 'Noun',
        definitions: [
          { definition: 'A <a href="/wiki/happy">happy</a> accident &amp; a lucky find.', parsedExamples: [{ example: 'It was <i>pure</i> serendipity.' }] },
          { definition: '' },
          { definition: 'Second meaning.' },
          { definition: 'Third.' },
          { definition: 'Fourth, not said.' },
        ],
      },
      { partOfSpeech: 'Adjective', definitions: [{ definition: 'Lucky.', examples: ['a <b>lucky</b> day'] }] },
    ],
  })
})

describe('dictionary', () => {
  test('meanings by part of speech, as plain text, with an example', async () => {
    expect(await define({ word: 'serendipity' })).toBe([
      'serendipity', 'Noun:', '1. A happy accident & a lucky find. (e.g. "It was pure serendipity.")', '2. Second meaning.', '3. Third.',
      'Adjective:', '1. Lucky. (e.g. "a lucky day")',
    ].join('\n'))
    expect(asked[0]).toBe('https://en.wiktionary.org/api/rest_v1/page/definition/serendipity')
  })

  test('a misspelling gets the words they probably meant', async () => {
    answer = url => url.includes('opensearch') ? Response.json(['seredipity', ['serendipity', 'serendipitous']]) : new Response('', { status: 404 })
    await expect(define({ word: 'seredipity' })).rejects.toThrow('Wiktionary has no "seredipity". Did they mean: serendipity, serendipitous?')
  })

  test('phrases use underscores, and HTML comes out plain', async () => {
    await define({ word: 'kick the bucket' })
    expect(asked[0]).toEndWith('/definition/kick_the_bucket')
    expect(plain('<span>a&nbsp;b</span>  &lt;c&gt;')).toBe('a b <c>')
  })

  test('off with the "look things up online" switch', async () => {
    writeFileSync(join(CONFIG, 'policy.json'), JSON.stringify({ webSearch: false }))
    expect((await runTool('dictionary', { word: 'frog' }, {}))?.isError).toBe(true)
    expect(asked).toEqual([])
  })
})
