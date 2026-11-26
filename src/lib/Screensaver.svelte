<script>
  // The screensaver (App.svelte decides when, with screensaver.js): a big clock and date, the personality's face, or
  // a photo slideshow, or each in turn. Things drift slowly about so nothing stays lit in one place (old screens burn
  // in). A tap anywhere wakes it, and that tap goes no further: the cover catches the whole touch and stays a moment
  // longer while it fades (`leaving`), so nothing underneath is pressed.
  // Margins and transforms only, no flex gap or newer CSS: old tablets run Chrome 59.
  import { onMount } from 'svelte'
  import Face from './Face.svelte'
  import { driftTarget, modeAt, nextPhoto } from './screensaver.js'

  let { mode = 'clock', p, feeling = 'happy', now, timeZone, dim = false, leaving = false, onWake } = $props()

  const PHOTO_MS = 15000 // each photo for 15 seconds
  const started = Date.now()
  let photos = $state([])
  let layers = $state(['', '']) // two pictures, so one can fade into the next
  let front = $state(0)
  let pos = $state({ x: 0, y: 0 })
  let root

  let shownMode = $derived(modeAt(mode, now - started, photos.length > 0))
  let landscape = $state(true)

  // Somewhere new to drift to: slowly for the clock, a little livelier for the face
  let driftMs = $derived(shownMode === 'face' ? 9000 : 20000)
  function drift() {
    landscape = window.innerWidth >= window.innerHeight
    pos = driftTarget(pos, 0.25)
  }
  $effect(() => {
    const ms = driftMs
    const first = setTimeout(drift, 50) // after the first paint, so it glides from the middle
    const timer = setInterval(drift, ms)
    return () => (clearTimeout(first), clearInterval(timer))
  })

  // The slideshow: the next photo is loaded before it fades in; one that won't load is skipped from then on
  function showNext() {
    const url = nextPhoto(photos, layers[front])
    if (!url || url === layers[front]) {
      if (url && !layers[front]) layers[front] = url
      return
    }
    const img = new Image()
    img.onload = () => {
      const back = 1 - front
      layers[back] = url
      front = back
    }
    img.onerror = () => (photos = photos.filter((u) => u !== url))
    img.src = url
  }
  $effect(() => {
    if (shownMode !== 'photos') return
    showNext()
    const timer = setInterval(showNext, PHOTO_MS)
    return () => clearInterval(timer)
  })

  function wake(e) {
    e.preventDefault() // a cancelled touchstart sends no mouse events or click on to what's underneath
    e.stopPropagation()
    if (!leaving) onWake()
  }

  onMount(() => {
    // Svelte's own touchstart handlers are passive, and a passive one can't cancel the touch: so by hand
    const events = ['touchstart', 'touchend', 'mousedown', 'mouseup', 'click', 'contextmenu']
    for (const type of events) root.addEventListener(type, wake, { passive: false })
    if (mode === 'photos' || mode === 'mix') {
      fetch('/api/photos').then((r) => r.json()).then((r) => (photos = Array.isArray(r.photos) ? r.photos : [])).catch(() => {})
    }
    return () => {
      for (const type of events) root.removeEventListener(type, wake)
    }
  })

  let time = $derived(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }))
  let date = $derived(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone }))
  let move = $derived(`transform: translate(${(pos.x * (landscape ? 100 : 60)).toFixed(2)}vw, ${(pos.y * 100).toFixed(2)}vh); transition-duration: ${driftMs}ms`)
</script>

<div class="saver" class:leaving class:dim bind:this={root} role="button" tabindex="-1" aria-label="Wake up">
  {#if shownMode === 'photos'}
    {#each layers as url, i (i)}
      {#if url}<div class="photo" class:shown={i === front} style="background-image: url('{url.replace(/'/g, '%27')}')"></div>{/if}
    {/each}
  {:else}
    <div class="drifter" class:face={shownMode === 'face'} style={move}>
      {#if shownMode === 'face'}
        <Face kind={p.face} svg={p.svg} fill={p.colours.faceFill} ink={p.colours.faceInk} mood="waiting" {feeling} size={200} />
      {:else}
        <div class="time">{time}</div>
        <div class="date">{date}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .saver {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 50; /* over everything, alarms included (an alarm wakes it anyway) */
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: #000;
    color: var(--fg, #fff);
    opacity: 1;
    transition: opacity 0.4s;
    -webkit-tap-highlight-color: transparent;
    -webkit-user-select: none;
    user-select: none;
    outline: none;
  }
  .saver.leaving {
    opacity: 0;
  }
  /* In a browser there's no backlight to turn down, so the picture itself goes darker (the app dims the screen instead) */
  .saver.dim .drifter,
  .saver.dim .photo {
    filter: brightness(0.45);
  }
  .drifter {
    text-align: center;
    pointer-events: none; /* taps go to the cover, never the face */
    transition-property: transform;
    transition-timing-function: linear;
    will-change: transform;
  }
  .drifter.face {
    transition-timing-function: ease-in-out;
  }
  .time {
    font-size: 24vh;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--accent, #fff);
  }
  .date {
    margin-top: 2vh;
    font-size: 5vh;
    font-weight: 600;
    color: var(--muted, #aaa);
  }
  @media (orientation: portrait) {
    .time {
      font-size: 17vw;
    }
    .date {
      font-size: 4.5vw;
    }
  }
  .photo {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background-color: #000;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    opacity: 0;
    transition: opacity 1.5s;
    pointer-events: none;
  }
  .photo.shown {
    opacity: 1;
  }
</style>
