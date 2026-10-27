import { afterAll, describe, expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// instance.ts reads instance.json as it's imported, so write it first (and nothing here may import it before then:
// ../helpers.ts does, through common.ts).
const FILE = join(homedir(), '.config', 'froghub', 'instance.json')
writeFileSync(FILE, JSON.stringify({ site: 'https://hub.example.com', kids: ['Sam'], agentDir: '/srv/frog.hub agent', webRoot: '/var/www/x' }))
const { agentMemoryDir, handleInstance, houseTime, instance } = await import('../../channel/instance.ts')
afterAll(() => rmSync(FILE))

describe('instance', () => {
  test('instance.json over the defaults', () => {
    expect(instance).toMatchObject({ site: 'https://hub.example.com', haUrl: '', timeZone: 'Europe/London', kids: ['Sam'], agentDir: '/srv/frog.hub agent' })
  })

  test("the assistant's memory is where Claude Code keeps that folder's", () => {
    expect(agentMemoryDir).toBe(join(homedir(), '.claude', 'projects', '-srv-frog-hub-agent', 'memory'))
  })

  test("the displays get the public part, not the server's folders", async () => {
    expect(await handleInstance().json()).toEqual({ site: 'https://hub.example.com', haUrl: '', timeZone: 'Europe/London', kids: ['Sam'], musicAssistant: false })
  })

  test("times are in the house's time zone", () => {
    const summer = Date.UTC(2026, 9, 21, 17, 5) // 18:05 BST
    expect(houseTime(summer)).toBe('Wednesday 21 October at 18:05')
    expect(houseTime(Date.UTC(2026, 11, 25, 7, 0), { hour: '2-digit', minute: '2-digit' })).toBe('07:00')
  })
})
