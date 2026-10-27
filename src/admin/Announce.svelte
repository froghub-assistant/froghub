<script>
  // Say something on one Frog Hub or all of them, word for word or by asking the assistant to put it in its own words.
  import { onMount } from 'svelte'
  import { api } from './api.svelte.js'
  import { personalities } from '../lib/personalities.js'
  import { house } from '../lib/house.svelte.js'
  import { Megaphone } from '@lucide/svelte'

  let mode = $state('say') // say | prompt
  let text = $state('')
  let to = $state('') // a display's name, or '' for all
  let atNight = $state(false)
  let personality = $state('')
  let displays = $state([])
  let sending = $state(false)
  let result = $state('')
  let error = $state('')

  onMount(async () => {
    try {
      displays = await (await fetch('/api/displays')).json()
    } catch {
      // no list: it goes to all of them
    }
  })

  async function send(event) {
    event.preventDefault()
    sending = true
    result = ''
    error = ''
    try {
      const body = { [mode]: text.trim(), at_night: atNight, ...(to ? { to } : {}), ...(mode === 'prompt' && personality ? { personality } : {}) }
      const r = await api('/api/admin/announce', body)
      result = mode === 'prompt' ? `Said: “${r.text}”` : 'Sent!'
      text = ''
    } catch (err) {
      error = err.message
    } finally {
      sending = false
    }
  }
</script>

<form class="card" onsubmit={send}>
  <div class="seg">
    <button type="button" class:on={mode === 'say'} onclick={() => (mode = 'say')}>Say exactly this</button>
    <button type="button" class:on={mode === 'prompt'} onclick={() => (mode = 'prompt')}>Ask the assistant to say it</button>
  </div>
  <label>
    {mode === 'say' ? 'What should it say?' : 'What should it tell the room?'}
    <textarea bind:value={text} rows="3" maxlength={mode === 'say' ? 500 : 1000}
      placeholder={mode === 'say' ? "Dinner's ready!" : `Tell ${house.kids[0] || 'Sam'} it is time to get ready for school, and show the weather`}></textarea>
  </label>
  <div class="cols">
    <label>
      To
      <select bind:value={to}>
        <option value="">Every Frog Hub</option>
        {#each displays as d (d.id)}<option value={d.name}>{d.name}</option>{/each}
      </select>
    </label>
    {#if mode === 'prompt'}
      <label>
        As
        <select bind:value={personality}>
          <option value="">The usual personality</option>
          {#each Object.entries(personalities) as [id, p] (id)}<option value={id}>{p.name}</option>{/each}
        </select>
      </label>
    {/if}
  </div>
  <label class="check"><input type="checkbox" bind:checked={atNight} /> Speak it at night too (otherwise it's only shown during night hours)</label>
  <button class="primary" disabled={sending || !text.trim()}>{#if sending}{mode === 'prompt' ? 'Asking…' : 'Sending…'}{:else}<Megaphone size={18} /> Send{/if}</button>
  {#if result}<p class="ok">{result}</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
</form>

<style>
  form {
    display: grid;
    gap: 14px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }
</style>
