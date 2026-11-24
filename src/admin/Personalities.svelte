<script>
  // Make your own personalities (channel/personas.ts): describe a character, Claude writes how it talks, its colours,
  // its words on screen, its voice and an animated face; tweak it, then save it for every display.
  import { onMount, onDestroy } from 'svelte'
  import { api } from './api.svelte.js'
  import { refreshCustoms } from '../lib/customs.svelte.js'
  import Face from '../lib/Face.svelte'
  import { LoaderCircle, Palette, Pencil, RotateCcw, Save, Sparkles, Trash, WandSparkles } from '@lucide/svelte'

  const MOODS = [
    ['waiting', 'Waiting'],
    ['listening', 'Listening'],
    ['thinking', 'Thinking'],
    ['speaking', 'Speaking'],
    ['error', 'Confused'],
  ]
  const FEELINGS = [
    ['happy', 'Happy'],
    ['sad', 'Sad'],
    ['tired', 'Tired'],
  ]
  const EXAMPLES = ['a sleepy cloud who loves weather facts', 'a brave little robot who talks like a pirate', 'a calm owl who reads bedtime stories']

  let saved = $state([])
  let builder = $state(undefined) // 'claude-code', 'api' or null (can't make any)
  let voices = $state([])
  let description = $state('')
  let feedback = $state('')
  let draft = $state(null) // what's being made or edited (an id when editing a saved one)
  let working = $state(false)
  let mood = $state('waiting')
  let feeling = $state('happy')
  let note = $state('')
  let error = $state('')
  let poll = null

  async function load() {
    try {
      const r = await api('/api/admin/personalities')
      saved = r.personalities
      builder = r.builder
    } catch (err) {
      error = err.message
    }
  }

  onMount(async () => {
    await load()
    try {
      voices = (await api('/api/admin/personalities/voices')).voices
    } catch {
      // the voice list is only for the picker
    }
  })
  onDestroy(() => clearTimeout(poll))

  async function make(refine) {
    note = ''
    error = ''
    working = true
    try {
      const body = refine ? { description: draft.description || description, feedback, previous: $state.snapshot(draft) } : { description }
      const { job } = await api('/api/admin/personalities/generate', body)
      const check = async () => {
        try {
          const r = await api(`/api/admin/personalities/job?id=${job}`)
          if (r.status === 'working') return (poll = setTimeout(check, 3000))
          working = false
          if (r.status === 'failed') return (error = r.error)
          draft = { ...r.draft, id: refine ? draft.id : undefined }
          feedback = ''
          mood = 'waiting'
          feeling = 'happy'
        } catch (err) {
          working = false
          error = err.message
        }
      }
      poll = setTimeout(check, 3000)
    } catch (err) {
      working = false
      error = err.message
    }
  }

  async function save() {
    note = ''
    error = ''
    try {
      const r = await api('/api/admin/personalities', { personality: $state.snapshot(draft) })
      note = `Saved ${r.personality.name}. ${r.voice} Pick it in Settings on a display (or publish it from admin mode).`
      draft = null
      description = ''
      await load()
      refreshCustoms()
    } catch (err) {
      error = err.message
    }
  }

  async function remove(p) {
    if (!confirm(`Delete ${p.name}? Displays using it go back to Frog.`)) return
    note = ''
    error = ''
    try {
      const r = await api('/api/admin/personalities/delete', { id: p.id })
      note = `Deleted ${p.name}.${r.note || ''}`
      if (draft?.id === p.id) draft = null
      await load()
      refreshCustoms()
    } catch (err) {
      error = err.message
    }
  }

  function edit(p) {
    draft = { ...p }
    description = p.description
    feedback = ''
    note = ''
    error = ''
    scrollTo({ top: 0, behavior: 'smooth' })
  }

  const voiceName = (id) => (voices.find((v) => v.id === id) || {}).name || id
</script>

{#if saved.length}
  <section class="card">
    <h2><Palette size={20} /> Your personalities</h2>
    <div class="saved">
      {#each saved as p (p.id)}
        <article style="--pbg: {p.colours.bg}; --pfg: {p.colours.fg}; --pac: {p.colours.accent}">
          <Face kind="custom" svg={p.svg} size={84} />
          <div class="about">
            <b>{p.name}</b>
            <span class="small">{voiceName(p.voice)}</span>
          </div>
          <button class="ghost icon" onclick={() => edit(p)} aria-label="Edit {p.name}"><Pencil size={16} /></button>
          <button class="ghost icon" onclick={() => remove(p)} aria-label="Delete {p.name}"><Trash size={16} /></button>
        </article>
      {/each}
    </div>
  </section>
{/if}

<section class="card">
  <h2><Sparkles size={20} /> {draft?.id ? `Change ${draft.name}` : 'Make a personality'}</h2>
  {#if builder === null}
    <p class="error">The personality builder needs Claude Code on the Frog Hub server, or an ANTHROPIC_API_KEY.</p>
  {/if}
  {#if !draft}
    <label>
      Describe a character
      <textarea rows="3" maxlength="600" bind:value={description} placeholder="e.g. {EXAMPLES[0]}"></textarea>
    </label>
    <p class="muted small">
      Ideas: {#each EXAMPLES as e, i (e)}<button class="link" onclick={() => (description = e)}>{e}</button>{i < EXAMPLES.length - 1 ? ' · ' : ''}{/each}
    </p>
    <button class="primary" disabled={working || !description.trim() || builder === null} onclick={() => make(false)}>
      {#if working}<LoaderCircle size={16} class="spin" /> Claude is drawing it (a minute or two)…{:else}<WandSparkles size={16} /> Make it{/if}
    </button>
  {:else}
    <div class="preview" style="--pbg: {draft.colours.bg}; --pbg2: {draft.colours.bg2}; --pfg: {draft.colours.fg}; --pmuted: {draft.colours.muted}; --pac: {draft.colours.accent}">
      <Face kind="custom" svg={draft.svg} {mood} {feeling} size={200} />
      <p class="line">
        {mood === 'listening' ? draft.listening : mood === 'thinking' ? draft.thinking : mood === 'error' ? draft.error : draft.greeting.split('{name}').join('Sam')}
      </p>
      <div class="swatches">
        {#each Object.entries(draft.colours) as [k, c] (k)}<i style="background: {c}" title="{k} {c}"></i>{/each}
      </div>
    </div>
    <div class="seg">
      {#each MOODS as [id, label] (id)}<button class:on={mood === id} onclick={() => (mood = id)}>{label}</button>{/each}
    </div>
    <div class="seg" class:dim={mood !== 'waiting'}>
      {#each FEELINGS as [id, label] (id)}<button class:on={feeling === id} onclick={() => ((feeling = id), (mood = 'waiting'))}>{label}</button>{/each}
    </div>

    <div class="fields">
      <label>Name <input maxlength="24" bind:value={draft.name} /></label>
      <label>Greeting ({'{name}'} is the person) <input maxlength="100" bind:value={draft.greeting} /></label>
      <label>While listening <input maxlength="60" bind:value={draft.listening} /></label>
      <label>While thinking <input maxlength="60" bind:value={draft.thinking} /></label>
      <label>When something goes wrong <input maxlength="60" bind:value={draft.error} /></label>
      <label>
        Voice
        <select bind:value={draft.voice}>
          {#if !voices.some((v) => v.id === draft.voice)}<option value={draft.voice}>{draft.voice}</option>{/if}
          {#each voices as v (v.id)}<option value={v.id}>{v.name} ({v.language.replace('_', '-')})</option>{/each}
        </select>
      </label>
      <label>Pitch {draft.pitch} <input type="range" min="0.7" max="1.3" step="0.01" bind:value={draft.pitch} /></label>
      <label class="wide">
        How it talks (what the assistant is told)
        <textarea rows="5" maxlength="1200" bind:value={draft.prompt}></textarea>
      </label>
    </div>
    <p class="muted small">The rules for looking after the children always come first, whatever this says.</p>

    <label>
      Want something different?
      <textarea rows="2" maxlength="600" bind:value={feedback} placeholder="e.g. make the face rounder, and the voice less shouty"></textarea>
    </label>
    <div class="row buttons">
      <button class="ghost" disabled={working || !feedback.trim() || builder === null} onclick={() => make(true)}>
        {#if working}<LoaderCircle size={16} class="spin" /> Changing it…{:else}<RotateCcw size={16} /> Change it{/if}
      </button>
      <button class="primary" disabled={working || !draft.name.trim()} onclick={save}><Save size={16} /> Save</button>
      <button class="ghost" disabled={working} onclick={() => ((draft = null), (feedback = ''))}>Start again</button>
    </div>
  {/if}
  {#if note}<p class="ok">{note}</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
</section>

<style>
  .saved {
    display: grid;
    gap: 10px;
  }
  .saved article {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 14px;
    background: var(--pbg);
    color: var(--pfg);
    border: 1px solid var(--pac);
  }
  .about {
    flex: 1;
    display: grid;
  }
  .icon {
    color: var(--pfg);
  }
  .preview {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 20px;
    margin-bottom: 12px;
    border-radius: 18px;
    background: linear-gradient(var(--pbg), var(--pbg2));
    color: var(--pfg);
  }
  .line {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    text-align: center;
  }
  .swatches {
    display: flex;
    gap: 6px;
  }
  .swatches i {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.3);
  }
  .seg {
    margin-bottom: 8px;
  }
  .dim {
    opacity: 0.6;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
    margin: 14px 0 6px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .buttons {
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .small {
    font-size: 13px;
  }
  textarea + .muted,
  label + .primary {
    margin-top: 10px;
  }
  .primary,
  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
