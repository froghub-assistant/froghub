/**
 * Cleans an SVG face that Claude drew for a custom personality (personas.ts), before it's saved or shown on a child's
 * display. The SVG is rebuilt from an allowlist rather than filtered: only drawing elements, plain attributes and
 * CSS animations survive. Scripts, event handlers, links, outside pictures, fonts and anything unknown are dropped.
 *
 * The displays also only ever show it as an <img> (Face.svelte), where SVGs can't run scripts or load anything, so
 * this is the second line of defence, not the only one.
 */

export const MAX_SVG = 40_000

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'use', 'symbol', 'style', 'animate', 'animatetransform',
])

const ATTRIBUTES = new Set([
  'id', 'class', 'style', 'viewbox', 'xmlns', 'preserveaspectratio', 'transform', 'transform-origin', 'opacity', 'visibility', 'display',
  'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'width', 'height', 'd', 'points', 'pathlength',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'clip-path', 'clip-rule', 'mask',
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'fx', 'fy', 'spreadmethod',
  'font-size', 'font-weight', 'font-family', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
  'href', 'xlink:href', 'xmlns:xlink', 'clippathunits', 'maskunits', 'maskcontentunits',
  'attributename', 'attributetype', 'values', 'from', 'to', 'by', 'dur', 'begin', 'end', 'repeatcount', 'repeatdur',
  'keytimes', 'keysplines', 'calcmode', 'type', 'additive', 'accumulate', 'restart',
])
// What SMIL animations may change: never a link
const ANIMATABLE = new Set([
  'transform', 'opacity', 'fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-dasharray',
  'stroke-dashoffset', 'r', 'rx', 'ry', 'cx', 'cy', 'x', 'y', 'width', 'height', 'd', 'points', 'offset', 'stop-color',
  'visibility', 'display',
])

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Undoes the few entities an SVG's attribute or text might use, so the checks see the real characters. */
function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** A value that could reach outside the picture: script URLs, data URLs, url() to anything but #id, CSS escapes. */
function unsafe(value: string): boolean {
  const v = value.toLowerCase().replace(/\s+/g, '')
  return v.includes('javascript:') || v.includes('data:') || v.includes('expression(') || v.includes('\\') ||
    v.includes('<') || /url\((?!['"]?#)/.test(v) || v.includes('@import')
}

/** CSS from a <style> element or style="": comments dropped; null if it uses anything but plain rules and @keyframes. */
export function cleanCss(css: string): string | null {
  const text = decode(css).replace(/\/\*[\s\S]*?\*\//g, '')
  if (unsafe(text) || /behavior|binding|@font-face|@namespace|@charset|@media|@supports|@page/i.test(text)) return null
  for (const at of text.match(/@[\w-]+/g) ?? []) if (!/^@(-webkit-)?keyframes$/i.test(at)) return null
  return text.trim()
}

/** The cleaned SVG, or null if there's no usable <svg> in it. */
export function cleanSvg(input: string): string | null {
  if (typeof input !== 'string' || input.length > MAX_SVG * 2) return null
  const start = input.search(/<svg[\s>]/i)
  if (start < 0) return null
  const source = input.slice(start)

  const out: string[] = []
  const open: string[] = [] // elements written and not yet closed
  let skip = 0 // depth inside a dropped element
  let inStyle = false
  let styleText = ''
  let rootDone = false
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[!?][^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g
  let m: RegExpExecArray | null
  while ((m = token.exec(source)) && !rootDone) {
    const [whole, cdata, closing, opening, attrs, selfClose, text] = m
    if (whole.startsWith('<!--') || (whole.startsWith('<!') && cdata === undefined) || whole.startsWith('<?')) continue
    if (cdata !== undefined || text !== undefined) {
      if (skip) continue
      if (inStyle) styleText += cdata ?? text
      else if (open.length && /\S/.test(cdata ?? text)) out.push(escapeText(decode(cdata ?? text)))
      continue
    }
    if (closing) {
      const name = closing.toLowerCase()
      if (skip) {
        skip--
        continue
      }
      if (name === 'style' && inStyle) {
        inStyle = false
        const css = cleanCss(styleText)
        if (css) out.push(escapeText(css))
        styleText = ''
      }
      const at = open.map(t => t.toLowerCase()).lastIndexOf(name)
      if (at < 0) continue // a stray closing tag
      while (open.length > at) out.push(`</${open.pop()}>`)
      if (!open.length) rootDone = true
      continue
    }
    if (opening) {
      const name = opening.toLowerCase()
      const empty = selfClose === '/'
      if (skip || !ELEMENTS.has(name) || (!open.length && name !== 'svg') || (name === 'style' && inStyle)) {
        if (!empty) skip++
        continue
      }
      const kept: string[] = []
      for (const a of (attrs ?? '').matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        const key = a[1].toLowerCase()
        const value = decode(a[2] ?? a[3] ?? a[4] ?? '')
        if (!ATTRIBUTES.has(key) || key.startsWith('on')) continue
        if ((key === 'href' || key === 'xlink:href') && !/^#[\w-]+$/.test(value)) continue
        if (key === 'attributename' && !ANIMATABLE.has(value.toLowerCase())) continue
        if (key === 'xmlns' && value !== 'http://www.w3.org/2000/svg') continue
        if (key === 'xmlns:xlink' && value !== 'http://www.w3.org/1999/xlink') continue
        if (key === 'style') {
          const css = cleanCss(value)
          if (css) kept.push(`style="${escapeAttr(css)}"`)
          continue
        }
        if (!open.length && (key === 'class' || key === 'width' || key === 'height')) continue // the display sets these
        if (unsafe(value)) continue
        kept.push(`${a[1].includes(':') ? key : a[1]}="${escapeAttr(value)}"`)
      }
      // An animation that lost its attributeName could still change something it shouldn't: drop it
      if (name === 'animate' && !kept.some(k => k.toLowerCase().startsWith('attributename='))) {
        if (!empty) skip++
        continue
      }
      if (!open.length) {
        if (!kept.some(k => k.startsWith('xmlns='))) kept.unshift('xmlns="http://www.w3.org/2000/svg"')
        if (!kept.some(k => k.toLowerCase().startsWith('viewbox='))) kept.push('viewBox="0 0 200 200"')
      }
      const tag = opening
      out.push(`<${tag}${kept.length ? ' ' + kept.join(' ') : ''}${empty ? '/' : ''}>`)
      if (!empty) {
        open.push(tag)
        if (name === 'style') inStyle = true
      } else if (!open.length) {
        rootDone = true // <svg/>: nothing in it
      }
    }
  }
  while (open.length) out.push(`</${open.pop()}>`)
  const svg = out.join('')
  return svg.length > MAX_SVG ? null : svg
}
