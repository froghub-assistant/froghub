<script>
  // Everything the assistant was asked and what it answered (channel/history.ts), newest first.
  import { onMount } from 'svelte'
  import { api } from './api.svelte.js'
  import { house } from '../lib/house.svelte.js'
  import { Brain, CalendarClock, Megaphone, MessageCircle, ScrollText } from '@lucide/svelte'

  const KINDS = { ask: MessageCircle, 'admin-page': Brain, announcement: Megaphone, scheduled: CalendarClock }
  const WHERE = { 'admin-page': 'Admin page', announcement: 'Announcement', scheduled: 'Scheduled job' }
  let items = $state(null)
  let more = $state(false)
  let find = $state('')
  let error = $state('')
  let clearing = $state(false) // asked once; the second press clears
  let logging = $state(null) // the history policy switch
  let askDelete = $state(false) // just turned off with something logged: delete it too?

  async function loadSwitch() {
    try {
      logging = (await (await fetch('/api/policy')).json()).history
    } catch {
      // the log still shows
    }
  }

  async function setLogging(on) {
    error = ''
    try {
      logging = (await api('/api/policy', { history: on })).policy.history
      askDelete = !logging && !!items?.length
    } catch (err) {
      error = err.message
    }
  }

  async function load(older = false) {
    error = ''
    try {
      const page = await api(`/api/admin/history?limit=50${older && items?.length ? `&before=${items.at(-1).at}` : ''}`)
      items = older ? [...items, ...page.items] : page.items
      more = page.more
    } catch (err) {
      error = err.message
    }
  }

  async function clear(sure = false) {
    if (!clearing && !sure) return (clearing = true)
    clearing = false
    askDelete = false
    try {
      await api('/api/admin/history', { clear: true })
      await load()
    } catch (err) {
      error = err.message
    }
  }

  const shown = $derived(
    !items ? [] : !find.trim() ? items
      : items.filter((e) => [e.text, e.answer, e.speaker, e.display].some((s) => s?.toLowerCase().includes(find.trim().toLowerCase()))),
  )
  const when = (ms) =>
    new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: house.timeZone })
  const where = (e) => [e.display || WHERE[e.kind] || 'A display', e.speaker && e.speaker !== 'someone' && e.kind === 'ask' ? e.speaker : '', e.admin && e.kind === 'ask' ? 'admin mode' : '']
    .filter(Boolean).join(' · ')

  onMount(() => {
    load()
    loadSwitch()
    const timer = setInterval(() => !find && items && items.length <= 50 && load(), 15000)
    return () => clearInterval(timer)
  })
</script>

<section class="card">
  <div class="top">
    <h2><ScrollText size={22} /> Questions and answers</h2>
    <button class="ghost" onclick={() => load()}>Refresh</button>
  </div>
  {#if logging !== null}
    <label class="check"><input type="checkbox" checked={logging} onchange={(e) => setLogging(e.currentTarget.checked)} /> Keep a log of questions and answers</label>
    {#if askDelete}
      <div class="ask">
        <p>Logging is off. Delete the history too?</p>
        <button class="danger" onclick={() => clear(true)}>Delete it</button>
        <button class="ghost" onclick={() => (askDelete = false)}>Keep it</button>
      </div>
    {:else if !logging}<p class="muted small">Off: nothing new is logged{items?.length ? ', and what is here stays until it is cleared' : ''}.</p>{/if}
  {/if}
  <input type="search" bind:value={find} placeholder="Find…" />
  {#if error}<p class="error">{error}</p>{/if}
  {#if !items}
    <p class="muted">Loading…</p>
  {:else if !shown.length}
    <p class="muted">{find ? 'Nothing matches.' : logging ? 'Nothing asked yet.' : 'Nothing logged.'}</p>
  {:else}
    <ul class="log">
      {#each shown as e (e.at + e.text)}
        {@const Kind = KINDS[e.kind] || MessageCircle}
        <li>
          <small><Kind size={14} /> {when(e.at)} · {where(e)}{e.ms ? ` · ${(e.ms / 1000).toFixed(1)} s` : ''}</small>
          <p class="q">{e.text}</p>
          {#if e.error}
            <p class="error">Failed: {e.error}</p>
          {:else if e.answer === null}
            <p class="muted">No answer in time.</p>
          {:else}
            <p class="a">{e.answer || '(nothing said)'}</p>
          {/if}
          {#if e.actions?.length || e.shown}
            <small>{[e.shown && `Showed “${e.shown}”`, ...(e.actions || [])].filter(Boolean).join(' · ')}</small>
          {/if}
        </li>
      {/each}
    </ul>
    {#if more}<button class="ghost" onclick={() => load(true)}>Older</button>{/if}
  {/if}
</section>

<section class="card">
  <p class="muted small">The newest 1,000 are kept on the server, where only Frog Hub can read them.</p>
  <button class="danger" onclick={clear} onblur={() => (clearing = false)}>{clearing ? 'Really clear it all?' : 'Clear the log'}</button>
</section>

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .top h2 {
    margin: 0;
  }
  input[type='search'] {
    width: 100%;
    margin: 12px 0 4px;
  }
  .log {
    list-style: none;
    margin: 8px 0;
    padding: 0;
  }
  .log li {
    display: grid;
    gap: 4px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .log p {
    margin: 0;
    white-space: pre-wrap;
  }
  .log small {
    color: var(--muted);
  }
  .q {
    font-weight: 600;
  }
  .a {
    padding-left: 12px;
    border-left: 3px solid var(--accent);
  }
  .small {
    font-size: 13px;
  }
  .ask {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 10px 0;
  }
  .ask p {
    flex-basis: 100%;
    margin: 0;
  }
</style>
