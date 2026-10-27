<script>
  // What Frog Hub's assistant remembers. The memory is its own to keep tidy, so grown-ups don't edit the files:
  // they ask it to remember, change or forget something (it does that with its own tools and says what it did).
  import { onMount } from 'svelte'
  import { api, ago } from './api.svelte.js'
  import { house } from '../lib/house.svelte.js'
  import { Brain } from '@lucide/svelte'

  let files = $state(null)
  let open = $state('') // the memory shown in full
  let request = $state('')
  let asking = $state(false)
  let answer = $state('')
  let error = $state('')

  async function load() {
    try {
      files = await api('/api/admin/memory')
    } catch (err) {
      error = err.message
    }
  }

  async function ask(event) {
    event.preventDefault()
    asking = true
    answer = ''
    error = ''
    try {
      answer = (await api('/api/admin/remember', { text: request.trim() })).text
      request = ''
      await load()
    } catch (err) {
      error = err.message
    } finally {
      asking = false
    }
  }

  // Memory files start with a little header (name, description); show the description and the rest.
  const description = (text) => (text.match(/^description:\s*(.+)$/m) || [])[1] || ''
  const body = (text) => text.replace(/^---[\s\S]*?---\s*/, '').trim()

  onMount(load)
</script>

<section class="card">
  <h2><Brain size={22} /> Ask it to remember something</h2>
  <form onsubmit={ask}>
    <textarea bind:value={request} rows="3" maxlength="1000" disabled={asking}
      placeholder={`House rule: bedtime is 8pm on school nights\n${house.kids[0] || 'Sam'}'s favourite animal is now the axolotl\nForget the thing about the spelling test`}></textarea>
    <button class="primary" disabled={asking || !request.trim()}>{asking ? 'Asking…' : 'Ask'}</button>
  </form>
  {#if answer}<p class="ok">“{answer}”</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
  <p class="muted small">It can remember new things, change them, or forget them. Start with "House rule:" for something it should always follow.</p>
</section>

<section class="card">
  <h2>What it remembers</h2>
  {#if !files}
    <p class="muted">Loading…</p>
  {:else if !files.filter((f) => f.file !== 'MEMORY.md').length}
    <p class="muted">Nothing yet.</p>
  {:else}
    <ul class="list">
      {#each files.filter((f) => f.file !== 'MEMORY.md') as f (f.file)}
        <li>
          <button class="memory" onclick={() => (open = open === f.file ? '' : f.file)}>
            <b>{description(f.text) || f.file.replace(/\.md$/, '').replace(/[-_]/g, ' ')}</b>
            {#if open === f.file}
              <span class="full">{body(f.text)}</span>
            {/if}
            <small>{ago(f.modified)}</small>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  form {
    display: grid;
    gap: 10px;
  }
  .memory {
    flex: 1;
    display: grid;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    text-align: left;
  }
  .memory small {
    color: var(--muted);
  }
  .full {
    white-space: pre-wrap;
    color: var(--muted);
    font-size: 14px;
  }
  .small {
    font-size: 13px;
  }
</style>
