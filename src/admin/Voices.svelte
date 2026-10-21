<script>
  // How many "Hey Verity" wake word recordings each person has made (Settings → 🎙️ on a display), towards retraining.
  import { onMount } from 'svelte'
  import { api } from './api.svelte.js'

  const GOAL = { wake: 40, other: 20 }
  let counts = $state(null)
  let error = $state('')

  onMount(async () => {
    try {
      counts = await api('/api/wakeword/counts')
    } catch (err) {
      error = err.message
    }
  })
</script>

<section class="card">
  <h2>🎙️ "Hey Verity" recordings</h2>
  {#if error}<p class="error">{error}</p>{/if}
  {#if counts}
    {#if !Object.keys(counts).length}
      <p class="muted">No recordings yet. On a Frog Hub: Settings (admin mode) → 🎙️ Record voices.</p>
    {:else}
      {#each Object.entries(counts) as [who, c] (who)}
        <div class="person">
          <b>{who.replace(/_/g, ' ')}</b>
          {#each ['wake', 'other'] as kind (kind)}
            <div class="bar-row">
              <span>{kind === 'wake' ? '"Hey Verity"' : 'Other talking'}</span>
              <div class="bar"><span style="width: {Math.min(100, ((c[kind] || 0) / GOAL[kind]) * 100)}%"></span></div>
              <span class="num">{c[kind] || 0}/{GOAL[kind]}</span>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
    <p class="muted small">Once everyone is near the goal, the wake word can be retrained with their real voices.</p>
  {:else if !error}
    <p class="muted">Loading…</p>
  {/if}
</section>

<style>
  .person {
    margin: 14px 0;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 120px 1fr 56px;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
    font-size: 14px;
  }
  .bar {
    height: 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .num {
    text-align: right;
    color: var(--muted);
  }
  .small {
    font-size: 13px;
  }
</style>
