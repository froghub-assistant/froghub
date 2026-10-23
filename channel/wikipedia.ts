/**
 * The wikipedia tool: looks something up on Wikipedia (or Simple English Wikipedia, written for children and learners)
 * and gives the article's summary, its picture (which show_on_screen accepts) and other matches; or, with more, the
 * article itself, cut to a length the assistant can read. Off with the grown-ups' "look things up online" switch.
 */
import { clean } from './common.ts'
import { instance } from './instance.ts'
import type { Tool } from './tools.ts'

export const wikipediaTool: Tool = {
  name: 'wikipedia',
  description:
    'Look something up on Wikipedia: the best match\'s summary, its picture (show it with show_on_screen image_url) ' +
    'and other matching articles. simple uses Simple English Wikipedia (easier words, good for children). more gives ' +
    'the article itself, for details the summary lacks. Say it in your own words.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look up, e.g. "red panda", "Battle of Hastings"' },
      simple: { type: 'boolean', description: 'Simple English Wikipedia' },
      more: { type: 'boolean', description: 'The article itself rather than its summary' },
    },
    required: ['query'],
  },
}

const MAX_ARTICLE = 6000
const headers = () => ({ 'User-Agent': `FrogHub/0.1 (home display${instance.site ? `; ${instance.site}` : ''})` })

async function get(url: string): Promise<any> {
  const r = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`Wikipedia answered ${r.status}`)
  return r.json()
}

/** Runs the tool; returns the text for the assistant (throws when there's nothing to say). */
export async function lookUp(args: Record<string, unknown>): Promise<string> {
  const query = clean(args.query, 200)
  if (!query) throw new Error('Look up what?')
  const site = `https://${args.simple === true ? 'simple' : 'en'}.wikipedia.org`
  const found: { title: string; description?: string | null }[] =
    (await get(`${site}/w/rest.php/v1/search/page?limit=5&q=${encodeURIComponent(query)}`)).pages ?? []
  if (!found.length) throw new Error(`Wikipedia has nothing for "${query}"; try other words.`)
  const [best, ...others] = found
  const othersLine = others.length ? `\nOther matches: ${others.map(p => p.title).join('; ')}` : ''
  const page = encodeURIComponent(best.title.replace(/ /g, '_'))
  if (args.more === true) {
    const pages = (await get(`${site}/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${page}`)).query?.pages ?? {}
    const text = String((Object.values(pages)[0] as { extract?: string } | undefined)?.extract ?? '').replace(/\n{2,}/g, '\n').trim()
    if (!text) throw new Error(`Couldn't read the article "${best.title}".`)
    return `${best.title} (${site}/wiki/${page})\n${text.length > MAX_ARTICLE ? `${text.slice(0, MAX_ARTICLE)}…` : text}${othersLine}`
  }
  const summary = await get(`${site}/api/rest_v1/page/summary/${page}?redirect=true`)
  if (summary.type === 'disambiguation')
    return `"${best.title}" could mean several things: ${others.map(p => `${p.title}${p.description ? ` (${p.description})` : ''}`).join('; ') || 'look up something more exact'}.`
  return [
    `${summary.title}${summary.description ? `: ${summary.description}` : ''}`,
    String(summary.extract ?? '').trim(),
    summary.thumbnail?.source ? `Picture: ${summary.thumbnail.source}` : '',
    `Link: ${summary.content_urls?.desktop?.page ?? `${site}/wiki/${page}`}`,
  ].filter(Boolean).join('\n') + othersLine
}
