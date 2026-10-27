<script>
  // Records real voices for training the "Hey Verity" wake word (channel/samples.ts), through the same microphone
  // path the wake word hears. Opened from Settings in admin mode.
  import { onDestroy } from 'svelte'
  import { startMic } from './mic.js'
  import { tapMic } from './assist.svelte.js'
  import { Mic } from '@lucide/svelte'

  let { adminToken, name = '', onClose } = $props()

  const WAKE = ['normally', 'a bit quicker', 'slowly', 'quietly', 'loudly', 'from across the room', 'in a happy voice',
    'like a question', 'sleepily', 'facing away from the tablet', 'excitedly', 'in your normal voice again']
  const OTHER = ['"Hey Betty!"', '"Very pretty"', '"Hey everybody"', '"Hey Jerry"', '"Verity"', '"Hey, where\'s my tea?"',
    '"Severity"', '"Hey Jarvis"', '"Hey there"', 'anything you like, like what you did today', 'count to five',
    'a bit of a song', '"Hey, very tidy room!"', 'your name and your favourite animal']
  const SECONDS = { wake: 2.5, other: 4 }
  const QUIET = 1500 // loudest sample below this = probably nothing said

  // svelte-ignore state_referenced_locally (a starting value to edit)
  let who = $state(name)
  let kind = $state('wake')
  let turn = $state(0)
  let recording = $state(false)
  let progress = $state(0)
  let note = $state('')
  let counts = $state({ wake: 0, other: 0 })

  let prompt = $derived(kind === 'wake' ? `Say "Hey Verity" ${WAKE[turn % WAKE.length]}` : `Say ${OTHER[turn % OTHER.length]}`)

  const headers = () => ({ 'X-Admin-Token': adminToken })
  const speaker = () => who.trim() || 'someone'

  async function loadCounts() {
    try {
      const all = await (await fetch('/api/wakeword/counts', { headers: headers() })).json()
      counts = all[speaker().replace(/[^\w ]/g, '').replace(/ /g, '_')] || { wake: 0, other: 0 }
    } catch {
      // server unreachable; the counts just don't update
    }
  }
  loadCounts()

  let stopMic = null
  async function record() {
    if (recording) return
    note = ''
    const chunks = []
    stopMic = tapMic((pcm) => chunks.push(pcm))
    if (!stopMic) {
      // The voice loop isn't running (it needs a tap first): open the microphone just for this.
      const own = await startMic((pcm) => chunks.push(pcm))
      stopMic = () => own.stop()
    }
    recording = true
    const started = Date.now()
    const ms = SECONDS[kind] * 1000
    await new Promise((done) => {
      const timer = setInterval(() => {
        progress = Math.min(1, (Date.now() - started) / ms)
        if (progress >= 1) {
          clearInterval(timer)
          done()
        }
      }, 50)
    })
    stopMic()
    stopMic = null
    recording = false
    progress = 0

    const length = chunks.reduce((n, c) => n + c.length, 0)
    const audio = new Int16Array(length)
    let at = 0
    for (const c of chunks) {
      audio.set(c, at)
      at += c.length
    }
    let peak = 0
    for (let i = 0; i < audio.length; i++) peak = Math.max(peak, Math.abs(audio[i]))
    if (peak < QUIET) {
      note = "I didn't hear anything. Try again a bit louder or closer?"
      return
    }
    try {
      const r = await (await fetch(`/api/wakeword/sample?kind=${kind}&speaker=${encodeURIComponent(speaker())}`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/octet-stream' },
        body: audio.buffer,
      })).json()
      if (r.error) throw new Error(r.error)
      counts = r.counts
      turn++
      note = 'Got it!'
    } catch (err) {
      note = `Couldn't save it: ${err.message}`
    }
  }

  onDestroy(() => stopMic && stopMic())
</script>

<div class="recorder">
  <h1><Mic size={30} /> Teach Verity your voice</h1>
  <p class="note">
    These recordings stay on the server and are only used to train the "Hey Verity" wake word. Each person: about 40 of
    "Hey Verity" and 20 of other things.
  </p>

  <label>Who's talking? <input bind:value={who} onchange={loadCounts} maxlength="30" /></label>

  <div class="choices">
    <button class="choice" class:picked={kind === 'wake'} onclick={() => ((kind = 'wake'), (turn = 0))}>"Hey Verity" ({counts.wake})</button>
    <button class="choice" class:picked={kind === 'other'} onclick={() => ((kind = 'other'), (turn = 0))}>Other talking ({counts.other})</button>
  </div>

  <p class="prompt">{prompt}</p>
  <button class="record" class:on={recording} onclick={record} disabled={recording}>
    {recording ? 'Listening…' : 'Tap, then say it'}
    <span class="bar" style="width: {progress * 100}%"></span>
  </button>
  {#if note}<p class="result">{note}</p>{/if}

  <div class="buttons">
    <button class="secondary" onclick={onClose}>Done</button>
  </div>
</div>

<style>
  .recorder {
    position: fixed;
    inset: 0;
    z-index: 30;
    overflow-y: auto;
    padding: 24px 32px;
    box-sizing: border-box;
    background: var(--bg);
    color: var(--fg);
    text-align: center;
  }
  h1 {
    margin: 0 0 8px;
  }
  .note {
    color: var(--muted);
    margin: 0 auto 16px;
    max-width: 640px;
  }
  label {
    display: block;
    margin-bottom: 14px;
    font-size: 20px;
  }
  input {
    margin-left: 8px;
    padding: 8px 12px;
    border: 2px solid var(--accent);
    border-radius: 10px;
    background: var(--bg2);
    color: var(--fg);
    font: inherit;
  }
  .choices button {
    margin: 0 6px;
    padding: 10px 18px;
    border: 2px solid var(--accent);
    border-radius: 12px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 18px;
  }
  .choices .picked {
    background: var(--accent);
    color: var(--bg);
  }
  .prompt {
    margin: 22px 0 14px;
    font-size: 30px;
    font-weight: 800;
  }
  .record {
    position: relative;
    overflow: hidden;
    padding: 22px 48px;
    border: 0;
    border-radius: 20px;
    background: var(--accent);
    color: var(--bg);
    font: inherit;
    font-size: 26px;
    font-weight: 800;
  }
  .record.on {
    background: #d33;
    color: #fff;
  }
  .bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 6px;
    background: rgba(255, 255, 255, 0.8);
  }
  .result {
    font-size: 20px;
    margin: 14px 0 0;
  }
  .buttons {
    margin-top: 24px;
  }
  .buttons button {
    padding: 10px 24px;
    border: 2px solid var(--fg);
    border-radius: 12px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 18px;
  }
</style>
