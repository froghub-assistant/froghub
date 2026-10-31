<script>
  // One icon (a pair from icons.js): Lucide's outline, or Phosphor's duotone when Settings → Icons is two-tone.
  // fill="currentColor" (play, pause, stop) becomes Phosphor's solid weight.
  import { settings } from './settings.svelte.js'

  let { of, size = 24, ...rest } = $props()
  let Lucide = $derived(of.lucide)
  let Phosphor = $derived(of.phosphor)
</script>

{#if settings.iconStyle === 'two-tone'}
  {@const { fill, ...attrs } = rest}
  <Phosphor {size} weight={fill ? 'fill' : 'duotone'} class="lucide phosphor" {...attrs} />
{:else}
  <Lucide {size} {...rest} />
{/if}
