<script>
  // First-run welcome for a new display: say hello, connect (copy everything from the other Frog Hubs with the PIN,
  // or type in Home Assistant's address and token), pick a personality, say who it's for and which room, try the
  // microphone, then a little party. A grown-up can also make it a grown-ups display (needs the PIN). Shown instead of Settings while there's no HA token (or from Settings → admin).
  import { fly, fade, scale } from 'svelte/transition'
  import { backOut } from 'svelte/easing'
  import Face from './Face.svelte'
  import PinPad from './PinPad.svelte'
  import { HomeAssistant } from './ha.js'
  import { startMic } from './mic.js'
  import { personalities, personality } from './personalities.js'
  import { settings, saveSettings, SYNCED } from './settings.svelte.js'
  import { house, houseLoaded } from './house.svelte.js'
  import { startHaLogin, pendingHaLogin, finishHaLogin, newPairing, waitForPairing } from './connect.js'

  let { onDone, start = 'hello' } = $props()

  const STEPS = ['hello', 'connect', 'personality', 'about', 'mic', 'done']
  // svelte-ignore state_referenced_locally (where it starts)
  let step = $state(STEPS.includes(start) ? start : 'hello') // ?welcome=mic opens at that page, to try it out
  let forward = $state(true) // which way the pages slide
  let at = $derived(STEPS.indexOf(step))

  let draft = $state({ ...settings })
  houseLoaded.then(() => {
    if (!draft.haUrl) draft.haUrl = house.haUrl // this house's Home Assistant, from the server
  })
  // svelte-ignore state_referenced_locally (from where it starts)
  let picked = $state(STEPS.indexOf(step) > STEPS.indexOf('personality')) // a personality has been chosen (past its page)
  // Frog Hub is a frog until a personality is picked
  let p = $derived(personality(step === 'personality' || picked ? draft.personality : 'frog'))
  let adminToken = $state(null)
  let grownUps = $state(false) // a grown-ups display: no kids' rules (saved on the server at the end, with the PIN)

  function go(next) {
    // Without Home Assistant there's no voice, so the microphone page is skipped both ways
    if (next === 'mic' && noHa) next = STEPS.indexOf('mic') > at ? 'done' : 'about'
    forward = STEPS.indexOf(next) > at
    step = next
  }

  function skipHa() {
    noHa = true
    draft.token = ''
    go('personality')
  }

  // ── Connecting ──
  let manual = $state(false) // typing the address and token instead of copying them
  let noHa = $state(false) // set up without Home Assistant: no voice, so no microphone page
  let showPin = $state(false)
  let pinFor = 'copy' // what the PIN is for: copying from the other Frog Hubs, or grown-up mode
  let checking = $state(false)
  let connectNote = $state('')
  let connected = $state(false)
  let areas = $state([])

  async function tryConnection() {
    noHa = false
    checking = true
    connectNote = ''
    const ha = new HomeAssistant(draft.haUrl, draft.token)
    try {
      await ha.connect()
      areas = await ha.call({ type: 'config/area_registry/list' })
      connected = true
      setTimeout(() => go('personality'), 900)
    } catch (err) {
      connectNote = err.message
    } finally {
      ha.onclose = null
      ha.close()
      checking = false
    }
  }

  async function unlocked(token) {
    showPin = false
    adminToken = token
    if (pinFor === 'grownUps') {
      grownUps = true
      return
    }
    try {
      applyShared(await (await fetch('/api/settings', { headers: { 'X-Admin-Token': token } })).json())
    } catch {
      // server unreachable: falls through to typing it in
    }
    if (!draft.token) {
      connectNote = "The other Frog Hubs haven't shared a Home Assistant token yet. Type it in instead."
      manual = true
      return
    }
    await tryConnection()
  }

  // The shared HA token and the house's settings, into the draft only: nothing is saved until Start at the end
  function applyShared(shared) {
    if (shared.token) draft.token = shared.token
    for (const k of SYNCED) if (shared.settings && k in shared.settings) draft[k] = shared.settings[k]
    draft.syncedAt = shared.updated || 0
  }

  // Log in with Home Assistant: the page goes to HA and comes back, so the draft goes with it
  function logIn() {
    startHaLogin(draft.haUrl, { ...draft, token: '' })
  }
  const login = pendingHaLogin()
  if (login) {
    Object.assign(draft, login.keep || {})
    step = 'connect'
    manual = true
    checking = true
    finishHaLogin(draft.deviceName || draft.name)
      .then(({ haUrl, token }) => {
        draft.haUrl = haUrl
        draft.token = token
        return tryConnection()
      })
      .catch((err) => {
        connectNote = err.message
        checking = false
      })
  }

  // Pairing: a QR code for a grown-up's phone (channel/pair.ts)
  let pairing = $state(null) // { code, svg } while waiting
  let pairingStop = null
  async function startPairing() {
    connectNote = ''
    try {
      pairing = await newPairing()
      pairingStop = new AbortController()
      applyShared(await waitForPairing(pairing.code, pairingStop.signal))
      pairing = null
      if (draft.token) await tryConnection()
      else {
        connectNote = "The other Frog Hubs haven't shared a Home Assistant token yet. Type it in instead."
        manual = true
      }
    } catch (err) {
      if (err.message !== 'cancelled') connectNote = err.message
      pairing = null
    }
  }
  function stopPairing() {
    if (pairingStop) pairingStop.abort()
    pairing = null
  }

  // ── The microphone ──
  let mic = $state.raw(null) // the open microphone (the page switches to "Say hello" while it's on)
  let level = $state(0) // 0..1, smoothed
  let heard = $state(false)
  let micNote = $state('')
  let loudFrames = 0

  async function startListening() {
    micNote = ''
    try {
      mic = await startMic((pcm) => {
        let peak = 0
        for (let i = 0; i < pcm.length; i += 4) peak = Math.max(peak, Math.abs(pcm[i]))
        const now = Math.min(1, peak / 12000)
        level = Math.max(now, level * 0.85)
        if (now > 0.25) loudFrames++
        if (loudFrames > 3 && !heard) {
          heard = true
          setTimeout(stopListening, 1200)
        }
      })
    } catch (err) {
      micNote = `I couldn't open the microphone (${err.message}). You can carry on and sort it out later.`
    }
  }

  function stopListening() {
    if (mic) mic.stop()
    mic = null
    level = 0
  }

  $effect(() => {
    if (step !== 'mic') stopListening()
    return stopListening
  })

  // ── Finishing ──
  function toggleGrownUps() {
    if (grownUps) grownUps = false
    else if (adminToken) grownUps = true
    else {
      pinFor = 'grownUps'
      showPin = true
    }
  }

  async function finish() {
    stopListening()
    Object.assign(settings, { ...draft, setUp: true })
    saveSettings()
    if (adminToken) {
      try {
        await fetch('/api/audience', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
          body: JSON.stringify({ device: settings.deviceId, grownUps }),
        })
      } catch {
        // the server is unreachable: it stays a kids' display, which can be changed later on the admin page
      }
    }
    onDone(adminToken)
  }

  const confetti = Array.from({ length: 36 }, (_, i) => ({
    emoji: ['🎉', '✨', '🐸', '💛', '⭐', '🎈'][i % 6],
    left: Math.random() * 100,
    delay: Math.random() * 1.2,
    spin: Math.random() * 720 - 360,
    duration: 2.4 + Math.random() * 1.6,
  }))
  const bubbles = Array.from({ length: 10 }, (_, i) => ({
    left: 5 + i * 9.5 + Math.random() * 4,
    size: 18 + Math.random() * 40,
    delay: Math.random() * 10,
    duration: 12 + Math.random() * 10,
  }))
</script>

<div
  class="onboarding"
  style="--bg: {p.colours.bg}; --bg2: {p.colours.bg2}; --fg: {p.colours.fg}; --muted: {p.colours.muted}; --accent: {p.colours.accent}"
>
  <div class="bubbles" aria-hidden="true">
    {#each bubbles as b, i (i)}
      <span style="left: {b.left}%; width: {b.size}px; height: {b.size}px; animation-delay: -{b.delay}s; animation-duration: {b.duration}s"></span>
    {/each}
  </div>

  {#if step !== 'hello' && step !== 'done'}
    <div class="dots" transition:fade>
      {#each STEPS.slice(1, -1) as s, i (s)}
        <span class:on={i + 1 <= at}></span>
      {/each}
    </div>
  {/if}

  {#key step}
    <section
      class="page"
      in:fly={{ x: forward ? 260 : -260, duration: 450, delay: 120, easing: backOut }}
      out:fly={{ x: forward ? -260 : 260, duration: 250 }}
    >
      {#if step === 'hello'}
        <div class="hero bob">
          <Face kind="frog" fill={personalities.frog.colours.faceFill} ink={personalities.frog.colours.faceInk} size={200} />
        </div>
        <h1 class="big">Hello! 👋</h1>
        <p class="lead">I'm <b>Frog Hub</b>, your new smart display. Let's get me set up, it only takes a minute.</p>
        <button class="primary" onclick={() => go('connect')}>Let's go →</button>

      {:else if step === 'connect'}
        <h1>Is there already a Frog Hub in the house?</h1>
        {#if pairing}
          <div class="pairing">
            <div class="qr">{@html pairing.svg}</div>
            <p class="lead">A grown-up scans this with their phone and types the PIN there.</p>
            <p class="note">Or on the admin page, under Displays → Pair: <b class="code">{pairing.code}</b></p>
            <button class="link" onclick={stopPairing}>Cancel</button>
          </div>
        {:else if !manual}
          <div class="cards">
            <button class="card" onclick={startPairing} disabled={checking}>
              <span class="emoji">📱</span>
              <b>Yes! Scan with a phone</b>
              <small>A grown-up scans a code with their phone, so nobody types on me</small>
            </button>
            <button class="card" onclick={() => ((pinFor = 'copy'), (showPin = true))} disabled={checking}>
              <span class="emoji">🐸🐸</span>
              <b>Yes! Copy everything</b>
              <small>A grown-up types the PIN and I'll copy the connection and settings from the others</small>
            </button>
            <button class="card" onclick={() => (manual = true)} disabled={checking}>
              <span class="emoji">🏠</span>
              <b>No, I'm the first</b>
              <small>Type in Home Assistant's address and a long-lived access token</small>
            </button>
          </div>
        {:else}
          {#if draft.haUrl && !draft.token}
            <button class="primary" onclick={logIn} disabled={checking}>🏠 Log in with Home Assistant</button>
            <p class="note">Log in as the person (or the Frog Hub user) whose rooms and devices this display should use.
              Or use a long-lived access token:</p>
          {/if}
          <div class="form">
            <label>Home Assistant address <input bind:value={draft.haUrl} autocapitalize="off" autocomplete="off" /></label>
            <label>
              Long-lived access token
              <input type="password" bind:value={draft.token} autocomplete="off" placeholder="HA → your profile → Security → Long-lived access tokens" />
            </label>
          </div>
          <button class="primary" onclick={tryConnection} disabled={checking || !draft.token || connected}>
            {connected ? '✓ Connected!' : checking ? 'Checking…' : 'Connect'}
          </button>
        {/if}
        {#if !checking && !connected && !pairing}
          <button class="link" onclick={skipHa}>Skip: use it without Home Assistant</button>
        {/if}
        {#if checking && !manual}<p class="note">Connecting…</p>{/if}
        {#if connected && !manual}<p class="ok" in:scale={{ easing: backOut }}>✓ Connected!</p>{/if}
        {#if connectNote}<p class="warn">{connectNote}</p>{/if}

      {:else if step === 'personality'}
        <h1>Who should I be?</h1>
        <div class="faces">
          {#each Object.entries(personalities) as [id, each] (id)}
            <button
              class="pick"
              class:picked={draft.personality === id}
              style="--c: {each.colours.accent}; --cbg: {each.colours.bg2}"
              onclick={() => (draft.personality = id)}
            >
              <Face kind={each.face} fill={each.colours.faceFill} ink={each.colours.faceInk} size={96} mood={draft.personality === id ? 'speaking' : 'waiting'} />
              <b>{each.name}</b>
            </button>
          {/each}
        </div>
        {#key draft.personality}
          <p class="bubble" in:scale={{ start: 0.6, duration: 300, easing: backOut }}>{p.greeting(draft.name || 'there')}</p>
        {/key}
        <button class="primary" onclick={() => ((picked = true), go('about'))}>That's me →</button>

      {:else if step === 'about'}
        <h1>Nice to meet you!</h1>
        <div class="form">
          <label>Who's it for? <input bind:value={draft.name} maxlength="30" placeholder="a name" /></label>
          {#if areas.length}
            <span class="label">Which room am I in?</span>
            <div class="chips">
              {#each areas as a (a.area_id)}
                <button class="chip" class:picked={draft.area === a.area_id} onclick={() => (draft.area = a.area_id)}>{a.name}</button>
              {/each}
              <button class="chip" class:picked={!draft.area} onclick={() => (draft.area = '')}>None</button>
            </div>
          {/if}
          <label>
            What should the other Frog Hubs call me?
            <input
              bind:value={draft.deviceName}
              maxlength="40"
              placeholder={(areas.find((a) => a.area_id === draft.area) || {}).name || 'e.g. Kitchen'}
            />
          </label>
          <button class="toggle" class:on={grownUps} onclick={toggleGrownUps}>
            <span class="knob"></span>
            <span>
              <b>🧑 Grown-up mode</b>
              <small>For a display only grown-ups use: no kids' rules. Needs the PIN{adminToken ? '' : ' (a grown-up types it)'}.</small>
            </span>
          </button>
        </div>
        <button class="primary" onclick={() => go('mic')} disabled={!draft.name.trim()}>Next →</button>

      {:else if step === 'mic'}
        <h1>{heard ? 'I can hear you!' : 'Can I hear you?'}</h1>
        <div class="hero">
          <Face kind={p.face} fill={p.colours.faceFill} ink={p.colours.faceInk} size={150} mood={heard ? 'speaking' : mic ? 'listening' : 'waiting'} />
        </div>
        <div class="meter"><span style="width: {level * 100}%"></span></div>
        {#if heard}
          <p class="ok" in:scale={{ easing: backOut }}>✓ Loud and clear</p>
          <button class="primary" onclick={() => go('done')}>Next →</button>
        {:else if mic}
          <p class="lead">Say hello to me!</p>
        {:else}
          <button class="primary" onclick={startListening}>🎙️ Turn on the microphone</button>
          <button class="link" onclick={() => go('done')}>Skip for now</button>
        {/if}
        {#if micNote}<p class="warn">{micNote}</p>{/if}

      {:else if step === 'done'}
        <div class="confetti" aria-hidden="true">
          {#each confetti as c, i (i)}
            <span style="left: {c.left}%; animation-delay: {c.delay}s; animation-duration: {c.duration}s; --spin: {c.spin}deg">{c.emoji}</span>
          {/each}
        </div>
        <div class="hero bob">
          <Face kind={p.face} fill={p.colours.faceFill} ink={p.colours.faceInk} size={190} mood="speaking" />
        </div>
        <h1 class="big">All set, {draft.name}! 🎉</h1>
        {#if noHa}
          <p class="lead">Tap ⌨️ to type to me. To talk out loud, add Home Assistant later in Settings.</p>
        {:else}
          <p class="lead">Tap my face to talk to me, or just say the wake word.</p>
        {/if}
        <button class="primary" onclick={finish}>Start →</button>
      {/if}
    </section>
  {/key}

  {#if at > 0 && step !== 'done'}
    <button class="back" onclick={() => (step === 'connect' && manual ? (manual = false) : go(STEPS[at - 1]))} aria-label="Back">←</button>
  {/if}

  {#if showPin}
    <PinPad onUnlock={unlocked} onCancel={() => (showPin = false)} />
  {/if}
</div>

<style>
  .onboarding {
    position: fixed;
    inset: 0;
    z-index: 20;
    overflow: hidden;
    background: radial-gradient(circle at 30% 30%, var(--bg2), var(--bg) 75%);
    color: var(--fg);
    transition: background 0.6s, color 0.6s;
  }
  .page {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 40px 48px;
    box-sizing: border-box;
    text-align: center;
    overflow-y: auto;
  }
  h1 {
    margin: 0;
    font-size: 34px;
  }
  .big {
    font-size: 52px;
  }
  .lead {
    margin: 0;
    max-width: 640px;
    font-size: 22px;
    color: var(--muted);
  }
  .hero {
    filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.35));
  }
  .bob {
    animation: bob 2.6s ease-in-out infinite;
  }
  @keyframes bob {
    50% {
      transform: translateY(-14px) rotate(-3deg);
    }
  }
  .primary {
    margin-top: 6px;
    padding: 16px 40px;
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    color: var(--bg);
    font: inherit;
    font-size: 24px;
    font-weight: 800;
    box-shadow: 0 6px 0 rgba(0, 0, 0, 0.25);
    transition: transform 0.1s, box-shadow 0.1s, background 0.6s;
  }
  .primary:active {
    transform: translateY(4px);
    box-shadow: 0 2px 0 rgba(0, 0, 0, 0.25);
  }
  .primary:disabled {
    opacity: 0.5;
  }
  .link {
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 18px;
    text-decoration: underline;
  }
  .cards {
    display: flex;
    gap: 20px;
  }
  .pairing {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .qr {
    width: 240px;
    height: 240px;
    padding: 8px;
    border-radius: 16px;
    background: #fff;
  }
  .qr :global(svg) {
    width: 100%;
    height: 100%;
  }
  .code {
    font-family: monospace;
    letter-spacing: 2px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: 240px;
    padding: 22px;
    border: 3px solid var(--accent);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--fg);
    font: inherit;
    font-size: 20px;
    transition: transform 0.15s;
  }
  .card:active {
    transform: scale(0.96);
  }
  .card small {
    color: var(--muted);
    font-size: 15px;
  }
  .emoji {
    font-size: 48px;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(620px, 100%);
    text-align: left;
  }
  label,
  .label {
    font-weight: 700;
    font-size: 18px;
  }
  input {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 12px 14px;
    border: 2px solid var(--muted);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--fg);
    font: inherit;
    font-size: 20px;
    box-sizing: border-box;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    padding: 10px 18px;
    border: 2px solid var(--muted);
    border-radius: 999px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 17px;
  }
  .chip.picked {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--bg);
  }
  .toggle {
    display: flex;
    align-items: center;
    padding: 12px 14px;
    border: 2px solid var(--muted);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--fg);
    font: inherit;
    text-align: left;
  }
  .toggle.on {
    border-color: var(--accent);
  }
  .toggle > span:last-child {
    display: flex;
    flex-direction: column;
    margin-left: 14px;
  }
  .toggle small {
    color: var(--muted);
    font-size: 14px;
  }
  .knob {
    position: relative;
    flex: none;
    width: 52px;
    height: 30px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.15);
    transition: background 0.2s;
  }
  .knob::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--fg);
    transition: transform 0.2s;
  }
  .toggle.on .knob {
    background: var(--accent);
  }
  .toggle.on .knob::after {
    transform: translateX(22px);
  }
  .faces {
    display: flex;
    gap: 16px;
  }
  .pick {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 14px 16px;
    border: 3px solid transparent;
    border-radius: 22px;
    background: var(--cbg);
    color: #fff;
    font: inherit;
    font-size: 19px;
    transition: transform 0.2s, border-color 0.2s;
  }
  .pick.picked {
    border-color: var(--c);
    transform: translateY(-8px) scale(1.06);
  }
  .bubble {
    position: relative;
    margin: 4px 0 0;
    padding: 12px 22px;
    border-radius: 20px;
    background: var(--fg);
    color: var(--bg);
    font-size: 21px;
    font-weight: 700;
  }
  .meter {
    width: min(420px, 80%);
    height: 18px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.08s linear;
  }
  .ok {
    margin: 0;
    color: var(--accent);
    font-size: 24px;
    font-weight: 800;
  }
  .warn {
    margin: 0;
    max-width: 620px;
    color: #ffb4a2;
  }
  .note {
    margin: 0;
    color: var(--muted);
  }
  .dots {
    position: absolute;
    top: 22px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    gap: 10px;
    z-index: 1;
  }
  .dots span {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--muted);
    opacity: 0.4;
    transition: all 0.3s;
  }
  .dots span.on {
    width: 30px;
    border-radius: 6px;
    background: var(--accent);
    opacity: 1;
  }
  .back {
    position: absolute;
    top: 14px;
    left: 18px;
    z-index: 1;
    width: 52px;
    height: 52px;
    border: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    color: var(--fg);
    font-size: 26px;
  }
  .bubbles span {
    position: absolute;
    bottom: -80px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.02));
    opacity: 0.6;
    animation: rise linear infinite;
  }
  @keyframes rise {
    to {
      transform: translateY(-120vh) translateX(30px);
    }
  }
  .confetti span {
    position: absolute;
    top: -40px;
    font-size: 30px;
    animation: fall ease-in forwards;
  }
  @keyframes fall {
    to {
      transform: translateY(115vh) rotate(var(--spin));
    }
  }
  @media (max-height: 640px) {
    .big {
      font-size: 42px;
    }
    h1 {
      font-size: 28px;
    }
  }
</style>
