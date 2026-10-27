// Frog Hub's demo (demo/index.html, built with `vite build --mode demo` into the docs site): the real display app, with
// the server (server.js) and Home Assistant (ha.js) pretended in the browser. Imported first, so the pretend server is
// answering before the app's modules ask it anything.
import './server.js'
import { settings, saveSettings } from '../lib/settings.svelte.js'
import { mount } from 'svelte'
import '../app.css'
import App from '../App.svelte'
import DemoBar from './DemoBar.svelte'

// Already set up, in a bedroom, for Sam; no microphone (the demo has no speech-to-text), and never night unless it's
// told goodnight. The personality and volume stay as the visitor left them.
Object.assign(settings, {
  haUrl: 'demo', token: 'demo', setUp: true, sync: false, area: 'bedroom', name: settings.name || 'Sam',
  deviceId: 'demo', micMuted: true, nightStart: 0, nightEnd: 0,
})
saveSettings()
try {
  localStorage.removeItem('froghub-sleep') // a goodnight from an earlier visit would keep it dark until midnight
} catch {
  // storage blocked: nothing kept anyway
}

// The display fills the window below the demo's bar. The transform makes #app what its full-screen (position: fixed)
// parts fill, instead of the whole window.
const app = document.getElementById('app')
app.style.cssText = 'position: fixed; left: 0; right: 0; bottom: 0; top: var(--demo-bar, 72px); transform: translateZ(0); overflow: hidden'
mount(App, { target: app })
mount(DemoBar, { target: document.body })
