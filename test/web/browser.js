// Just enough of a browser for src/lib's modules: the page's address, sessionStorage, history, and a fake fetch.

/** Sets the page's address (location.href can be assigned, as in a browser, to "go" somewhere). */
export function visit(url) {
  globalThis.location = new URL(url)
}

const store = new Map()
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

globalThis.history = {
  replaceState: (_state, _title, url) => visit(new URL(url, location.href).href),
}

/**
 * Replaces fetch with `answer(url, init)`, which returns [status, body] (or throws, like an unreachable server).
 * Returns the list of requests made, as [url, init].
 */
export function fakeFetch(answer) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push([String(url), init])
    const [status, body] = await answer(String(url), init)
    return Response.json(body, { status })
  }
  return calls
}

/** Lets the awaits in a poll finish (with fake timers, nothing else will). */
export async function settle() {
  for (let i = 0; i < 20; i++) await null
}
