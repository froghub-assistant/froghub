/**
 * Pairing a new display by QR code, so nobody types a PIN or token on the tablet. The new display asks for a code
 * and shows it as a QR code of <site>/admin/#pair=<code>; a grown-up scans it with their phone, unlocks the admin
 * page with the PIN and says yes. The display, polling meanwhile, then gets what "Copy everything" would give it
 * (the shared settings and HA token), once. Codes last 10 minutes.
 *
 *   POST /api/pair                  a new code: {code}
 *   GET  /api/pair?code=…           {waiting: true} until approved, then the shared settings and token (once); 404 if
 *                                   it's unknown or expired
 *   POST /api/admin/pair {code}     approve it; admin only
 */
import { adminValid, json, log } from './common.ts'
import { sharedSettingsFile } from './store.ts'

const LIFETIME_MS = 10 * 60 * 1000
const MAX_OPEN = 20
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O or 1/I, in case someone has to type it

const codes = new Map<string, { expires: number; approved: boolean }>()

function tidy(): void {
  const now = Date.now()
  for (const [code, c] of codes) if (c.expires < now) codes.delete(code)
}

export async function handlePair(req: Request, pathname: string): Promise<Response> {
  tidy()
  if (pathname === '/api/admin/pair') {
    if (req.method !== 'POST') return new Response('not found', { status: 404 })
    if (!adminValid(req.headers.get('x-admin-token'))) return json({ error: 'admin mode needed' }, 403)
    const code = String((await req.json().catch(() => ({}))).code ?? '').toUpperCase()
    const entry = codes.get(code)
    if (!entry) return json({ error: "That code has expired, or there's no display waiting with it. Try again from the display." }, 404)
    entry.approved = true
    log(`pair: approved ${code}`)
    return json({ ok: true })
  }
  if (req.method === 'POST') {
    if (codes.size >= MAX_OPEN) return json({ error: 'too many displays pairing at once; try again in a few minutes' }, 429)
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const code = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('')
    codes.set(code, { expires: Date.now() + LIFETIME_MS, approved: false })
    return json({ code, expiresIn: LIFETIME_MS })
  }
  if (req.method === 'GET') {
    const code = (new URL(req.url).searchParams.get('code') ?? '').toUpperCase()
    const entry = codes.get(code)
    if (!entry) return json({ error: 'expired' }, 404)
    if (!entry.approved) return json({ waiting: true })
    codes.delete(code)
    return json(sharedSettingsFile(true))
  }
  return new Response('not found', { status: 404 })
}
