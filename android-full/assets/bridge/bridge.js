// window.FrogHubApp for Frog Hub's page in the full app, the same as the WebView app's (android/ MainActivity's
// PageBridge), passed on to GeckoActivity over a native messaging port. GeckoActivity only answers on Frog Hub's
// own site; anywhere else the port is closed straight away and these do nothing.
'use strict'

let port = null
// GeckoActivity sends the settings when the port opens and after every change, since getSettings() has to answer
// at once and messages to the app can't.
let settings = '{}'

function send(message) {
  if (port) port.postMessage(message)
}

port = browser.runtime.connectNative('froghub')
port.onMessage.addListener((message) => {
  if (message.settings) settings = message.settings
  if (message.call) {
    // GeckoActivity calling a function of the page's, such as frogHubDlna(state)
    const f = window.wrappedJSObject[message.call]
    if (typeof f === 'function') f(cloneInto(JSON.parse(message.json), window))
  }
})
port.onDisconnect.addListener(() => {
  port = null
})

window.wrappedJSObject.FrogHubApp = cloneInto({
  wake: () => send({ type: 'wake' }),
  getSettings: () => settings,
  setSettings: (json) => send({ type: 'setSettings', json: String(json) }),
  exit: () => send({ type: 'exit' }),
  startDlna: (name) => send({ type: 'startDlna', name: String(name) }),
  stopDlna: () => send({ type: 'stopDlna' }),
  duckDlna: (on) => send({ type: 'duckDlna', on: !!on }),
  stopDlnaPlayback: () => send({ type: 'stopDlnaPlayback' }),
}, window, { cloneFunctions: true })
