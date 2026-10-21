<script>
  // An animated face for the current personality: a Verity-style smiley or a frog.
  // `mood` follows the voice status: waiting (idle, blinking), listening, thinking, speaking, error.
  // `feeling` is how it is while nobody's talking to it (a child's idea): happy, sad or tired.
  import { Spring } from 'svelte/motion'

  let { kind = 'smiley', fill, ink, mood = 'waiting', feeling = 'happy', size = 220 } = $props()
  const idle = $derived(!['listening', 'thinking', 'speaking'].includes(mood))
  const shows = $derived(idle ? feeling : 'happy') // talking to it always cheers it up
  const uid = Math.random().toString(36).slice(2, 8) // unique gradient ids per face

  // You can drag the smiley round to look at the back of its head. It turns back to face you when it
  // starts listening or talking. A drag isn't a tap, so it doesn't start a conversation.
  const turn = new Spring(0, { stiffness: 0.08, damping: 0.5 }) // degrees
  let dragFrom = null // { x, angle } while a finger is down
  let dragged = false

  function down(e) {
    e.currentTarget.setPointerCapture(e.pointerId) // keep following the finger off the edge of the face
    dragFrom = { x: e.clientX, angle: turn.target }
    dragged = false
  }
  function move(e) {
    if (!dragFrom) return
    const dx = e.clientX - dragFrom.x
    if (Math.abs(dx) > 6) dragged = true
    if (dragged) turn.set(dragFrom.angle + dx * 1.2, { instant: true })
  }
  function up() {
    dragFrom = null
  }
  function click(e) {
    if (dragged) e.stopPropagation() // it was a spin, not a tap
    dragged = false
  }

  $effect(() => {
    if (mood === 'listening' || mood === 'speaking') turn.target = Math.round(turn.target / 360) * 360
  })

  // Where the features sit on the ball for the current angle: sliding sideways and squashing as they go round.
  const rad = $derived((turn.current * Math.PI) / 180)
  const facing = $derived(Math.cos(rad)) // 1 = facing us, below 0 = we're looking at the back
  const features = $derived(`translate(${100 + Math.sin(rad) * 62} 0) scale(${Math.max(Math.abs(facing), 0.01)} 1) translate(-100 0)`)
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<svg
  class="face {mood} {idle ? feeling : ''}"
  width={size}
  height={size}
  viewBox="0 0 200 200"
  aria-hidden="true"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onclick={click}
>
  {#if kind === 'frog'}
    <circle cx="62" cy="58" r="30" fill={fill} />
    <circle cx="138" cy="58" r="30" fill={fill} />
    <ellipse cx="100" cy="118" rx="88" ry="70" fill={fill} />
    <g class="eyes">
      <circle cx="62" cy="56" r="15" fill="#fff" />
      <circle cx="138" cy="56" r="15" fill="#fff" />
      <circle class="pupil" cx="62" cy="58" r="8" fill={ink} />
      <circle class="pupil" cx="138" cy="58" r="8" fill={ink} />
    </g>
    {#if shows === 'sad'}
      <path class="mouth" d="M60 145 Q100 115 140 145" stroke={ink} stroke-width="8" fill="none" stroke-linecap="round" />
    {:else if shows === 'tired'}
      <ellipse class="mouth yawn" cx="100" cy="135" rx="14" ry="10" fill={ink} />
    {:else}
      <path class="mouth" d="M50 125 Q100 165 150 125" stroke={ink} stroke-width="8" fill="none" stroke-linecap="round" />
    {/if}
  {:else}
    <!-- Verity: traced from a screenshot. A flat lemon-yellow ball, small close-set black oval
         eyes, and a thin deep U-shaped smile with curled-up ends. -->
    <defs>
      <radialGradient id="shade-{uid}" cx="50%" cy="50%" r="50%">
        <stop offset="80%" stop-color="#000" stop-opacity="0" />
        <stop offset="100%" stop-color="#000" stop-opacity="0.12" />
      </radialGradient>
    </defs>
    <ellipse class="shadow" cx="100" cy="194" rx="52" ry="5" fill="#000" opacity="0.25" />
    <g class="ball">
      <circle cx="100" cy="98" r="90" fill={fill} />
      <circle cx="100" cy="98" r="90" fill="url(#shade-{uid})" />
      <g transform={features} opacity={facing > 0 ? Math.min(1, facing * 4) : 0}>
        <g class="eyes">
          <ellipse class="pupil" cx="82" cy="85" rx="5.5" ry="10.5" fill={ink} />
          <ellipse class="pupil" cx="117" cy="86" rx="5.5" ry="10.5" fill={ink} />
        </g>
        {#if mood === 'speaking'}
          <!-- Talking, traced from a picture: a curved top lip, a deep round bowl with soft corners, and a
               face-coloured tongue. (No tooth: it looked wrong.) -->
          <g class="mouth open">
            <path d="M48 104 C72 120 128 120 152 104 C154 134 130 158 100 158 C70 158 46 134 48 104 Z"
              fill={ink} stroke={ink} stroke-width="6" stroke-linejoin="round" />
            <path d="M76 147 C88 138 112 138 124 147 C114 155 86 155 76 147 Z" fill={fill} />
          </g>
        {:else if shows === 'sad'}
          <!-- Sad: the smile turned upside down, with a tear. -->
          <path class="mouth" d="M62 138 C72 122 128 122 138 138" stroke={ink} stroke-width="5.5" fill="none" stroke-linecap="round" />
          <path class="tear" d="M80 100 C76 108 76 113 80 113 C84 113 84 108 80 100 Z" fill="#7cc4ff" />
        {:else if shows === 'tired'}
          <!-- Tired: a small sleepy yawn. -->
          <ellipse class="mouth yawn" cx="100" cy="128" rx="11" ry="9" fill={ink} />
        {:else}
          {#if idle}
            <circle class="cheek" cx="60" cy="99" r="9" fill="#ff8a8a" opacity="0.45" />
            <circle class="cheek" cx="140" cy="99" r="9" fill="#ff8a8a" opacity="0.45" />
          {/if}
          <g class="mouth">
            <path d="M41 108 C50 128 74 140 98 140 C122 140 145 129 154 111" stroke={ink} stroke-width="5.5" fill="none" stroke-linecap="round" />
            <path d="M41 108 L37 103 M154 111 L159 106" stroke={ink} stroke-width="5" fill="none" stroke-linecap="round" />
          </g>
        {/if}
      </g>
      {#if shows === 'tired'}
        <text class="zzz" x="150" y="40" fill={ink} font-size="26" font-weight="bold">z</text>
      {/if}
    </g>
  {/if}
</svg>

<style>
  .face {
    display: block;
    transition: transform 0.3s;
    touch-action: pan-y; /* sideways drags spin the face instead of scrolling */
  }
  .eyes {
    transform-origin: 100px 70px;
    animation: blink 5s infinite;
  }
  .mouth {
    transform-origin: 100px 128px;
  }
  .ball {
    animation: float 3.2s ease-in-out infinite;
  }
  .listening {
    animation: pulse 1.2s ease-in-out infinite;
  }
  .thinking .pupil {
    transform: translateY(-7px);
    transition: transform 0.3s;
  }
  .thinking {
    animation: wobble 1.6s ease-in-out infinite;
  }
  .speaking .mouth {
    animation: talk 0.28s ease-in-out infinite alternate;
  }
  .speaking .mouth.open {
    transform-origin: 100px 110px; /* open and close from the top lip */
  }
  .error {
    filter: grayscale(0.7);
  }
  /* Feelings (only while idle) */
  .sad .ball {
    animation-duration: 5s; /* a slow, droopy float */
  }
  .sad .pupil {
    transform: translateY(4px);
  }
  .tired .ball {
    animation-duration: 6s;
  }
  .tired .eyes {
    transform-origin: 100px 86px;
    animation: sleepy 6s infinite; /* half-shut, sometimes nodding off */
  }
  .tired .yawn {
    transform-origin: 100px 128px;
    animation: yawn 6s ease-in-out infinite;
  }
  .zzz {
    animation: zzz 3s ease-in-out infinite;
  }
  .tear {
    animation: tear 4s ease-in infinite;
  }
  @keyframes blink {
    0%, 94%, 100% { transform: scaleY(1); }
    96% { transform: scaleY(0.1); }
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.06); }
  }
  @keyframes wobble {
    0%, 100% { transform: rotate(-3deg); }
    50% { transform: rotate(3deg); }
  }
  @keyframes sleepy {
    0%, 70%, 100% { transform: scaleY(0.4); }
    80%, 90% { transform: scaleY(0.1); }
  }
  @keyframes yawn {
    0%, 60%, 100% { transform: scale(0.6); }
    75%, 85% { transform: scale(1.3); }
  }
  @keyframes zzz {
    0% { opacity: 0; transform: translate(0, 10px); }
    30%, 70% { opacity: 1; }
    100% { opacity: 0; transform: translate(12px, -14px); }
  }
  @keyframes tear {
    0%, 40% { opacity: 0; transform: translateY(0); }
    50% { opacity: 1; }
    100% { opacity: 0; transform: translateY(26px); }
  }
  @keyframes talk {
    from { transform: scaleY(0.6); }
    to { transform: scaleY(1.25); }
  }
</style>
