/**
 * Web search for a model without its own (the API brain's local fallback, e.g. LM Studio): a SearXNG instance if
 * FROGHUB_SEARCH_URL is set (with format=json allowed in its settings), otherwise DuckDuckGo's plain HTML results page.
 * Claude has Anthropic's own web search instead.
 *
 * Environment:
 *   FROGHUB_SEARCH_URL  a SearXNG instance, e.g. http://192.168.1.20:8888 (optional)
 */
import type { Tool } from './tools.ts'

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web for something current or that you are unsure of (news, opening times, facts). Gives the top few results.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
}

type Result = { title: string; url: string; snippet: string }
const RESULTS = 5
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (FrogHub home display)' }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
/** Plain text from a bit of HTML: no tags, entities decoded, spaces squashed. */
export const plain = (html: string) =>
  html.replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? all)
    .replace(/\s+/g, ' ').trim()

/** DuckDuckGo's results page: each result's link, title and snippet. */
export function parseDuckDuckGo(html: string): Result[] {
  const results: Result[] = []
  for (const block of html.split('class="result__a"').slice(1)) {
    const link = block.match(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    let url = link[1].replace(/&amp;/g, '&')
    const redirect = url.match(/[?&]uddg=([^&]+)/) // older pages link through duckduckgo.com/l/?uddg=<the url>
    if (redirect) url = decodeURIComponent(redirect[1])
    if (url.startsWith('//')) url = `https:${url}`
    if (!/^https?:\/\//.test(url) || url.includes('duckduckgo.com/y.js')) continue // (ads)
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)
    results.push({ title: plain(link[2]), url, snippet: snippet ? plain(snippet[1]) : '' })
    if (results.length === RESULTS) break
  }
  return results
}

async function search(query: string): Promise<Result[]> {
  const searx = (process.env.FROGHUB_SEARCH_URL || '').replace(/\/+$/, '')
  if (searx) {
    const r = await fetch(`${searx}/search?format=json&q=${encodeURIComponent(query)}`, { headers: HEADERS, signal: AbortSignal.timeout(10_000) })
    if (!r.ok) throw new Error(`SearXNG answered ${r.status}`)
    return ((await r.json()).results ?? []).slice(0, RESULTS)
      .map((x: Record<string, string>) => ({ title: plain(x.title ?? ''), url: x.url ?? '', snippet: plain(x.content ?? '') }))
  }
  const r = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!r.ok) throw new Error(`DuckDuckGo answered ${r.status}`)
  return parseDuckDuckGo(await r.text())
}

/** The top results for `query`, as text for the model. */
export async function webSearch(query: string): Promise<string> {
  const q = query.trim().slice(0, 200)
  if (!q) throw new Error('Search for what?')
  const results = await search(q)
  if (!results.length) return `No results for "${q}".`
  return results.map((x, i) => `${i + 1}. ${x.title}\n${x.url}\n${x.snippet}`).join('\n\n')
}
