import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { cleanDisplay } from '../../channel/display.ts'

const RED_PANDA = 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Red_Panda.jpg/330px-Red_Panda.jpg'

/** Wikipedia's page summary API, answering with `page` for any title. */
function wikipedia(page: unknown, status = 200) {
  return spyOn(globalThis, 'fetch').mockImplementation((async () => Response.json(page, { status })) as unknown as typeof fetch)
}

afterEach(() => {
  ;(globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.()
})

describe('show_on_screen cards', () => {
  test('shown for 30 seconds unless asked, between 5 and 300', async () => {
    expect((await cleanDisplay({ title: 'Hi' })).seconds).toBe(30)
    expect((await cleanDisplay({ title: 'Hi', seconds: 2 })).seconds).toBe(5)
    expect((await cleanDisplay({ title: 'Hi', seconds: 9999 })).seconds).toBe(300)
    expect((await cleanDisplay({ title: 'Hi', seconds: 12.6 })).seconds).toBe(13)
  })

  test('text is flattened to one line and cut to length', async () => {
    const d = await cleanDisplay({ title: 'T'.repeat(80), text: 'one\ntwo\r\n\nthree', emoji: '🐸', ignored: 'yes' })
    expect(d).toEqual({ title: 'T'.repeat(60), text: 'one two three', emoji: '🐸', seconds: 30 })
  })

  test('up to 30 list items of up to 300 characters, without empty ones', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `step ${i + 1}`)
    const d = await cleanDisplay({ items: ['a', '', 7, 'x'.repeat(400), ...many] })
    expect(d.items).toEqual(['a', 'x'.repeat(300), ...many.slice(0, 28)])
  })

  test('an empty card is refused', async () => {
    await expect(cleanDisplay({ title: '  ', items: [] })).rejects.toThrow('Nothing to show.')
  })

  test('pictures only from Wikimedia', async () => {
    expect((await cleanDisplay({ image_url: RED_PANDA })).image).toBe(RED_PANDA)
    for (const url of ['https://example.com/cat.jpg', 'http://upload.wikimedia.org/x.jpg', 'https://upload.wikimedia.org.evil.com/x.jpg', `${RED_PANDA}" onerror="x`]) {
      await expect(cleanDisplay({ image_url: url })).rejects.toThrow('Pictures must be upload.wikimedia.org')
    }
  })

  test("picture_of uses the Wikipedia article's lead picture", async () => {
    const fetched = wikipedia({ type: 'standard', thumbnail: { source: RED_PANDA } })
    expect((await cleanDisplay({ picture_of: 'Red panda' })).image).toBe(RED_PANDA)
    expect(String(fetched.mock.calls[0][0])).toBe('https://en.wikipedia.org/api/rest_v1/page/summary/Red_panda?redirect=true')
  })

  test('picture_of with no picture, a disambiguation page or no article is an error the assistant can act on', async () => {
    wikipedia({ type: 'standard' })
    await expect(cleanDisplay({ picture_of: 'Nothing' })).rejects.toThrow('Wikipedia has no picture for "Nothing"')
    wikipedia({ type: 'disambiguation', thumbnail: { source: RED_PANDA } })
    await expect(cleanDisplay({ picture_of: 'Mercury' })).rejects.toThrow('Wikipedia has no picture')
    wikipedia({}, 404)
    await expect(cleanDisplay({ picture_of: 'Zzzzz' })).rejects.toThrow('Wikipedia has no picture')
  })
})
