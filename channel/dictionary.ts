/**
 * The dictionary tool: what a word means, from Wiktionary (English definitions, with an example where there is one),
 * and how to spell it when it's misspelt. Off with the grown-ups' "look things up online" switch.
 */
import { clean } from './common.ts'
import { instance } from './instance.ts'
import type { Tool } from './tools.ts'

export const dictionaryTool: Tool = {
  name: 'dictionary',
  description:
    'What a word or phrase means, from Wiktionary: its meanings by part of speech, with an example sentence where ' +
    'there is one. If it is misspelt, says the words they probably meant (so it also helps with spelling).',
  inputSchema: {
    type: 'object',
    properties: { word: { type: 'string', description: 'e.g. "serendipity", "kick the bucket"' } },
    required: ['word'],
  },
}

const SITE = 'https://en.wiktionary.org'
const PARTS = 3 // parts of speech said
const MEANINGS = 3 // meanings for each
const headers = () => ({ 'User-Agent': `FrogHub/0.1 (home display${instance.site ? `; ${instance.site}` : ''})` })

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }
/** Wiktionary's HTML as plain text. */
export const plain = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENTITIES[e]).replace(/\s+/g, ' ').trim()

type Meaning = { definition: string; examples?: string[]; parsedExamples?: { example: string }[] }
type Entry = { partOfSpeech: string; definitions: Meaning[] }

/** Runs the tool; returns the text for the assistant (throws when there's nothing to say). */
export async function define(args: Record<string, unknown>): Promise<string> {
  const word = clean(args.word, 80)
  if (!word) throw new Error('Which word?')
  const r = await fetch(`${SITE}/api/rest_v1/page/definition/${encodeURIComponent(word.replace(/ /g, '_'))}`, {
    headers: headers(), signal: AbortSignal.timeout(8000),
  })
  if (r.status === 404) {
    const [, guesses = []] = await fetch(`${SITE}/w/api.php?action=opensearch&profile=fuzzy&limit=5&format=json&search=${encodeURIComponent(word)}`, {
      headers: headers(), signal: AbortSignal.timeout(8000),
    }).then(res => res.json()).catch(() => [])
    const near = (guesses as string[]).filter(g => g.toLowerCase() !== word.toLowerCase())
    throw new Error(`Wiktionary has no "${word}".${near.length ? ` Did they mean: ${near.join(', ')}?` : ''}`)
  }
  if (!r.ok) throw new Error(`Wiktionary answered ${r.status}`)
  const entries: Entry[] = (await r.json()).en ?? []
  if (!entries.length) throw new Error(`Wiktionary has "${word}", but not as an English word.`)
  const lines = entries.slice(0, PARTS).map(e => {
    const meanings = e.definitions.map(d => ({ ...d, text: plain(d.definition) })).filter(d => d.text).slice(0, MEANINGS)
    return `${e.partOfSpeech}:\n${meanings.map((d, i) => {
      const example = d.parsedExamples?.[0]?.example ?? d.examples?.[0]
      return `${i + 1}. ${d.text}${example ? ` (e.g. "${plain(example)}")` : ''}`
    }).join('\n')}`
  })
  return `${word}\n${lines.join('\n')}`
}
