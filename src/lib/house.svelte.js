// This Frog Hub instance's details from the server (GET /api/instance, channel/instance.ts): Home Assistant's address for
// new displays, the house's time zone (a tablet's own can be wrong), the children's names for examples, and whether
// the displays can be Music Assistant speakers (music.svelte.js).

export const house = $state({
  site: '',
  haUrl: '',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', // until the server answers
  kids: [],
  musicAssistant: false,
})

export const houseLoaded = fetch('/api/instance')
  .then((r) => r.json())
  .then((i) => Object.assign(house, i))
  .catch(() => {}) // server unreachable: keep the guesses
