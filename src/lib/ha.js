// A small Home Assistant WebSocket client: auth, commands, subscriptions and binary audio frames.

export class HomeAssistant {
  constructor(url, token) {
    this.url = url.replace(/\/+$/, '')
    this.token = token
    this.nextId = 1
    this.pending = new Map() // id -> { resolve, reject }
    this.listeners = new Map() // id -> callback for events
    this.onclose = null
    this.ws = null
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url.replace(/^http/, 'ws') + '/api/websocket')
      ws.binaryType = 'arraybuffer'
      this.ws = ws
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: this.token }))
        else if (msg.type === 'auth_ok') resolve()
        else if (msg.type === 'auth_invalid') reject(new Error('Home Assistant rejected the token'))
        else if (msg.type === 'result') {
          const p = this.pending.get(msg.id)
          if (!p) return
          this.pending.delete(msg.id)
          if (msg.success) p.resolve(msg.result)
          else p.reject(new Error(msg.error ? msg.error.message : 'Command failed'))
        } else if (msg.type === 'event') {
          const cb = this.listeners.get(msg.id)
          if (cb) cb(msg.event)
        }
      }
      ws.onerror = () => reject(new Error('Could not reach Home Assistant'))
      ws.onclose = () => {
        for (const p of this.pending.values()) p.reject(new Error('Connection closed'))
        this.pending.clear()
        this.listeners.clear()
        if (this.onclose) this.onclose()
      }
    })
  }

  close() {
    this.onclose = null
    if (this.ws) this.ws.close()
  }

  // Send a command and wait for its result.
  call(msg) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ ...msg, id }))
    })
  }

  // Send a command whose events (e.g. pipeline runs, subscriptions) arrive under the same id.
  subscribe(msg, callback) {
    const id = this.nextId++
    this.listeners.set(id, callback)
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    this.ws.send(JSON.stringify({ ...msg, id }))
    return { id, result, stop: () => this.listeners.delete(id) }
  }

  // Audio for the assist pipeline: one byte of handler id, then 16-bit PCM.
  sendAudio(handlerId, pcm) {
    if (!this.ws || this.ws.readyState !== 1) return
    const frame = new Uint8Array(1 + pcm.byteLength)
    frame[0] = handlerId
    frame.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 1)
    this.ws.send(frame.buffer)
  }

  callService(domain, service, data) {
    return this.call({ type: 'call_service', domain, service, service_data: data })
  }

  absolute(path) {
    return /^https?:/.test(path) ? path : this.url + path
  }
}
