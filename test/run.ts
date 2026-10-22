/**
 * `bun run test`: runs the unit tests with HOME in a throwaway folder, since the channel server keeps its files in
 * ~/.config/froghub and reads them as soon as it's imported. A fake `systemctl` goes first on the PATH, so nothing a
 * test does can restart the real assistant. Arguments are passed on to `bun test` (e.g. a file name or --watch).
 */
import { spawnSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'

const root = mkdtempSync(join(tmpdir(), 'froghub-test-'))
const home = join(root, 'home')
const bin = join(root, 'bin')
mkdirSync(join(home, '.config', 'froghub'), { recursive: true })
mkdirSync(bin)
writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\necho "$*" >> "$HOME/systemctl.log"\n')
chmodSync(join(bin, 'systemctl'), 0o755)

// --isolate: each file gets fresh modules (the channel keeps state in them: admin tokens, the announcement queue, ...)
const result = spawnSync(process.execPath, ['test', '--isolate', ...process.argv.slice(2)], {
  cwd: resolve(dirname(import.meta.path), '..'),
  stdio: 'inherit',
  env: { ...process.env, HOME: home, FROGHUB_TEST_HOME: home, PATH: `${bin}:${process.env.PATH}`, TZ: 'Europe/London' },
})
rmSync(root, { recursive: true, force: true })
process.exit(result.status ?? 1)
