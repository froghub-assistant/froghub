import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { LISTS_FILE, handleLists, pickList, runLists } from '../../channel/lists.ts'
import { asAdmin, CONFIG, read, request } from '../helpers.ts'

type Call = { url: string; body: any }
const calls: Call[] = []
let shopping: { summary: string; uid: string }[] = []
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
  if (url.endsWith('/api/states')) {
    return Response.json([
      { entity_id: 'todo.shopping_list', state: String(shopping.length), attributes: { friendly_name: 'Shopping list' } },
      { entity_id: 'todo.someone_s_to_do', state: '4', attributes: { friendly_name: "Someone's To-do list" } },
      { entity_id: 'light.lamp', state: 'on', attributes: {} },
    ])
  }
  if (url.includes('get_items')) return Response.json({ service_response: { 'todo.shopping_list': { items: shopping } } })
  return Response.json([])
}) as typeof fetch)
afterAll(() => fetchSpy.mockRestore())
beforeEach(() => {
  calls.length = 0
  shopping = [{ summary: 'Milk', uid: 'u1' }, { summary: 'Brown bread', uid: 'u2' }]
  rmSync(LISTS_FILE, { force: true })
  writeFileSync(join(CONFIG, 'shared-token'), 'ha-token-for-the-tests-0123456789')
  writeFileSync(join(CONFIG, 'shared-settings.json'), JSON.stringify({ settings: { haUrl: 'https://ha.test/' }, updated: 1 }))
})

const services = () => calls.filter(c => c.url.includes('/api/services/todo/') && !c.url.includes('get_items'))

describe('the lists', () => {
  test("only Home Assistant's own Shopping list until a grown-up shares others", async () => {
    expect(await runLists({ action: 'show' })).toBe('Shopping list (2):\n- Milk\n- Brown bread')
    expect(calls[0]).toEqual({ url: 'https://ha.test/api/states', body: undefined })
    await expect(runLists({ action: 'show', list: 'to-do' })).rejects.toThrow('There\'s no list called "to-do". There are: Shopping list.')
  })

  test('adds, ticks off and removes, by name or part of it', async () => {
    expect(await runLists({ action: 'add', list: 'shopping', items: ['eggs', ' ', 'jam'] })).toBe('Added to Shopping list: eggs, jam.')
    expect(await runLists({ action: 'tick', items: ['bread', 'cheese'] })).toBe('Ticked off Shopping list: Brown bread. Not on Shopping list: cheese.')
    expect(await runLists({ action: 'remove', items: ['MILK'] })).toBe('Removed from Shopping list: Milk.')
    expect(services().map(c => [c.url.split('/todo/')[1], c.body])).toEqual([
      ['add_item', { entity_id: 'todo.shopping_list', item: 'eggs' }],
      ['add_item', { entity_id: 'todo.shopping_list', item: 'jam' }],
      ['update_item', { entity_id: 'todo.shopping_list', item: 'u2', status: 'completed' }],
      ['remove_item', { entity_id: 'todo.shopping_list', item: 'u1' }],
    ])
  })

  test('picking a list: the only one, by its words, or asking which', () => {
    const lists = [{ id: 'todo.a', name: 'Shopping list', items: 0 }, { id: 'todo.b', name: 'To-do list', items: 0 }]
    expect(pickList(lists.slice(0, 1), '').id).toBe('todo.a')
    expect(pickList(lists, 'to do').id).toBe('todo.b')
    expect(() => pickList(lists, '')).toThrow('Which list? There are: Shopping list, To-do list.')
    expect(() => pickList([], '')).toThrow('No lists are shared')
  })

  test('without Home Assistant there are none', async () => {
    rmSync(join(CONFIG, 'shared-token'))
    await expect(runLists({ action: 'show' })).rejects.toThrow("isn't connected to Home Assistant")
  })

  test('grown-ups choose which lists it may use on the admin page', async () => {
    expect((await handleLists(request('GET', '/api/admin/lists'))).status).toBe(403)
    const { lists } = await read(handleLists(request('POST', '/api/admin/lists', { allowed: ['todo.someone_s_to_do', 'light.lamp'] }, await asAdmin())))
    expect(lists).toEqual([
      { id: 'todo.shopping_list', name: 'Shopping list', items: 2, allowed: false },
      { id: 'todo.someone_s_to_do', name: "Someone's To-do list", items: 4, allowed: true },
    ])
    await expect(runLists({ action: 'show', list: 'shopping' })).rejects.toThrow('There\'s no list called "shopping"')
  })

  test('off with the lists switch', async () => {
    const { runTool } = await import('../../channel/tools.ts')
    writeFileSync(join(CONFIG, 'policy.json'), JSON.stringify({ lists: false }))
    expect((await runTool('lists', { action: 'show' }, {}))?.isError).toBe(true)
    writeFileSync(join(CONFIG, 'policy.json'), '{}')
  })
})
