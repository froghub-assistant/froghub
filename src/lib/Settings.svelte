<script>
  import { personalities } from './personalities.js'
  import { settings, saveSettings, pushShared } from './settings.svelte.js'
  import Recorder from './Recorder.svelte'
  import { POLICY } from './policy.js'

  let { areas = [], adminToken = null, onClose, onUnlock, onWelcome } = $props()

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

  // Edit a copy so nothing changes until Save.
  let draft = $state({ ...settings })

  // The Android app's own settings, when Frog Hub is running inside it (see android/ in the repo).
  const app = window.FrogHubApp && window.FrogHubApp.getSettings ? window.FrogHubApp : null
  let appDraft = $state(app ? JSON.parse(app.getSettings()) : null)

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
  <h1>⚙️ Settings</h1>

  {#if !adminToken}
    <button class="secondary small fetch" onclick={onUnlock}>🔑 Copy everything from the other Frog Hubs (needs the PIN)</button>
  {/if}

  <label>
    Personality
    <div class="choices">
      {#each Object.entries(personalities) as [id, p] (id)}
        <button
          class="choice"
          class:picked={draft.personality === id}
          style="--c: {p.colours.accent}"
          onclick={() => (draft.personality = id)}
        >{p.name}</button>
      {/each}
    </div>
  </label>

  <label>Who's it for? <input bind:value={draft.name} /></label>

  <label>
    Room for the buttons
    <select bind:value={draft.area}>
      <option value="">None</option>
      {#each areas as a (a.area_id)}<option value={a.area_id}>{a.name}</option>{/each}
    </select>
  </label>

  <label>This display's name <input bind:value={draft.deviceName} placeholder="its room's name" maxlength="40" /></label>
  <p class="note">What the other Frog Hubs call it when you send a 📢 message to just this one.</p>

  <label>Night mode from <input type="number" min="0" max="23" bind:value={draft.nightStart} /> to <input type="number" min="0" max="23" bind:value={draft.nightEnd} /> o'clock</label>

  <details>
    <summary>Home Assistant connection</summary>
    <label>Address <input bind:value={draft.haUrl} autocapitalize="off" autocomplete="off" /></label>
    <label>
      Long-lived access token
      <input type="password" bind:value={draft.token} autocomplete="off" placeholder="HA → your profile → Security → Long-lived access tokens" />
    </label>
  </details>

  <label class="check">
    <input type="checkbox" bind:checked={draft.sync} />
    Same settings on every Frog Hub, including the Home Assistant token{adminToken ? '' : ' (a grown-up\'s Save in admin mode updates them all)'}
  </label>

  {#if adminToken && policy}
    <details>
      <summary>🛡️ What the assistant can use</summary>
      {#each POLICY as [key, text] (key)}
        <label class="check"><input type="checkbox" bind:checked={policy[key]} /> {text}</label>
      {/each}
      <p class="note">These apply to every Frog Hub. Turning off web search or memory restarts the assistant.</p>
    </details>
    {#if grownUps !== null}
      <label class="check"><input type="checkbox" bind:checked={grownUps} /> 🧑 Grown-ups display</label>
      <p class="note">
        Just this Frog Hub: the assistant talks to it like a grown-up, without the kids' rules. Leave it off on children's displays.
        Memories and messages to the other Frog Hubs still stay suitable for children.
      </p>
    {/if}
    <button class="secondary small" onclick={onWelcome}>✨ Show the welcome again</button>
    <button class="secondary small" onclick={() => (recording = true)}>🎙️ Record voices for the "Hey Verity" wake word</button>
  {/if}

  {#if recording}
    <Recorder {adminToken} name={draft.name} onClose={() => (recording = false)} />
  {/if}

  {#if appDraft}
    <details>
      <summary>Tablet app</summary>
      <label>Screen off after <input type="number" min="0" max="240" bind:value={appDraft.dimMinutes} /> idle minutes (0 = never)</label>
      <label class="check"><input type="checkbox" bind:checked={appDraft.openOnStartup} /> Open Frog Hub when the tablet starts</label>
      <label>Frog Hub address <input bind:value={appDraft.url} autocapitalize="off" autocomplete="off" /></label>
      <p class="note">App {appDraft.version}. If the page ever won't load, tap the top-left corner 5 times for these settings.</p>
      <button class="secondary small" onclick={() => app.exit()}>Close the app</button>
    </details>
  {/if}

  <div class="buttons">
    <button class="secondary reload" onclick={() => location.reload()}>🔄 Reload</button>
    <button class="secondary" onclick={() => onClose(false)}>Cancel</button>
    <button class="primary" onclick={save} disabled={!!saving}>{saving || 'Save'}</button>
  </div>
</div>

<style>
  .settings {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    padding: 24px 32px;
    background: var(--bg);
    color: var(--fg);
    z-index: 10;
  }
  h1 {
    margin: 0 0 16px;
  }
  label {
    display: block;
    margin: 0 0 16px;
    font-weight: 600;
  }
  input,
  select {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--muted);
    background: rgba(255, 255, 255, 0.06);
    color: var(--fg);
    font: inherit;
    box-sizing: border-box;
  }
  input[type='number'] {
    display: inline-block;
    width: 70px;
    margin: 0 6px;
  }
  .check input {
    display: inline-block;
    width: auto;
    margin: 0 8px 0 0;
  }
  .note {
    color: var(--muted);
    font-size: 0.9em;
  }
  .small {
    padding: 10px 18px;
    border-radius: 12px;
    border: 0;
    font: inherit;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  /* Margins rather than flex gap, which Fire OS 5's Chrome 59 doesn't have. */
  .choice {
    margin: 0 10px 10px 0;
    padding: 10px 18px;
    border-radius: 999px;
    border: 2px solid var(--c);
    background: transparent;
    color: var(--fg);
    font: inherit;
  }
  .choice.picked {
    background: var(--c);
    color: #000;
  }
  details {
    margin-bottom: 16px;
  }
  summary {
    margin-bottom: 12px;
    font-weight: 600;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
  }
  .fetch {
    margin-bottom: 16px;
  }
  .reload {
    margin-right: auto; /* on the left, away from Save */
  }
  .buttons button {
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
</style>
