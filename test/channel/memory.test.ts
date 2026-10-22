import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { handleMemory } from '../../channel/memory.ts'
import { agentMemoryDir } from '../../channel/instance.ts'
import { asAdmin, read, request } from '../helpers.ts'

const get = async (headers: Record<string, string> = {}) => handleMemory(request('GET', '/api/admin/memory', undefined, headers))

beforeEach(() => rmSync(agentMemoryDir, { recursive: true, force: true }))

describe("the admin page's view of the assistant's memory", () => {
  test('needs admin mode', async () => {
    expect((await get()).status).toBe(403)
  })

  test('nothing remembered yet is an empty list', async () => {
    expect(await read(get(await asAdmin()))).toEqual([])
  })

  test('lists its markdown files in order, with what they say', async () => {
    mkdirSync(agentMemoryDir, { recursive: true })
    writeFileSync(join(agentMemoryDir, 'pets.md'), 'The cat is called Mochi.')
    writeFileSync(join(agentMemoryDir, 'MEMORY.md'), '- [Pets](pets.md)')
    writeFileSync(join(agentMemoryDir, 'notes.txt'), 'not memory')
    writeFileSync(join(agentMemoryDir, 'bad name!.md'), 'odd name')
    const files = await read(get(await asAdmin()))
    expect(files.map((f: { file: string }) => f.file)).toEqual(['MEMORY.md', 'pets.md'])
    expect(files[1]).toMatchObject({ file: 'pets.md', text: 'The cat is called Mochi.' })
    expect(files[1].modified).toBeNumber()
  })

  test('is read-only', async () => {
    expect((await handleMemory(request('POST', '/api/admin/memory', { file: 'x.md' }, await asAdmin()))).status).toBe(404)
  })
})
