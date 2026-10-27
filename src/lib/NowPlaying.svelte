<script>
  // What this display's Music Assistant speaker is playing, from the now-playing pill: the picture, back, play/pause,
  // next, its volume and what's up next. All through Home Assistant's media player for it.
  import { onMount } from 'svelte'
  import { ListMusic, Music, Pause, Play, SkipBack, SkipForward, Square, X } from '@lucide/svelte'

  // id: the speaker's media_player entity; entity: its HA state (kept up to date by the page)
  let { ha, id, entity, onClose, onFind } = $props()

  let next = $state('') // the queue's next item
  let volume = $state(0) // the speaker's, from the effect below
  let error = $state('')

  let a = $derived(entity ? entity.attributes : {})
  let playing = $derived(entity && entity.state === 'playing')
  let picture = $derived(a.entity_picture ? ha.absolute(a.entity_picture) : '')

  onMount(() => {
    loadQueue()
    const timer = setInterval(loadQueue, 15000)
    return () => clearInterval(timer)
  })

  // Follow volume changes from elsewhere (Music Assistant, the assistant), unless the slider is being moved
  let sliding = false
  $effect(() => {
    const v = Math.round((a.volume_level || 0) * 100)
    if (!sliding) volume = v
  })

  async function loadQueue() {
    try {
      const r = await ha.call({ type: 'call_service', domain: 'music_assistant', service: 'get_queue', service_data: { entity_id: id }, return_response: true })
      const q = r.response && r.response[id]
      const item = q && q.next_item
      next = item ? (item.media_item && item.media_item.name) || item.name || '' : ''
    } catch {
      next = ''
    }
  }

  async function media(service, data = {}) {
    error = ''
    try {
      await ha.callService('media_player', service, { entity_id: id, ...data })
      if (service === 'media_next_track' || service === 'media_previous_track') setTimeout(loadQueue, 1500)
    } catch (err) {
      error = err.message
    }
  }

  function setVolume() {
    sliding = false
    media('volume_set', { volume_level: volume / 100 })
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="sheet-back" onclick={onClose}>
  <div class="sheet" onclick={(e) => e.stopPropagation()}>
    <button class="close" onclick={onClose} aria-label="Close"><X size={26} /></button>
    {#if picture}<img src={picture} alt="" />{:else}<div class="blank"><Music size={80} /></div>{/if}
    <h2>{a.media_title || 'Nothing playing'}</h2>
    {#if a.media_artist || a.media_album_name}<p class="by">{[a.media_artist, a.media_album_name].filter(Boolean).join(' · ')}</p>{/if}

    <div class="controls">
      <button onclick={() => media('media_previous_track')} aria-label="Back"><SkipBack size={34} /></button>
      <button class="main" onclick={() => media('media_play_pause')} aria-label={playing ? 'Pause' : 'Play'}>
        {#if playing}<Pause size={40} fill="currentColor" />{:else}<Play size={40} fill="currentColor" />{/if}
      </button>
      <button onclick={() => media('media_next_track')} aria-label="Next"><SkipForward size={34} /></button>
      <button onclick={() => (media('media_stop'), onClose())} aria-label="Stop"><Square size={28} fill="currentColor" /></button>
    </div>

    <label class="volume">
      Volume
      <input type="range" min="0" max="100" step="5" bind:value={volume} oninput={() => (sliding = true)} onchange={setVolume} />
      <span>{volume}%</span>
    </label>

    {#if next}<p class="next">Up next: {next}</p>{/if}
    {#if error}<p class="next">Couldn't do that: {error}</p>{/if}
    <button class="find" onclick={onFind}><ListMusic size={20} /> Find something else</button>
  </div>
</div>

<style>
  .sheet-back {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
  }
  .sheet {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(420px, 90vw);
    max-height: 94vh;
    padding: 24px;
    border-radius: 24px;
    background: var(--bg);
    color: var(--fg);
    box-sizing: border-box;
    overflow-y: auto;
  }
  .close {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    border: 0;
    background: none;
    color: var(--fg);
  }
  img,
  .blank {
    width: min(260px, 60vw);
    aspect-ratio: 1;
    border-radius: 18px;
    object-fit: cover;
    background: var(--bg2);
  }
  .blank {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
  }
  h2 {
    margin: 16px 0 4px;
    font-size: 24px;
    text-align: center;
  }
  .by {
    margin: 0;
    color: var(--muted);
    font-size: 18px;
    text-align: center;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 18px;
    margin: 18px 0 10px;
  }
  .controls button {
    display: flex;
    padding: 8px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--fg);
  }
  .controls .main {
    padding: 14px;
    background: var(--accent);
    color: var(--bg);
  }
  .volume {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    font-size: 18px;
  }
  .volume input {
    flex: 1;
    accent-color: var(--accent);
  }
  .next {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: 17px;
    text-align: center;
  }
  .find {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    padding: 10px 18px;
    border: 2px solid var(--accent);
    border-radius: 999px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 18px;
  }
</style>
