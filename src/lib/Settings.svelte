<script>
  import { personalities } from './personalities.js'
  import { settings, saveSettings, pushShared } from './settings.svelte.js'
  import Recorder from './Recorder.svelte'
  import { POLICY } from './policy.js'
  import { SLEEP_SOUNDS, playAudio, stopAudio } from './player.svelte.js'
  import { house } from './house.svelte.js'
  import Icon from './Icon.svelte'
  import { icons as I } from './icons.js'

  let { areas = [], calendars = [], adminToken = null, onClose, onUnlock, onWelcome } = $props()

  // The sections down the side. Grown-ups only shows in admin mode, Tablet app only inside the Android app.
  const SECTIONS = [
    { id: 'look', label: 'Look', icon: I.Palette },
    { id: 'display', label: 'This display', icon: I.TabletSmartphone },
    { id: 'night', label: 'Night & goodnight', icon: I.Moon },
    { id: 'morning', label: 'Good morning', icon: I.Sunrise },
    { id: 'connection', label: 'Connection', icon: I.House },
    { id: 'grownups', label: 'Grown-ups', icon: I.Shield, admin: true },
    { id: 'app', label: 'Tablet app', icon: I.Smartphone, app: true },
  ]
  let section = $state('look')
  const PREVIEW = [I.Mic, I.Music, I.House, I.Moon] // shown on the icon style choices

  // What Frog Hub's assistant may use. Only shown, and only saved, in admin mode (the server checks the token too).
  let policy = $state(null)
  let policyLoaded = ''
  // svelte-ignore state_referenced_locally (the panel opens afresh each time)
  if (adminToken) {
    fetch('/api/policy').then((r) => r.json()).then((p) => {
      policy = p
      policyLoaded = JSON.stringify(p)
    }).catch(() => {})
  }
  // Grown-ups display (no kids' rules): per display, kept on the server, only changed in admin mode.
  let grownUps = $state(null)
  let grownUpsLoaded = null
  // svelte-ignore state_referenced_locally
  if (adminToken) {
    fetch(`/api/audience?device=${settings.deviceId}`).then((r) => r.json()).then((a) => {
      grownUps = a.grownUps
      grownUpsLoaded = a.grownUps
    }).catch(() => {})
  }
  let saving = $state('')
  let recording = $state(false) // the wake word recorder is open
  let trying = null // the goodnight sound's Hear it, while it plays

  function trySound() {
    clearTimeout(trying)
    playAudio({ noise: draft.goodnightSound })
    trying = setTimeout(stopAudio, 8000)
  }

  // Edit a copy so nothing changes until Save.
  let draft = $state({ ...settings })

  // The Android app's own settings, when Frog Hub is running inside it (see android/ in the repo).
  const app = window.FrogHubApp && window.FrogHubApp.getSettings ? window.FrogHubApp : null
  let appDraft = $state(app ? JSON.parse(app.getSettings()) : null)
  let sections = $derived(SECTIONS.filter((s) => (!s.admin || (adminToken && policy)) && (!s.app || appDraft)))

  async function save() {
    Object.assign(settings, draft)
    saveSettings()
    if (adminToken) {
      saving = 'Saving…'
      try {
        if (settings.sync) await pushShared(adminToken)
        if (grownUps !== null && grownUps !== grownUpsLoaded) {
          await fetch('/api/audience', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
            body: JSON.stringify({ device: settings.deviceId, grownUps }),
          })
        }
        if (policy && JSON.stringify(policy) !== policyLoaded) {
          const r = await (await fetch('/api/policy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
            body: JSON.stringify(policy),
          })).json()
          if (r.restarting) {
            saving = 'Restarting the assistant (about 30 seconds)…'
            await new Promise((done) => setTimeout(done, 2500))
          }
        }
      } catch {
        // the server is unreachable: this display's own settings are still saved
      }
    }
    if (app) app.setSettings(JSON.stringify(appDraft)) // reloads the page itself if the address changed
    onClose(true)
  }
</script>

<div class="settings">
  <header class:admin={adminToken}>
    <h1><Icon of={I.Gear} size={28} /> Settings</h1>
  </header>

  <div class="body">
    <nav>
      {#each sections as s (s.id)}
        <button class:on={section === s.id} onclick={() => (section = s.id)}><Icon of={s.icon} size={22} /> <span>{s.label}</span></button>
      {/each}
    </nav>

    <div class="pane">
      {#if section === 'look'}
        <section class="card">
          <h2>Personality</h2>
          <div class="choices">
            {#each Object.entries(personalities) as [id, p] (id)}
              <button class="choice" class:picked={draft.personality === id} style="--c: {p.colours.accent}" onclick={() => (draft.personality = id)}>
                <i class="dot"></i>{p.name}
              </button>
            {/each}
          </div>
        </section>
        <section class="card">
          <h2>Icons</h2>
          <div class="styles">
            {#each [['outline', 'Outline', 'lucide'], ['two-tone', 'Two-tone', 'phosphor']] as [id, name, kind] (id)}
              <button class="style" class:picked={draft.iconStyle === id} onclick={() => (draft.iconStyle = id)}>
                <span class="preview">
                  {#each PREVIEW as pair, i (i)}
                    {@const Glyph = pair[kind]}
                    {#if kind === 'phosphor'}<Glyph size={26} weight="duotone" class="lucide phosphor" />{:else}<Glyph size={26} />{/if}
                  {/each}
                </span>
                {name}
              </button>
            {/each}
          </div>
        </section>
      {:else if section === 'display'}
        <section class="card">
          <h2>Who and where</h2>
          <label class="row">Who's it for? <input bind:value={draft.name} placeholder="a name" /></label>
          <label class="row">
            Room for the buttons
            <select bind:value={draft.area}>
              <option value="">None</option>
              {#each areas as a (a.area_id)}<option value={a.area_id}>{a.name}</option>{/each}
            </select>
          </label>
          <label class="row">This display's name <input bind:value={draft.deviceName} placeholder="its room's name" maxlength="40" /></label>
          <p class="note">What the other Frog Hubs call it when you send a message to just this one.</p>
        </section>
        {#if house.musicAssistant}
          <section class="card">
            <h2>Music</h2>
            <label class="row switch">Be a Music Assistant speaker <input type="checkbox" bind:checked={draft.maSpeaker} /></label>
            <p class="note">Called this display's name in Music Assistant.</p>
          </section>
        {/if}
      {:else if section === 'night'}
        <section class="card">
          <h2>Night mode</h2>
          <label class="row">From <span><input type="number" min="0" max="23" bind:value={draft.nightStart} /> to <input type="number" min="0" max="23" bind:value={draft.nightEnd} /> o'clock</span></label>
          <p class="note">The screen goes dark and quiet in these hours.</p>
        </section>
        <section class="card">
          <h2>When someone says goodnight</h2>
          <label class="row">
            The room's lights
            <select bind:value={draft.goodnightLights}>
              <option value="off">Off</option>
              <option value="dim">Dimmed</option>
              <option value="leave">Left as they are</option>
            </select>
          </label>
          {#if draft.goodnightLights === 'dim'}
            <label class="row">Dimmed to <span><input type="number" min="1" max="100" bind:value={draft.goodnightDim} /> %</span></label>
          {/if}
          <label class="row">
            Sleep sound
            <span class="with-button">
              <select bind:value={draft.goodnightSound}>
                {#each Object.entries(SLEEP_SOUNDS) as [id, name] (id)}<option value={id}>{name}</option>{/each}
                <option value="none">None</option>
              </select>
              {#if draft.goodnightSound !== 'none'}<button class="secondary small" onclick={trySound}><Icon of={I.Play} size={14} /> Hear it</button>{/if}
            </span>
          </label>
          {#if draft.goodnightSound !== 'none'}
            <label class="row">Fades out after <span><input type="number" min="5" max="180" bind:value={draft.goodnightMinutes} /> minutes</span></label>
          {/if}
          <p class="note">Then the screen stays dark and quiet until night mode ends in the morning, or until someone talks to it.</p>
        </section>
      {:else if section === 'morning'}
        <section class="card">
          <h2>Good morning</h2>
          <label class="row switch">Wake this room up in the morning <input type="checkbox" bind:checked={draft.morningOn} /></label>
          {#if draft.morningOn}
            <label class="row">At <input type="time" bind:value={draft.morningTime} /></label>
            <label class="row">
              On
              <select bind:value={draft.morningDays}>
                <option value="weekdays">Weekdays</option>
                <option value="weekends">Weekends</option>
                <option value="every">Every day</option>
              </select>
            </label>
          {/if}
        </section>
        {#if draft.morningOn}
          <section class="card">
            <h2>Lights</h2>
            <label class="row">
              The room's lights
              <select bind:value={draft.morningLights}>
                <option value="fade">Fade up, like a sunrise</option>
                <option value="leave">Left as they are</option>
              </select>
            </label>
            {#if draft.morningLights === 'fade'}
              <label class="row">Over the <span><input type="number" min="1" max="60" bind:value={draft.morningFade} /> minutes before, up to <input type="number" min="5" max="100" bind:value={draft.morningBright} /> %</span></label>
            {/if}
            <p class="note">The lights need the grown-ups' devices switch. Night mode ends then too.</p>
          </section>
          <section class="card">
            <h2>Saying good morning</h2>
            <label class="row switch">Say the time and the weather <input type="checkbox" bind:checked={draft.morningSpeak} /></label>
            {#if draft.morningSpeak && calendars.length}
              <p class="note">And today's events from:</p>
              {#each calendars as c (c.id)}
                <label class="row switch">
                  {c.name}
                  <input type="checkbox" checked={draft.morningCalendars.includes(c.id)}
                    onchange={(e) => (draft.morningCalendars = e.currentTarget.checked ? [...draft.morningCalendars, c.id] : draft.morningCalendars.filter((id) => id !== c.id))} />
                </label>
              {/each}
            {/if}
          </section>
        {/if}
      {:else if section === 'connection'}
        <section class="card">
          <h2>Home Assistant</h2>
          <label class="row">Address <input bind:value={draft.haUrl} autocapitalize="off" autocomplete="off" /></label>
          <label class="row">
            Access token
            <input type="password" bind:value={draft.token} autocomplete="off" placeholder="long-lived access token" />
          </label>
          <p class="note">Make a token in Home Assistant: your profile → Security → Long-lived access tokens.</p>
        </section>
        <section class="card">
          <h2>Other Frog Hubs</h2>
          <label class="row switch">Same settings on every Frog Hub <input type="checkbox" bind:checked={draft.sync} /></label>
          <p class="note">Including the Home Assistant token. {adminToken ? 'Saving here updates them all.' : 'A grown-up\'s Save in admin mode updates them all.'}</p>
          {#if !adminToken}
            <button class="secondary small" onclick={onUnlock}><Icon of={I.Key} size={16} /> Copy everything from the other Frog Hubs (needs the PIN)</button>
          {/if}
        </section>
      {:else if section === 'grownups' && adminToken && policy}
        <section class="card">
          <h2>What the assistant can use</h2>
          {#each POLICY as [key, text] (key)}
            <label class="row switch">{text} <input type="checkbox" bind:checked={policy[key]} /></label>
          {/each}
          <p class="note">These apply to every Frog Hub. Turning off web search or memory restarts the assistant.</p>
        </section>
        {#if grownUps !== null}
          <section class="card">
            <h2>Grown-ups display</h2>
            <label class="row switch">This is a grown-ups display <input type="checkbox" bind:checked={grownUps} /></label>
            <p class="note">
              Just this Frog Hub: the assistant talks to it like a grown-up, without the kids' rules. Leave it off on children's displays.
              Memories and messages to the other Frog Hubs still stay suitable for children.
            </p>
          </section>
        {/if}
        <section class="card">
          <h2>Setting up</h2>
          <div class="actions">
            <button class="secondary small" onclick={onWelcome}><Icon of={I.Sparkles} size={16} /> Show the welcome again</button>
            <button class="secondary small" onclick={() => (recording = true)}><Icon of={I.Mic} size={16} /> Record voices for the "Hey Verity" wake word</button>
          </div>
        </section>
      {:else if section === 'app' && appDraft}
        <section class="card">
          <h2>Tablet app</h2>
          <label class="row">Screen off after <span><input type="number" min="0" max="240" bind:value={appDraft.dimMinutes} /> idle minutes</span></label>
          <p class="note">0 means never.</p>
          <label class="row switch">Open Frog Hub when the tablet starts <input type="checkbox" bind:checked={appDraft.openOnStartup} /></label>
          <label class="row">Frog Hub address <input bind:value={appDraft.url} autocapitalize="off" autocomplete="off" /></label>
          <p class="note">App {appDraft.version}. If the page ever won't load, tap the top-left corner 5 times for these settings.</p>
          <div class="actions"><button class="secondary small" onclick={() => app.exit()}>Close the app</button></div>
        </section>
      {/if}
    </div>
  </div>

  {#if recording}
    <Recorder {adminToken} name={draft.name} onClose={() => (recording = false)} />
  {/if}

  <footer>
    <button class="secondary reload" onclick={() => location.reload()}><Icon of={I.RefreshCw} size={16} /> Reload</button>
    <button class="secondary" onclick={() => onClose(false)}>Cancel</button>
    <button class="primary" onclick={save} disabled={!!saving}>{saving || 'Save'}</button>
  </footer>
</div>

<style>
  /* Margins rather than flex gap throughout, which Fire OS 5's Chrome 59 doesn't have. */
  .settings {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
    z-index: 10;
  }
  header {
    padding: 16px 28px 8px;
  }
  header.admin {
    padding-left: 250px; /* clear of the Admin mode badge in the top-left corner */
  }
  h1 {
    margin: 0;
    font-size: 1.6em;
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0; /* lets the pane scroll instead of growing */
  }
  nav {
    flex: none;
    width: 230px;
    padding: 8px 12px 8px 20px;
    overflow-y: auto;
  }
  nav button {
    display: flex;
    align-items: center;
    width: 100%;
    margin-bottom: 6px;
    padding: 12px 14px;
    border: 0;
    border-radius: 14px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-weight: 600;
    text-align: left;
  }
  nav button span {
    margin-left: 12px;
  }
  nav button.on {
    background: rgba(255, 255, 255, 0.1);
    color: var(--fg);
  }
  nav button.on :global(.lucide) {
    color: var(--accent);
  }
  .pane {
    flex: 1;
    min-width: 0;
    padding: 8px 28px 20px 8px;
    overflow-y: auto;
  }
  .card {
    margin-bottom: 16px;
    padding: 14px 20px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.05);
  }
  h2 {
    margin: 0 0 6px;
    font-size: 1em;
    color: var(--accent);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
    padding: 6px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    font-weight: 600;
  }
  h2 + .row {
    border-top: 0;
  }
  .row > input,
  .row > select,
  .row > span {
    margin-left: 16px;
  }
  .row > input:not([type='checkbox']),
  .row > select {
    flex: 0 1 320px;
    min-width: 0;
  }
  input,
  select {
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--muted);
    background: rgba(255, 255, 255, 0.06);
    color: var(--fg);
    font: inherit;
    box-sizing: border-box;
  }
  input[type='number'] {
    width: 70px;
    margin: 0 6px;
  }
  .with-button {
    display: flex;
    align-items: center;
  }
  .with-button button {
    margin-left: 10px;
  }
  /* Checkboxes as switches */
  .switch input {
    -webkit-appearance: none;
    appearance: none;
    flex: none;
    position: relative;
    width: 52px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 15px;
    background: rgba(255, 255, 255, 0.18);
    transition: background 0.2s;
  }
  .switch input::before {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
  }
  .switch input:checked {
    background: var(--accent);
  }
  .switch input:checked::before {
    transform: translateX(22px);
  }
  .note {
    margin: 6px 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  .small {
    padding: 10px 18px;
    border-radius: 12px;
    border: 0;
    font: inherit;
  }
  .actions button {
    margin: 6px 10px 6px 0;
  }
  .choices,
  .styles {
    display: flex;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .choice {
    display: flex;
    align-items: center;
    margin: 0 10px 10px 0;
    padding: 10px 18px 10px 12px;
    border-radius: 999px;
    border: 2px solid transparent;
    background: rgba(255, 255, 255, 0.08);
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }
  .dot {
    width: 18px;
    height: 18px;
    margin-right: 10px;
    border-radius: 50%;
    background: var(--c);
  }
  .choice.picked {
    border-color: var(--c);
    background: rgba(255, 255, 255, 0.14);
  }
  .style {
    margin: 0 12px 10px 0;
    padding: 12px 18px;
    border-radius: 16px;
    border: 2px solid transparent;
    background: rgba(255, 255, 255, 0.08);
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }
  .style.picked {
    border-color: var(--accent);
    background: rgba(255, 255, 255, 0.14);
  }
  .preview {
    display: block;
    margin-bottom: 8px;
  }
  .preview :global(.lucide) {
    margin: 0 4px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 28px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .reload {
    margin-right: auto; /* on the left, away from Save */
  }
  footer button {
    margin-left: 12px;
    padding: 12px 22px;
    border-radius: 12px;
    border: 0;
    font: inherit;
    font-weight: 700;
  }
  .primary {
    background: var(--accent);
    color: var(--bg);
  }
  .secondary {
    background: rgba(255, 255, 255, 0.1);
    color: var(--fg);
  }

  /* Portrait or a small screen: the sections go along the top */
  @media (max-width: 700px) {
    .body {
      flex-direction: column;
    }
    nav {
      display: flex;
      width: auto;
      padding: 4px 16px;
      overflow-x: auto;
      overflow-y: hidden;
    }
    nav button {
      flex: none;
      width: auto;
      margin: 0 6px 0 0;
    }
    .pane {
      padding: 8px 16px 16px;
    }
    .row {
      flex-wrap: wrap;
    }
  }
</style>
