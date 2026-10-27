#!/usr/bin/env bun
/**
 * Sets up a new Frog Hub (or changes this one): `bun run setup` in the repo. Asks a few questions, then:
 *   - writes ~/.config/froghub/instance.json (site, Home Assistant, time zone, children), weather.json and the PIN
 *   - installs the assistant ("brain") as a systemd user service:
 *       claude-code  Claude Code on Haiku in tmux, using your Claude subscription (setup/agent/)
 *       api          standalone.ts: the Anthropic API and/or an OpenAI-compatible server such as LM Studio
 *   - builds the web app and copies it to the web root
 *   - prints (or adds) the Caddy site block
 *   - optionally starts the voice containers (setup/voice/compose.yaml; any of them can be on another computer
 *     instead) and adds them and the four personalities' pipelines to Home Assistant
 * Run it again any time; every question defaults to what's set now. `--dry-run` shows what it would do.
 */
import { spawnSync } from 'child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { checkToken, setUpHomeAssistant } from './homeassistant'

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
const works = (cmd: string) => spawnSync('sh', ['-c', `${cmd} >/dev/null 2>&1`]).status === 0

// One connection per computer for all of setup (the voice on other computers), so a password is asked once
const SSH_OPTS = ['-o', 'ControlMaster=auto', '-o', `ControlPath=${join(tmpdir(), 'froghub-ssh-%C')}`, '-o', 'ControlPersist=60']

// What setup adds that wasn't there before (folders, the Caddyfile backup), for remove.sh. install.sh keeps the same list.
const MANIFEST = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'froghub', 'installed')

function note(line: string): void {
  if (DRY || (existsSync(MANIFEST) && readFileSync(MANIFEST, 'utf8').split('\n').includes(line))) return
  mkdirSync(dirname(MANIFEST), { recursive: true })
  appendFileSync(MANIFEST, line + '\n')
}

/** The folders `mkdir -p dir` would make, outermost first. */
function missingDirs(dir: string): string[] {
  const out: string[] = []
  for (let d = resolve(dir); !existsSync(d); d = dirname(d)) out.unshift(d)
  return out
}

function write(path: string, text: string, mode?: number): void {
  if (DRY) return say(`\x1b[2m(would write ${path})\x1b[0m`)
  const made = missingDirs(dirname(path))
  mkdirSync(dirname(path), { recursive: true })
  for (const d of made) note(`dir ${d}`)
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
const haUrl = ask('Home Assistant address ("none" to go without)', old.haUrl || (old.site ? 'none' : 'http://homeassistant.local:8123')).replace(/\/+$/, '')
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

heading('Recipes')
say('Recipes come from TheMealDB (free, with pictures). With a recipeapi.io key (recipeapi.io → Dashboard; the free plan')
say('allows 500 requests a month) they come from there instead: 50,000 recipes with diet, time and calorie filters, no pictures.')
const recipeKeyFile = join(CONFIG, 'recipeapi.key')
const oldRecipeKey = existsSync(recipeKeyFile) ? readFileSync(recipeKeyFile, 'utf8').trim() : ''
let recipeKey = ''
for (;;) {
  recipeKey = secret(oldRecipeKey ? 'recipeapi.io key (Enter to keep it; "none" for TheMealDB)' : 'recipeapi.io key (Enter for TheMealDB)')
  if (!recipeKey || recipeKey === 'none' || DRY) break
  const r = await fetch('https://recipeapi.io/api/v1/recipes?per_page=1', { headers: { Authorization: `Bearer ${recipeKey}` }, signal: AbortSignal.timeout(10_000) })
    .catch(() => null)
  if (r?.status === 401) { say('recipeapi.io turned that key down.'); continue }
  if (!r?.ok) say(`Couldn't check it (${r ? `recipeapi.io answered ${r.status}` : 'no answer'}); keeping it anyway.`)
  break
}

heading('Sound clips')
say('The assistant finds sound clips (animal noises, instruments, sound effects) on Wikimedia Commons. With a free')
say('Freesound.org API key (make an account, then freesound.org/apiv2/apply) it searches Freesound too.')
const freesoundKeyFile = join(CONFIG, 'freesound.key')
const oldFreesoundKey = existsSync(freesoundKeyFile) ? readFileSync(freesoundKeyFile, 'utf8').trim() : ''
let freesoundKey = ''
for (;;) {
  freesoundKey = secret(oldFreesoundKey ? 'Freesound API key (Enter to keep it; "none" for Commons only)' : 'Freesound API key (Enter for Commons only)')
  if (!freesoundKey || freesoundKey === 'none' || DRY) break
  const r = await fetch(`https://freesound.org/apiv2/search/text/?query=frog&page_size=1&token=${encodeURIComponent(freesoundKey)}`, { signal: AbortSignal.timeout(10_000) })
    .catch(() => null)
  if (r?.status === 401) { say('Freesound turned that key down.'); continue }
  if (!r?.ok) say(`Couldn't check it (${r ? `Freesound answered ${r.status}` : 'no answer'}); keeping it anyway.`)
  break
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
  if (env.ANTHROPIC_API_KEY) {
    env.FROGHUB_MODEL = ask('Claude model', env.FROGHUB_MODEL || 'claude-haiku-5-5')
    env.FROGHUB_BIG_MODEL = ask('Bigger model it may hand hard questions to ("none" for none)', env.FROGHUB_BIG_MODEL || 'claude-sonnet-5-5')
  }
  say('An OpenAI-compatible API: LM Studio (http://<computer>:1234/v1), Ollama (http://<computer>:11434/v1) or OpenAI (https://api.openai.com/v1).')
  const local = ask(`Its address, for ${env.ANTHROPIC_API_KEY ? 'when the Anthropic API fails' : 'the answers'} ("none" for none)`, env.FROGHUB_FALLBACK_URL || (env.ANTHROPIC_API_KEY ? 'none' : ''))
  if (local && local !== 'none') {
    env.FROGHUB_FALLBACK_URL = local
    env.FROGHUB_FALLBACK_MODEL = ask('Model name there (e.g. qwen3:8b on Ollama, gpt-5-mini on OpenAI)', env.FROGHUB_FALLBACK_MODEL || '')
    const key = secret(env.FROGHUB_FALLBACK_KEY ? 'Its API key (Enter to keep the one set now; "none" for none)' : 'Its API key (Enter for none: LM Studio and Ollama need none)')
    if (key === 'none') delete env.FROGHUB_FALLBACK_KEY
    else if (key) env.FROGHUB_FALLBACK_KEY = key
  } else {
    delete env.FROGHUB_FALLBACK_URL
    delete env.FROGHUB_FALLBACK_MODEL
    delete env.FROGHUB_FALLBACK_KEY
  }
  if (!env.ANTHROPIC_API_KEY && !env.FROGHUB_FALLBACK_URL) say('⚠️  No API key and no local model: it will only be able to say it can\'t answer.')
  write(envFile, '# Frog Hub standalone assistant (written by bun run setup; keep this private)\n' +
    Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', 0o600)
  const rules = join(CONFIG, 'assistant.md')
  if (!existsSync(rules) || yes(`Replace ${rules} (its rules) with the fresh template`, false))
    write(rules, render('standalone/assistant.md', childValues))
  write(standaloneUnit, render('standalone/froghub-standalone.service', { BUN, CHANNEL_DIR, ENV_FILE: envFile }))
}

write(join(CONFIG, 'instance.json'), JSON.stringify({ ...old, site, haUrl: haUrl === 'none' ? '' : haUrl, timeZone, kids, agentDir }, null, 1) + '\n')
if (weather.latitude !== undefined) write(join(CONFIG, 'weather.json'), JSON.stringify(weather) + '\n')
if (pinHash) write(join(CONFIG, 'pin'), pinHash + '\n', 0o600)
if (recipeKey) write(recipeKeyFile, recipeKey === 'none' ? '' : recipeKey + '\n', 0o600)
if (freesoundKey) write(freesoundKeyFile, freesoundKey === 'none' ? '' : freesoundKey + '\n', 0o600)

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
const madeWebDirs = missingDirs(webRoot)
run([...sudo, 'mkdir', '-p', webRoot])
for (const d of madeWebDirs) note(`dir ${d}`)
run([...sudo, 'rsync', '-a', '--delete', `${join(REPO, 'dist')}/`, `${webRoot}/`])
// SELinux (Fedora, RHEL, Rocky, Alma…): the web server may only read files labelled as web content, and a new
// /var/www made by mkdir isn't. New files inherit the folder's label, so ./deploy.sh keeps working after this.
if (works('selinuxenabled')) {
  if (has('semanage')) run(['sudo', 'semanage', 'fcontext', '-a', '-t', 'httpd_sys_content_t', `${webRoot}(/.*)?`], { allowFail: true })
  run(['sudo', 'chcon', '-R', '-t', 'httpd_sys_content_t', webRoot], { allowFail: true })
}

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
  note(`file ${caddyfile}.bak-froghub`)
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

heading('Voice (wake word, speech-to-text and the voices)')
// Each runs here in a container, or on another computer that already runs it (Whisper on a faster PC, say)
const VOICE = [
  { key: 'openwakeword', name: 'openWakeWord', what: 'the wake word', port: 10400 },
  { key: 'whisper', name: 'Whisper', what: 'speech-to-text', port: 10300 },
  { key: 'piper', name: 'Piper', what: 'the voices', port: 10200 },
] as const
// Just after install.sh, the docker group isn't active until you log in again, so fall back to sudo
const sudoDocker = has('docker') && !works('docker info') ? ['sudo', '-E'] : []
const engine = has('docker') ? [...sudoDocker, 'docker'] : has('podman') ? ['podman'] : null
const compose = works('docker compose version') ? [...sudoDocker, 'docker', 'compose']
  : has('docker-compose') ? [...sudoDocker, 'docker-compose'] : has('podman-compose') ? ['podman-compose'] : null
const composeFile = join(SETUP, 'voice', 'compose.yaml')
if (!haUrl || haUrl === 'none') say('Skipped: voice needs Home Assistant.')
else if (yes('Set up the voice and add it to Home Assistant', true)) {
  say('For each: Enter or "here" runs it on this computer in a container; or give host:port of one running elsewhere.')
  const where: Record<string, string> = {}
  for (const v of VOICE) {
    const answer = ask(`${v.name} (${v.what})`, old.voice?.[v.key] || 'here').replace(/^tcp:\/\//, '')
    where[v.key] = answer === 'here' || answer.includes(':') ? answer : `${answer}:${v.port}`
  }
  const here = VOICE.filter(v => where[v.key] === 'here')
  const elsewhere = VOICE.filter(v => where[v.key] !== 'here')
  let bind = old.voiceBind || '127.0.0.1'
  let started = true
  if (here.length && !compose) {
    say(`Running ${listNames(here.map(v => v.name))} here needs Docker (or podman-compose). Afterwards run setup again.`)
    started = false
  } else if (here.length && compose) {
    bind = ask('Address HA reaches the ones here on (127.0.0.1 if HA is on this computer, else this computer\'s LAN address)', bind)
    const services = here.map(v => v.key)
    say(`\x1b[2m$ VOICE_BIND=${bind} ${compose.join(' ')} -f setup/voice/compose.yaml up -d ${services.join(' ')}\x1b[0m`)
    if (!DRY && spawnSync(compose[0], [...compose.slice(1), '-f', composeFile, 'up', '-d', ...services], { stdio: 'inherit', env: { ...process.env, VOICE_BIND: bind } }).status !== 0) {
      say('Starting them failed; fix that, then run setup again.')
      started = false
    }
  }
  // One that's moved elsewhere doesn't need its container here any more
  for (const v of elsewhere)
    if (engine && works(`${engine.join(' ')} container inspect froghub-${v.key}`)) run([...engine, 'rm', '-f', `froghub-${v.key}`], { allowFail: true })

  // Ones elsewhere can be installed there over SSH (setup/voice/voice.sh, copied to ~/froghub-voice there)
  const oldSsh: Record<string, { ssh: string; bind: string }> = old.voiceSsh || {}
  const ssh: Record<string, { ssh: string; bind: string }> = {}
  for (const v of elsewhere) {
    if (!has('ssh')) break
    const host = hostOf(where[v.key])
    if (!yes(`Install ${v.name} on ${host} over SSH`, oldSsh[v.key] !== undefined)) continue
    const target = ask('SSH to (user@host)', oldSsh[v.key]?.ssh || host)
    const listen = ask(`Address on ${host} for it to listen on (0.0.0.0 for all)`, oldSsh[v.key]?.bind || (/^[\d.]+$/.test(host) ? host : '0.0.0.0'))
    ssh[v.key] = { ssh: target, bind: listen }
  }
  // Ones installed over SSH before that are now somewhere else
  for (const [key, was] of Object.entries(oldSsh))
    if (ssh[key]?.ssh !== was.ssh) {
      say(`Removing ${key} from ${was.ssh}`)
      sshRun(was.ssh, ['down', key])
    }
  for (const target of new Set(Object.values(ssh).map(t => t.ssh))) {
    const keys = Object.keys(ssh).filter(k => ssh[k].ssh === target)
    if (!sshCopy(target)) { say(`Couldn't copy the voice files to ${target}; check you can ssh ${target}, then run setup again.`); started = false; continue }
    const hasEngine = DRY || spawnSync('ssh', [...SSH_OPTS, target, 'command -v docker || command -v podman-compose'], { stdio: 'ignore' }).status === 0
    if (!hasEngine) {
      if (!yes(`${target} has no Docker or podman-compose: install it there (with sudo)`, true)) { started = false; continue }
      if (!sshRun(target, ['engine'])) { started = false; continue }
    }
    for (const bindThere of new Set(keys.map(k => ssh[k].bind)))
      if (!sshRun(target, ['up', bindThere, ...keys.filter(k => ssh[k].bind === bindThere)])) started = false
  }
  const byHand = elsewhere.filter(v => !ssh[v.key])
  if (byHand.length)
    say(`To run ${listNames(byHand.map(v => v.name))} on another computer with Frog Hub's settings, from a copy of this repo there:\n` +
      `  VOICE_BIND=0.0.0.0 docker compose -f setup/voice/compose.yaml up -d ${byHand.map(v => v.key).join(' ')}`)
  if (!started) say('Not everything started; fix that and run setup again.')
  if (!DRY) {
    const instanceFile = join(CONFIG, 'instance.json')
    writeFileSync(instanceFile, JSON.stringify({ ...readJson(instanceFile), voice: where, voiceBind: bind, voiceSsh: ssh }, null, 1) + '\n')
  }
  if (started) {
    const endpoints = VOICE.map(v => {
      const at = where[v.key] === 'here' ? `${bind}:${v.port}` : where[v.key]
      return { ...v, host: hostOf(at), port: Number(at.slice(at.lastIndexOf(':') + 1)) }
    })
    if (DRY) {
      say(`\x1b[2m(would ask for a Home Assistant token, then add ${listNames(endpoints.map(e => `${e.name} at ${e.host}:${e.port}`))}` +
        ' and add or update the four "Frog Hub · …" pipelines)\x1b[0m')
    } else {
      say('Now a Home Assistant long-lived access token (HA → your profile → Security → Create token). It is only used now, not saved.')
      for (;;) {
        const token = secret('Token (Enter to skip)')
        if (!token) { say('Skipped: run setup again with a token to add them to Home Assistant.'); break }
        const problem = await checkToken(haUrl, token)
        if (problem) { say(`${problem} Try again, or Enter to skip.`); continue }
        await setUpHomeAssistant(haUrl, token, endpoints, say)
        break
      }
    }
  }
}

heading('Done 🐸')
say(`Open ${site} on each tablet (Fully Kiosk Browser works well) and follow the welcome.`)
say(`Grown-ups' page: ${site}/admin`)
if (brain === 'claude-code') say(`Watch the assistant: tmux -L froghub attach -t froghub (Ctrl-b d to leave)`)
say('After changing the code: ./deploy.sh')
process.exit(0) // (nothing left to wait for, whatever a library or ssh left open)

// ---- the voice on other computers, over SSH ----

/** "host:port" → "host" (and "[::1]:10300" → "::1") */
function hostOf(at: string): string {
  return at.slice(0, at.lastIndexOf(':')).replace(/^\[|\]$/g, '')
}

/** Copies compose.yaml and voice.sh to ~/froghub-voice on the target. */
function sshCopy(target: string): boolean {
  say(`\x1b[2m$ ssh ${target} (copy setup/voice/compose.yaml and voice.sh to ~/froghub-voice)\x1b[0m`)
  if (DRY) return true
  return ['compose.yaml', 'voice.sh'].every(file => spawnSync('ssh', [...SSH_OPTS, target,
    `mkdir -p froghub-voice && cat > froghub-voice/${file}`], { input: readFileSync(join(SETUP, 'voice', file)), stdio: ['pipe', 'inherit', 'inherit'] }).status === 0)
}

/** sh ~/froghub-voice/voice.sh <args> on the target, with a terminal for sudo's password. */
function sshRun(target: string, args: string[]): boolean {
  return run(['ssh', ...SSH_OPTS, '-t', target, 'sh', 'froghub-voice/voice.sh', ...args], { allowFail: true })
}
