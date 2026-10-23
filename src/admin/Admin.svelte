<script>
  // Frog Hub's admin page (<site>/admin): everything a grown-up manages, from a phone or computer.
  // The server checks the PIN and every request; this page just keeps the token for the tab.
  import PinPad from '../lib/PinPad.svelte'
  import { session, signIn, signOut } from './api.svelte.js'
  import Displays from './Displays.svelte'
  import Announce from './Announce.svelte'
  import Alarms from './Alarms.svelte'
  import Assistant from './Assistant.svelte'
  import Memory from './Memory.svelte'
  import History from './History.svelte'
  import Voices from './Voices.svelte'
  import Pair from './Pair.svelte'

  const TABS = [
    ['displays', '📺', 'Displays', Displays],
    ['announce', '📢', 'Announce', Announce],
    ['alarms', '⏰', 'Alarms', Alarms],
    ['assistant', '🛡️', 'Assistant', Assistant],
    ['memory', '🧠', 'Memory', Memory],
    ['history', '📜', 'History', History],
    ['voices', '🎙️', 'Voices', Voices],
  ]
  // A display's pairing QR code opens #pair=<code>: show it on the Displays tab
  const pairCode = (location.hash.match(/^#pair=([A-Za-z0-9]{8})$/) || [])[1] || ''
  let tab = $state(pairCode ? 'displays' : TABS.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'displays')
  $effect(() => history.replaceState(null, '', `#${tab}`))
  let Current = $derived(TABS.find((t) => t[0] === tab)[3])
</script>

{#if !session.token}
  <div class="login">
    <h1>🐸 Frog Hub Admin</h1>
    <PinPad onUnlock={signIn} onCancel={() => {}} />
  </div>
{:else}
  <header>
    <h1>🐸 Frog Hub Admin</h1>
    <button class="ghost" onclick={signOut}>🔒 Lock</button>
  </header>
  <nav>
    {#each TABS as [id, emoji, label] (id)}
      <button class:on={tab === id} onclick={() => (tab = id)}><span>{emoji}</span>{label}</button>
    {/each}
  </nav>
  <main>
    {#if tab === 'displays'}<Pair code={pairCode.toUpperCase()} />{/if}
    {#key tab}<Current />{/key}
  </main>
{/if}

<style>
  .login h1 {
    position: fixed;
    top: 24px;
    left: 0;
    right: 0;
    z-index: 30;
    margin: 0;
    text-align: center;
  }
  .login :global(.cancel) {
    display: none;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 8px;
    max-width: 920px;
    margin: 0 auto;
  }
  h1 {
    margin: 0;
    font-size: 22px;
  }
  nav {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    gap: 6px;
    padding: 8px 16px;
    max-width: 920px;
    margin: 0 auto;
    overflow-x: auto;
    background: var(--bg);
  }
  nav button {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding: 9px 14px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
  }
  nav button.on {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--bg);
  }
  main {
    max-width: 920px;
    margin: 0 auto;
    padding: 8px 16px 48px;
  }
</style>
