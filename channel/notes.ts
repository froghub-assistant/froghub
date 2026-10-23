/**
 * The API brain's memory: one markdown list in ~/.config/froghub/memory.md (the Claude Code brain keeps its own memory
 * files instead). The whole list goes into every prompt, so the assistant can see what it knows, and its tools add,
 * change and forget lines. The admin page shows it (memory.ts).
 *
 * Environment:
 *   FROGHUB_MEMORY  the file (default ~/.config/froghub/memory.md)
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { clean } from './common.ts'
import type { Tool } from './tools.ts'

export const MEMORY_FILE = process.env.FROGHUB_MEMORY || join(homedir(), '.config', 'froghub', 'memory.md')
export const MAX_MEMORY_CHARS = 6000

export const memoryTools: Tool[] = [
  {
    name: 'remember',
    description: 'Save a short note to your long-term memory (things people ask you to remember, preferences).',
    inputSchema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
  },
  {
    name: 'change_memory',
    description: 'Change a note in your memory: the one containing `old` becomes `note`.',
    inputSchema: {
      type: 'object',
      properties: { old: { type: 'string', description: 'Part of the note as it is now' }, note: { type: 'string', description: 'The note as it should be' } },
      required: ['old', 'note'],
    },
  },
  {
    name: 'forget',
    description: 'Remove notes from your memory: each one containing `text` (when asked to forget something, or to tidy up).',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Part of the note(s) to remove' } }, required: ['text'] },
  },
]

const lines = () => (existsSync(MEMORY_FILE) ? readFileSync(MEMORY_FILE, 'utf8').split('\n').filter(l => l.trim()) : [])
const save = (notes: string[]) => writeFileSync(MEMORY_FILE, notes.length ? notes.join('\n') + '\n' : '')

/** Runs one of the tools above; returns the text for the assistant (throws on bad input). */
export function runMemoryTool(name: string, args: Record<string, unknown>): string {
  if (name === 'remember') {
    const note = clean(args.note, 300)
    if (!note) throw new Error('Nothing to remember.')
    appendFileSync(MEMORY_FILE, `- ${note}\n`)
    return 'Remembered.'
  }
  const notes = lines()
  const find = clean(name === 'forget' ? args.text : args.old, 300).toLowerCase()
  if (!find) throw new Error('Say which note.')
  const matching = notes.filter(l => l.toLowerCase().includes(find))
  if (!matching.length) throw new Error(`No note contains "${find}".`)
  if (name === 'forget') {
    if (matching.length > 5) throw new Error(`${matching.length} notes contain "${find}"; be more specific.`)
    save(notes.filter(l => !matching.includes(l)))
    return `Forgot: ${matching.map(l => l.replace(/^- /, '')).join(' | ')}`
  }
  if (name === 'change_memory') {
    const note = clean(args.note, 300)
    if (!note) throw new Error('Give the note as it should be.')
    if (matching.length > 1) throw new Error(`${matching.length} notes contain "${find}"; be more specific.`)
    save(notes.map(l => (l === matching[0] ? `- ${note}` : l)))
    return `Changed it to: ${note}`
  }
  throw new Error(`unknown tool: ${name}`)
}

/** The memory, for the system prompt: all of it, or the newest part with a nudge to tidy up when it's too long. */
export function memoryForPrompt(): string {
  const text = lines().join('\n')
  if (!text) return 'Your memory is empty so far.'
  if (text.length > MAX_MEMORY_CHARS) {
    return `## Your memory (too long: the oldest notes are hidden; merge or forget some)\n\n…${text.slice(-MAX_MEMORY_CHARS)}`
  }
  const full = text.length > MAX_MEMORY_CHARS * 0.8 ? ' (nearly full: merge or forget old notes when you can)' : ''
  return `## Your memory${full}\n\n${text}`
}
