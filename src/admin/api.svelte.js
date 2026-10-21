// The admin page's link to the server: the admin token (from the PIN) for this browser tab, and fetch with it.
// The server ends admin mode after 10 idle minutes; a 403 sends you back to the PIN.

const KEY = 'froghub-admin-token'

function stored() {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export const session = $state({ token: stored() })

export function signIn(token) {
  session.token = token
  try {
    sessionStorage.setItem(KEY, token)
  } catch {
    // storage blocked: the PIN again after a reload
  }
}

export function signOut() {
  if (session.token) fetch('/api/admin/lock', { method: 'POST', headers: { 'X-Admin-Token': session.token } }).catch(() => {})
  session.token = null
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // nothing stored
  }
}

/** JSON from the server, with the admin token. Throws an Error with the server's message if it fails. */
export async function api(path, body) {
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Admin-Token': session.token || '', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (r.status === 403) {
    signOut()
    throw new Error('Admin mode ended, enter the PIN again')
  }
  if (!r.ok || data.error) throw new Error(data.error || `The server said ${r.status}`)
  return data
}

/** "2 minutes ago", "yesterday 18:05", for last seen times. */
export function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
