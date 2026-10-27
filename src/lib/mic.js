// Microphone capture as 16 kHz mono 16-bit PCM, using ScriptProcessorNode so it works on old WebViews.
// In Frog Hub's full Android app on Android 5, where GeckoView can't record, the app records instead and passes the
// same PCM to window.frogHubPcm.

const TARGET_RATE = 16000
const appListeners = new Set() // startMic callers sharing the app's recording

function appRecords() {
  return !!(window.FrogHubApp && window.FrogHubApp.nativeMic && window.FrogHubApp.nativeMic())
}

// base64 of little-endian 16-bit samples
function decodePcm(base64) {
  const bytes = atob(base64)
  const out = new Int16Array(bytes.length >> 1)
  for (let i = 0; i < out.length; i++) {
    const v = bytes.charCodeAt(2 * i) | (bytes.charCodeAt(2 * i + 1) << 8)
    out[i] = v > 0x7fff ? v - 0x10000 : v
  }
  return out
}

function getUserMedia(constraints) {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints)
  }
  const legacy = navigator.webkitGetUserMedia || navigator.getUserMedia
  if (!legacy) return Promise.reject(new Error('This browser has no microphone support'))
  return new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject))
}

// `context`: an AudioContext to use (and keep) instead of a new one, so speech can carry on with the microphone off.
export async function startMic(onPcm, context = null) {
  if (appRecords()) {
    const Context = window.AudioContext || window.webkitAudioContext
    const ctx = context || new Context()
    const listener = (pcm) => onPcm(pcm)
    window.frogHubPcm = (base64) => {
      const pcm = decodePcm(base64)
      appListeners.forEach((f) => f(pcm))
    }
    appListeners.add(listener)
    if (appListeners.size === 1) window.FrogHubApp.startMic()
    return {
      context: ctx,
      stop(keepContext = false) {
        if (appListeners.delete(listener) && appListeners.size === 0) window.FrogHubApp.stopMic()
        if (!keepContext) ctx.close()
      },
    }
  }
  const stream = await getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const Context = window.AudioContext || window.webkitAudioContext
  const ctx = context || new Context()
  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const ratio = ctx.sampleRate / TARGET_RATE
  let carry = new Float32Array(0) // samples left over between buffers

  processor.onaudioprocess = (e) => {
    const fresh = e.inputBuffer.getChannelData(0)
    const input = new Float32Array(carry.length + fresh.length)
    input.set(carry)
    input.set(fresh, carry.length)
    const count = Math.floor(input.length / ratio)
    const out = new Int16Array(count)
    for (let i = 0; i < count; i++) {
      // Average the input samples that fall into each output sample (a cheap low-pass).
      const start = Math.floor(i * ratio)
      const end = Math.min(input.length, Math.floor((i + 1) * ratio))
      let sum = 0
      for (let j = start; j < end; j++) sum += input[j]
      const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)))
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
    }
    carry = input.slice(Math.floor(count * ratio))
    onPcm(out)
  }

  source.connect(processor)
  processor.connect(ctx.destination) // Chrome only runs the processor when it's connected

  return {
    context: ctx,
    stop(keepContext = false) {
      processor.disconnect()
      source.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      if (!keepContext) ctx.close()
    },
  }
}
