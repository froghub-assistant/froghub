import { svelte } from '@sveltejs/vite-plugin-svelte'
import legacy from '@vitejs/plugin-legacy'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'

// Svelte scopes nested selectors as `.a.svelte-x b:where(.svelte-x)`, and Chrome 59 has no :where(), so it drops
// those whole rules (unstyled inputs and buttons on old tablets). Plain classes instead; only a little more specific.
// Chrome 59 also only knows grid gaps as `grid-gap`, so every `gap` gets one too (flex containers just ignore it;
// flexbox gaps don't exist there at all, see the @supports fallbacks in the CSS).
const noWhere = {
  name: 'no-where',
  generateBundle(_, bundle) {
    for (const file of Object.values(bundle)) {
      if (file.type === 'asset' && file.fileName.endsWith('.css')) {
        file.source = String(file.source)
          .replace(/:where\((\.svelte-[\w-]+)\)/g, '$1')
          .replace(/(^|[;{\s])gap:([^;}]+)/g, '$1grid-gap:$2;gap:$2')
      }
    }
  },
}

// `vite build --mode demo`: the try-it-in-a-browser demo (demo/index.html, src/demo/) for the docs site, with a pretend
// server and Home Assistant in place of ./lib/ha.js. Modern browsers only; served from the docs at /demo/.
const demo = {
  root: 'demo',
  base: './',
  publicDir: false,
  plugins: [svelte()],
  resolve: { alias: [{ find: /^(\.\/lib\/|\.\/)ha\.js$/, replacement: fileURLToPath(new URL('src/demo/ha.js', import.meta.url)) }] },
  build: { outDir: '../docs/public/demo', emptyOutDir: true },
}

export default defineConfig(({ mode }) => mode === 'demo' ? demo : {
  plugins: [
    svelte(),
    // Old tablets such as the 7th-gen Fire 7 run Fire OS 5 = Android 5.1, whose WebView is Chrome 59 (no ES modules, so it gets these).
    legacy({ targets: ['chrome >= 59', 'android >= 5'], modernPolyfills: true }),
    noWhere,
  ],
  build: {
    cssTarget: 'chrome59', // e.g. spells out `inset`, which Chrome 59 doesn't know either
    // Two pages: the display (/) and the admin page (/admin)
    rollupOptions: { input: { main: 'index.html', admin: 'admin/index.html' } },
  },
})
