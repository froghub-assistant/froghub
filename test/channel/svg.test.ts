import { describe, expect, test } from 'bun:test'
import { cleanCss, cleanSvg, MAX_SVG } from '../../channel/svg.ts'

const face = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>.mouth-talk { display: none } .mood-speaking .mouth-talk { display: inline; animation: talk .3s infinite alternate }
  @keyframes talk { from { transform: scaleY(.6) } to { transform: scaleY(1.2) } }</style>
  <defs><radialGradient id="g"><stop offset="0" stop-color="#ff0"/><stop offset="1" stop-color="#cc0"/></radialGradient></defs>
  <circle cx="100" cy="100" r="80" fill="url(#g)"/>
  <g class="eyes"><ellipse cx="80" cy="85" rx="6" ry="10" fill="#111"/></g>
  <path class="mouth-talk" d="M60 120 Q100 160 140 120 Z" fill="#111"/>
  <text x="150" y="40">z</text>
</svg>`

describe('cleanSvg', () => {
  test('keeps an ordinary animated face as it is (bar whitespace)', () => {
    const svg = cleanSvg(face)!
    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">')
    for (const bit of ['<style>', '@keyframes talk', '.mood-speaking .mouth-talk', '<radialGradient id="g">', 'fill="url(#g)"',
      '<ellipse cx="80"', '<text x="150" y="40">z</text>', '</svg>']) expect(svg).toContain(bit)
  })

  test('drops scripts, event handlers and things that load or run anything', () => {
    const svg = cleanSvg(`<svg viewBox="0 0 200 200" onload="alert(1)">
      <script>alert(1)</script><foreignObject><div>hi</div></foreignObject>
      <image href="https://evil.example/x.png"/><a href="javascript:alert(1)"><circle r="5"/></a>
      <circle r="9" onclick="alert(1)" fill="url(https://evil.example/x)" style="fill: red; background: url(https://x)"/>
      <use href="https://evil.example/x.svg#a"/><use href="#ok"/>
      <animate attributeName="href" to="javascript:alert(1)"/><set attributeName="fill" to="red"/>
      <rect width="10" height="10" fill="javascript:alert(1)"/>
    </svg>`)!
    for (const bad of ['script', 'alert', 'onload', 'onclick', 'foreignObject', 'image', 'evil', 'javascript', '<a', '<set', 'attributeName="href"'])
      expect(svg).not.toContain(bad)
    expect(svg).toContain('<use href="#ok"/>')
    expect(svg).toContain('<circle r="9"/>')
  })

  test('drops a <style> that imports or links anything, and entity tricks', () => {
    expect(cleanSvg('<svg><style>@import url(https://x/a.css); circle { fill: red }</style></svg>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><style></style></svg>')
    expect(cleanSvg('<svg><circle r="1" fill="&#106;avascript:x"/></svg>')).not.toContain('avascript')
    expect(cleanSvg('<svg><style><![CDATA[ circle { fill: red } ]]></style></svg>')).toContain('circle { fill: red }')
  })

  test('only the root <svg>: anything before it, after it, or a second one goes', () => {
    const svg = cleanSvg('Here it is!\n```xml\n<svg viewBox="0 0 10 10"><circle r="1"/></svg>\n```<svg><script/></svg>')
    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="1"/></svg>')
  })

  test("the display's own attributes on the root go (it sets class, width and height)", () => {
    expect(cleanSvg('<svg class="x" width="500" height="500" viewBox="0 0 200 200"></svg>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"></svg>')
  })

  test('closes what was left open and ignores stray closing tags', () => {
    expect(cleanSvg('<svg><g><circle r="1"/></rect></svg>')).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><g><circle r="1"/></g></svg>')
    expect(cleanSvg('<svg><g><circle r="1"/>')).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><g><circle r="1"/></g></svg>')
  })

  test('nothing usable, or far too big, is null', () => {
    expect(cleanSvg('no picture here')).toBeNull()
    expect(cleanSvg(42 as unknown as string)).toBeNull()
    expect(cleanSvg(`<svg>${'<circle r="1"/>'.repeat(MAX_SVG)}</svg>`)).toBeNull()
  })
})

describe('cleanCss', () => {
  test('rules and keyframes are fine; anything that reaches out is not', () => {
    expect(cleanCss('.a { fill: red } /* note */ @keyframes b { to { opacity: 0 } }')).toBe('.a { fill: red }  @keyframes b { to { opacity: 0 } }')
    expect(cleanCss('.a { fill: url(#g) }')).toBe('.a { fill: url(#g) }')
    for (const bad of ['@import "x.css";', '.a { background: url(https://x) }', '.a { content: "\\41" }', '@font-face { src: x }',
      '.a { behavior: url(x.htc) }', '@media print { .a { fill: red } }'])
      expect(cleanCss(bad)).toBeNull()
  })
})
