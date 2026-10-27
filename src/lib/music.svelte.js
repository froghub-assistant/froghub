// This display as a Music Assistant speaker, when the server has Music Assistant (GET /api/instance says so), so
// anything MA plays (and Home Assistant, through it) can play here. Two ways, one at a time:
//   - Sendspin, MA's own streaming protocol, where the browser is new enough (it needs BigInt: Chrome 67 and up).
//     Caddy passes wss://<site>/sendspin on to MA, so the https page can reach it.
//   - Otherwise, in Frog Hub's Android app (old Fire tablets: Chrome 59), a DLNA speaker the app runs itself, playing
//     through Android's own media player; MA finds it on the network.
// Either way it's one speaker per display, named after it, and turned down while someone talks to Frog Hub.

export const music = $state({ via: '', playing: false, title: '', artist: '' })

let player = null // the Sendspin player
let duckGain = null // between Sendspin's own volume and the speaker, for turning it down while someone talks
let ducked = false

/** Whether this browser can run the Sendspin client. */
export function sendspinWorks() {
  return typeof BigInt === 'function' && typeof DataView.prototype.getBigInt64 === 'function' &&
    typeof AudioContext !== 'undefined' && window.isSecureContext
}

/** Becomes a Music Assistant speaker called `name` (again, if the name changed). */
export async function startMusic(name) {
  stopMusic()
  if (sendspinWorks()) {
    const { SendspinPlayer } = await import('@sendspin/sendspin-js')
    const p = new SendspinPlayer({
      baseUrl: location.origin,
      clientName: name,
      productName: 'Frog Hub',
      correctionMode: 'quality-local', // one speaker on its own: no pitch shifts to keep in step with others
      onStateChange: (state) => {
        if (player !== p) return
        const meta = state.serverState && state.serverState.metadata
        music.playing = state.isPlaying
        music.title = (meta && meta.title) || ''
        music.artist = (meta && meta.artist) || ''
        insertDuck(p)
      },
    })
    player = p
    music.via = 'sendspin'
    p.unlock().catch(() => {}) // the page has usually had its tap already; if not, unlockMusic() on the next one
    await p.connect()
  } else if (window.FrogHubApp && window.FrogHubApp.startDlna) {
    // The app says what its speaker is playing through this
    window.frogHubDlna = (state) => Object.assign(music, { playing: !!state.playing, title: state.title || '', artist: state.artist || '' })
    window.FrogHubApp.startDlna(name)
    music.via = 'dlna'
  }
}

export function stopMusic() {
  if (player) player.disconnect('shutdown')
  player = null
  duckGain = null
  if (music.via === 'dlna' && window.FrogHubApp && window.FrogHubApp.stopDlna) window.FrogHubApp.stopDlna()
  Object.assign(music, { via: '', playing: false, title: '', artist: '' })
}

/** The now-playing pill's stop button: stops Music Assistant's queue for this speaker. */
export function stopMusicPlaying() {
  if (player) player.sendCommand('stop', {})
  else if (music.via === 'dlna' && window.FrogHubApp && window.FrogHubApp.stopDlnaPlayback) window.FrogHubApp.stopDlnaPlayback()
}

/** From a tap, for browsers that wouldn't let the speaker start without one. */
export function unlockMusic() {
  if (player) player.unlock().catch(() => {})
}

/** Quieter while Frog Hub is listening or talking. */
export function duckMusic(on) {
  ducked = on
  if (duckGain) duckGain.gain.setTargetAtTime(on ? 0.2 : 1, duckGain.context.currentTime, 0.1)
  if (music.via === 'dlna' && window.FrogHubApp && window.FrogHubApp.duckDlna) window.FrogHubApp.duckDlna(on)
}

// Sendspin's volume is MA's (a volume change here would show in MA), so ducking is a gain node of our own after its
// own one, put in once it has made its audio context. scheduler, gainNode and audioContext aren't public: checked
// against @sendspin/sendspin-js 5.0.0 (package.json pins it); if they move, it just doesn't duck.
function insertDuck(p) {
  const scheduler = p.scheduler
  if (!scheduler || !scheduler.gainNode || !scheduler.audioContext) return
  const ctx = scheduler.audioContext
  if (duckGain && duckGain.context === ctx) return // already in (a new stream format makes a new context)
  const g = ctx.createGain()
  g.gain.value = ducked ? 0.2 : 1
  scheduler.gainNode.disconnect()
  scheduler.gainNode.connect(g)
  g.connect(scheduler.streamDestination || ctx.destination)
  duckGain = g
}
