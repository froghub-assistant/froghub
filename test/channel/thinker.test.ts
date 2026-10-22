import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { bigModel, thinkHarder } from '../../channel/thinker.ts'

// A pretend `claude` first on the PATH: it writes down its arguments and answers (or fails, or dawdles)
const bin = mkdtempSync(join(tmpdir(), 'froghub-claude-'))
writeFileSync(join(bin, 'claude'), `#!/bin/sh
printf '%s\\n' "$@" > "${bin}/args"
case "$*" in
*dawdle*) sleep 5 ;;
*fail*) echo "rate limited" >&2; exit 1 ;;
esac
echo "It's 391: 17 × 20 is 340, plus 17 × 3 is 51."
`)
chmodSync(join(bin, 'claude'), 0o755)
const PATH = process.env.PATH
process.env.PATH = `${bin}:${PATH}`
afterAll(() => {
  process.env.PATH = PATH
  rmSync(bin, { recursive: true, force: true })
})

describe('thinkHarder', () => {
  test("asks a locked-down one-shot claude and returns its answer", async () => {
    expect(await thinkHarder('What is 17 × 23?', 'sonnet')).toBe("It's 391: 17 × 20 is 340, plus 17 × 3 is 51.")
    const args = readFileSync(join(bin, 'args'), 'utf8').split('\n')
    expect(args.slice(0, 3)).toEqual(['-p', '--model', 'sonnet'])
    for (const flag of ['--restricted', '--strict-mcp-config', '--no-session-persistence']) expect(args).toContain(flag)
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args.at(-2)).toBe('What is 17 × 23?')
  })

  test('a failure says to answer yourself', async () => {
    expect(thinkHarder('please fail', 'sonnet')).rejects.toThrow('The bigger model failed (rate limited); answer it yourself.')
  })

  test('gives up after the time limit', async () => {
    expect(thinkHarder('dawdle', 'sonnet', 300)).rejects.toThrow('took longer than 0.3 seconds')
  })
})

describe('bigModel', () => {
  test('"none" turns it off; empty means the default', () => {
    process.env.FROGHUB_BIG_MODEL = 'none'
    expect(bigModel('sonnet')).toBe('')
    process.env.FROGHUB_BIG_MODEL = ''
    expect(bigModel('sonnet')).toBe('sonnet')
    process.env.FROGHUB_BIG_MODEL = 'opus'
    expect(bigModel('sonnet')).toBe('opus')
    delete process.env.FROGHUB_BIG_MODEL
  })
})
