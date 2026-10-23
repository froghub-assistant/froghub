// Microphone capture as 16 kHz mono 16-bit PCM, using ScriptProcessorNode so it works on old WebViews.

const TARGET_RATE = 16000

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
