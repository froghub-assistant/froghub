<script>
  // The demo's strip of things to try: each one is asked as if it had been typed to the display.
  import { askText, voice } from '../lib/assist.svelte.js'
  import { FlaskConical } from '@lucide/svelte'

  const TRY = ['Tell me a joke', 'Turn off the lights', 'Set a timer for 10 seconds', "What's the weather?", 'What is 7 times 8?', 'Tell me a story', 'Goodnight']
  let note = $state('')
  let height = $state(0)
  $effect(() => document.documentElement.style.setProperty('--demo-bar', `${height}px`))

  function ask(text) {
    note = askText(text) ? '' : voice.status === 'off' ? 'Tap the screen first, so it can talk.' : 'Just a moment…'
  }
</script>

<aside bind:clientHeight={height}>
  <span class="label"><FlaskConical size={16} /> Demo: a pretend bedroom, nothing real. Try</span>
  {#each TRY as t (t)}<button onclick={() => ask(t)}>{t}</button>{/each}
  <span class="label">or tap the frog to type.</span>
  {#if note}<span class="note">{note}</span>{/if}
  <a href="../">About Frog Hub →</a>
</aside>

<style>
  aside {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 50;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font: 14px/1.3 system-ui, sans-serif;
  }
  button {
    padding: 4px 10px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.12);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  button:hover {
    background: rgba(255, 255, 255, 0.25);
  }
  .note {
    color: #ffd27a;
  }
  a {
    margin-left: auto;
    color: #b7f5bf;
  }
</style>
