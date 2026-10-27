<script>
  // The alarms and timers every Frog Hub rings for (channel/alarms.ts): see them, add one, cancel one.
  import { onMount } from 'svelte'
  import { api } from './api.svelte.js'
  import { house } from '../lib/house.svelte.js'
  import { AlarmClock, Timer } from '@lucide/svelte'

  const REPEATS = [['once', 'Once'], ['daily', 'Every day'], ['weekdays', 'School days (Mon–Fri)'], ['weekends', 'Weekends']]
  let alarms = $state(null)
  let kind = $state('alarm')
  let time = $state('07:30')
  let minutes = $state(10)
  let label = $state('')
  let repeat = $state('once')
  let error = $state('')
  let note = $state('')

  async function load() {
    try {
      alarms = (await (await fetch('/api/alarms')).json()).alarms.sort((a, b) => a.next - b.next)
    } catch (err) {
      error = err.message
    }
  }

  async function run(tool, args) {
    error = ''
    note = ''
    try {
      note = (await api('/api/alarms/manage', { tool, args })).text
      await load()
    } catch (err) {
      error = err.message
    }
  }

  function add(event) {
    event.preventDefault()
    if (kind === 'alarm') run('set_alarm', { time, label: label || undefined, repeat })
    else run('set_timer', { minutes: Number(minutes), label: label || undefined })
    label = ''
  }

  const when = (ms) =>
    new Date(ms).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: house.timeZone })

  onMount(() => {
    load()
    const timer = setInterval(load, 15000)
    return () => clearInterval(timer)
  })
</script>

<section class="card">
  <h2>Set</h2>
  <form onsubmit={add}>
    <div class="seg">
      <button type="button" class:on={kind === 'alarm'} onclick={() => (kind = 'alarm')}><AlarmClock size={16} /> Alarm</button>
      <button type="button" class:on={kind === 'timer'} onclick={() => (kind = 'timer')}><Timer size={16} /> Timer</button>
    </div>
    <div class="cols">
      {#if kind === 'alarm'}
        <label>Time <input type="time" bind:value={time} required /></label>
        <label>
          Repeat
          <select bind:value={repeat}>{#each REPEATS as [id, text] (id)}<option value={id}>{text}</option>{/each}</select>
        </label>
      {:else}
        <label>Minutes <input type="number" min="0.5" max="720" step="0.5" bind:value={minutes} required /></label>
      {/if}
      <label>Label <input bind:value={label} maxlength="40" placeholder={kind === 'alarm' ? 'School' : 'Cookies'} /></label>
    </div>
    <button class="primary">Set {kind}</button>
  </form>
  {#if note}<p class="ok">{note}</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
</section>

<section class="card">
  <h2>Set now</h2>
  {#if !alarms}
    <p class="muted">Loading…</p>
  {:else if !alarms.length}
    <p class="muted">No alarms or timers.</p>
  {:else}
    <ul class="list">
      {#each alarms as a (a.id)}
        <li>
          <span class="icon">{#if a.timer}<Timer size={22} />{:else}<AlarmClock size={22} />{/if}</span>
          <span class="what">
            <b>{a.label}</b>
            <small>{a.timer ? `rings ${when(a.next)}` : `${a.time}${a.repeat && a.repeat !== 'once' ? ` · ${REPEATS.find((r) => r[0] === a.repeat)[1]}` : ''} · next ${when(a.next)}`}</small>
          </span>
          <button class="ghost" onclick={() => run('cancel_alarm', { id: a.id })}>Cancel</button>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="muted small">They ring on every Frog Hub.</p>
</section>

<style>
  form {
    display: grid;
    gap: 14px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
  }
  .icon {
    display: flex;
    color: var(--accent);
  }
  .what {
    flex: 1;
    display: grid;
  }
  .what small {
    color: var(--muted);
  }
  .small {
    font-size: 13px;
  }
</style>
