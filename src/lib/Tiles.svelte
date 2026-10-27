<script>
  // Buttons for the lights, switches, fans and media players in one HA area.
  import { Fan, Lightbulb, Pause, Play, Plug, Power } from '@lucide/svelte'

  let { states, entities, onToggle, onMedia } = $props()

  const icons = { light: Lightbulb, switch: Plug, fan: Fan }

  function title(id) {
    const s = states[id]
    return (s && s.attributes.friendly_name) || id
  }
</script>

<div class="tiles">
  {#each entities as id (id)}
    {@const s = states[id]}
    {@const domain = id.split('.')[0]}
    {#if s && s.state !== 'unavailable'}
      {#if domain === 'media_player'}
        <button class="tile media" class:on={s.state === 'playing'} onclick={() => onMedia(id)}>
          <span class="icon">{#if s.state === 'playing'}<Pause size={26} />{:else}<Play size={26} />{/if}</span>
          <span class="name">{title(id)}</span>
          <span class="sub">{s.attributes.media_title || s.state}</span>
        </button>
      {:else}
        {@const Icon = icons[domain] || Power}
        <button class="tile" class:on={s.state === 'on'} onclick={() => onToggle(id)}>
          <span class="icon"><Icon size={26} /></span>
          <span class="name">{title(id)}</span>
          <span class="sub">{s.state === 'on' ? 'On' : 'Off'}</span>
        </button>
      {/if}
    {/if}
  {/each}
</div>

<style>
  .tiles {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .tile {
    flex: 1 1 140px;
    max-width: 220px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 14px 16px;
    border: 0;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--fg);
    font: inherit;
    text-align: left;
  }
  .tile.on {
    background: var(--accent);
    color: var(--bg);
  }
  .icon {
    display: flex;
  }
  .name {
    font-weight: 700;
    font-size: 16px;
  }
  .sub {
    font-size: 13px;
    opacity: 0.8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
</style>
