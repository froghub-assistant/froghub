// Shared by the channel tests: requests, a test PIN and admin mode, and the files under the test HOME.
import { rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { adminValid, handleUnlock } from '../channel/common.ts'

export const CONFIG = join(homedir(), '.config', 'froghub')
export const PIN = '4821'

export function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://frog.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

export const read = async (res: Response | Promise<Response>) => (await res).json()

export async function setPin(): Promise<void> {
  writeFileSync(join(CONFIG, 'pin'), await Bun.password.hash(PIN))
}

let token = ''
/** Headers for admin mode, unlocking with the test PIN again whenever the last token has run out. */
export async function asAdmin(): Promise<Record<string, string>> {
  if (!adminValid(token)) {
    await setPin()
    token = (await read(handleUnlock(request('POST', '/api/unlock', { pin: PIN })))).token
  }
  return { 'x-admin-token': token }
}

export const removeConfig = (...files: string[]) => files.forEach(f => rmSync(join(CONFIG, f), { force: true }))
