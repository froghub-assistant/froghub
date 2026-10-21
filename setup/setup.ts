#!/usr/bin/env bun
/**
 * Sets up a new Frog Hub (or changes this one): `bun run setup` in the repo. Asks a few questions, then:
 *   - writes ~/.config/froghub/instance.json (site, Home Assistant, time zone, children), weather.json and the PIN
 *   - installs the assistant ("brain") as a systemd user service:
 *       claude-code  Claude Code on Haiku in tmux, using your Claude subscription (setup/agent/)
 *       api          standalone.ts: the Anthropic API and/or an OpenAI-compatible server such as LM Studio
 *   - builds the web app and copies it to the web root
 *   - prints (or adds) the Caddy site block
 *   - optionally starts the voice containers (setup/voice/compose.yaml) and adds them and the four personalities'
 *     pipelines to Home Assistant
 * Run it again any time; every question defaults to what's set now. `--dry-run` shows what it would do.
 */
import { spawnSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'

const DRY = process.argv.includes('--dry-run')
const REPO = resolve(dirname(import.meta.path), '..')
const SETUP = join(REPO, 'setup')
const CHANNEL_DIR = join(REPO, 'channel')
const CONFIG = join(homedir(), '.config', 'froghub')
const UNITS = join(homedir(), '.config', 'systemd', 'user')
const BUN = process.execPath
const TTY = process.stdin.isTTY

// ---- little helpers ----

const say = (text = '') => console.log(text)
const heading = (text: string) => say(`\n\x1b[1;32m${text}\x1b[0m`)

function ask(question: string, fallback = ''): string {
  const answer = prompt(`${question}${fallback ? ` [${fallback}]` : ''}:`)?.trim()
  return answer || fallback
}

function yes(question: string, fallback: boolean): boolean {
  const answer = ask(`${question} (${fallback ? 'Y/n' : 'y/N'})`).toLowerCase()
  return answer ? answer.startsWith('y') : fallback
}

function choose(question: string, options: Record<string, string>, fallback: string): string {
  const keys = Object.keys(options)
  keys.forEach((k, i) => say(`  ${i + 1}. ${options[k]}`))
  for (;;) {
    const answer = ask(question, String(keys.indexOf(fallback) + 1))
    const key = keys[Number(answer) - 1] ?? (options[answer] ? answer : '')
    if (key) return key
    say(`Pick a number from 1 to ${keys.length}.`)
  }
}

/** Asks without showing what's typed (PINs, keys, tokens). */
function secret(question: string): string {
  if (TTY) spawnSync('stty', ['-echo'], { stdio: 'inherit' })
  try {
    return prompt(`${question}:`)?.trim() ?? ''
  } finally {
    if (TTY) {
      spawnSync('stty', ['echo'], { stdio: 'inherit' })
      say()
    }
  }
}

/** Runs a command (shown first), stopping setup if it fails. */
function run(cmd: string[], options: { cwd?: string; allowFail?: boolean } = {}): boolean {
  say(`\x1b[2m$ ${cmd.join(' ')}\x1b[0m`)
  if (DRY) return true
  const result = spawnSync(cmd[0], cmd.slice(1), { cwd: options.cwd, stdio: 'inherit' })
  if (result.status === 0) return true
  if (options.allowFail) return false
  console.error(`That failed (${cmd[0]} exited with ${result.status ?? result.signal}). Fix it and run setup again.`)
  process.exit(1)
}

const has = (command: string) => spawnSync('sh', ['-c', `command -v ${command}`]).status === 0

function write(path: string, text: string, mode?: number): void {
  if (DRY) return say(`\x1b[2m(would write ${path})\x1b[0m`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  if (mode) chmodSync(path, mode)
  say(`Wrote ${path}`)
}

const readJson = (path: string) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {})

function render(template: string, values: Record<string, string>): string {
  return readFileSync(join(SETUP, template), 'utf8').replace(/\{\{(\w+)\}\}/g, (all, key) => values[key] ?? all)
}

/** "Sam", "Sam and Alex", "Sam, Alex and Jo" */
const listNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

// ---- 1. this house ----

const old = readJson(join(CONFIG, 'instance.json'))
say('🐸 Frog Hub setup. Press Enter to keep the value in [brackets].' + (DRY ? ' (Dry run: nothing is changed.)' : ''))

heading('This house')
const site = ask('Web address the displays will open (HTTPS, for the microphone)', old.site || 'https://hub.example.com').replace(/\/+$/, '')
const haUrl = ask('Home Assistant address ("none" to go without)', old.haUrl || 'http://homeassistant.local:8123').replace(/\/+$/, '')
const timeZone = ask('Time zone', old.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London')
const kids = ask("Children's names, separated by commas", (old.kids || []).join(', '))
  .split(',').map(s => s.trim()).filter(Boolean)
if (!kids.length) say("No names: the assistant's rules will just say \"the children\".")

heading('Weather')
const oldWeather = readJson(join(CONFIG, 'weather.json'))
let weather = oldWeather
const town = ask('Nearest town, for the weather (Enter to keep)' , oldWeather.place && oldWeather.place !== 'home' ? oldWeather.place : '')
if (town && town !== oldWeather.place) {
  const found = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=${encodeURIComponent(town)}`)
    .then(r => r.json()).then(j => j.results || []).catch(() => [])
  if (!found.length) say(`Couldn't find "${town}"; the weather keeps its old place.`)
  else {
    const places = Object.fromEntries(found.map((p: any, i: number) => [String(i), [p.name, p.admin1, p.country].filter(Boolean).join(', ')]))
    const pick = found[Number(choose('Which one', places, '0'))]
    weather = { latitude: Math.round(pick.latitude * 100) / 100, longitude: Math.round(pick.longitude * 100) / 100, place: pick.name }
  }
}

heading('Admin PIN (for grown-ups: settings, the admin page, announcements)')
const hasPin = existsSync(join(CONFIG, 'pin'))
let pinHash = ''
if (!hasPin || yes('Change the admin PIN', false)) {
  for (;;) {
    const pin = secret('New admin PIN (4-6 digits)')
    if (!/^\d{4,6}$/.test(pin)) { say('The PIN must be 4 to 6 digits.'); continue }
    if (secret('Same again') !== pin) { say("They didn't match."); continue }
    pinHash = await Bun.password.hash(pin)
    break
  }
}

// ---- 2. the brain ----

heading('The assistant')
const agentUnit = join(UNITS, 'froghub-agent.service')
const standaloneUnit = join(UNITS, 'froghub-standalone.service')
const brain = choose('Which', {
  'claude-code': 'Claude Code (Haiku) with your Claude subscription: the cleverest, needs `claude` installed and logged in',
  api: 'The Anthropic API (pay per use) and/or a local model in LM Studio or similar (OpenAI-compatible)',
}, existsSync(standaloneUnit) && !existsSync(agentUnit) ? 'api' : 'claude-code')

let agentDir = old.agentDir || join(homedir(), 'froghub-agent')
const childValues = {
  CHILD: kids[0] || 'one of the children',
  CHILDREN: kids.length ? listNames(kids) : 'the children',
}

if (brain === 'claude-code') {
  if (!has('claude')) say('⚠️  `claude` isn\'t on the PATH. Install Claude Code and run `claude` once to log in before starting it.')
  if (!has('tmux')) say('⚠️  tmux isn\'t installed (it runs Claude Code in the background): sudo apt install tmux')
  agentDir = resolve(ask("The assistant's folder (its rules and settings)", agentDir))
  const memory = join(homedir(), '.claude', 'projects', agentDir.replace(/[^a-zA-Z0-9]/g, '-'), 'memory')
  const values = { ...childValues, MEMORY: '/' + memory, BUN, CHANNEL_DIR, AGENT_DIR: agentDir, TMUX: spawnSync('sh', ['-c', 'command -v tmux']).stdout?.toString().trim() || '/usr/bin/tmux' }
  // Its rules are the house's to tweak, so an existing CLAUDE.md is only replaced when asked
  if (!existsSync(join(agentDir, 'CLAUDE.md')) || yes(`Replace ${agentDir}/CLAUDE.md (its rules) with the fresh template`, false))
    write(join(agentDir, 'CLAUDE.md'), render('agent/CLAUDE.md', values))
  write(join(agentDir, 'settings.json'), render('agent/settings.json', values))
  write(join(agentDir, 'mcp.json'), render('agent/mcp.json', values))
  write(join(agentDir, 'start'), render('agent/start', values), 0o755)
  write(join(agentDir, 'accept-channels'), render('agent/accept-channels', values), 0o755)
  write(agentUnit, render('agent/froghub-agent.service', values))
} else {
  const envFile = join(CONFIG, 'standalone.env')
  const env: Record<string, string> = Object.fromEntries((existsSync(envFile) ? readFileSync(envFile, 'utf8') : '')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  say('An Anthropic API key (console.anthropic.com → API keys). Leave it empty to use only a local model.')
  const key = secret(env.ANTHROPIC_API_KEY ? 'API key (Enter to keep the one set now)' : 'API key')
  if (key) env.ANTHROPIC_API_KEY = key
  if (env.ANTHROPIC_API_KEY) env.FROGHUB_MODEL = ask('Claude model', env.FROGHUB_MODEL || 'claude-haiku-5-5')
  const local = ask(`OpenAI-compatible server for ${env.ANTHROPIC_API_KEY ? 'when the API fails' : 'the answers'}, e.g. http://192.168.1.20:1234/v1 ("none" for none)`, env.FROGHUB_FALLBACK_URL || (env.ANTHROPIC_API_KEY ? 'none' : ''))
  if (local && local !== 'none') {
    env.FROGHUB_FALLBACK_URL = local
    env.FROGHUB_FALLBACK_MODEL = ask('Model name there', env.FROGHUB_FALLBACK_MODEL || '')
  } else {
    delete env.FROGHUB_FALLBACK_URL
    delete env.FROGHUB_FALLBACK_MODEL
  }
  if (!env.ANTHROPIC_API_KEY && !env.FROGHUB_FALLBACK_URL) say('⚠️  No API key and no local model: it will only be able to say it can\'t answer.')
  write(envFile, '# Frog Hub standalone assistant (written by bun run setup; keep this private)\n' +
    Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', 0o600)
  const rules = join(CONFIG, 'assistant.md')
  if (!existsSync(rules) || yes(`Replace ${rules} (its rules) with the fresh template`, false))
    write(rules, render('standalone/assistant.md', childValues))
  write(standaloneUnit, render('standalone/froghub-standalone.service', { BUN, CHANNEL_DIR, ENV_FILE: envFile }))
}

write(join(CONFIG, 'instance.json'), JSON.stringify({ site, haUrl: haUrl === 'none' ? '' : haUrl, timeZone, kids, agentDir }, null, 1) + '\n')
if (weather.latitude !== undefined) write(join(CONFIG, 'weather.json'), JSON.stringify(weather) + '\n')
if (pinHash) write(join(CONFIG, 'pin'), pinHash + '\n', 0o600)

// Both brains listen on the same port, so only one runs
const [unit, other] = brain === 'claude-code' ? ['froghub-agent', 'froghub-standalone'] : ['froghub-standalone', 'froghub-agent']
run(['bun', 'install', '--no-summary'], { cwd: CHANNEL_DIR })
run(['systemctl', '--user', 'disable', '--now', other], { allowFail: true })
run(['systemctl', '--user', 'daemon-reload'])
run(['systemctl', '--user', 'enable', unit])
run(['systemctl', '--user', 'restart', unit])
if (spawnSync('loginctl', ['show-user', process.env.USER || '', '-p', 'Linger']).stdout?.toString().trim() !== 'Linger=yes')
  say(`To keep it running when you're logged out: sudo loginctl enable-linger ${process.env.USER}`)

// ---- 3. the web app ----

heading('The web app')
const webRoot = ask('Folder your web server serves it from', old.webRoot || '/var/www/froghub')
if (!DRY) {
  const instanceFile = join(CONFIG, 'instance.json')
  writeFileSync(instanceFile, JSON.stringify({ ...readJson(instanceFile), webRoot }, null, 1) + '\n')
}
run(['bun', 'install', '--no-summary'], { cwd: REPO })
run(['bun', 'run', 'build'], { cwd: REPO })
const sudo = existsSync(webRoot) && spawnSync('test', ['-w', webRoot]).status === 0 ? [] : ['sudo']
run([...sudo, 'mkdir', '-p', webRoot])
run([...sudo, 'rsync', '-a', '--delete', `${join(REPO, 'dist')}/`, `${webRoot}/`])

// ---- 4. the web server ----

heading('The web server (Caddy)')
const host = new URL(site).host
const haLocal = haUrl && haUrl !== 'none' ? new URL(haUrl).host : ''
const block = `${host} {
	# Frog Hub is for home: uncomment to turn away anyone outside your network (change the range to yours)
	# @outside not remote_ip 127.0.0.1/8 ::1 192.168.0.0/16
	# respond @outside "Frog Hub only works at home." 403
	root * ${webRoot}
	reverse_proxy /api/* 127.0.0.1:8790
${haLocal ? `	# Spoken replies from Home Assistant, same-origin so the app can change their pitch
	handle_path /tts/* {
		rewrite * /api/tts_proxy{path}
		reverse_proxy ${haLocal}
	}
` : ''}	header /assets/* Cache-Control "public, max-age=31536000, immutable"
	header / Cache-Control "no-cache"
	file_server
}
`
const caddyfile = '/etc/caddy/Caddyfile'
const caddyText = existsSync(caddyfile) ? readFileSync(caddyfile, 'utf8') : ''
if (new RegExp(`^${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,{]`, 'm').test(caddyText)) {
  say(`${caddyfile} already has a block for ${host}; leaving it alone.`)
} else if (existsSync(caddyfile) && yes(`Add this to ${caddyfile} (with sudo) and reload Caddy?\n\n${block}\n`, true)) {
  run(['sudo', 'cp', caddyfile, `${caddyfile}.bak-froghub`])
  say(`\x1b[2m$ sudo tee -a ${caddyfile}\x1b[0m`)
  if (!DRY) spawnSync('sudo', ['tee', '-a', caddyfile], { input: '\n' + block, stdio: ['pipe', 'ignore', 'inherit'] })
  if (!run(['sudo', 'caddy', 'validate', '--config', caddyfile, '--adapter', 'caddyfile'], { allowFail: true })) {
    say(`Caddy didn't like it, so the old one is back (${caddyfile}.bak-froghub). Add the block by hand.`)
    run(['sudo', 'cp', `${caddyfile}.bak-froghub`, caddyfile])
  } else run(['sudo', 'systemctl', 'reload', 'caddy'], { allowFail: true })
} else {
  say(`Add this to your Caddy config (any web server works: serve ${webRoot}, send /api/ to 127.0.0.1:8790):\n\n${block}`)
}

// ---- 5. voice ----

heading('Voice (wake word, speech-to-text and the voices, all on this computer)')
const works = (cmd: string) => spawnSync('sh', ['-c', `${cmd} >/dev/null 2>&1`]).status === 0
// Just after install.sh, the docker group isn't active until you log in again, so fall back to sudo
const sudoDocker = has('docker') && !works('docker info') ? ['sudo', '-E'] : []
const compose = works('docker compose version') ? [...sudoDocker, 'docker', 'compose']
  : has('docker-compose') ? [...sudoDocker, 'docker-compose'] : has('podman-compose') ? ['podman-compose'] : null
if (!haUrl || haUrl === 'none') say('Skipped: voice needs Home Assistant.')
else if (!compose) say('Skipped: needs Docker (or podman-compose). Afterwards: docker compose -f setup/voice/compose.yaml up -d')
else if (yes('Start the voice containers and set them up in Home Assistant', true)) {
  const bind = ask('Address HA reaches them on (127.0.0.1 if HA is on this computer, else this computer\'s LAN address)', '127.0.0.1')
  const env = { ...process.env, VOICE_BIND: bind }
  say(`\x1b[2m$ VOICE_BIND=${bind} ${compose.join(' ')} -f setup/voice/compose.yaml up -d\x1b[0m`)
  if (!DRY && spawnSync(compose[0], [...compose.slice(1), '-f', join(SETUP, 'voice', 'compose.yaml'), 'up', '-d'], { stdio: 'inherit', env }).status !== 0)
    say('Starting them failed; fix that, then run setup again.')
  else {
    say('Now a Home Assistant long-lived access token (HA → your profile → Security → Create token). It is only used now, not saved.')
    const token = secret('Token (Enter to skip)')
    if (token && !DRY) await setUpHomeAssistant(haUrl, token, bind)
  }
}

heading('Done 🐸')
say(`Open ${site} on each tablet (Fully Kiosk Browser works well) and follow the welcome.`)
say(`Grown-ups' page: ${site}/admin`)
if (brain === 'claude-code') say(`Watch the assistant: tmux -L froghub attach -t froghub (Ctrl-b d to leave)`)
say('After changing the code: ./deploy.sh')

// ---- Home Assistant: Wyoming services and the personalities' pipelines ----

async function setUpHomeAssistant(base: string, token: string, host: string): Promise<void> {
  const rest = (path: string, body?: unknown) => fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => (r.ok ? r.json() : Promise.reject(new Error(`${path}: ${r.status} ${await r.text()}`))))

  // The Wyoming integration, once per service (HA says "already configured" for one it has)
  for (const [name, port] of [['openWakeWord', 10400], ['Whisper', 10300], ['Piper', 10200]] as const) {
    try {
      const flow = await rest('/api/config/config_entries/flow', { handler: 'wyoming', show_advanced_options: false })
      const done = await rest(`/api/config/config_entries/flow/${flow.flow_id}`, { host, port })
      say(done.type === 'create_entry' ? `Added ${name} to Home Assistant.` : `${name}: ${done.reason || done.type}`)
    } catch (err) {
      say(`Couldn't add ${name}: ${(err as Error).message}`)
    }
  }

  const states: { entity_id: string }[] = await rest('/api/states')
  const find = (domain: string, hint: string) =>
    states.map(s => s.entity_id).find(id => id.startsWith(`${domain}.`) && id.includes(hint)) ?? states.map(s => s.entity_id).find(id => id.startsWith(`${domain}.`))
  const stt = find('stt', 'whisper')
  const tts = find('tts', 'piper')
  const wake = find('wake_word', 'openwakeword')
  if (!stt || !tts || !wake) return say(`Couldn't find the speech entities in HA (stt: ${stt}, tts: ${tts}, wake word: ${wake}); give it a minute and run setup again.`)

  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/api/websocket')
  let id = 0
  const waiting = new Map<number, (m: any) => void>()
  const call = (msg: object) => new Promise<any>(done => {
    waiting.set(++id, done)
    ws.send(JSON.stringify({ ...msg, id }))
  })
  await new Promise<void>((ready, fail) => {
    ws.onmessage = ev => {
      const m = JSON.parse(String(ev.data))
      if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }))
      else if (m.type === 'auth_ok') ready()
      else if (m.type === 'auth_invalid') fail(new Error('Home Assistant said the token is invalid'))
      else if (m.type === 'result') waiting.get(m.id)?.(m), waiting.delete(m.id)
    }
    ws.onerror = () => fail(new Error(`couldn't connect to ${base}`))
  }).catch(err => say((err as Error).message))
  if (ws.readyState !== WebSocket.OPEN) return

  const existing: { id: string; name: string }[] = (await call({ type: 'assist_pipeline/pipeline/list' })).result?.pipelines ?? []
  for (const p of JSON.parse(readFileSync(join(SETUP, 'voice', 'pipelines.json'), 'utf8'))) {
    const pipeline = {
      name: p.name, language: 'en', conversation_engine: 'conversation.home_assistant', conversation_language: 'en',
      stt_engine: stt, stt_language: 'en', tts_engine: tts, tts_language: p.tts_language, tts_voice: p.tts_voice,
      wake_word_entity: wake, wake_word_id: 'hey_jarvis', prefer_local_intents: false,
    }
    const same = existing.find(e => e.name === p.name)
    const result = same
      ? await call({ type: 'assist_pipeline/pipeline/update', pipeline_id: same.id, ...pipeline })
      : await call({ type: 'assist_pipeline/pipeline/create', ...pipeline })
    say(result.success ? `${same ? 'Updated' : 'Added'} the "${p.name}" pipeline.` : `"${p.name}": ${result.error?.message}`)
  }
  ws.close()
}
