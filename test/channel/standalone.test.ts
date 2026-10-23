import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { asAdmin, CONFIG } from '../helpers.ts'

// The API brain, with the Anthropic API and the local fallback server played by a pretend fetch. Each test sets what
// they answer; every request they got is kept for checking.
const PORT = 18790 + Math.floor(Math.random() * 1000)
Object.assign(process.env, {
  FROGHUB_PORT: String(PORT),
  ANTHROPIC_API_KEY: 'test-key',
  FROGHUB_MODEL: 'small-model',
  FROGHUB_BIG_MODEL: 'big-model',
  FROGHUB_FALLBACK_URL: 'http://fallback.test/v1/',
  FROGHUB_FALLBACK_MODEL: 'local-model',
  FROGHUB_SEARCH_URL: 'http://search.test',
  FROGHUB_FALLBACK_KEY: 'local-key',
})
const MEMORY = join(CONFIG, 'memory.md')
writeFileSync(join(CONFIG, 'assistant.md'), 'You are Frog Hub (test rules).')

type Body = { model: string; system?: string; messages: { role: string; content: unknown }[]; tools: { name: string }[] }
let claude: (body: Body) => Response = () => new Response('down', { status: 500 })
let fallback: (body: Body) => Response = () => new Response('down', { status: 500 })
const asked: { to: 'claude' | 'fallback'; body: Body; headers: Record<string, string> }[] = []
const searched: string[] = []

const realFetch = globalThis.fetch
spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith('http://search.test/search')) {
    searched.push(new URL(url).searchParams.get('q')!)
    return Response.json({ results: [{ title: 'Red panda', url: 'https://en.wikipedia.org/wiki/Red_panda', content: 'Lives 8 to 10 years.' }] })
  }
  if (url === 'https://api.anthropic.com/v1/messages' || url === 'http://fallback.test/v1/chat/completions') {
    const to = url.includes('anthropic') ? 'claude' : 'fallback'
    const body = JSON.parse(String(init?.body))
    asked.push({ to, body, headers: init?.headers as Record<string, string> })
    return (to === 'claude' ? claude : fallback)(body)
  }
  return realFetch(input, init)
}) as typeof fetch)
afterAll(() => (globalThis.fetch as unknown as { mockRestore(): void }).mockRestore())

await import('../../channel/standalone.ts')

const tool = (name: string, input: Record<string, unknown>, id = `t-${name}`) => ({ type: 'tool_use', id, name, input })
const says = (text: string, more: Record<string, unknown> = {}) => Response.json({ content: [tool('reply', { text, ...more })] })

async function ask(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const r = await realFetch(`http://127.0.0.1:${PORT}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: r.status, ...(await r.json()) }
}

beforeEach(() => {
  asked.length = 0
  claude = () => new Response('down', { status: 500 })
  fallback = () => new Response('down', { status: 500 })
  rmSync(MEMORY, { force: true })
})

describe('answering', () => {
  test('the reply tool becomes the answer', async () => {
    claude = () => says('Ribbit! It is sunny.', { continue_conversation: true })
    const a = await ask({ text: 'Is it sunny?', personality: 'frog', speaker: 'Sam', conversation_id: 'c1' })
    expect(a).toMatchObject({ text: 'Ribbit! It is sunny.', continue_conversation: true, actions: [] })
    const { body } = asked[0]
    expect(body.model).toBe('small-model')
    expect(body.system).toContain('You are Frog Hub (test rules).')
    expect(body.system).toContain('the "frog" personality, talking to Sam')
    expect(body.system).toContain('not in admin mode')
    expect(body.messages).toEqual([{ role: 'user', content: 'Is it sunny?' }])
  })

  test("the room's devices go with the question, and admin mode is passed on", async () => {
    claude = () => says('Done.')
    await ask({ text: 'Lights on', devices: [{ id: 'light.kitchen', name: 'Kitchen light', state: 'off' }], conversation_id: 'c2' },
      await asAdmin())
    const { body } = asked[0]
    expect(String(body.messages[0].content)).toStartWith('Lights on\n\n[Room devices: ')
    expect(String(body.messages[0].content)).toContain('light.kitchen')
    expect(body.system).toContain('This request is in admin mode')
  })

  test('keeps the last six exchanges of a conversation, and conversations apart', async () => {
    let n = 0
    claude = () => says(`answer ${++n}`)
    for (let i = 1; i <= 8; i++) await ask({ text: `question ${i}`, conversation_id: 'long' })
    const last = asked.at(-1)!.body.messages
    expect(last).toHaveLength(13) // six exchanges, then the new question
    expect(last[0]).toEqual({ role: 'user', content: 'question 2' })
    expect(last.at(-1)).toEqual({ role: 'user', content: 'question 8' })
    await ask({ text: 'hello', conversation_id: 'other' })
    expect(asked.at(-1)!.body.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  test('remember writes to its memory, then it is asked again for the reply', async () => {
    let round = 0
    claude = () => (++round === 1 ? Response.json({ content: [tool('remember', { note: 'Sam likes red pandas' })] }) : says('I will remember that.'))
    const a = await ask({ text: 'Remember I like red pandas', conversation_id: 'c3' })
    expect(a.text).toBe('I will remember that.')
    expect(readFileSync(MEMORY, 'utf8')).toBe('- Sam likes red pandas\n')
    expect(asked[1].body.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-remember', content: 'Remembered.' }] })
  })

  test('what it remembers is in the next system prompt', async () => {
    writeFileSync(MEMORY, '- The cat is called Mochi\n')
    claude = () => says('Mochi!')
    await ask({ text: "What's the cat called?", conversation_id: 'c4' })
    expect(asked[0].body.system).toContain('## Your memory\n\n- The cat is called Mochi')
  })
})

describe('thinking harder', () => {
  test('the small model can hand the question to the big one, which answers', async () => {
    claude = body => body.model === 'small-model'
      ? Response.json({ content: [tool('think_harder', { why: 'long division' })] })
      : says('It is 391, because 17 times 20 is 340 and 17 times 3 is 51.')
    const a = await ask({ text: 'What is 17 times 23?', conversation_id: 'c5' })
    expect(a.text).toBe('It is 391, because 17 times 20 is 340 and 17 times 3 is 51.')
    expect(asked.map(x => x.body.model)).toEqual(['small-model', 'big-model'])
    expect(asked[0].body.tools.map(t => t.name)).toContain('think_harder')
    expect(asked[1].body.tools.map(t => t.name)).not.toContain('think_harder') // no handing it on again
    expect(asked[1].body.messages).toEqual([{ role: 'user', content: 'What is 17 times 23?' }])
  })
})

describe('when Claude fails', () => {
  test('the local model answers instead', async () => {
    fallback = () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'reply', arguments: '{"text":"Local frog here."}' } }] } }] })
    const a = await ask({ text: 'Hello', conversation_id: 'c6' })
    expect(a.text).toBe('Local frog here.')
    expect(asked.map(x => x.to)).toEqual(['claude', 'fallback'])
    const { body } = asked[1]
    expect(body.model).toBe('local-model')
    expect(asked[1].headers.authorization).toBe('Bearer local-key')
    expect(body).toMatchObject({ max_tokens: 600 })
    expect(body.messages[0]).toMatchObject({ role: 'system' })
  })

  test('the local model can search the web and remember, then reply', async () => {
    let round = 0
    fallback = () => Response.json({ choices: [{ message: ++round === 1
      ? { content: null, tool_calls: [
          { id: 'c1', function: { name: 'web_search', arguments: '{"query":"red panda lifespan"}' } },
          { id: 'c2', function: { name: 'remember', arguments: '{"note":"Sam asked about red pandas"}' } },
        ] }
      : { tool_calls: [{ id: 'c3', function: { name: 'reply', arguments: '{"text":"About 8 to 10 years."}' } }] } }] })
    const a = await ask({ text: 'How long do red pandas live?', conversation_id: 'c6b' })
    expect(a.text).toBe('About 8 to 10 years.')
    expect(searched).toEqual(['red panda lifespan'])
    expect(readFileSync(MEMORY, 'utf8')).toBe('- Sam asked about red pandas\n')
    const second = asked.filter(x => x.to === 'fallback')[1].body.messages
    expect(second.slice(-2)).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: '1. Red panda\nhttps://en.wikipedia.org/wiki/Red_panda\nLives 8 to 10 years.' },
      { role: 'tool', tool_call_id: 'c2', content: 'Remembered.' },
    ])
    const names = asked.find(x => x.to === 'fallback')!.body.tools.map((t: any) => t.function.name)
    expect(names.slice(0, 5)).toEqual(['reply', 'remember', 'change_memory', 'forget', 'web_search'])
    expect(names).toEqual(expect.arrayContaining(['get_weather', 'find_recipe', 'set_alarm', 'show_on_screen', 'announce', 'schedule']))
  })

  test('a local model that just talks (no tool call) still counts', async () => {
    fallback = () => Response.json({ choices: [{ message: { content: '  Just words.  ' } }] })
    expect((await ask({ text: 'Hello', conversation_id: 'c7' })).text).toBe('Just words.')
  })

  test('nothing answering says so, without an error', async () => {
    const a = await ask({ text: 'Hello', conversation_id: 'c8' })
    expect(a).toMatchObject({ status: 200, text: '', timed_out: true })
  })
})

describe('the shared tools', () => {
  test('it can use them (an alarm here), and gets their results before replying', async () => {
    let round = 0
    claude = () => (++round === 1 ? Response.json({ content: [tool('set_timer', { minutes: 10, label: 'Cookies' })] }) : says('Timer set.'))
    expect((await ask({ text: 'Ten minute timer for the cookies', conversation_id: 't1' })).text).toBe('Timer set.')
    const result = (asked[1].body.messages.at(-1)!.content as { content: string }[])[0]
    expect(result.content).toMatch(/^Set \w{4}: timer "Cookies"/)
    expect(JSON.parse(readFileSync(join(CONFIG, 'alarms.json'), 'utf8'))[0]).toMatchObject({ label: 'Cookies' })
    expect(asked[0].body.tools.map(t => t.name)).toEqual(expect.arrayContaining(['get_weather', 'find_recipe', 'show_on_screen', 'announce', 'schedule', 'send_message']))
  })

  test("show_on_screen's card goes with the reply in the same turn", async () => {
    claude = () => Response.json({ content: [tool('show_on_screen', { title: 'Red panda', emoji: '🐼' }), tool('reply', { text: 'Here it is.' })] })
    expect(await ask({ text: 'Show me a red panda', conversation_id: 't2' })).toMatchObject({ text: 'Here it is.', display: { title: 'Red panda', emoji: '🐼' } })
  })

  test("what a grown-up turned off isn't offered, and a tool says so if called anyway", async () => {
    writeFileSync(join(CONFIG, 'policy.json'), JSON.stringify({ webSearch: false, memory: false, weather: false }))
    let round = 0
    claude = () => (++round === 1 ? Response.json({ content: [tool('get_weather', {})] }) : says('I can\'t check the weather.'))
    await ask({ text: 'Weather?', conversation_id: 't3' })
    rmSync(join(CONFIG, 'policy.json'))
    const names = asked[0].body.tools.map(t => t.name)
    expect(names).not.toContain('remember')
    expect(names).not.toContain('web_search')
    expect(asked[1].body.messages.at(-1)!.content).toEqual([{ type: 'tool_result', tool_use_id: 't-get_weather', content: "A grown-up has turned off the weather in Frog Hub's settings.", is_error: true }])
  })

  test('an announcement is asked as one, without the conversation', async () => {
    claude = () => says('Tea is ready, everyone!')
    const r = await realFetch(`http://127.0.0.1:${PORT}/local/announce`, { method: 'POST', body: JSON.stringify({ prompt: 'Say tea is ready' }) })
    expect(await r.json()).toMatchObject({ ok: true, text: 'Tea is ready, everyone!' })
    expect(asked[0].body.system).toContain('a grown-up at home wants you to tell the room something unprompted')
    expect(asked[0].body.messages).toEqual([{ role: 'user', content: 'Say tea is ready' }])
  })

  test("the display's other routes are there too (alarms here)", async () => {
    expect((await realFetch(`http://127.0.0.1:${PORT}/api/alarms`)).status).toBe(200)
  })
})

describe('bad requests', () => {
  test('no text, or not JSON', async () => {
    expect((await ask({ text: '   ' })).status).toBe(400)
    const r = await realFetch(`http://127.0.0.1:${PORT}/api/ask`, { method: 'POST', body: 'not json' })
    expect(r.status).toBe(400)
  })

  test('ping says which model it is', async () => {
    expect(await (await realFetch(`http://127.0.0.1:${PORT}/api/ping`)).json()).toEqual({ ok: true, brain: 'small-model' })
    expect(existsSync(MEMORY)).toBe(false)
  })
})
