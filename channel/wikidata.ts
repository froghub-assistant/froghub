/**
 * The wikidata tool: exact facts about a thing from Wikidata (population, birthday, height, capital, atomic number...),
 * for when a number matters more than Wikipedia's prose. Finds the best match by name, then reads a chosen set of its
 * statements, naming the things they point to. Off with the grown-ups' "look things up online" switch.
 */
import { clean } from './common.ts'
import { instance } from './instance.ts'
import type { Tool } from './tools.ts'

export const wikidataTool: Tool = {
  name: 'wikidata',
  description:
    'Exact facts from Wikidata about a person, place, animal, element, book, film...: e.g. population, area, capital, ' +
    'date of birth, height, mass, atomic number, boiling point, distance from Earth. Give the thing, and fact to pick ' +
    'one (e.g. "population"). Better than Wikipedia for numbers and dates.',
  inputSchema: {
    type: 'object',
    properties: {
      thing: { type: 'string', description: 'e.g. "Mount Everest", "Paris", "Marie Curie", "gold"' },
      fact: { type: 'string', description: 'Only facts whose name contains this, e.g. "population", "born", "height"' },
    },
    required: ['thing'],
  },
}

const API = 'https://www.wikidata.org/w/api.php'
// The statements worth saying, by property id
export const FACTS: Record<string, string> = {
  P31: 'is a', P279: 'a kind of', P17: 'country', P131: 'in', P36: 'capital', P1376: 'capital of', P1082: 'population',
  P2046: 'area', P2044: 'height above sea level', P2048: 'height', P2043: 'length', P2049: 'width', P2067: 'mass',
  P569: 'born', P19: 'place of birth', P570: 'died', P20: 'place of death', P27: 'citizenship', P106: 'occupation',
  P166: 'award', P571: 'founded or started', P576: 'ended', P35: 'head of state', P6: 'head of government',
  P38: 'currency', P37: 'official language', P50: 'author', P57: 'director', P175: 'performer', P577: 'published',
  P136: 'genre', P225: 'scientific name', P141: 'conservation status', P2250: 'life expectancy', P246: 'element symbol',
  P1086: 'atomic number', P2101: 'melting point', P2102: 'boiling point', P2583: 'distance from Earth',
  P2120: 'radius', P625: 'coordinates', P856: 'website',
}
const MAX_VALUES = 3
const NOT_A_THING = /family name|given name|surname|disambiguation|Wikimedia/i

const get = async (params: Record<string, string>): Promise<any> => {
  const r = await fetch(`${API}?${new URLSearchParams({ format: 'json', ...params })}`, {
    headers: { 'User-Agent': `FrogHub/0.1 (home display${instance.site ? `; ${instance.site}` : ''})` },
    signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) throw new Error(`Wikidata answered ${r.status}`)
  return r.json()
}

type Snak = { datavalue?: { type: string; value: any } }
type Claim = { rank: string; mainsnak: Snak }

const qid = (url: string) => url.match(/Q\d+$/)?.[0] ?? ''

/** The ids of the things a statement points to (its value, or its quantity's unit), to name them. */
function refs(snak: Snak): string[] {
  const v = snak.datavalue
  if (v?.type === 'wikibase-entityid') return [v.value.id]
  if (v?.type === 'quantity' && qid(v.value.unit)) return [qid(v.value.unit)]
  return []
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A statement's value as words. */
export function say(snak: Snak, names: Record<string, string>): string {
  const v = snak.datavalue
  if (!v) return 'unknown'
  switch (v.type) {
    case 'wikibase-entityid':
      return names[v.value.id] ?? v.value.id
    case 'quantity': {
      const amount = Number(v.value.amount)
      const unit = qid(v.value.unit)
      return `${amount.toLocaleString('en-GB', { maximumFractionDigits: 6 })}${unit ? ` ${names[unit] ?? unit}` : ''}`
    }
    case 'time': {
      const m = String(v.value.time).match(/^([+-])(\d+)-(\d\d)-(\d\d)/)
      if (!m) return String(v.value.time)
      const year = `${Number(m[2])}${m[1] === '-' ? ' BC' : ''}`
      if (v.value.precision >= 11) return `${Number(m[4])} ${MONTHS[Number(m[3]) - 1]} ${year}`
      if (v.value.precision === 10) return `${MONTHS[Number(m[3]) - 1]} ${year}`
      return v.value.precision === 8 ? `the ${Math.floor(Number(m[2]) / 10) * 10}s` : year
    }
    case 'monolingualtext':
      return v.value.text
    case 'globecoordinate':
      return `${v.value.latitude.toFixed(3)}, ${v.value.longitude.toFixed(3)}`
    default:
      return String(v.value)
  }
}

/** The statements of a property to say: the preferred ones if any, else the normal ones, never deprecated. */
const best = (claims: Claim[]) => {
  const preferred = claims.filter(c => c.rank === 'preferred')
  return (preferred.length ? preferred : claims.filter(c => c.rank === 'normal')).slice(0, MAX_VALUES)
}

/** Runs the tool; returns the text for the assistant (throws when there's nothing to say). */
export async function wikidataFacts(args: Record<string, unknown>): Promise<string> {
  const thing = clean(args.thing, 150)
  const fact = clean(args.fact, 60).toLowerCase()
  if (!thing) throw new Error('Facts about what?')
  const matches: { id: string; label?: string; description?: string }[] =
    (await get({ action: 'wbsearchentities', search: thing, language: 'en', uselang: 'en', type: 'item', limit: '5' })).search ?? []
  if (!matches.length) throw new Error(`Wikidata has nothing called "${thing}".`)
  // The first match that's a real thing (not a name or a disambiguation page) with the fact asked for, else the first
  const entities = (await get({ action: 'wbgetentities', ids: matches.map(m => m.id).join('|'), props: 'labels|descriptions|claims', languages: 'en' })).entities ?? {}
  const facts = (e: any) => Object.keys(FACTS).filter(p => e?.claims?.[p] && (!fact || FACTS[p].includes(fact)))
  const top = matches.find(m => !NOT_A_THING.test(m.description ?? '') && facts(entities[m.id]).length) ?? matches[0]
  const others = matches.filter(m => m !== top && !NOT_A_THING.test(m.description ?? ''))
  const entity = entities[top.id]
  if (!entity) throw new Error(`Couldn't read ${top.id} from Wikidata.`)
  const wanted = facts(entity)
  const statements = wanted.map(p => [p, best(entity.claims[p])] as const).filter(([, cs]) => cs.length)
  // Name what the statements point to, in one go
  const ids = [...new Set(statements.flatMap(([, cs]) => cs.flatMap(c => refs(c.mainsnak))))].slice(0, 50)
  const names: Record<string, string> = {}
  if (ids.length) {
    const found = (await get({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels', languages: 'en' })).entities ?? {}
    for (const [id, e] of Object.entries<any>(found)) if (e.labels?.en) names[id] = e.labels.en.value
  }
  const title = `${entity.labels?.en?.value ?? top.label ?? thing}${entity.descriptions?.en ? ` (${entity.descriptions.en.value})` : ''}`
  const lines = statements.map(([p, cs]) => `${FACTS[p]}: ${cs.map(c => say(c.mainsnak, names)).join('; ')}`)
  if (!lines.length) {
    const has = Object.keys(FACTS).filter(p => entity.claims?.[p]).map(p => FACTS[p])
    return `${title}: no ${fact ? `"${fact}" ` : ''}facts found${has.length ? `. It has: ${has.join(', ')}` : ''}.`
  }
  const alsoMeans = others.length ? `\n(Or did they mean: ${others.map(o => `${o.label}${o.description ? `, ${o.description}` : ''}`).join('; ')}?)` : ''
  return `${title}\n${lines.join('\n')}${alsoMeans}`
}
