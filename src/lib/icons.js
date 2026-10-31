// Two-tone icons (Settings → Icons). Lucide only draws outlines, so this marks the paths that close up (end where they
// start) and app.css fills those, and rects, circles and polygons, softly in the accent colour. Open strokes such as
// chevrons and ticks stay plain lines: filling them would make odd wedges.

/** Marks each Lucide path under `root` that hasn't been looked at yet as closed or open. */
export function markShapes(root) {
  for (const path of root.querySelectorAll('.lucide path:not([data-shape])')) {
    let closed = false
    try {
      const length = path.getTotalLength()
      const start = path.getPointAtLength(0)
      const end = path.getPointAtLength(length)
      closed = length > 0 && Math.hypot(end.x - start.x, end.y - start.y) < 0.75 // in the icons' 24-unit grid
    } catch {
      // not rendered yet: left as a line
    }
    path.setAttribute('data-shape', closed ? 'closed' : 'open')
  }
}

let watching = null

/** Turns two-tone icons on or off for the whole page, marking icons as they appear. */
export function setTwoTone(on) {
  document.documentElement.classList.toggle('two-tone', on)
  if (!on || watching) return
  markShapes(document)
  let queued = false // at most once a frame, since the clock changes the page every second
  watching = new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      markShapes(document)
    })
  })
  watching.observe(document.body, { childList: true, subtree: true })
}
