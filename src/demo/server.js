// The demo's pretend Frog Hub server: fetch('/api/…') is answered here, in the browser, so the display runs with no
// server. The "assistant" is a handful of canned answers, enough to show what the real one does.

const queue = [] // announcements: the goodnight routine, sleep sounds
let lastId = 0
let alarms = []
const push = (a) => queue.push({ id: ++lastId, text: '', at_night: true, ...a })

const JOKES = [
  "Why don't frogs ever park? They're always afraid of getting toad!",
  'What do frogs order at a café? French flies and a large croak!',
  'Why was the frog so happy? He ate whatever bugged him!',
  "What's a frog's favourite game? Croaket!",
]
const FACTS = [
  'Frogs drink through their skin, so they never need a cup.',
  'A group of frogs is called an army.',
  'Some frogs can freeze solid in winter and hop away again in spring.',
  'Glass frogs have see-through tummies: you can see their hearts beating.',
]
const pick = (list) => list[Math.floor(Math.random() * list.length)]
const reply = (text, more = {}) => ({ text, continue_conversation: false, actions: [], ...more })
const card = (emoji, title, text, more = {}) => ({ display: { emoji, title, text, seconds: 30, ...more } })

function sum(t) {
  const m = t.match(/(-?\d+(?:\.\d+)?)\s*(plus|\+|minus|-|times|x|×|\*|multiplied by|divided by|\/|÷)\s*(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const [a, b] = [Number(m[1]), Number(m[3])]
  const op = m[2]
  if (/divided|\/|÷/.test(op) && b === 0) return "You can't divide by zero. Not even frogs can!"
  const answer = /plus|\+/.test(op) ? a + b : /minus|-/.test(op) ? a - b : /divided|\/|÷/.test(op) ? a / b : a * b
  return `${m[1]} ${op.replace('*', 'times').replace('x', 'times')} ${m[3]} is ${Math.round(answer * 1000) / 1000}.`
}

function answer(text, devices = []) {
  const t = text.toLowerCase().replace(/[?!.,]/g, '').trim()
  const lights = devices.filter((d) => d.id.startsWith('light.'))
  let m
  if (/good ?night|night night|going to bed|go to sleep|bedtime/.test(t)) {
    push({ goodnight: { lights: true } })
    return reply("Night night! Sleep tight. I'll turn the lights down and play some rain for you.")
  }
  if (/story/.test(t)) {
    return reply('Once upon a time, a little frog called Pip found a lily pad shaped like the moon. Every night she ' +
      'hopped onto it, and it carried her gently across the pond while the fireflies sang. And when the sun came up, ' +
      'Pip was home again, warm and sleepy. The end.')
  }
  if ((m = t.match(/(\d+|a|one)\s*(second|minute)/)) && /timer|remind|alarm/.test(t)) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1
    const ms = n * (m[2] === 'second' ? 1000 : 60000)
    alarms.push({ id: `t${Date.now()}`, label: `${n} ${m[2]}${n === 1 ? '' : 's'}`, timer: true, next: Date.now() + ms })
    return reply(`Okay, a ${n} ${m[2]} timer. Starting now!`)
  }
  if (/weather|rain(ing)? (today|later)|cold|coat|umbrella|sunny/.test(t)) {
    return reply("It's 14 degrees and partly cloudy. It might rain after four, so take a coat!",
      card('⛅', 'Today', '14°C and partly cloudy. Highs of 16°C, light rain after 4pm.'))
  }
  if (/(rain|wave|sea|ocean|white noise|sleep) ?(sound|noise)s?|play (some )?(rain|waves|white noise)/.test(t)) {
    const noise = /wave|sea|ocean/.test(t) ? 'waves' : /white/.test(t) ? 'white noise' : 'rain'
    push({ audio: { noise } })
    return reply(`Here's some ${noise === 'waves' ? 'sea' : noise}. Tap the stop button to end it.`)
  }
  if (/joke|funny/.test(t)) return reply(pick(JOKES))
  if (/fact|frog/.test(t)) {
    const fact = pick(FACTS)
    return reply(fact, card('🐸', 'Frog fact', fact))
  }
  if ((m = sum(t))) return reply(m)
  if ((m = t.match(/^(?:turn|switch) (on|off) (?:the |all the )?lights?$|^(?:turn|switch) (?:the |all the )?lights? (on|off)$/))) {
    const on = (m[1] || m[2]) === 'on'
    return reply(on ? 'Lights on!' : 'Lights off!', { actions: lights.map((d) => ({ entity_id: d.id, service: on ? 'turn_on' : 'turn_off' })) })
  }
  if ((m = t.match(/(?:dim|set) (?:the )?(lamp|lights?) (?:to )?(\d{1,3})(?: percent| %)?/))) {
    const which = lights.filter((d) => m[1] !== 'lamp' || /lamp/i.test(d.name))
    return reply(`${m[1] === 'lamp' ? 'Lamp' : 'Lights'} at ${m[2]} percent.`, {
      actions: which.map((d) => ({ entity_id: d.id, service: 'brightness', value: Number(m[2]) })),
    })
  }
  if (/^play |music|song/.test(t)) {
    return reply("At home I'd play that on a speaker in the room. This pretend bedroom hasn't got one, but I can play rain or the sea!")
  }
  if (/spell (\w+)/.test(t)) {
    const word = t.match(/spell (\w+)/)[1]
    return reply(`${word}: ${word.toUpperCase().split('').join(', ')}.`, card('🔤', word, '', { items: [word.toUpperCase().split('').join(' ')] }))
  }
  if (/who are you|your name|what are you/.test(t)) return reply("I'm Frog Hub! A smart display that lives on a tablet and helps around the house.")
  if (/hello|^hi\b|hey/.test(t)) return reply('Hello! Ribbit!')
  return reply("I'm only the demo, so I know a few tricks. Try a joke, a timer, the weather, the lights, or saying goodnight!",
    card('🐸', 'Things to try', '', { items: ['Tell me a joke', 'Set a timer for 10 seconds', "What's the weather?", 'Turn off the lights', 'What is 7 times 8?', 'Tell me a story', 'Goodnight'] }))
}

async function route(path, method, body, query) {
  if (path === '/api/instance') return { site: location.host, haUrl: 'demo', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, kids: ['Sam'] }
  if (path === '/api/settings') return { settings: {}, updated: 0 }
  if (path === '/api/policy') return method === 'POST' ? { ok: true } : {}
  if (path === '/api/announcements') return { latest: lastId, items: queue.filter((a) => a.id > Number(query.get('after'))) }
  if (path === '/api/displays') return [{ id: 'kitchen', name: 'Kitchen' }]
  if (path === '/api/announce') return { ok: true, to: 'Kitchen' }
  if (path === '/api/alarms') return { now: Date.now(), alarms }
  if (path === '/api/alarms/done' || path === '/api/alarms/snooze') {
    alarms = alarms.filter((a) => a.id !== body.id)
    return { ok: true }
  }
  if (path === '/api/admin/unlock') return { token: 'demo' }
  if (path === '/api/admin/check') return { admin: true }
  if (path === '/api/audience') return { grownUps: false }
  if (path === '/api/ask') {
    await new Promise((r) => setTimeout(r, 700)) // thinking
    return answer(String(body.text || ''), body.devices)
  }
  return { ok: true }
}

const realFetch = window.fetch.bind(window)
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href)
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init)
  let body = {}
  try {
    body = init.body ? JSON.parse(init.body) : {}
  } catch {
    // not JSON (wake word recordings): ignored
  }
  const result = await route(url.pathname, init.method || 'GET', body, url.searchParams)
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
}
