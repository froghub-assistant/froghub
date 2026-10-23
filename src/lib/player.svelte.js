// Audio from a URL that the server sent (play_audio, or {audio} on /local/announce): one thing at a time, at the
// display's volume, turned down while someone is talking to Frog Hub.

export const player = $state({ title: '', playing: false, error: '' })

let audio = null
let level = 1 // the display's volume, 0..1
let ducked = false

const apply = () => audio && (audio.volume = ducked ? level * 0.2 : level)

export function playAudio({ url, title }) {
  stopAudio()
  player.error = ''
  const a = new Audio()
  audio = a
  a.preload = 'auto'
  a.src = url
  apply()
  const done = () => audio === a && stopAudio()
  a.onended = done
  a.onerror = () => {
    if (audio !== a) return
    player.error = "Couldn't play that"
    done()
  }
  player.title = title || 'Audio'
  player.playing = true
  const started = a.play()
  if (started && started.catch) started.catch((err) => {
    if (audio !== a) return
    player.error = `Couldn't play that (${err.message})`
    done()
  })
}

export function stopAudio() {
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
