// Alarms and timers live on the server (set by the assistant); this polls them and rings the one that's due.

const POLL_MS = 10000
const RING_MAX_MS = 10 * 60 * 1000 // give up (counts as stopped) after ten minutes

export const alarm = $state({ ringing: null }) // { id, label, timer } while ringing

let list = []
let skew = 0 // the server's clock minus ours
let chime = null

async function poll() {
  try {
    const r = await (await fetch('/api/alarms')).json()
    skew = r.now - Date.now()
    list = r.alarms
  } catch {
    // server unreachable, or an assistant without alarms; try again next time
  }
}

export function startAlarms() {
  poll()
  setInterval(poll, POLL_MS)
  setInterval(() => {
    if (alarm.ringing) return
    const due = list.find((a) => a.next <= Date.now() + skew)
    if (due) ring(due)
  }, 1000)
}

function ring(a) {
  alarm.ringing = a
  list = list.filter((x) => x.id !== a.id)
  chime = playChime()
  const started = Date.now()
  const giveUp = setInterval(() => {
    if (alarm.ringing !== a) return clearInterval(giveUp)
    if (window.FrogHubApp) window.FrogHubApp.wake()
    if (Date.now() - started > RING_MAX_MS) {
      clearInterval(giveUp)
      finish('done')
    }
  }, 5000)
  if (window.FrogHubApp) window.FrogHubApp.wake()
}

export function finish(how) {
  const a = alarm.ringing
  if (!a) return
  alarm.ringing = null
  if (chime) chime.stop()
  chime = null
  fetch(`/api/alarms/${how}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: a.id }),
  }).then(poll, poll)
}

// A friendly three-note chime every two seconds, getting louder for the first half minute.
function playChime() {
  const Context = window.AudioContext || window.webkitAudioContext
  const ctx = new Context()
  const started = ctx.currentTime
  const notes = [659.25, 783.99, 1046.5] // E5 G5 C6
  const play = () => {
    const loud = Math.min(1, 0.25 + (ctx.currentTime - started) / 40)
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.22
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.5 * loud, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.65)
    })
  }
  play()
  const timer = setInterval(play, 2000)
  return {
    stop() {
      clearInterval(timer)
      ctx.close()
    },
  }
}
