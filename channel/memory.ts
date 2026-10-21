/**
 * The admin page's view of the assistant's memory: the markdown files it writes in its memory directory. Read-only:
 * the memory is the assistant's to keep, so grown-ups ask it to remember or forget things (POST /api/admin/remember
 * in server.ts) instead of editing the files.
 *
 *   GET  /api/admin/memory      [{ file, text, modified }]     admin only
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { adminValid, json } from './common.ts'
import { agentMemoryDir as DIR } from './instance.ts'

const NAME = /^[\w.-]{1,80}\.md$/

export async function handleMemory(req: Request): Promise<Response> {
  if (!adminValid(req.headers.get('x-admin-token'))) return json({ error: 'admin mode needed' }, 403)
  if (req.method === 'GET') {
    if (!existsSync(DIR)) return json([])
    return json(readdirSync(DIR).filter(f => NAME.test(f)).sort().map(file => ({
      file,
      text: readFileSync(`${DIR}/${file}`, 'utf8'),
      modified: statSync(`${DIR}/${file}`).mtimeMs,
    })))
  }
  return new Response('not found', { status: 404 })
}
