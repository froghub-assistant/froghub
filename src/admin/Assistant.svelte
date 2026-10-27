<script>
  // What Frog Hub's assistant may use, on every display (channel/store.ts). Web search and memory restart it.
  import { onMount } from 'svelte'
  import { api } from './api.svelte.js'
  import { POLICY } from '../lib/policy.js'

  let policy = $state(null)
  let note = $state('')
  let error = $state('')
  let askDelete = $state(false) // the log just turned off with something in it: delete it too?
  let lists = $state(null) // Home Assistant's to-do lists, and which the assistant may use (channel/lists.ts)
  let listsError = $state('')

  onMount(async () => {
    try {
      policy = await (await fetch('/api/policy')).json()
    } catch (err) {
      error = err.message
    }
    try {
      lists = (await api('/api/admin/lists')).lists
    } catch (err) {
      listsError = err.message
    }
  })

  async function allowList(id, on) {
    listsError = ''
    const allowed = lists.filter((l) => (l.id === id ? on : l.allowed)).map((l) => l.id)
    try {
      lists = (await api('/api/admin/lists', { allowed })).lists
    } catch (err) {
      listsError = err.message
    }
  }

  async function toggle(key, on) {
    note = ''
    error = ''
    try {
      const r = await api('/api/policy', { [key]: on })
      policy = r.policy
      note = r.restarting ? 'Saved. The assistant is restarting (about 30 seconds).' : 'Saved.'
      askDelete = key === 'history' && !on && (await api('/api/admin/history?limit=1')).items.length > 0
    } catch (err) {
      error = err.message
    }
  }

  async function deleteHistory() {
    askDelete = false
    try {
      await api('/api/admin/history', { clear: true })
      note = 'Saved, and the history is deleted.'
    } catch (err) {
      error = err.message
    }
  }
</script>

<section class="card">
  <h2>🛡️ What the assistant can use</h2>
  {#if policy}
    <ul class="list">
      {#each POLICY as [key, text] (key)}
        <li>
          <label class="check grow"><input type="checkbox" checked={policy[key]} onchange={(e) => toggle(key, e.currentTarget.checked)} /> {text}</label>
        </li>
      {/each}
    </ul>
  {:else if !error}
    <p class="muted">Loading…</p>
  {/if}
  {#if askDelete}
    <div class="ask">
      <p>Logging is off. Delete the history too?</p>
      <button class="danger" onclick={deleteHistory}>Delete it</button>
      <button class="ghost" onclick={() => (askDelete = false)}>Keep it</button>
    </div>
  {:else if note}<p class="ok">{note}</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
  <p class="muted small">These apply to every Frog Hub. Grown-ups displays are switched on the Displays tab.</p>
</section>

<section class="card">
  <h2>📝 Lists it can use</h2>
  {#if lists}
    {#if lists.length}
      <ul class="list">
        {#each lists as l (l.id)}
          <li>
            <label class="check grow"><input type="checkbox" checked={l.allowed} onchange={(e) => allowList(l.id, e.currentTarget.checked)} /> {l.name}</label>
            <span class="muted small">{l.items} to do</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">Home Assistant has no to-do lists yet.</p>
    {/if}
  {:else if !listsError}
    <p class="muted">Loading…</p>
  {/if}
  {#if listsError}<p class="error">{listsError}</p>{/if}
  <p class="muted small">
    Home Assistant's to-do lists the assistant may read, add to and tick off ("add milk to the shopping list"). Lists
    from people's own accounts (Google Tasks and the like) stay private unless you tick them.
  </p>
</section>

<style>
  .grow {
    flex: 1;
  }
  .small {
    font-size: 13px;
  }
  .ask {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .ask p {
    flex-basis: 100%;
    margin: 0;
  }
</style>
