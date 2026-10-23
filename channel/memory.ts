/**
 * The admin page's view of the assistant's memory: the markdown files the Claude Code brain writes in its memory
 * directory, and the API brain's memory.md (notes.ts). Read-only:
 * the memory is the assistant's to keep, so grown-ups ask it to remember or forget things (POST /api/admin/remember
 * in server.ts) instead of editing the files.
 *
 *   GET  /api/admin/memory      [{ file, text, modified }]     admin only
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { adminValid, json } from './common.ts'
import { agentMemoryDir as DIR } from './instance.ts'
import { MEMORY_FILE } from './notes.ts'

const NAME = /^[\w.-]{1,80}\.md$/

export async function handleMemory(req: Request): Promise<Response> {
  if (!adminValid(req.headers.get('x-admin-token'))) return json({ error: 'admin mode needed' }, 403)
  if (req.method === 'GET') {
    const read = (file: string, path: string) => ({ file, text: readFileSync(path, 'utf8'), modified: statSync(path).mtimeMs })
    return json([
      ...(existsSync(DIR) ? readdirSync(DIR).filter(f => NAME.test(f)).sort().map(f => read(f, `${DIR}/${f}`)) : []),
      ...(existsSync(MEMORY_FILE) ? [read('memory.md', MEMORY_FILE)] : []),
    ])
  }
  return new Response('not found', { status: 404 })
}
