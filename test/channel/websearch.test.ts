import { describe, expect, test } from 'bun:test'
import { parseDuckDuckGo, plain } from '../../channel/websearch.ts'

// Cut down from DuckDuckGo's HTML results page: an ad, a result with a direct link, one through its redirect
const PAGE = `
<div class="result results_links result--ad"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=shop.example">Buy <b>pandas</b></a></div>
<div class="result results_links"><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://en.wikipedia.org/wiki/Red_panda">Red <b>panda</b> - Wikipedia</a></h2>
<a class="result__snippet" href="https://en.wikipedia.org/wiki/Red_panda">The <b>red panda</b> (Ailurus fulgens) &amp; its &quot;cousins&quot;&#x27;   live&#8230;</a></div>
<div class="result results_links"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fkids.nationalgeographic.com%2Fred-panda&amp;rut=abc">Red Panda | Nat Geo Kids</a>
<a class="result__snippet" href="x">Facts for kids</a></div>`

describe('DuckDuckGo results', () => {
  test('titles, real links and snippets, without the ads', () => {
    expect(parseDuckDuckGo(PAGE)).toEqual([
      { title: 'Red panda - Wikipedia', url: 'https://en.wikipedia.org/wiki/Red_panda', snippet: `The red panda (Ailurus fulgens) & its "cousins"' live…` },
      { title: 'Red Panda | Nat Geo Kids', url: 'https://kids.nationalgeographic.com/red-panda', snippet: 'Facts for kids' },
    ])
  })

  test('plain text from HTML', () => {
    expect(plain('<b>a</b>&nbsp;&lt;b&gt;\n  c&#65;')).toBe('a <b> cA')
  })
})
