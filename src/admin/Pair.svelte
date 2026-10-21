<script>
  // Pair a new display (channel/pair.ts): its welcome shows a QR code of <site>/admin/#pair=<code>, which opens this
  // with the code filled in; or type the code it shows.
  import { api } from './api.svelte.js'

  let { code = '' } = $props()
  let typed = $state(code)
  let busy = $state(false)
  let done = $state('')
  let error = $state('')

  async function pair(event) {
    event.preventDefault()
    busy = true
    error = ''
    try {
      await api('/api/admin/pair', { code: typed.trim().toUpperCase() })
      done = typed.trim().toUpperCase()
      typed = ''
    } catch (err) {
      error = err.message
    } finally {
      busy = false
    }
  }
</script>

<section class="card" class:asked={code && !done}>
  <h2>📱 Pair a new display</h2>
  {#if code && !done}
    <p>A display is asking to join with code <b class="code">{code}</b>. Check it matches the one on its screen, then:</p>
  {/if}
  <form onsubmit={pair}>
    <input bind:value={typed} placeholder="Code on the display's screen" maxlength="8" autocapitalize="characters" autocomplete="off" />
    <button class="primary" disabled={busy || typed.trim().length < 8}>{busy ? 'Pairing…' : 'Pair it'}</button>
  </form>
  {#if done}<p class="ok">✓ Paired {done}. It copies the connection and settings now.</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
</section>

<style>
  form {
    display: flex;
    flex-wrap: wrap;
  }
  form > * {
    margin: 0 10px 10px 0;
  }
  input {
    flex: 1;
    min-width: 160px;
    font-family: monospace;
    letter-spacing: 2px;
    text-transform: uppercase;
  }
  .code {
    font-family: monospace;
    letter-spacing: 2px;
  }
  .asked {
    border: 2px solid var(--accent);
  }
</style>
