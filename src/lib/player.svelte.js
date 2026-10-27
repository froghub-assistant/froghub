// Audio from a URL that the server sent (play_audio, play_radio, or {audio} on /local/announce): one thing at a time,
// at the display's volume, turned down while someone is talking to Frog Hub. HLS radio (the BBC's, say) goes through
// hls.js, loaded only when needed; it also asks for an https copy of each piece, since the page is https.

export const player = $state({ title: '', playing: false, error: '' })

let audio = null
let hls = null // the hls.js player, while one is playing
let level = 1 // the display's volume, 0..1
let ducked = false

const apply = () => audio && (audio.volume = ducked ? level * 0.2 : level)

export async function playAudio({ url, title, hls: isHls }) {
  stopAudio()
  player.error = ''
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
