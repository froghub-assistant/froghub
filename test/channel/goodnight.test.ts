import { beforeEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { runTool } from '../../channel/tools.ts'
import { routes } from '../../channel/app.ts'
import { CONFIG, read, request } from '../helpers.ts'

const handle = routes(async () => null)
const checkIn = (device: string, name: string) => read(handle(request('GET', `/api/announcements?after=0&device=${device}&name=${name}`)))
const latest = async (device = 'night1', name = 'Bedroom') => (await checkIn(device, name)).items.at(-1)
const bedroom = { id: 'night1', name: 'Bedroom', area: '', seen: Date.now() }

beforeEach(() => writeFileSync(join(CONFIG, 'policy.json'), '{}'))

describe('goodnight', () => {
  test('goes to the display that asked, with its own settings', async () => {
    const r = await runTool('goodnight', {}, { from: bedroom })
    expect(r?.text).toContain('Goodnight starts on Bedroom')
    expect(r?.text).toContain('its usual sleep sound')
    const a = await latest()
    expect(a.goodnight).toEqual({ lights: true })
    expect(a.to).toBe('night1')
    expect(a.at_night).toBe(true)
  })

  test('takes a sound and a time, kept within limits', async () => {
    await runTool('goodnight', { sound: 'Waves', minutes: 600 }, { from: bedroom })
    expect((await latest()).goodnight).toEqual({ lights: true, sound: 'waves', minutes: 180 })
    await runTool('goodnight', { sound: 'thunder', minutes: 1 }, { from: bedroom })
    expect((await latest()).goodnight).toEqual({ lights: true, minutes: 5 })
  })

  test("leaves out what the grown-ups turned off", async () => {
    writeFileSync(join(CONFIG, 'policy.json'), JSON.stringify({ devices: false, music: false }))
    const r = await runTool('goodnight', { sound: 'rain' }, { from: bedroom })
    expect(r?.text).toContain('no sound')
    expect(r?.text).not.toContain('lights')
    expect((await latest()).goodnight).toEqual({ lights: false, sound: 'none' })
  })

  test('needs a display when nobody asked', async () => {
    await checkIn('night2', 'Nursery')
    expect((await runTool('goodnight', {}, {}))?.isError).toBe(true)
    expect((await runTool('goodnight', { to: 'attic' }, {}))?.text).toContain('No display called "attic"')
    expect((await runTool('goodnight', { to: 'nursery' }, {}))?.text).toContain('on Nursery')
    expect((await latest('night2', 'Nursery')).to).toBe('night2')
    expect((await runTool('goodnight', { to: 'all' }, {}))?.text).toContain('every display')
    expect((await latest('night2', 'Nursery')).to).toBeUndefined()
  })

  test('from the server, with /local/announce', async () => {
    const r = await read(handle(request('POST', '/local/announce', { goodnight: true, sound: 'white noise', minutes: 30 })))
    expect(r.ok).toBe(true)
    const a = await latest()
    expect(a.goodnight).toEqual({ lights: true, sound: 'white noise', minutes: 30 })
    expect(a.at_night).toBe(true)
  })
})
