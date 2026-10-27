<script>
  // Find music and play it, without asking the assistant: songs, artists, albums, playlists and radio from every
  // music service added to Music Assistant, played on this display or a Music Assistant speaker in its room.
  import { onMount } from 'svelte'
  import { Disc3, ListMusic, Music, Radio, Search, User, X } from '@lucide/svelte'

  // players: [{ id, name, here }], this display's own speaker first. configEntry: Music Assistant's, for its search.
  let { ha, players, configEntry, device, onClose } = $props()

  const KINDS = [
    { key: 'tracks', label: 'Songs', icon: Music },
    { key: 'artists', label: 'Artists', icon: User },
    { key: 'albums', label: 'Albums', icon: Disc3 },
    { key: 'playlists', label: 'Playlists', icon: ListMusic },
    { key: 'radio', label: 'Radio', icon: Radio },
  ]

  let query = $state('')
  let kind = $state('tracks')
  let results = $state(null) // Music Assistant's answer: { tracks: [...], artists: [...], ... }
  let favourites = $state([]) // before searching: the library's favourites (tap the heart in Music Assistant)
  let browse = $state([]) // and some albums from the library to browse
  let status = $state('')
  let allowed = $state(true) // the grown-ups' "Play music" switch
  let grownUps = $state(false) // on a grown-ups' display, explicit songs show too
  // Where to play: what was picked, else this display if it's a speaker (players lists it first, once it's on), else
  // the room's first Music Assistant speaker
  let chosen = $state('')
  let target = $derived(chosen && players.some((pl) => pl.id === chosen) ? chosen : players[0] ? players[0].id : '')
  let input
  let searchId = 0

  const clean = (items) => items.filter((item) => grownUps || item.explicit !== true)
  let shown = $derived(results ? clean(results[kind] || []) : [])

  onMount(() => {
    input.focus()
    fetch('/api/policy').then((r) => r.json()).then((p) => (allowed = p.music !== false)).catch(() => {})
    fetch(`/api/audience?device=${device}`).then((r) => r.json()).then((a) => (grownUps = !!a.grownUps)).catch(() => {})
    loadHome()
  })

  async function library(data) {
    try {
      const r = await ha.call({
        type: 'call_service',
        domain: 'music_assistant',
        service: 'get_library',
        service_data: { config_entry_id: configEntry, limit: 12, ...data },
        return_response: true,
      })
      return (r.response && r.response.items) || []
    } catch {
      return []
    }
  }

  async function loadHome() {
    const [tracks, playlists, albums, some] = await Promise.all([
      library({ media_type: 'track', favorite: true }),
      library({ media_type: 'playlist', favorite: true }),
      library({ media_type: 'album', favorite: true }),
      library({ media_type: 'album', order_by: 'random' }),
    ])
    favourites = [...playlists, ...albums, ...tracks]
    const seen = new Set(favourites.map((i) => i.uri))
    browse = some.filter((i) => !seen.has(i.uri))
  }

  async function search(e) {
    e.preventDefault()
    const name = query.trim()
    if (!name) return
    input.blur() // the keyboard covers the results
    const id = ++searchId
    status = 'Searching…'
    try {
      const r = await ha.call({
        type: 'call_service',
        domain: 'music_assistant',
        service: 'search',
        service_data: { config_entry_id: configEntry, name, limit: 20 },
        return_response: true,
      })
      if (id !== searchId) return
      results = r.response || {}
      // Show the first kind with anything in it, starting with songs
      const first = KINDS.find((k) => (results[k.key] || []).length)
      if (first && !(results[kind] || []).length) kind = first.key
      status = first ? '' : `Nothing found for “${name}”`
    } catch (err) {
      if (id === searchId) status = `Couldn't search: ${err.message}`
    }
  }

  async function play(item) {
    status = `Starting ${item.name}…`
    try {
      await ha.callService('music_assistant', 'play_media', {
        entity_id: target,
        media_id: item.uri,
        media_type: item.media_type,
        enqueue: 'replace',
      })
      onClose()
    } catch (err) {
      status = `Couldn't play it: ${err.message}`
    }
  }

  function by(item) {
    if (item.artists && item.artists.length) return item.artists.map((a) => a.name).join(', ')
    return item.owner || ''
  }

  // Music Assistant's own pictures (its library, Plex...) come from its web server at home over http; Caddy passes
  // /imageproxy/ on to it, so the https page can show them
  function picture(item) {
    if (typeof item.image !== 'string' || !/^https?:/.test(item.image)) return ''
    const url = new URL(item.image)
    if (url.pathname.startsWith('/imageproxy/')) return `/imageproxy/${url.pathname.slice(12)}?size=256`
    return url.protocol === 'https:' ? item.image : ''
  }
</script>

{#snippet tile(item)}
  {@const KindIcon = (KINDS.find((k) => k.key.startsWith(item.media_type)) || KINDS[0]).icon}
  <button class="item" onclick={() => play(item)}>
    {#if picture(item)}<img src={picture(item)} alt="" loading="lazy" />{:else}<span class="blank"><KindIcon size={48} /></span>{/if}
    <span class="name">{item.name}{item.version ? ` (${item.version})` : ''}</span>
    {#if by(item)}<span class="by">{by(item)}</span>{/if}
  </button>
{/snippet}

<div class="music">
  <form class="bar" onsubmit={search}>
    <input bind:this={input} bind:value={query} placeholder="Find a song, artist or album" enterkeyhint="search" />
    <button type="submit" disabled={!query.trim()} aria-label="Search"><Search size={24} /></button>
    <button type="button" class="close" onclick={onClose} aria-label="Close"><X size={26} /></button>
  </form>

  {#if !allowed}
    <p class="note">A grown-up has turned music off.</p>
  {:else}
    <div class="row">
      <div class="kinds">
        {#each KINDS as k (k.key)}
          {@const count = results ? (results[k.key] || []).length : 0}
          <button class:chosen={kind === k.key} disabled={results && !count} onclick={() => (kind = k.key)}>
            <k.icon size={20} />{k.label}
          </button>
        {/each}
      </div>
      <label class="where">
        Play on
        <select value={target} onchange={(e) => (chosen = e.currentTarget.value)}>
          {#each players as pl (pl.id)}<option value={pl.id}>{pl.here ? 'This display' : pl.name}</option>{/each}
        </select>
      </label>
    </div>

    {#if status}<p class="note">{status}</p>{/if}

    <div class="results">
      {#if results}
        {#each shown as item (item.uri)}{@render tile(item)}{/each}
      {:else}
        {#if clean(favourites).length}
          <h3>Favourites</h3>
          {#each clean(favourites) as item (item.uri)}{@render tile(item)}{/each}
        {/if}
        {#if clean(browse).length}
          <h3>From your music</h3>
          {#each clean(browse) as item (item.uri)}{@render tile(item)}{/each}
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .music {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
  }
  .bar input {
    flex: 1;
    min-width: 0;
    padding: 10px 14px;
    border: 2px solid var(--accent);
    border-radius: 12px;
    background: var(--bg2);
    color: var(--fg);
    font: inherit;
    font-size: 22px;
  }
  .bar button {
    display: flex;
    padding: 10px 14px;
    border: 0;
    border-radius: 12px;
    background: var(--accent);
    color: var(--bg);
  }
  .bar button:disabled {
    opacity: 0.4;
  }
  .bar .close {
    background: none;
    color: var(--fg);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 16px 10px;
  }
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .kinds button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 2px solid var(--bg2);
    border-radius: 999px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 18px;
  }
  .kinds button.chosen {
    border-color: var(--accent);
    background: var(--bg2);
  }
  .kinds button:disabled {
    opacity: 0.35;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 18px;
  }
  .where select {
    max-width: 220px;
    padding: 8px;
    border: 2px solid var(--accent);
    border-radius: 12px;
    background: var(--bg2);
    color: var(--fg);
    font: inherit;
    font-size: 18px;
  }
  .note {
    margin: 4px 16px 10px;
    color: var(--muted);
    font-size: 20px;
  }
  .results {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    grid-auto-rows: max-content;
    gap: 14px;
    padding: 0 16px 16px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  h3 {
    grid-column: 1 / -1;
    margin: 6px 0 0;
    font-size: 20px;
  }
  .item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    text-align: left;
  }
  .item img,
  .blank {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 12px;
    object-fit: cover;
    background: var(--bg2);
  }
  .blank {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg);
    opacity: 0.5;
  }
  .name {
    font-size: 18px;
    font-weight: 700;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .by {
    color: var(--muted);
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
