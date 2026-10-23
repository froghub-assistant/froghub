// What to say out loud of a reply. A long one (more than about 25 seconds of speech) is shown in full on a card, and
// only its first sentence or two are said, then that the rest is on the screen.

export const TOO_LONG = 350 // characters
const GIST = 200

/** The opening sentences of `text`, up to about GIST characters (at least one sentence, cut at a word if that's huge). */
export function gist(text) {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) || [text]
  let said = ''
  for (const s of sentences) {
    if (said && (said + s).length > GIST) break
    said += s
  }
  said = said.trim()
  if (said.length > GIST + 50) said = said.slice(0, GIST).replace(/\s+\S*$/, '') + '…'
  return said
}

/** { spoken, card }: what to say, and the card to show the whole reply on (null when it's short enough to say). */
export function forSpeaking(text, question = '') {
  if (text.length <= TOO_LONG) return { spoken: text, card: null }
  return {
    spoken: `${gist(text)} The rest is on the screen.`,
    card: { emoji: '📝', ...(question ? { title: question.length > 60 ? question.slice(0, 59) + '…' : question } : {}), text, seconds: 300 },
  }
}
