// The personalities grown-ups made on the admin page (channel/personas.ts), kept in personalities.js next to the
// built-in four. Cached in localStorage so a display that starts without the server still looks right, and checked
// again with the shared settings. `customs.version` changes whenever they do, so components that read it update.
import { personalities, personality, setCustom } from './personalities.js'

const KEY = 'froghub-personalities'

export const customs = $state({ version: 0 })

function apply(text) {
  try {
    setCustom(JSON.parse(text))
    customs.version++
  } catch {
    // a broken cache: wait for the server
  }
}

try {
  const cached = localStorage.getItem(KEY)
  if (cached) apply(cached)
} catch {
  // storage blocked
}

/** Fetches the custom personalities again; true if they changed. */
export async function refreshCustoms() {
  try {
    const r = await fetch('/api/personalities')
    if (!r.ok) return false
    const text = JSON.stringify((await r.json()).personalities || [])
    let cached = null
    try {
      cached = localStorage.getItem(KEY)
    } catch {
      // storage blocked
    }
    if (text === cached && customs.version) return false
    try {
      localStorage.setItem(KEY, text)
    } catch {
      // storage blocked: fetched again next time
    }
    apply(text)
    return true
  } catch {
    return false
  }
}

/** personality(id), updating when the custom ones change. */
export function currentPersonality(id) {
  void customs.version
  return personality(id)
}

/** [id, personality] for every personality, built-in first, updating when the custom ones change. */
export function personalityList() {
  void customs.version
  return Object.entries(personalities)
}
