#!/usr/bin/env bun
// Set or change Frog Hub's admin PIN (4-6 digits). Stores only a hash, in ~/.config/froghub/pin.
import { chmodSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const dir = join(homedir(), '.config', 'froghub')
const first = prompt('New admin PIN (4-6 digits):') ?? ''
const again = prompt('Same again:') ?? ''
if (!/^\d{4,6}$/.test(first)) {
  console.error('The PIN must be 4 to 6 digits.')
  process.exit(1)
}
if (first !== again) {
  console.error("The PINs didn't match.")
  process.exit(1)
}
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'pin'), await Bun.password.hash(first) + '\n')
chmodSync(join(dir, 'pin'), 0o600)
console.log('Admin PIN set. It works straight away; no restart needed.')
