/**
 * show_on_screen: the assistant can put a card on the display next to its spoken reply (a recipe's steps, a
 * spelling, a picture of an animal). Pictures only from Wikimedia, so it can't show just anything off the web:
 * usually the lead picture of a Wikipedia article, which this looks up itself (the assistant has no WebFetch).
 */
import { instance } from './instance.ts'

export type Display = { title?: string; text?: string; emoji?: string; items?: string[]; image?: string; seconds: number }

export const displayTool = {
  name: 'show_on_screen',
  description:
    'Show a card on the Frog Hub screen alongside your spoken reply: a title, a short text, an emoji, a list and/or a ' +
    'picture. Call it before reply, with the same request_id. For a picture, give picture_of (a Wikipedia article ' +
    'title, e.g. "Red panda") and its main picture is used.',
  inputSchema: {
    type: 'object',
    properties: {
      request_id: { type: 'string' },
      title: { type: 'string', description: 'Up to 60 characters' },
      text: { type: 'string', description: 'Up to 1500 characters, plain text' },
      emoji: { type: 'string', description: 'One big emoji' },
      items: { type: 'array', items: { type: 'string' }, description: 'Up to 30 lines of up to 300 characters (steps, a list, spellings); a whole recipe method fits' },
      picture_of: { type: 'string', description: 'English Wikipedia article whose main picture to show, e.g. "Red panda", "Eiffel Tower"' },
      image_url: { type: 'string', description: 'Or an exact https://upload.wikimedia.org/… image URL, or the picture find_recipe gave' },
      seconds: { type: 'number', description: 'How long to show it, 5-300 (default 30)' },
    },
    required: ['request_id'],
  },
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '')

/** The lead picture of an English Wikipedia article (a sized thumbnail on Wikimedia), or null. */
async function wikipediaPicture(title: string): Promise<string | null> {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`, {
    headers: { 'User-Agent': `FrogHub/0.1 (home display${instance.site ? `; ${instance.site}` : ''})` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null
  const page = await res.json()
  return page.type === 'standard' && page.thumbnail ? page.thumbnail.source : null
}

export async function cleanDisplay(a: Record<string, unknown>): Promise<Display> {
  const d: Display = { seconds: Math.max(5, Math.min(300, Math.round(Number(a.seconds) || 30))) }
  if (text(a.title, 60)) d.title = text(a.title, 60)
  if (text(a.text, 1500)) d.text = text(a.text, 1500)
  if (text(a.emoji, 8)) d.emoji = text(a.emoji, 8)
  if (Array.isArray(a.items)) d.items = a.items.map(i => text(i, 300)).filter(Boolean).slice(0, 30)
  if (text(a.picture_of, 100)) {
    const found = await wikipediaPicture(text(a.picture_of, 100))
    if (!found) throw new Error(`Wikipedia has no picture for "${text(a.picture_of, 100)}"; try another title, or show it without a picture.`)
    a.image_url = found
  }
  if (a.image_url !== undefined) {
    const url = String(a.image_url)
    if (!/^https:\/\/((upload|thumb)\.wikimedia\.org|www\.themealdb\.com\/images)\/[^\s"'<>]+$/.test(url))
      throw new Error('Pictures must be upload.wikimedia.org or thumb.wikimedia.org URLs (or a recipe picture from find_recipe).')
    d.image = url
  }
  if (!d.title && !d.text && !d.emoji && !d.items?.length && !d.image) throw new Error('Nothing to show.')
  return d
}
