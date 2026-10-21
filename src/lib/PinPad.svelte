<script>
  // Big number pad for the admin PIN. The PIN is checked on the server, never in the browser.
  let { onUnlock, onCancel } = $props()

  let pin = $state('')
  let message = $state('Enter the admin PIN')
  let busy = $state(false)

  function press(digit) {
    if (pin.length < 6) pin += digit
  }

  // A physical keyboard works too: digits, Backspace, Enter, Escape.
  function key(e) {
    if (busy) return
    if (/^[0-9]$/.test(e.key)) press(e.key)
    else if (e.key === 'Backspace') pin = pin.slice(0, -1)
    else if (e.key === 'Enter') submit()
    else if (e.key === 'Escape') onCancel()
    else return
    e.preventDefault()
  }

  async function submit() {
    if (busy || pin.length < 4) return
    busy = true
    try {
      const response = await fetch('/api/admin/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const result = await response.json()
      if (response.ok && result.token) {
        onUnlock(result.token, result.idle_timeout)
        return
      }
      message = result.error || 'Wrong PIN'
    } catch {
      message = "Couldn't reach the server"
    }
    pin = ''
    busy = false
  }
</script>

<svelte:window onkeydown={key} />

<div class="pinpad">
  <p class="message">{message}</p>
  <p class="dots">{pin.length ? '●'.repeat(pin.length) : ' '}</p>
  <div class="keys">
    {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d (d)}
      <button onclick={() => press(d)}>{d}</button>
    {/each}
    <button class="small" onclick={() => (pin = pin.slice(0, -1))}>⌫</button>
    <button onclick={() => press('0')}>0</button>
    <button class="small ok" onclick={submit} disabled={busy || pin.length < 4}>OK</button>
  </div>
  <button class="cancel" onclick={onCancel}>Cancel</button>
</div>

<style>
  .pinpad {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    color: var(--fg);
  }
  .message {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
  }
  .dots {
    margin: 8px 0 12px;
    min-height: 28px;
    font-size: 24px;
    letter-spacing: 6px;
  }
  .keys {
    display: grid;
    grid-template-columns: repeat(3, 84px);
    gap: 10px;
  }
  .keys button {
    height: 64px;
    border: 0;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.1);
    color: var(--fg);
    font: inherit;
    font-size: 28px;
    font-weight: 700;
  }
  .keys .small {
    font-size: 20px;
  }
  .keys .ok {
    background: var(--accent);
    color: var(--bg);
  }
  .keys button:disabled {
    opacity: 0.4;
  }
  .cancel {
    margin-top: 16px;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
  }
</style>
