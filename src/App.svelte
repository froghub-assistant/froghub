<script>
  import { onMount } from 'svelte'
  import Face from './lib/Face.svelte'
  import Settings from './lib/Settings.svelte'
  import PinPad from './lib/PinPad.svelte'
  import Onboarding from './lib/Onboarding.svelte'
  import Tiles from './lib/Tiles.svelte'
  import { HomeAssistant } from './lib/ha.js'
  import { personality } from './lib/personalities.js'
  import { settings, saveSettings, pullShared } from './lib/settings.svelte.js'
  import { house } from './lib/house.svelte.js'
  import { alarm, startAlarms, finish as finishAlarm } from './lib/alarms.svelte.js'
  import { voice, startVoice, startTextOnly, stopVoice, setPersonality, tapToTalk, askText, sayUnasked, setMicMuted, setVolume } from './lib/assist.svelte.js'
  import { startAnnouncements, otherDisplays, sendMessage } from './lib/announce.js'

  const WEATHER = {
    'clear-night': '🌙', cloudy: '☁️', fog: '🌫️', hail: '🌨️', lightning: '🌩️', 'lightning-rainy': '⛈️',
    partlycloudy: '⛅', pouring: '🌧️', rainy: '🌦️', snowy: '❄️', 'snowy-rainy': '🌨️', sunny: '☀️',
    windy: '💨', 'windy-variant': '💨', exceptional: '⚠️',
  }
  const TILE_DOMAINS = ['light', 'switch', 'fan', 'media_player']

  let ha = null
  let states = $state({})
  let areas = $state([])
  let areaEntities = $state([])
  let entityDevice = {} // entity_id -> device_id, for actions that address a device (Alexa text commands)
  let connection = $state('connecting') // connecting | ok | error | none (no Home Assistant set up)
  let connectionError = $state('')
  let needsTap = $state(false)
  // A new display gets the welcome; ?welcome shows it again to try it out.
  const setUp = () => settings.setUp || Boolean(settings.token)
  let showOnboarding = $state(!setUp() || new URLSearchParams(location.search).has('welcome'))
  let showSettings = $state(false)
  let showPin = $state(false)
  let adminToken = $state(null) // set while admin mode is unlocked (checked on the server)
  let now = $state(new Date())
  let typing = $state(false) // the keyboard box is open
  let typed = $state('')
  let messaging = $state(false) // the 📢 box is open
  let message = $state('')
  let messageTo = $state('') // a display id, or '' for all of them
  let messageTargets = $state([])
  let messageNote = $state('')

  let p = $derived(personality(settings.personality))
  // This display, as the other displays see it (for messages): its own name, or its room's.
  let areaName = $derived((areas.find((a) => a.area_id === settings.area) || {}).name || '')
  let me = $derived({
    id: settings.deviceId,
    name: settings.deviceName || areaName || 'Frog Hub',
    area: settings.area,
    areaName,
    who: settings.name,
    personality: settings.personality,
    micMuted: settings.micMuted,
    volume: settings.volume,
    ready: setUp() && !showOnboarding, // the welcome finished
  })
  let showVolume = $state(false) // the 🔊 button's slider

  $effect(() => setVolume(settings.volume))

  // The 🎙️ button: the microphone off (or on again), kept across restarts
  function toggleMic() {
    settings.micMuted = !settings.micMuted
    saveSettings()
    setMicMuted(settings.micMuted)
  }
  // The house's time zone from the server: a tablet's own can be wrong (e.g. stuck on GMT on a debloated Fire).
  let TZ = $derived(house.timeZone)
  let hour = $derived(Number(now.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).slice(0, 2)) % 24)
  let night = $derived(
    settings.nightStart > settings.nightEnd
      ? hour >= settings.nightStart || hour < settings.nightEnd
      : hour >= settings.nightStart && hour < settings.nightEnd,
  )
  let weather = $derived(Object.values(states).find((s) => s.entity_id.startsWith('weather.')))
  let partOfDay = $derived(hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening')
  let busy = $derived(['listening', 'thinking', 'speaking'].includes(voice.status))
  // Its moods: tired at bedtime, sad when it can't hear or nobody's talked to it for ages, otherwise happy.
  const LONELY_MS = 3 * 60 * 60 * 1000
  let lastTalked = $state(Date.now())
  $effect(() => {
    if (busy) lastTalked = Date.now()
  })
  const forcedFeeling = new URLSearchParams(location.search).get('feeling') // ?feeling=sad to preview a mood
  let feeling = $derived(
    forcedFeeling || night ? forcedFeeling || 'tired' : voice.status === 'error' || now - lastTalked > LONELY_MS ? 'sad' : 'happy',
  )
  let caption = $derived(
    voice.status === 'listening' ? p.listening
    : voice.status === 'thinking' ? p.thinking
    : voice.status === 'error' ? p.error
    : '',
  )

  $effect(() => {
    // The voice loop uses the personality's pipeline (voice) and pitch.
    setPersonality(p)
    document.title = `${p.name} · Frog Hub`
  })

  async function connect() {
    if (ha) {
      ha.onclose = null
      ha.close()
      ha = null
    }
    if (!settings.token) {
      // No Home Assistant: no voice, room buttons or weather, but typed questions, alarms and messages still work
      connection = 'none'
      states = {}
      areas = []
      areaEntities = []
      if (setUp()) startTextOnly(voiceOptions())
      return
    }
    connection = 'connecting'
    ha = new HomeAssistant(settings.haUrl, settings.token)
    ha.onclose = () => {
      connection = 'error'
      connectionError = 'Lost connection to Home Assistant, retrying…'
      stopVoice()
      setTimeout(connect, 5000)
    }
    try {
      await ha.connect()
      const list = await ha.call({ type: 'get_states' })
      states = Object.fromEntries(list.map((s) => [s.entity_id, s]))
      ha.subscribe({ type: 'subscribe_events', event_type: 'state_changed' }, (event) => {
        const { entity_id, new_state } = event.data
        if (new_state) states[entity_id] = new_state
        else delete states[entity_id]
      })
      await loadAreas()
      connection = 'ok'
      await beginVoice()
    } catch (err) {
      connection = 'error'
      connectionError = err.message
    }
  }

  async function loadAreas() {
    const [areaList, devices, entities] = await Promise.all([
      ha.call({ type: 'config/area_registry/list' }),
      ha.call({ type: 'config/device_registry/list' }),
      ha.call({ type: 'config/entity_registry/list' }),
    ])
    areas = areaList
    const deviceArea = Object.fromEntries(devices.map((d) => [d.id, d.area_id]))
    entityDevice = Object.fromEntries(entities.map((e) => [e.entity_id, e.device_id]))
    areaEntities = entities
      .filter((e) => !e.hidden_by && !e.disabled_by && !e.entity_category && TILE_DOMAINS.includes(e.entity_id.split('.')[0]))
      .filter((e) => settings.area && (e.area_id || deviceArea[e.device_id]) === settings.area)
      .map((e) => e.entity_id)
      .slice(0, 8)
  }

  function voiceOptions() {
    return {
      personality: p,
      muted: settings.micMuted,
      getContext: () => ({
        adminToken,
        device: settings.deviceId,
        personalityId: settings.personality,
        speaker: settings.name,
        devices: areaEntities
          .filter((id) => states[id])
          .map((id) => ({ id, name: states[id].attributes.friendly_name || id, state: states[id].state })),
      }),
      onActions: runActions,
      onDisplay: showCard,
      quickCommand,
    }
  }

  async function beginVoice() {
    try {
      await startVoice(ha, voiceOptions())
      needsTap = voice.status === 'off'
    } catch (err) {
      // Usually autoplay/mic rules wanting a tap first, or the mic permission being refused.
      needsTap = true
      voice.error = err.message
    }
  }

  // Room actions from the assistant: only ever for the devices in the chosen room.
  function runActions(actions) {
    for (const a of actions) {
      if (!areaEntities.includes(a.entity_id)) continue
      const domain = a.entity_id.split('.')[0]
      const value = Math.max(0, Math.min(100, Number(a.value) || 0))
      if (['turn_on', 'turn_off', 'toggle'].includes(a.service)) {
        ha.callService('homeassistant', a.service, { entity_id: a.entity_id })
      } else if (a.service === 'brightness' && domain === 'light') {
        ha.callService('light', 'turn_on', { entity_id: a.entity_id, brightness_pct: value })
      } else if (domain === 'media_player' && ['media_play_pause', 'media_next_track'].includes(a.service)) {
        ha.callService('media_player', a.service, { entity_id: a.entity_id })
      } else if (a.service === 'play_music' && domain === 'media_player' && a.query) {
        playMusic(a.entity_id, a.query)
      } else if (a.service === 'volume' && domain === 'media_player') {
        ha.callService('media_player', 'volume_set', { entity_id: a.entity_id, volume_level: value / 100 })
      }
    }
  }

  // Common room commands, handled here in a few milliseconds instead of asking the assistant. Only ever touches
  // this room's devices; returns the spoken reply, or null to let the assistant deal with it.
  function quickCommand(heard) {
    const t = heard.toLowerCase().replace(/[.,!?]/g, '').replace(/\bplease\b/g, '')
      .replace(/^\s*(hey |ok |okay )?(verity|falsity|lovity|frog)\s+/, '').replace(/\s+/g, ' ').trim()
    const room = areaEntities.filter((id) => states[id])
    const name = (id) => states[id].attributes.friendly_name || id
    const echo = room.find((id) => id.startsWith('media_player.'))
    const playing = echo && states[echo].state === 'playing'

    let m
    // "play <song>" goes to the assistant on purpose: it fixes Whisper's misheard names first.
    if (echo && /^(play|resume|unpause|carry on)( the)?( music| song)?$/.test(t)) {
      if (playing) return null
      ha.callService('media_player', 'media_play_pause', { entity_id: echo })
      return 'Playing!'
    }
    if (echo && /^(pause|stop)( the)?( music| song)?$/.test(t)) {
      if (!playing) return null
      ha.callService('media_player', 'media_play_pause', { entity_id: echo })
      return 'Paused!'
    }
    if (echo && /^(next|skip)( the)?( song| track| one)?$/.test(t)) {
      ha.callService('media_player', 'media_next_track', { entity_id: echo })
      return 'Skipping!'
    }
    if (echo && (m = t.match(/^(?:set )?(?:the )?volume (?:to )?(\d{1,3})(?: percent)?$/))) {
      ha.callService('media_player', 'volume_set', { entity_id: echo, volume_level: Math.min(100, Number(m[1])) / 100 })
      return `Volume ${Math.min(100, Number(m[1]))}!`
    }

    // "turn on the lamp", "switch the light off", "lamp off"
    const on =t.match(/^(?:turn|switch) (on|off) (?:the |my )?(.+)$/)
    const after = t.match(/^(?:turn |switch )?(?:the |my )?(.+) (on|off)$/)
    const [state, target] = on ? [on[1], on[2]] : after ? [after[2], after[1]] : []
    if (!state) return null
    const switchable = room.filter((id) => /^(light|switch|fan)\./.test(id))
    const lightWords = /^(lights?|lamps?)$/
    const match = switchable.find((id) => name(id).toLowerCase().includes(target))
      || (lightWords.test(target) && switchable.filter((id) => id.startsWith('light.')).length === 1
        ? switchable.find((id) => id.startsWith('light.')) : null)
    if (!match) return null
    ha.callService('homeassistant', state === 'on' ? 'turn_on' : 'turn_off', { entity_id: match })
    return `${name(match)} ${state}!`
  }

  // Echos play by voice command, so this works without Spotify Premium. The Echo is addressed by its device.
  async function playMusic(entityId, query) {
    try {
      const deviceId = entityDevice[entityId] || (await ha.call({ type: 'config/entity_registry/get', entity_id: entityId })).device_id
      if (!deviceId) throw new Error(`${entityId} has no device`)
      await ha.callService('alexa_devices', 'send_text_command', { device_id: deviceId, text_command: `play ${query} on Spotify` })
    } catch (err) {
      voice.reply += ` ⚠️ Couldn't start the music: ${err.message}`
    }
  }

  async function tapToStart() {
    needsTap = false
    await beginVoice()
  }

  function openSettings() {
    if (adminToken) showSettings = true
    else showPin = true
  }

  // A card the assistant put on screen (show_on_screen), in place of the clock until it times out or is closed.
  let card = $state(null)
  let cardTimer = null
  function showCard(display) {
    clearTimeout(cardTimer)
    card = display
    cardTimer = setTimeout(() => (card = null), display.seconds * 1000)
  }

  // Something the server wants said (announce.js). At night it's only shown, quietly, unless it says at_night.
  function announced(a) {
    const silent = night && !a.at_night
    sayUnasked(a.text, {
      silent,
      show: () => {
        if (!silent && window.FrogHubApp) window.FrogHubApp.wake()
        if (a.display) showCard(a.display)
        if (a.actions && a.actions.length) runActions(a.actions)
      },
    })
  }

  let settingsKey = $state(0) // bumped to reopen Settings with freshly pulled values

  async function unlocked(token) {
    adminToken = token
    showPin = false
    // Admin mode gets the shared HA token too, so a new tablet only needs the PIN.
    if (settings.sync || !settings.token) {
      const changed = await pullShared(token, !settings.token)
      if (changed.length) settingsKey++
    }
    showSettings = true
  }

  function lockAdmin() {
    if (adminToken) fetch('/api/admin/lock', { method: 'POST', headers: { 'X-Admin-Token': adminToken } }).catch(() => {})
    adminToken = null
    showSettings = false
  }

  // The server ends admin mode after 10 idle minutes; notice that here too.
  $effect(() => {
    if (!adminToken) return
    const token = adminToken
    const timer = setInterval(async () => {
      try {
        const r = await (await fetch('/api/admin/check', { method: 'POST', headers: { 'X-Admin-Token': token } })).json()
        if (!r.admin && adminToken === token) {
          adminToken = null
          showSettings = false
        }
      } catch {
        // server unreachable; try again next time
      }
    }, 30000)
    return () => clearInterval(timer)
  })

  function sendTyped(event) {
    event.preventDefault()
    if (askText(typed)) {
      typed = ''
      typing = false
    }
  }

  // The 📢 button: type a message for the other displays (all of them, or one).
  async function openMessaging() {
    messaging = !messaging
    typing = false
    messageNote = ''
    if (messaging) {
      messageTargets = await otherDisplays(me.id)
      if (!messageTargets.some((d) => d.id === messageTo)) messageTo = ''
    }
  }

  async function sendMessageNow(event) {
    event.preventDefault()
    if (!message.trim()) return
    messageNote = 'Sending…'
    const error = await sendMessage(me, message.trim(), messageTo)
    if (error) {
      messageNote = error
      return
    }
    const where = messageTo ? (messageTargets.find((d) => d.id === messageTo) || {}).name : 'everyone'
    message = ''
    messaging = false
    voice.reply = `📢 Sent to ${where}!`
  }

  // Something a grown-up queued for this display on the admin page (channel/registry.ts).
  function adminCommand(command) {
    if (command.wipe) {
      // Forget everything and start again as a brand-new display (a new id, then the welcome)
      try {
        localStorage.clear()
      } catch {
        // storage blocked: nothing to clear
      }
      location.replace(location.pathname)
      return
    }
    if (command.set) {
      const roomChanged = 'area' in command.set && command.set.area !== settings.area
      Object.assign(settings, command.set)
      saveSettings()
      if ('micMuted' in command.set) setMicMuted(settings.micMuted)
      if (roomChanged) {
        stopVoice()
        connect()
      }
    }
    if (command.welcome) {
      showSettings = false
      showOnboarding = true
    }
  }

  function finishOnboarding(token) {
    showOnboarding = false
    if (token) adminToken = token // copied from the other displays with the PIN: stay unlocked for a bit
    stopVoice()
    connect()
  }

  function closeSettings(saved) {
    showSettings = false
    if (saved) {
      stopVoice()
      connect()
    }
  }

  // In the Android app, light the screen back up when the wake word is heard (and keep it lit while talking).
  $effect(() => {
    if (['listening', 'thinking', 'speaking'].includes(voice.status) && window.FrogHubApp) window.FrogHubApp.wake()
  })

  onMount(() => {
    const timer = setInterval(() => (now = new Date()), 1000)
    connect()
    startAlarms()
    const announceTimer = startAnnouncements(() => me, announced, adminCommand)
    // Settings another display published (admin mode). A new HA address needs a reconnect.
    const sync = async () => {
      if (showSettings || showOnboarding) return
      const changed = await pullShared()
      if (changed.includes('haUrl')) {
        stopVoice()
        connect()
      }
    }
    sync()
    const syncTimer = setInterval(sync, 60000)
    return () => {
      clearInterval(timer)
      clearInterval(syncTimer)
      clearInterval(announceTimer)
    }
  })
</script>

<main
  class:night
  style="--bg: {p.colours.bg}; --bg2: {p.colours.bg2}; --fg: {p.colours.fg}; --muted: {p.colours.muted}; --accent: {p.colours.accent}"
>
  <section class="buddy" class:busy>
    <!-- Without Home Assistant there's no voice: a tap opens the keyboard instead -->
    <button
      class="face-button"
      onclick={() => (connection === 'none' || voice.muted ? (typing = true) : tapToTalk())}
      aria-label={connection === 'none' || voice.muted ? `Type to ${p.name}` : voice.status === 'listening' ? 'Stop listening' : 'Talk'}
    >
      <Face kind={p.face} fill={p.colours.faceFill} ink={p.colours.faceInk} mood={voice.status} {feeling} size={busy ? 260 : 220} />
    </button>
    {#if busy || voice.reply}
      {#if voice.heard}<p class="heard">“{voice.heard}”</p>{/if}
      {#if caption}<p class="caption">{caption}</p>{/if}
      {#if voice.reply && voice.status !== 'listening'}<p class="reply">{voice.reply}</p>{/if}
    {:else}
      <p class="greeting">{p.greeting(settings.name)}</p>
      {#if voice.muted && connection !== 'none'}<p class="hint">🔇 The microphone is off. Tap 🎙️ to turn it on, or tap me to type.</p>
      {:else if voice.wakeWord && voice.status === 'waiting'}<p class="hint">Say “{voice.wakeWord}” or tap me to talk</p>{/if}
      {#if voice.status === 'error'}<p class="hint">{voice.error}</p>{/if}
    {/if}
  </section>

  <section class="info">
    {#if card}
      <div class="card">
        <button class="card-close" onclick={() => (card = null)} aria-label="Close">✕</button>
        {#if card.emoji}<div class="card-emoji">{card.emoji}</div>{/if}
        {#if card.title}<h2>{card.title}</h2>{/if}
        {#if card.image}<img src={card.image} alt={card.title || ''} />{/if}
        {#if card.text}<p>{card.text}</p>{/if}
        {#if card.items && card.items.length}
          <ol>{#each card.items as item, i (i)}<li>{item}</li>{/each}</ol>
        {/if}
      </div>
    {:else}
      <div class="clock">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })}</div>
      <div class="date">{partOfDay} · {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })}</div>
      {#if weather}
        <div class="weather">
          <span class="wicon">{WEATHER[weather.state] || '🌡️'}</span>
          <span>{Math.round(weather.attributes.temperature)}{weather.attributes.temperature_unit || '°'}</span>
          <span class="wdesc">{weather.state.replace('partlycloudy', 'partly cloudy').replace(/-/g, ' ')}</span>
        </div>
      {/if}
      {#if areaEntities.length}
        <Tiles
          {states}
          entities={areaEntities}
          onToggle={(id) => ha.callService('homeassistant', 'toggle', { entity_id: id })}
          onMedia={(id) => ha.callService('media_player', 'media_play_pause', { entity_id: id })}
        />
      {/if}
      {#if connection === 'connecting' || connection === 'error'}
        <p class="status">{connection === 'connecting' ? 'Connecting to Home Assistant…' : connectionError}</p>
      {/if}
    {/if}
  </section>

  <button class="keyboard" onclick={() => ((typing = !typing), (messaging = false))} aria-label="Type to {p.name}">⌨️</button>
  <button class="megaphone" onclick={openMessaging} aria-label="Send a message to the other Frog Hubs">📢</button>
  {#if connection !== 'none'}
    <button class="mic" class:muted={voice.muted} onclick={toggleMic} aria-label={voice.muted ? 'Turn the microphone on' : 'Turn the microphone off'}>{voice.muted ? '🔇' : '🎙️'}</button>
  {/if}
  <button class="speaker" class:low={connection === 'none'} onclick={() => (showVolume = !showVolume)} aria-label="Volume">{settings.volume === 0 ? '🔈' : settings.volume < 50 ? '🔉' : '🔊'}</button>
  {#if showVolume}
    <div class="volume" class:low={connection === 'none'}>
      <input type="range" min="0" max="100" step="5" bind:value={settings.volume} onchange={saveSettings} aria-label="Volume" />
      <span>{settings.volume}%</span>
    </div>
  {/if}
  <button class="gear" onclick={openSettings} aria-label="Settings">⚙️</button>

  {#if typing}
    <form class="typebox" onsubmit={sendTyped}>
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={typed} placeholder="Type to {p.name}…" autofocus enterkeyhint="send" maxlength="500" />
      <button type="submit" disabled={!typed.trim() || busy}>Send</button>
      <button type="button" class="close" onclick={() => (typing = false)} aria-label="Close">✕</button>
    </form>
  {/if}

  {#if messaging}
    <form class="typebox" onsubmit={sendMessageNow}>
      <select bind:value={messageTo} aria-label="Send to">
        <option value="">📢 Everyone</option>
        {#each messageTargets as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
      </select>
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={message} placeholder={messageNote || 'Message for the other Frog Hubs…'} autofocus enterkeyhint="send" maxlength="300" />
      <button type="submit" disabled={!message.trim()}>Send</button>
      <button type="button" class="close" onclick={() => (messaging = false)} aria-label="Close">✕</button>
    </form>
    {#if messageNote && messageNote !== 'Sending…'}<p class="message-note">{messageNote}</p>{/if}
  {/if}

  {#if adminToken}
    <div class="admin">🔓 Admin mode <button onclick={lockAdmin}>Lock</button></div>
  {/if}

  {#if showPin}
    <PinPad onUnlock={unlocked} onCancel={() => (showPin = false)} />
  {/if}

  {#if needsTap && !showSettings && !showOnboarding}
    <button class="tap" onclick={tapToStart}>
      <span>👋 Tap once to wake {p.name} up</span>
      <small>(the browser needs one tap before it lets me use the microphone and speaker)</small>
    </button>
  {/if}

  {#if alarm.ringing}
    <div class="alarm">
      <div class="alarm-icon">{alarm.ringing.timer ? '⏲️' : '⏰'}</div>
      <div class="alarm-label">{alarm.ringing.label}</div>
      <div class="alarm-time">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })}</div>
      <div class="alarm-buttons">
        <button class="stop" onclick={() => finishAlarm('done')}>Stop</button>
        {#if !alarm.ringing.timer}<button class="snooze" onclick={() => finishAlarm('snooze')}>Snooze 9 min</button>{/if}
      </div>
    </div>
  {/if}

  {#if showSettings && !showPin}
    {#key settingsKey}
      <Settings
        {areas}
        {adminToken}
        onClose={closeSettings}
        onUnlock={() => (showPin = true)}
        onWelcome={() => ((showSettings = false), (showOnboarding = true))}
      />
    {/key}
  {/if}

  {#if showOnboarding}
    <Onboarding onDone={finishOnboarding} start={new URLSearchParams(location.search).get('welcome') || 'hello'} />
  {/if}
</main>

<style>
  main {
    position: fixed;
    inset: 0;
    display: flex;
    gap: 24px;
    padding: 24px 32px;
    box-sizing: border-box;
    background: radial-gradient(circle at 25% 40%, var(--bg2), var(--bg) 70%);
    color: var(--fg);
    transition: background 0.6s, filter 1s;
    overflow: hidden;
  }
  main.night {
    filter: brightness(0.35);
  }
  .face-button {
    padding: 0;
    border: 0;
    background: none;
  }
  .buddy {
    flex: 0 0 42%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .greeting {
    font-size: 28px;
    font-weight: 800;
    margin: 18px 0 6px;
  }
  .hint {
    color: var(--muted);
    margin: 0;
  }
  .heard {
    color: var(--muted);
    font-style: italic;
    margin: 14px 0 4px;
  }
  .caption {
    color: var(--accent);
    font-weight: 700;
    margin: 6px 0;
  }
  .reply {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.35;
    margin: 8px 0 0;
    max-height: 220px;
    overflow-y: auto;
  }
  .info {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 14px;
    min-width: 0;
  }
  .clock {
    font-size: 108px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -2px;
  }
  .date {
    font-size: 22px;
    color: var(--muted);
  }
  .weather {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 30px;
    font-weight: 700;
  }
  .wicon {
    font-size: 40px;
  }
  .wdesc {
    font-size: 20px;
    font-weight: 400;
    color: var(--muted);
    text-transform: capitalize;
  }
  .status {
    color: var(--muted);
  }
  .admin {
    position: absolute;
    top: 10px;
    left: 14px;
    z-index: 15;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 14px;
    border-radius: 999px;
    background: #c62828;
    color: #fff;
    font-weight: 700;
    font-size: 14px;
  }
  .admin button {
    border: 0;
    border-radius: 999px;
    padding: 4px 12px;
    background: #fff;
    color: #c62828;
    font: inherit;
  }
  .keyboard {
    position: absolute;
    left: 14px;
    bottom: 10px;
    border: 0;
    background: none;
    font-size: 30px;
    opacity: 0.7;
  }
  .megaphone {
    position: absolute;
    left: 64px;
    bottom: 10px;
    border: 0;
    background: none;
    font-size: 30px;
    opacity: 0.7;
  }
  .mic,
  .speaker {
    position: absolute;
    left: 114px;
    bottom: 10px;
    border: 0;
    background: none;
    font-size: 30px;
    opacity: 0.7;
  }
  .speaker {
    left: 164px;
  }
  .speaker.low {
    left: 114px;
  }
  .mic.muted {
    opacity: 1;
  }
  .volume {
    position: absolute;
    left: 110px;
    bottom: 64px;
    z-index: 10;
    display: flex;
    align-items: center;
    padding: 10px 16px;
    border-radius: 16px;
    background: var(--bg2);
    color: var(--fg);
  }
  .volume.low {
    left: 60px;
  }
  .volume input {
    width: 220px;
    margin-right: 12px;
    accent-color: var(--accent);
  }
  .typebox select {
    max-width: 30%;
    margin-right: 10px;
    padding: 10px 8px;
    border: 2px solid var(--accent);
    border-radius: 12px;
    background: var(--bg2);
    color: var(--fg);
    font: inherit;
    font-size: 20px;
  }
  .message-note {
    position: absolute;
    top: 70px;
    left: 16px;
    z-index: 10;
    margin: 0;
    padding: 6px 12px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.8);
    color: var(--fg);
  }
  /* Along the top, so the on-screen keyboard doesn't cover it. Margins, not gap: Fire OS 5's WebView is Chrome 59. */
  .typebox {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.8);
  }
  .typebox input {
    flex: 1;
    min-width: 0;
    padding: 10px 14px;
    border: 2px solid var(--accent);
    border-radius: 12px;
    background: var(--bg2);
    color: var(--fg);
    font: inherit;
    font-size: 22px;
  }
  .typebox button {
    margin-left: 10px;
    padding: 10px 18px;
    border: 0;
    border-radius: 12px;
    background: var(--accent);
    color: var(--bg);
    font: inherit;
    font-size: 20px;
    font-weight: 800;
  }
  .typebox button:disabled {
    opacity: 0.4;
  }
  .typebox .close {
    background: none;
    color: var(--fg);
  }
  .card {
    position: relative;
    max-height: 100%;
    overflow-y: auto;
    padding: 20px 24px;
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.08);
  }
  .card-close {
    position: absolute;
    top: 10px;
    right: 12px;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 24px;
  }
  .card-emoji {
    font-size: 64px;
    line-height: 1;
  }
  .card h2 {
    font-size: 34px;
    margin: 8px 40px 8px 0;
  }
  .card img {
    display: block;
    max-width: 100%;
    max-height: 280px;
    border-radius: 16px;
    margin: 8px 0;
  }
  .card p {
    font-size: 22px;
    line-height: 1.35;
    margin: 8px 0;
  }
  .card ol {
    font-size: 22px;
    line-height: 1.5;
    margin: 8px 0;
    padding-left: 30px;
  }
  .alarm {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    color: var(--fg);
    text-align: center;
  }
  .alarm-icon {
    font-size: 90px;
    animation: wobble 0.5s ease-in-out infinite alternate;
  }
  @keyframes wobble {
    from { transform: rotate(-12deg); }
    to { transform: rotate(12deg); }
  }
  .alarm-label {
    font-size: 44px;
    font-weight: 800;
    margin-top: 8px;
  }
  .alarm-time {
    font-size: 26px;
    color: var(--muted);
    margin: 4px 0 28px;
  }
  .alarm-buttons button {
    margin: 0 10px;
    padding: 18px 44px;
    border: 0;
    border-radius: 20px;
    font: inherit;
    font-size: 30px;
    font-weight: 800;
  }
  .alarm-buttons .stop {
    background: var(--accent);
    color: var(--bg);
  }
  .alarm-buttons .snooze {
    background: rgba(255, 255, 255, 0.12);
    color: var(--fg);
  }
  .gear {
    position: absolute;
    right: 14px;
    bottom: 10px;
    border: 0;
    background: none;
    font-size: 22px;
    opacity: 0.35;
  }
  .tap {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 0;
    background: rgba(0, 0, 0, 0.75);
    color: var(--fg);
    font: inherit;
    font-size: 30px;
    font-weight: 800;
    z-index: 5;
  }
  .tap small {
    font-size: 15px;
    font-weight: 400;
    color: var(--muted);
  }
</style>
