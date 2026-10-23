import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { say, wikidataFacts } from '../../channel/wikidata.ts'

const entity = (id: string, label: string, description: string, claims: Record<string, unknown[]> = {}) =>
  ({ id, labels: { en: { value: label } }, descriptions: { en: { value: description } }, claims })
const item = (id: string, rank = 'normal') => ({ rank, mainsnak: { datavalue: { type: 'wikibase-entityid', value: { id } } } })
const quantity = (amount: string, unit = '1', rank = 'normal') => ({ rank, mainsnak: { datavalue: { type: 'quantity', value: { amount, unit } } } })
const time = (t: string, precision: number) => ({ rank: 'normal', mainsnak: { datavalue: { type: 'time', value: { time: t, precision } } } })

let calls: URLSearchParams[] = []
let pages: Record<string, unknown> = {}
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
  const q = new URL(String(input)).searchParams
  calls.push(q)
  if (q.get('action') === 'wbsearchentities') return Response.json(pages.search)
  return Response.json({ entities: Object.fromEntries(q.get('ids')!.split('|').map(id => [id, (pages.entities as Record<string, unknown>)[id]])) })
}) as typeof fetch)
afterAll(() => fetchSpy.mockRestore())
beforeEach(() => {
  calls = []
  pages = {
    search: { search: [{ id: 'Q1', label: 'Gold', description: 'family name' }, { id: 'Q897', label: 'gold', description: 'chemical element' }, { id: 'Q5', label: 'Gold', description: 'band' }] },
    entities: {
      Q1: entity('Q1', 'Gold', 'family name', { P31: [item('Q101352')] }),
      Q897: entity('Q897', 'gold', 'chemical element', {
        P31: [item('Q11344')], P1086: [quantity('+79')], P2101: [quantity('+1064.18', 'http://www.wikidata.org/entity/Q25267')],
        P1082: [quantity('+1', '1', 'deprecated'), quantity('+2'), quantity('+3', '1', 'preferred')],
      }),
      Q5: entity('Q5', 'Gold', 'band'),
      Q11344: { labels: { en: { value: 'chemical element' } } },
      Q25267: { labels: { en: { value: 'degree Celsius' } } },
    },
  }
})

describe('wikidata', () => {
  test('the first real thing with the facts, naming what they point to, and what else it could mean', async () => {
    expect(await wikidataFacts({ thing: 'gold' })).toBe([
      'gold (chemical element)', 'is a: chemical element', 'population: 3', 'atomic number: 79', 'melting point: 1,064.18 degree Celsius',
      '(Or did they mean: Gold, band?)',
    ].join('\n'))
    expect(calls[2].get('ids')).toBe('Q11344|Q25267') // named in one go
  })

  test('fact picks which; with none of those it says what there is', async () => {
    expect(await wikidataFacts({ thing: 'gold', fact: 'point' })).toStartWith('gold (chemical element)\nmelting point: 1,064.18 degree Celsius\n(')
    expect(await wikidataFacts({ thing: 'gold', fact: 'height' })).toBe('Gold (family name): no "height" facts found. It has: is a.')
  })

  test('nothing found, or nothing asked', async () => {
    pages.search = { search: [] }
    await expect(wikidataFacts({ thing: 'zzqx' })).rejects.toThrow('Wikidata has nothing called "zzqx".')
    await expect(wikidataFacts({})).rejects.toThrow('Facts about what?')
  })

  test('dates as words, to the precision they have', () => {
    const at = (t: string, p: number) => say(time(t, p).mainsnak, {})
    expect(at('+1867-11-07T00:00:00Z', 11)).toBe('7 November 1867')
    expect(at('+1969-07-00T00:00:00Z', 10)).toBe('July 1969')
    expect(at('+1066-00-00T00:00:00Z', 9)).toBe('1066')
    expect(at('+1960-00-00T00:00:00Z', 8)).toBe('the 1960s')
    expect(at('-0044-03-15T00:00:00Z', 11)).toBe('15 March 44 BC')
  })
})
