// Settings live in the tablet's localStorage. The rest (SYNCED) can also be shared through the server, so every Frog Hub
// display matches: a grown-up's Save in admin mode publishes them, and displays with sync on pick them up.
// The HA token is shared too, but the server only hands it over in admin mode (after the PIN).

const KEY = 'froghub-settings'

const defaults = {
  haUrl: '', // filled from the server's instance settings during the welcome
  token: '',
  personality: 'frog', // the default look, until someone picks another
  name: '', // who it's for (per display)
  area: '', // area id for the buttons and what the assistant may control (picked per display)
  nightStart: 21,
  nightEnd: 7,
  sync: true, // this display follows (and, from admin mode, publishes) the shared settings
  syncedAt: 0, // when the shared settings this display last took were published
  deviceId: '', // this display's own random id (never synced), so messages can be sent to just it
  deviceName: '', // what it's called in those messages; '' = its room's name
  setUp: false, // the welcome was finished (displays from before it existed count as set up if they have an HA token)
  micMuted: false, // the 🎙️ button: microphone off
  volume: 100, // replies, announcements and alarms (alarms at least 20%)
}

export const SYNCED = ['personality', 'nightStart', 'nightEnd', 'haUrl'] // not area or name: each display has its own room and person

function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...defaults }
  }
}

export const settings = $state(load())
if (!settings.deviceId) {
  settings.deviceId = Math.random().toString(36).slice(2, 12)
  saveSettings()
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Storage blocked: settings only last until the page reloads.
  }
}

/** Take newer shared settings from the server (and the token, in admin mode). Returns the names of what changed. */
export async function pullShared(adminToken = null, force = false) {
  if (!settings.sync && !force) return []
  try {
    const shared = await (await fetch('/api/settings', { headers: adminToken ? { 'X-Admin-Token': adminToken } : {} })).json()
    const changed = []
    if (shared.token && shared.token !== settings.token) {
      settings.token = shared.token
      changed.push('token')
    }
    if (shared.settings && (force || shared.updated > settings.syncedAt)) {
      for (const k of SYNCED) {
        if (k in shared.settings && shared.settings[k] !== settings[k]) {
          settings[k] = shared.settings[k]
          changed.push(k)
        }
      }
      settings.syncedAt = shared.updated
    }
    saveSettings()
    return changed
  } catch {
    return [] // server unreachable; keep what we have
  }
}

/** Publish this display's settings and token for the others. Needs admin mode. */
export async function pushShared(adminToken) {
  const r = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
    body: JSON.stringify({ settings: Object.fromEntries(SYNCED.map((k) => [k, settings[k]])), token: settings.token }),
  })
  if (r.ok) {
    settings.syncedAt = (await r.json()).updated
    saveSettings()
  }
}
