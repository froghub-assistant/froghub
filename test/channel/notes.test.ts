import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, rmSync, writeFileSync } from 'fs'
import { MAX_MEMORY_CHARS, MEMORY_FILE, memoryForPrompt, runMemoryTool } from '../../channel/notes.ts'
import { handleMemory } from '../../channel/memory.ts'
import { asAdmin, read, request } from '../helpers.ts'

const notes = () => readFileSync(MEMORY_FILE, 'utf8')
beforeEach(() => writeFileSync(MEMORY_FILE, '- The cat is called Mochi\n- Sam likes red pandas\n- Bedtime is 7:30\n'))

describe("the API brain's memory", () => {
  test('remembers a new note at the end', () => {
    expect(runMemoryTool('remember', { note: 'Jo is allergic to nuts' })).toBe('Remembered.')
    expect(notes()).toEndWith('- Bedtime is 7:30\n- Jo is allergic to nuts\n')
  })

  test('changes a note', () => {
    expect(runMemoryTool('change_memory', { old: 'bedtime', note: 'Bedtime is 8 at weekends' })).toBe('Changed it to: Bedtime is 8 at weekends')
    expect(notes()).toBe('- The cat is called Mochi\n- Sam likes red pandas\n- Bedtime is 8 at weekends\n')
  })

  test('forgets notes', () => {
    expect(runMemoryTool('forget', { text: 'red panda' })).toBe('Forgot: Sam likes red pandas')
    expect(notes()).toBe('- The cat is called Mochi\n- Bedtime is 7:30\n')
  })

  test("says when it can't tell which, or there's nothing", () => {
    expect(() => runMemoryTool('forget', { text: 'dog' })).toThrow('No note contains "dog".')
    expect(() => runMemoryTool('change_memory', { old: 'e', note: 'x' })).toThrow('3 notes contain "e"; be more specific.')
    expect(() => runMemoryTool('remember', { note: '  ' })).toThrow('Nothing to remember.')
  })

  test('the prompt has all of it, then a nudge when nearly full, then only the newest part', () => {
    expect(memoryForPrompt()).toBe('## Your memory\n\n- The cat is called Mochi\n- Sam likes red pandas\n- Bedtime is 7:30')
    writeFileSync(MEMORY_FILE, `- ${'a'.repeat(MAX_MEMORY_CHARS * 0.9)}\n`)
    expect(memoryForPrompt()).toStartWith('## Your memory (nearly full: merge or forget old notes when you can)')
    writeFileSync(MEMORY_FILE, `- old note\n- ${'b'.repeat(MAX_MEMORY_CHARS)}\n`)
    const prompt = memoryForPrompt()
    expect(prompt).toStartWith('## Your memory (too long: the oldest notes are hidden; merge or forget some)')
    expect(prompt).not.toContain('old note')
    rmSync(MEMORY_FILE)
    expect(memoryForPrompt()).toBe('Your memory is empty so far.')
  })

  test('the admin page shows it', async () => {
    const files = await read(handleMemory(request('GET', '/api/admin/memory', undefined, await asAdmin())))
    expect(files.find((f: { file: string }) => f.file === 'memory.md').text).toContain('Mochi')
  })
})
