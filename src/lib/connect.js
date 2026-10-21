// Two ways for a new display to get its Home Assistant connection without typing a token:
//
//  - Log in with Home Assistant: off to HA's own login page (OAuth; Frog Hub's address is the client id, so nothing
//    to register), back with a code, swapped for a short-lived token, which makes a long-lived one for this display.
//    HA allows the token request from any site, so the server isn't involved.
//  - Pairing: the display shows a QR code of <site>/admin/#pair=<code>; a grown-up scans it, types the PIN on their
//    phone and says yes, and the display (polling channel/pair.ts) gets the shared settings and token.
import qrcode from 'qrcode-generator'
import { HomeAssistant } from './ha.js'

const LOGIN_KEY = 'froghub-ha-login'

const here = () => location.origin + location.pathname

/** Off to Home Assistant's login page. `keep` is saved and handed back by finishHaLogin (e.g. the welcome's draft). */
export function startHaLogin(haUrl, keep) {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')
  sessionStorage.setItem(LOGIN_KEY, JSON.stringify({ state, haUrl: haUrl.replace(/\/+$/, ''), keep }))
  const params = new URLSearchParams({ response_type: 'code', client_id: location.origin + '/', redirect_uri: here(), state })
  location.href = `${haUrl.replace(/\/+$/, '')}/auth/authorize?${params}`
}

/** Back from the login page? Returns {haUrl, keep} without finishing, or null. */
export function pendingHaLogin() {
  const params = new URLSearchParams(location.search)
  const saved = JSON.parse(sessionStorage.getItem(LOGIN_KEY) || 'null')
  if (!saved || !params.has('state')) return null
  return { haUrl: saved.haUrl, keep: saved.keep }
}

/** Swaps the login's code for a long-lived token for this display: {haUrl, token, keep}. Throws with a message. */
export async function finishHaLogin(deviceName) {
  const params = new URLSearchParams(location.search)
  const saved = JSON.parse(sessionStorage.getItem(LOGIN_KEY) || 'null')
  sessionStorage.removeItem(LOGIN_KEY)
  history.replaceState(null, '', here()) // the code is single-use; don't leave it in the address bar
  if (!saved || params.get('state') !== saved.state) throw new Error('That login didn’t match. Try again.')
  if (!params.get('code')) throw new Error('Home Assistant didn’t log in. Try again.')
  const r = await fetch(`${saved.haUrl}/auth/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'authorization_code', code: params.get('code'), client_id: location.origin + '/' }),
  })
  if (!r.ok) throw new Error(`Home Assistant said ${r.status} to the login. Try again.`)
  const { access_token } = await r.json()
  const ha = new HomeAssistant(saved.haUrl, access_token)
  try {
    await ha.connect()
    // Token names must be unique for the user, so the date and a little random bit go on the end
    const stamp = new Date().toISOString().slice(0, 10) + ' ' + Math.random().toString(36).slice(2, 6)
    const token = await ha.call({ type: 'auth/long_lived_access_token', client_name: `Frog Hub · ${deviceName || 'display'} · ${stamp}`, lifespan: 3650 })
    return { haUrl: saved.haUrl, token, keep: saved.keep }
  } finally {
    ha.close()
  }
}

/** A pairing code and its QR code (an SVG string): {code, svg, url}. */
export async function newPairing() {
  const r = await fetch('/api/pair', { method: 'POST' })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || `The server said ${r.status}`)
  const url = `${location.origin}/admin/#pair=${data.code}`
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  return { code: data.code, url, svg: qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) }
}

/** Waits for a grown-up to approve the code; resolves with the shared settings and token, or rejects when it expires. */
export function waitForPairing(code, signal) {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (signal && signal.aborted) return reject(new Error('cancelled'))
      try {
        const r = await fetch(`/api/pair?code=${encodeURIComponent(code)}`)
        if (r.status === 404) return reject(new Error('The code ran out. Make a new one.'))
        const data = await r.json()
        if (!data.waiting) return resolve(data)
      } catch {
        // server unreachable for a moment; keep trying
      }
      setTimeout(poll, 2000)
    }
    poll()
  })
}
