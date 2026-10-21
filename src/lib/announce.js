// Announcements: things said without anyone at this display asking (channel/announce.ts): from the server, another
// display's 📢 button, or the assistant passing a message on. Polled every few seconds;
// only the ones made after this display started are played, so a reload doesn't repeat old news.

const POLL_MS = 5000

// Each poll also tells the server this display is on (its id, name, room, who it's for and personality), so others can
// send to it and the admin page can list it. Anything a grown-up queued for it there comes back to onCommand.
// A display that hasn't finished the welcome yet (me.ready false) stays quiet: it isn't a Frog Hub until then.
export function startAnnouncements(getMe, onAnnouncement, onCommand) {
  let after = null // the newest id seen; null until the first poll
  const poll = async () => {
    try {
      const me = getMe()
      if (!me.ready) return
      const query = ['id', 'name', 'area', 'areaName', 'who', 'personality']
        .map((k) => `${k === 'id' ? 'device' : k}=${encodeURIComponent(me[k] || '')}`)
        .join('&')
      const r = await (await fetch(`/api/announcements?after=${after || 0}&${query}`)).json()
      if (r.command && onCommand) onCommand(r.command)
      if (after !== null && r.latest < after) {
        after = 0 // the server's server restarted and counts from 0 again: everything it has now is new
        return poll()
      }
      if (after !== null) r.items.forEach(onAnnouncement)
      after = r.latest
    } catch {
      // server unreachable; try again next time
    }
  }
  poll()
  return setInterval(poll, POLL_MS)
}

/** The other displays that are on: [{ id, name }]. */
export async function otherDisplays(myId) {
  try {
    return await (await fetch(`/api/displays?except=${encodeURIComponent(myId)}`)).json()
  } catch {
    return []
  }
}

/** Sends a message from this display (the 📢 button); to = a display id, or '' for all of them. Returns an error or ''. */
export async function sendMessage(me, text, to) {
  try {
    const r = await (await fetch('/api/announce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, to: to || undefined, device: me.id, name: me.name }),
    })).json()
    return r.error || ''
  } catch {
    return "Couldn't reach the server"
  }
}
