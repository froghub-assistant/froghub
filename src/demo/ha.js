// The demo's pretend Home Assistant (in place of ../lib/ha.js, see vite.config.js): a bedroom with a lamp, fairy
// lights and a fan, and the weather. Replies are spoken with the browser's own voices instead of Piper.

import { voice } from '../lib/assist.svelte.js'

const AREA = 'bedroom'
const entity = (entity_id, name, state, attributes = {}) => ({ entity_id, state, attributes: { friendly_name: name, ...attributes } })
const states = {
  'light.lamp': entity('light.lamp', 'Lamp', 'on', { brightness: 255 }),
  'light.fairy_lights': entity('light.fairy_lights', 'Fairy lights', 'off'),
  'fan.fan': entity('fan.fan', 'Fan', 'off'),
  'weather.home': entity('weather.home', 'Home', 'partlycloudy', { temperature: 14, temperature_unit: '°C' }),
}

export class HomeAssistant {
  constructor() {
    this.onclose = null
    this.listeners = new Set()
  }

  async connect() {}

  close() {}

  async call(msg) {
    if (msg.type === 'get_states') return Object.values(states)
    if (msg.type === 'config/area_registry/list') return [{ area_id: AREA, name: 'Bedroom' }]
    if (msg.type === 'config/device_registry/list') return []
    if (msg.type === 'config/entity_registry/list') return Object.keys(states).map((entity_id) => ({ entity_id, area_id: AREA, platform: 'demo' }))
    if (msg.type === 'assist_pipeline/pipeline/list') return { pipelines: [] }
    if (msg.type === 'call_service') return this.service(msg.service, msg.service_data)
    return null
  }

  subscribe(msg, callback) {
    if (msg.type === 'subscribe_events') this.listeners.add(callback)
    if (msg.type === 'assist_pipeline/run' && msg.start_stage === 'tts') say(msg.input.text, () => callback({ type: 'run-end', data: {} }))
    return { id: 0, result: Promise.resolve(), stop: () => this.listeners.delete(callback) }
  }

  sendAudio() {}

  callService(domain, service, data) {
    return this.call({ type: 'call_service', domain, service, service_data: data })
  }

  absolute(path) {
    return path
  }

  service(service, data) {
    const old = states[data.entity_id]
    if (!old) return null
    const on = service === 'toggle' ? old.state !== 'on' : service === 'turn_on'
    const attributes = { ...old.attributes }
    if (on && data.brightness_pct) attributes.brightness = Math.round(data.brightness_pct * 2.55)
    const new_state = { ...old, state: on ? 'on' : 'off', attributes }
    states[data.entity_id] = new_state
    for (const cb of this.listeners) cb({ data: { entity_id: data.entity_id, new_state } })
    return null
  }
}

// Speaks with the browser's speech synthesis (or just waits a little, without it), with the face talking meanwhile.
function say(text, done) {
  voice.status = 'speaking'
  const synth = window.speechSynthesis
  let finished = false
  const finish = () => !finished && ((finished = true), done())
  setTimeout(finish, 1500 + text.length * 90) // some browsers never say they've finished
  if (!synth) return setTimeout(finish, 800 + text.length * 50)
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-GB'
  u.pitch = 1.2
  u.onend = finish
  u.onerror = finish
  synth.cancel()
  synth.speak(u)
}
