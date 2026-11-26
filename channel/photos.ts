/**
 * Photos for the screensaver's slideshow: pictures in a folder on the server, and a list of picture addresses a
 * grown-up typed in. Neither has to exist; with no photos, the displays' slideshow shows the clock instead.
 *
 *   folder  ~/.config/froghub/photos/ (or instance.json's `photosDir`): .jpg, .jpeg, .png, .gif and .webp files,
 *           served as /api/photos/file/<name>. Keep them screen-sized: old tablets have little memory.
 *   list    ~/.config/froghub/photos.json {"urls": [...]}: http(s) addresses of pictures elsewhere
 *
 *   GET  /api/photos        anyone: {photos: [every picture's address], urls: [the typed-in list]}
 *   GET  /api/photos/file/<name>   a picture from the folder
 *   POST /api/admin/photos  admin only: {urls: [...]} replaces the list
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { extname, join } from 'path'
import { adminValid, json, log } from './common.ts'
import { instance } from './instance.ts'

const DIR = join(homedir(), '.config', 'froghub')
const LIST_FILE = join(DIR, 'photos.json')
const MAX_URLS = 200
const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
}

/** The photo folder: instance.json's photosDir, else ~/.config/froghub/photos. */
export function photosDir(): string {
  return typeof instance.photosDir === 'string' && instance.photosDir ? instance.photosDir : join(DIR, 'photos')
}

/** The pictures in the folder (file names, sorted), skipping anything that isn't a picture or is hidden. */
export function folderPhotos(): string[] {
  const dir = photosDir()
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(name => !name.startsWith('.') && extname(name).toLowerCase() in TYPES)
      .filter(name => statSync(join(dir, name)).isFile())
      .sort()
  } catch {
    return []
  }
}

/** Only http(s) addresses, without spaces or quotes, at most 2000 characters each; duplicates dropped. */
export function cleanUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return []
  const good = new Set<string>()
  for (const u of urls) {
    if (typeof u !== 'string') continue
    const url = u.trim()
    if (url.length > 2000 || /[\s"'<>]/.test(url)) continue
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) continue
    } catch {
      continue
    }
    good.add(url)
    if (good.size >= MAX_URLS) break
  }
  return [...good]
}

export function photoUrls(): string[] {
  try {
    return existsSync(LIST_FILE) ? cleanUrls(JSON.parse(readFileSync(LIST_FILE, 'utf8')).urls) : []
  } catch {
    return []
  }
}

/** Every picture for the slideshow: the folder's first, then the list. */
export function allPhotos(): string[] {
  return [...folderPhotos().map(name => `/api/photos/file/${encodeURIComponent(name)}`), ...photoUrls()]
}

function servePhoto(encoded: string): Response {
  let name: string
  try {
    name = decodeURIComponent(encoded)
  } catch {
    return new Response('not found', { status: 404 })
  }
  // Only a picture that's listed in the folder: no paths, no other files
  if (!folderPhotos().includes(name)) return new Response('not found', { status: 404 })
  return new Response(Bun.file(join(photosDir(), name)), {
    headers: { 'content-type': TYPES[extname(name).toLowerCase()], 'cache-control': 'max-age=3600' },
  })
}

export async function handlePhotos(req: Request, pathname: string): Promise<Response> {
  if (req.method === 'GET' && pathname === '/api/photos') return json({ photos: allPhotos(), urls: photoUrls() })
  if (req.method === 'GET' && pathname.startsWith('/api/photos/file/')) return servePhoto(pathname.slice('/api/photos/file/'.length))
  if (req.method === 'POST' && pathname === '/api/admin/photos') {
    if (!adminValid(req.headers.get('x-admin-token'))) return json({ error: 'admin mode needed' }, 403)
    const body = await req.json().catch(() => ({}))
    const urls = cleanUrls(body?.urls)
    writeFileSync(LIST_FILE, JSON.stringify({ urls }, null, 1))
    log(`photos: ${urls.length} addresses`)
    return json({ ok: true, urls })
  }
  return new Response('not found', { status: 404 })
}
