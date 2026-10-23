// Always-listening voice. Home Assistant does the plumbing: the wake word (openWakeWord on the server) and
// speech-to-text (Whisper) in one pipeline run, then text-to-speech (Piper) in another. The answer itself
// comes from Frog Hub's own assistant (a separate Claude Code session) via /api/ask.

import { startMic } from './mic.js'

export const voice = $state({
  status: 'off', // off | waiting | listening | thinking | speaking | error
  heard: '', // what Whisper heard
  reply: '', // what the assistant said
  error: '',
  wakeWord: '',
  muted: false, // the microphone is switched off (the 🎙️ button): no wake word, nothing heard or sent
})

const FOLLOW_UP_WINDOW = 5 * 60 * 1000 // keep the same conversation for 5 minutes
const ASK_TIMEOUT = 50000
// What Whisper "hears" in silence or background noise after a false wake. Answering these made Frog Hub
// pipe up out of nowhere, so they're dropped.
// Whisper's initial prompt lists the names below, and on silence it tends to echo them back.
const NOT_SPEECH = /^[\s.,!?…-]*$|^(thank you|thanks|thanks for watching|you|bye|okay|ok|hmm+|uh+|um+|so|yeah|music|applause|silence|the end|subtitles by.*|please subscribe.*)[\s.,!?…]*$|^((verity|falsity|lovity|frog)[\s.,!?…]*)+$/i

let ha = null
let options = null // { personality, getContext, onActions }
let pipelines = []
let ctx = null // the AudioContext replies play through (the microphone's too, while it's on)
let mic = null
let muted = false
let volume = 1 // 0..1, for replies
let gain = null // the reply playing now, to change its volume mid-sentence
let handlerId = null // stt_binary_handler_id of the current run; audio is only sent while set
let run = null
let stopped = true
let conversation = { id: null, at: 0 }
let playing = null
let tap = null // also gets the microphone's audio while set (the wake word recorder)

function pipelineId() {
  const wanted = options.personality.pipeline.toLowerCase()
  const match = pipelines.find((p) => p.name.toLowerCase() === wanted)
  return match ? match.id : undefined // undefined = HA's preferred pipeline
}

function conversationId() {
  if (!conversation.id || Date.now() - conversation.at > FOLLOW_UP_WINDOW) {
    conversation.id = 'froghub-' + Math.random().toString(36).slice(2, 10)
  }
  conversation.at = Date.now()
  return conversation.id
}

function onPcm(pcm) {
  if (tap) tap(pcm)
  if (handlerId !== null && voice.status !== 'speaking') ha.sendAudio(handlerId, pcm)
}

export async function startVoice(client, opts) {
  ha = client
  options = opts
  muted = voice.muted = !!opts.muted
  pipelines = (await ha.call({ type: 'assist_pipeline/pipeline/list' })).pipelines
  updateWakeWord()
  if (!ctx) {
    const Context = window.AudioContext || window.webkitAudioContext
    ctx = new Context()
  }
  if (!mic && !muted) mic = await startMic(onPcm, ctx)
  if (ctx.state === 'suspended') {
    // Without a tap since the page loaded, the browser may keep it suspended (and resume() waiting) for good
    await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1000))])
    if (ctx.state === 'suspended') throw new Error('The speaker needs a tap first')
  }
  stopped = false
  listen('wake_word')
}

// Without Home Assistant there's no microphone, wake word or voice: typed questions still get answers, shown on screen.
export function startTextOnly(opts) {
  ha = null
  options = opts
  stopped = false
  voice.status = 'waiting'
  voice.wakeWord = ''
}

export function setPersonality(personality) {
  if (!options) return
  options.personality = personality
  updateWakeWord()
}

function updateWakeWord() {
  const id = pipelineId()
  const chosen = pipelines.find((p) => p.id === id) || pipelines[0]
  voice.wakeWord = chosen && chosen.wake_word_id ? chosen.wake_word_id.replace(/_v\d.*$/, '').replace(/_/g, ' ') : ''
}

export function stopVoice() {
  stopped = true
  endRun()
  if (playing) playing.stop()
  if (mic) mic.stop(true)
  mic = null
  if (ctx) ctx.close().catch(() => {})
  ctx = null
  voice.status = 'off'
}

/** The 🎙️ button (or the admin page): off closes the microphone itself, so nothing is heard or sent until it's back on.
 * Replies to typed questions, announcements and alarms still sound. */
export async function setMicMuted(on) {
  muted = voice.muted = !!on
  if (muted) {
    endStream()
    endRun()
    if (mic) mic.stop(true)
    mic = null
    tap = null
    if (['listening', 'error'].includes(voice.status)) voice.status = 'waiting'
    return
  }
  if (stopped || !ha || mic) return
  try {
    mic = await startMic(onPcm, ctx)
  } catch (err) {
    voice.status = 'error'
    voice.error = 'Could not turn the microphone on: ' + err.message
    return
  }
  // Mid-reply, the reply goes back to the wake word itself when it's done
  if (!['thinking', 'speaking'].includes(voice.status)) again('wake_word', 0)
}

/** Volume for replies and announcements, 0 to 100. */
export function setVolume(percent) {
  volume = Math.max(0, Math.min(100, Number(percent) || 0)) / 100
  if (gain) gain.gain.value = volume
}

// Tapping the face: start listening without the wake word, stop listening (finish the sentence now),
// or cut a spoken reply short.
export function tapToTalk() {
  if (stopped || !ha || muted) return
  if (voice.status === 'waiting' || voice.status === 'error') {
    endStream()
    endRun()
    voice.heard = ''
    voice.reply = ''
    listen('stt')
  } else if (voice.status === 'listening') {
    endStream() // HA treats an empty audio frame as the end of speech and transcribes what it has
    voice.status = 'thinking' // transcribing can take a few seconds on the server; show that we've stopped
  } else if (voice.status === 'speaking' && playing) {
    playing.stop()
  }
}

// Typed instead of spoken (the keyboard button): skip the microphone and answer it like something heard.
export function askText(text) {
  text = text.trim()
  if (stopped || !options || !text || ['thinking', 'speaking'].includes(voice.status)) return false
  endStream()
  endRun()
  voice.heard = text
  voice.reply = ''
  respond(text)
  return true
}

// The wake word recorder borrows the microphone the voice loop already has open (the same audio the wake word hears).
// Returns a function that stops it, or null if the microphone isn't running yet.
export function tapMic(fn) {
  if (!mic) return null
  tap = fn
  return () => {
    if (tap === fn) tap = null
  }
}

// Said without being asked (an announcement from the server): waits until nobody's mid-conversation, then shows and
// says each in turn. silent ones (night time) are only shown.
const unasked = []
let announcing = false
export async function sayUnasked(text, { silent = false, show = () => {} } = {}) {
  unasked.push({ text, silent, show })
  if (announcing) return
  announcing = true
  while (unasked.length) {
    while (['listening', 'thinking', 'speaking'].includes(voice.status)) await new Promise((r) => setTimeout(r, 1000))
    const a = unasked.shift()
    voice.heard = ''
    voice.reply = a.text
    a.show()
    if (!a.silent && !stopped && ha && ctx) {
      endStream()
      endRun()
      await speak(a.text)
      if (!stopped) again('wake_word')
    }
  }
  announcing = false
}

function endStream() {
  if (handlerId !== null) ha.sendAudio(handlerId, new Int16Array(0))
  handlerId = null
}

function endRun() {
  if (run) run.stop()
  run = null
  handlerId = null
}

function again(stage, delay = 300) {
  endRun()
  if (!stopped) setTimeout(() => !stopped && listen(stage), delay)
}

function fail(message, delay = 2000) {
  voice.error = message
  voice.reply = options.personality.error
  voice.status = 'waiting'
  again('wake_word', delay)
}

// Wake word (or straight to listening for a follow-up) → speech-to-text.
function listen(stage) {
  if (stopped || !ha) return
  if (muted || !mic) {
    voice.status = 'waiting' // the microphone is off: typed questions only
    return
  }
  voice.status = stage === 'wake_word' ? 'waiting' : 'listening'
  let heard = ''

  run = ha.subscribe(
    {
      type: 'assist_pipeline/run',
      start_stage: stage,
      end_stage: 'stt',
      pipeline: pipelineId(),
      timeout: 3600,
      input: stage === 'wake_word'
        ? { sample_rate: 16000, timeout: 3600, noise_suppression_level: 2, auto_gain_dbfs: 15 }
        : { sample_rate: 16000 },
    },
    (event) => {
      const data = event.data || {}
      switch (event.type) {
        case 'run-start':
          handlerId = data.runner_data ? data.runner_data.stt_binary_handler_id : null
          break
        case 'wake_word-end':
          if (!data.wake_word_output || !data.wake_word_output.wake_word_id) return again('wake_word')
          voice.status = 'listening'
          voice.heard = ''
          voice.reply = ''
          break
        case 'stt-vad-end':
          voice.status = 'thinking' // they've stopped talking; the rest is transcribing and answering
          break
        case 'stt-end':
          handlerId = null // stop streaming once speech has ended
          heard = data.stt_output ? data.stt_output.text.trim() : ''
          voice.heard = heard
          break
        case 'run-end':
          endRun()
          if (heard && !NOT_SPEECH.test(heard)) respond(heard)
          else again('wake_word')
          break
        case 'error':
          if (data.code === 'wake-engine-missing' || data.code === 'wake-provider-missing') {
            voice.status = 'error'
            voice.error = 'No wake word service in Home Assistant'
            again('wake_word', 30000)
          } else if (data.code === 'stt-no-text-recognized') {
            again('wake_word')
          } else {
            fail(data.message || data.code || 'Voice error')
          }
          break
      }
    },
  )
  run.result.catch((err) => {
    voice.status = 'error'
    voice.error = err.message
    again('wake_word', 5000)
  })
}

// Ask Frog Hub's assistant, carry out any room actions, then speak the answer.
async function respond(text) {
  voice.status = 'thinking'
  // Simple room commands ("lamp off", "pause", "play Sandstorm") are done on the spot, Alexa-fast,
  // without waiting for the assistant.
  const quick = options.quickCommand && options.quickCommand(text)
  if (quick) {
    voice.reply = quick
    await speak(quick)
    if (!stopped) again('wake_word')
    return
  }
  const context = options.getContext()
  let answer
  try {
    const response = await Promise.race([
      fetch('/api/ask', {
        method: 'POST',
        headers: context.adminToken
          ? { 'Content-Type': 'application/json', 'X-Admin-Token': context.adminToken }
          : { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          personality: context.personalityId,
          device: context.device,
          speaker: context.speaker,
          conversation_id: conversationId(),
          devices: context.devices,
        }),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('The assistant took too long')), ASK_TIMEOUT)),
    ])
    if (!response.ok) throw new Error(`The assistant isn't running (${response.status})`)
    answer = await response.json()
  } catch (err) {
    return fail(err.message)
  }
  if (answer.timed_out || !answer.text) return fail('The assistant took too long')

  voice.reply = answer.text
  if (answer.actions && answer.actions.length) options.onActions(answer.actions)
  if (answer.display && options.onDisplay) options.onDisplay(answer.display)
  await speak(answer.text)
  // Always go back to waiting for the wake word, even after a question, rather than opening the mic straight away.
  if (!stopped) again('wake_word')
}

// Text-to-speech through the personality's pipeline (its Piper voice), played with its pitch.
function speak(text) {
  if (!ha) {
    voice.status = 'waiting' // text only: the answer is just shown
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let url = null
    const tts = ha.subscribe(
      { type: 'assist_pipeline/run', start_stage: 'tts', end_stage: 'tts', pipeline: pipelineId(), input: { text } },
      (event) => {
        if (event.type === 'tts-end' && event.data.tts_output) url = event.data.tts_output.url
        if (event.type === 'run-end' || event.type === 'error') {
          tts.stop()
          if (url) play(url).then(resolve)
          else resolve()
        }
      },
    )
    tts.result.catch(() => resolve())
  })
}

// TTS audio comes through Caddy at /tts/ (same origin), so it can be decoded and pitch-shifted.
async function play(url) {
  voice.status = 'speaking'
  try {
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/tts_proxy\//, '/tts/')
    const data = await (await fetch(path)).arrayBuffer()
    const buffer = await new Promise((ok, bad) => ctx.decodeAudioData(data, ok, bad))
    await new Promise((done) => {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = options.personality.pitch || 1
      gain = ctx.createGain()
      gain.gain.value = volume
      source.connect(gain)
      gain.connect(ctx.destination)
      source.onended = done
      playing = { stop: () => { try { source.stop() } catch { /* already stopped */ } done() } }
      source.start(0)
    })
  } catch (err) {
    voice.error = 'Could not play the reply: ' + err.message
  } finally {
    playing = null
    gain = null
    voice.status = 'waiting'
  }
}
