<script>
  // What Frog Hub's assistant may use, on every display (channel/store.ts). Web search and memory restart it.
  import { onMount } from 'svelte'
  import { api } from './api.svelte.js'
  import { POLICY } from '../lib/policy.js'

  let policy = $state(null)
  let note = $state('')
  let error = $state('')

  onMount(async () => {
    try {
      policy = await (await fetch('/api/policy')).json()
    } catch (err) {
      error = err.message
    }
  })

  async function toggle(key, on) {
    note = ''
    error = ''
    try {
      const r = await api('/api/policy', { [key]: on })
      policy = r.policy
      note = r.restarting ? 'Saved. The assistant is restarting (about 30 seconds).' : 'Saved.'
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
  {#if note}<p class="ok">{note}</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
  <p class="muted small">These apply to every Frog Hub. Grown-ups displays are switched on the Displays tab.</p>
</section>

<style>
  .grow {
    flex: 1;
  }
  .small {
    font-size: 13px;
  }
</style>
