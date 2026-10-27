// Audio from a URL that the server sent (play_audio, play_radio, or {audio} on /local/announce): one thing at a time,
// at the display's volume, turned down while someone is talking to Frog Hub. HLS radio (the BBC's, say) goes through
// hls.js, loaded only when needed; it also asks for an https copy of each piece, since the page is https.
// Sleep sounds for the goodnight routine (rain, waves, white noise) are made here instead, with Web Audio, so they
// need no network and never end on their own; anything can be given `minutes`, after which it fades out and stops.

export const player = $state({ title: '', playing: false, error: '' })

let audio = null
let hls = null // the hls.js player, while one is playing
let noise = null // a sleep sound, while one is playing: { nodes, gain, loudness }
let context = null
let level = 1 // the display's volume, 0..1
let ducked = false
let fade = 1 // 1, down to 0 over the last minute of `minutes`
let fadeTimer = null

const FADE_SECONDS = 60
const apply = () => {
  const volume = (ducked ? level * 0.2 : level) * fade
  if (audio) audio.volume = volume
  if (noise) noise.gain.gain.value = volume * noise.loudness
}

export const SLEEP_SOUNDS = { rain: 'Rain', waves: 'Waves', 'white noise': 'White noise' }

// Some seconds of noise, looped: white, pink (rain) or brown (waves). The end is cross-faded into the start, so the
// loop has no click.
function noiseBuffer(ctx, colour) {
  const rate = ctx.sampleRate
  const n = rate * 8
  const overlap = Math.floor(rate / 2)
  const x = new Float32Array(n + overlap)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0
  for (let i = 0; i < x.length; i++) {
    const white = Math.random() * 2 - 1
    if (colour === 'brown') {
      last = (last + 0.02 * white) / 1.02
      x[i] = last * 3.5
    } else if (colour === 'pink') {
      // Paul Kellet's filter
      b0 = 0.99886 * b0 + white * 0.0555179
      b1 = 0.99332 * b1 + white * 0.0750759
      b2 = 0.969 * b2 + white * 0.153852
      b3 = 0.8665 * b3 + white * 0.3104856
      b4 = 0.55 * b4 + white * 0.5329522
      b5 = -0.7616 * b5 - white * 0.016898
      x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
      b6 = white * 0.115926
    } else x[i] = white
  }
  const buffer = ctx.createBuffer(1, n, rate)
  const d = buffer.getChannelData(0)
  d.set(x.subarray(0, n))
  for (let i = 0; i < overlap; i++) {
    const t = i / overlap
    d[i] = x[i] * Math.sqrt(t) + x[n + i] * Math.sqrt(1 - t)
  }
  return buffer
}

function startNoise(kind) {
  context = context || new (window.AudioContext || window.webkitAudioContext)()
  const ctx = context
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const source = ctx.createBufferSource()
  source.buffer = noiseBuffer(ctx, kind === 'rain' ? 'pink' : kind === 'waves' ? 'brown' : 'white')
  source.loop = true
  const nodes = [source]
  let last = source
  const filter = (type, frequency) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = frequency
    last.connect(f)
    nodes.push(f)
    last = f
  }
  if (kind === 'rain') (filter('highpass', 200), filter('lowpass', 6000))
  else if (kind === 'waves') {
    filter('lowpass', 1000)
    // the sea coming in and going out, every ten seconds or so
    const swell = ctx.createGain()
    swell.gain.value = 0.6
    const wave = ctx.createOscillator()
    wave.frequency.value = 0.1
    const depth = ctx.createGain()
    depth.gain.value = 0.4
    wave.connect(depth).connect(swell.gain)
    last.connect(swell)
    nodes.push(swell, wave, depth)
    last = swell
    wave.start()
  } else filter('lowpass', 9000) // softer than raw white noise
  const gain = ctx.createGain()
  last.connect(gain).connect(ctx.destination)
  nodes.push(gain)
  source.start()
  noise = { nodes, gain, loudness: kind === 'white noise' ? 0.2 : 0.5 }
}

/** Plays `url` (or the sleep sound `noise`), replacing whatever was playing; with `minutes`, it fades out then. */
export async function playAudio({ url, title, hls: isHls, noise: kind, minutes }) {
  stopAudio()
  player.error = ''
  if (minutes > 0) {
    fadeTimer = setTimeout(function fadeOut() {
      fade = Math.max(0, fade - 1 / FADE_SECONDS)
      apply()
      fadeTimer = fade > 0 ? setTimeout(fadeOut, 1000) : (stopAudio(), null)
    }, Math.max(0, minutes * 60 - FADE_SECONDS) * 1000)
  }
  if (kind) {
    if (!SLEEP_SOUNDS[kind]) return
    player.title = title || SLEEP_SOUNDS[kind]
    player.playing = true
    try {
      startNoise(kind)
      apply()
    } catch (err) {
      stopAudio()
      player.error = `Couldn't play that (${err.message})`
    }
    return
  }
  const a = new Audio()
  audio = a
  a.preload = 'auto'
  player.title = title || 'Audio'
  player.playing = true
  const done = () => audio === a && stopAudio()
  const failed = (why) => {
    if (audio !== a) return
    player.error = why ? `Couldn't play that (${why})` : "Couldn't play that"
    done()
  }
  a.onended = done
  a.onerror = () => failed()
  if (isHls) {
    const Hls = (await import('hls.js/light')).default
    if (audio !== a) return // stopped while it loaded
    if (Hls.isSupported()) {
      const h = new Hls({ xhrSetup: (xhr, u) => xhr.open('GET', u.replace(/^http:/, 'https:'), true) })
      hls = h
      h.on(Hls.Events.ERROR, (_, data) => data.fatal && failed(data.details))
      h.loadSource(url)
      h.attachMedia(a)
    } else a.src = url // e.g. Safari, which plays HLS itself
  } else a.src = url
  apply()
  const started = a.play()
  if (started && started.catch) started.catch((err) => failed(err.message))
}

export function stopAudio() {
  clearTimeout(fadeTimer)
  fadeTimer = null
  fade = 1
  if (noise) {
    for (const node of noise.nodes) {
      if (node.stop) node.stop()
      node.disconnect()
    }
    noise = null
  }
  if (hls) {
    hls.destroy()
    hls = null
  }
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load() // lets go of a stream
  }
  audio = null
  player.playing = false
  player.title = ''
}

export function setAudioVolume(percent) {
  level = Math.max(0, Math.min(100, Number(percent) || 0)) / 100
  apply()
}

/** Quieter while Frog Hub is listening or talking. */
export function duck(on) {
  ducked = on
  apply()
}
