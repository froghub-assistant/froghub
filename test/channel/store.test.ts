import { beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { agentMemoryDir, instance } from '../../channel/instance.ts'
import { handleStore, isGrownUps, policy, POLICY_DEFAULTS, setGrownUps, sharedSettings } from '../../channel/store.ts'
import { asAdmin, CONFIG, read, removeConfig, request } from '../helpers.ts'

const AGENT_SETTINGS = join(instance.agentDir, 'settings.json')
const MEMORY = `/${agentMemoryDir}/**`
const SYSTEMCTL_LOG = join(homedir(), 'systemctl.log')

const agentSettings = () => JSON.parse(readFileSync(AGENT_SETTINGS, 'utf8')).permissions

beforeEach(() => {
  removeConfig('policy.json', 'shared-settings.json', 'shared-token', 'grown-up-displays.json')
  // The assistant's settings as setup writes them: web search and memory allowed
  mkdirSync(instance.agentDir, { recursive: true })
  writeFileSync(AGENT_SETTINGS, JSON.stringify({ permissions: { allow: ['mcp__froghub', 'WebSearch', `Read(${MEMORY})`, `Edit(${MEMORY})`], deny: [] } }))
  writeFileSync(SYSTEMCTL_LOG, '')
})

describe('policy', () => {
  test('everything is allowed until a grown-up changes it', async () => {
    expect(policy()).toEqual(POLICY_DEFAULTS)
    expect(await read(handleStore(request('GET', '/api/policy'), '/api/policy'))).toEqual(POLICY_DEFAULTS)
  })

  test('changing it needs admin mode', async () => {
    const res = await handleStore(request('POST', '/api/policy', { weather: false }), '/api/policy')
    expect(res.status).toBe(403)
    expect(policy().weather).toBe(true)
  })

  test('only known switches with true or false are taken', async () => {
    const body = await read(handleStore(request('POST', '/api/policy', { weather: false, music: 'no', rockets: true }, await asAdmin()), '/api/policy'))
    expect(body.policy).toEqual({ ...POLICY_DEFAULTS, weather: false })
    expect(body.restarting).toBe(false)
    expect(policy()).toEqual({ ...POLICY_DEFAULTS, weather: false })
  })

  test("web search and memory are switched in the assistant's settings, which restarts it", async () => {
    const body = await read(handleStore(request('POST', '/api/policy', { webSearch: false, memory: false }, await asAdmin()), '/api/policy'))
    expect(body.restarting).toBe(true)
    const { allow, deny } = agentSettings()
    expect(allow).toEqual(['mcp__froghub'])
    expect(deny.sort()).toEqual([`Edit(${MEMORY})`, `Read(${MEMORY})`, 'WebSearch'])
    await Bun.sleep(700) // it answers first and restarts half a second later
    expect(readFileSync(SYSTEMCTL_LOG, 'utf8')).toBe('--user restart froghub-agent\n')
  })

  test('switching them back on undoes it', async () => {
    const admin = await asAdmin()
    await handleStore(request('POST', '/api/policy', { webSearch: false }, admin), '/api/policy')
    await handleStore(request('POST', '/api/policy', { webSearch: true }, admin), '/api/policy')
    const { allow, deny } = agentSettings()
    expect(allow).toContain('WebSearch')
    expect(deny).not.toContain('WebSearch')
  })

  test("with the API brain (no Claude Code settings) switches are just saved", async () => {
    rmSync(AGENT_SETTINGS)
    const res = await handleStore(request('POST', '/api/policy', { webSearch: false }, await asAdmin()), '/api/policy')
    expect(res.status).toBe(200)
    expect(await read(res)).toMatchObject({ ok: true, restarting: false })
    expect(policy().webSearch).toBe(false)
  })
})

describe('shared settings', () => {
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.e30.abcdefghijklmnop'

  test('only the synced settings are published', async () => {
    const saved = await read(handleStore(request('POST', '/api/settings', {
      settings: { personality: 'verity', nightStart: 20, haUrl: 'http://ha.test:8123', area: 'kitchen', name: 'Sam', token: 'sneaky' },
    }, await asAdmin()), '/api/settings'))
    expect(saved.settings).toEqual({ personality: 'verity', nightStart: 20, haUrl: 'http://ha.test:8123' })
    expect(sharedSettings()).toEqual(saved.settings)
  })

  test('publishing them needs admin mode', async () => {
    expect((await handleStore(request('POST', '/api/settings', { settings: { personality: 'verity' } }), '/api/settings')).status).toBe(403)
    expect(sharedSettings()).toEqual({})
  })

  test('the HA token is kept in its own private file and only handed to admin mode', async () => {
    const admin = await asAdmin()
    await handleStore(request('POST', '/api/settings', { settings: {}, token: ` ${TOKEN} ` }, admin), '/api/settings')
    const file = join(CONFIG, 'shared-token')
    expect(readFileSync(file, 'utf8')).toBe(TOKEN)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(await read(handleStore(request('GET', '/api/settings'), '/api/settings'))).not.toHaveProperty('token')
    expect((await read(handleStore(request('GET', '/api/settings', undefined, admin), '/api/settings'))).token).toBe(TOKEN)
  })

  test("something that doesn't look like a token isn't saved", async () => {
    await handleStore(request('POST', '/api/settings', { settings: {}, token: 'short' }, await asAdmin()), '/api/settings')
    await handleStore(request('POST', '/api/settings', { settings: {}, token: `${TOKEN} ; rm -rf /` }, await asAdmin()), '/api/settings')
    expect(existsSync(join(CONFIG, 'shared-token'))).toBe(false)
  })

  test('nothing published yet', async () => {
    expect(await read(handleStore(request('GET', '/api/settings'), '/api/settings'))).toEqual({ settings: null, updated: 0 })
  })
})

describe('grown-ups displays', () => {
  test("displays are kids' ones unless marked", () => {
    expect(isGrownUps('abcd1234')).toBe(false)
    expect(setGrownUps('abcd1234', true)).toBe(true)
    expect(isGrownUps('abcd1234')).toBe(true)
    expect(setGrownUps('abcd1234', false)).toBe(false)
    expect(isGrownUps('abcd1234')).toBe(false)
  })

  test("ids that don't look like a display's are never grown-ups", () => {
    expect(setGrownUps('../../etc', true)).toBe(false)
    expect(setGrownUps('AB', true)).toBe(false)
    expect(isGrownUps(undefined)).toBe(false)
    expect(isGrownUps(['abcd1234'])).toBe(false)
  })

  test('marking one needs admin mode', async () => {
    const mark = { device: 'kitchen01', grownUps: true }
    expect((await handleStore(request('POST', '/api/audience', mark), '/api/audience')).status).toBe(403)
    expect(await read(handleStore(request('POST', '/api/audience', mark, await asAdmin()), '/api/audience'))).toEqual({ grownUps: true })
    expect(await read(handleStore(request('GET', '/api/audience?device=kitchen01'), '/api/audience'))).toEqual({ grownUps: true })
    expect((await handleStore(request('POST', '/api/audience', { grownUps: true }, await asAdmin()), '/api/audience')).status).toBe(400)
  })
})

test('unknown routes and methods are not found', async () => {
  expect((await handleStore(request('PUT', '/api/policy', {}), '/api/policy')).status).toBe(404)
  expect((await handleStore(request('POST', '/api/nothing', {}, await asAdmin()), '/api/nothing')).status).toBe(404)
})
