<script>
  // Every Frog Hub that has ever checked in (channel/registry.ts): what it's set to, whether it's on, and things to
  // do to it, which it picks up within 5 seconds (or when it next turns on).
  import { onMount } from 'svelte'
  import { api, ago } from './api.svelte.js'
  import { HomeAssistant } from '../lib/ha.js'
  import { personalities } from '../lib/personalities.js'
  import { house, houseLoaded } from '../lib/house.svelte.js'

  let list = $state(null)
  let error = $state('')
  let areas = $state([]) // from Home Assistant, for moving a display to another room
  let editing = $state(null) // { id, deviceName, name, area, grownUps }
  let arming = $state('') // `${action}:${id}` waiting for a second tap

  async function load() {
    try {
      list = await api('/api/admin/displays')
      error = ''
    } catch (err) {
      error = err.message
    }
  }

  async function act(id, action, extra = {}) {
    // Wipe and forget can't be undone: they need a second tap
    if ((action === 'wipe' || action === 'forget') && arming !== `${action}:${id}`) {
      arming = `${action}:${id}`
      setTimeout(() => arming === `${action}:${id}` && (arming = ''), 4000)
      return
    }
    arming = ''
    try {
      await api('/api/admin/displays', { id, action, ...extra })
      await load()
    } catch (err) {
      error = err.message
    }
  }

  async function saveEdit() {
    const d = list.find((x) => x.id === editing.id)
    const set = {}
    if (editing.deviceName !== (d.name === d.areaName ? '' : d.name)) set.deviceName = editing.deviceName
    if (editing.name !== d.who) set.name = editing.name
    if (editing.area !== d.area) set.area = editing.area
    const grownUps = editing.grownUps
    editing = null
    try {
      // Grown-up mode is kept on the server (it applies straight away); the rest goes to the tablet itself
      if (grownUps !== d.grownUps) await api('/api/audience', { device: d.id, grownUps })
      if (Object.keys(set).length) await act(d.id, 'set', { set })
      else await load()
    } catch (err) {
      error = err.message
    }
  }

  // Room names come from Home Assistant, with the token the displays share (only given out in admin mode).
  async function loadAreas() {
    try {
      const shared = await api('/api/settings')
      if (!shared.token) return
      await houseLoaded
      const url = shared.settings?.haUrl || house.haUrl
      if (!url) return
      const ha = new HomeAssistant(url, shared.token)
      await ha.connect()
      areas = await ha.call({ type: 'config/area_registry/list' })
      ha.onclose = null
      ha.close()
    } catch {
      // no rooms to pick from; the rest still works
    }
  }

  onMount(() => {
    load()
    loadAreas()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  })

  const pendingText = (p) =>
    [p.wipe && 'wipe', p.welcome && 'show the welcome', p.set && 'new settings'].filter(Boolean).join(', ')
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if !list}
  <p class="muted">Loading…</p>
{:else if !list.length}
  <p class="muted">No Frog Hubs have checked in yet. Open {house.site || 'Frog Hub'} on a tablet.</p>
{:else}
  <p class="muted">{list.filter((d) => d.online).length} on, {list.length} known</p>
  <div class="grid">
    {#each list as d (d.id)}
      {@const p = personalities[d.personality]}
      <article class="card" class:off={!d.online} style="--pc: {p ? p.colours.accent : 'var(--accent)'}">
        <div class="top">
          <span class="dot" class:on={d.online} title={d.online ? 'On' : 'Off'}></span>
          <h2>{d.name}</h2>
          {#if d.grownUps}<span class="badge">🧑 grown-up mode</span>{/if}
        </div>
        <dl>
          <dt>For</dt><dd>{d.who || '—'}</dd>
          <dt>Room</dt><dd>{d.areaName || '—'}</dd>
          <dt>Personality</dt><dd><span class="swatch"></span>{p ? p.name : d.personality || '—'}</dd>
          <dt>Last seen</dt><dd>{d.online ? 'on now' : ago(d.lastSeen)}</dd>
          <dt>First seen</dt><dd>{ago(d.firstSeen)}</dd>
          <dt>ID</dt><dd class="mono">{d.id}</dd>
        </dl>

        {#if d.pending}
          <p class="pending">
            ⏳ Waiting to {pendingText(d.pending)}{d.online ? '…' : ' when it next turns on'}
            <button class="link" onclick={() => act(d.id, 'cancel')}>Cancel</button>
          </p>
        {/if}

        {#if editing && editing.id === d.id}
          <div class="edit">
            <label>Display name <input bind:value={editing.deviceName} placeholder={d.areaName || 'its room\'s name'} maxlength="40" /></label>
            <label>Who it's for <input bind:value={editing.name} maxlength="30" /></label>
            {#if areas.length}
              <label>
                Room
                <select bind:value={editing.area}>
                  <option value="">None</option>
                  {#each areas as a (a.area_id)}<option value={a.area_id}>{a.name}</option>{/each}
                </select>
              </label>
            {/if}
            <label class="switch">
              <input type="checkbox" bind:checked={editing.grownUps} />
              🧑 Grown-up mode (no kids' rules on this display)
            </label>
            <div class="row">
              <button class="primary" onclick={saveEdit}>Save</button>
              <button class="ghost" onclick={() => (editing = null)}>Cancel</button>
            </div>
          </div>
        {:else}
          <div class="row">
            <button class="ghost" onclick={() => (editing = { id: d.id, deviceName: d.name === d.areaName ? '' : d.name, name: d.who, area: d.area, grownUps: d.grownUps })}>✏️ Edit</button>
            <button class="ghost" onclick={() => act(d.id, 'welcome')}>✨ Welcome</button>
            <button class="danger" onclick={() => act(d.id, 'wipe')}>{arming === `wipe:${d.id}` ? 'Tap again to wipe' : '🧽 Wipe'}</button>
            {#if !d.online}
              <button class="danger" onclick={() => act(d.id, 'forget')}>{arming === `forget:${d.id}` ? 'Tap again to forget' : '🗑️ Forget'}</button>
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  </div>
  <p class="muted small">
    🧽 Wipe erases everything saved on that tablet and starts it again with the welcome, as a new display.
    🗑️ Forget only removes it from this list (for a tablet that's gone for good); it reappears if it turns on again.
  </p>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }
  .card {
    border-left: 5px solid var(--pc);
  }
  .card.off {
    opacity: 0.75;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  h2 {
    margin: 0;
    font-size: 19px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--muted);
    flex: none;
  }
  .dot.on {
    background: #4ade80;
    box-shadow: 0 0 0 4px rgba(74, 222, 128, 0.2);
  }
  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    font-size: 12px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 12px 0;
    font-size: 14px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--pc);
  }
  .mono {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    color: var(--muted);
  }
  .pending {
    margin: 0 0 10px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(250, 204, 21, 0.12);
    font-size: 14px;
  }
  .edit {
    display: grid;
    gap: 10px;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 14px;
  }
  .small {
    font-size: 13px;
    margin-top: 16px;
  }
  @supports not (gap: 1px) {
    .top > * + *,
    .switch > * + * {
      margin-left: 10px;
    }
  }
</style>
