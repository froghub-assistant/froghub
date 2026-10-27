import { defineConfig } from 'vitepress'

// Published to https://froghub-assistant.github.io by .github/workflows/docs.yml
export default defineConfig({
  title: 'Frog Hub',
  description: "A homemade smart display for children's tablets",
  lang: 'en-GB',
  cleanUrls: true,
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: '/frog.svg' }]],
  themeConfig: {
    logo: '/frog.svg',
    nav: [
      { text: 'Guide', link: '/guide/install' },
      { text: 'What it can do', link: '/features/voice' },
      { text: 'Reference', link: '/reference/architecture' },
      { text: 'Developers', link: '/developers/' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Installing', link: '/guide/install' },
          { text: 'Setting up a display', link: '/guide/displays' },
          { text: "Grown-ups' settings", link: '/guide/grown-ups' },
          { text: 'Updating and removing', link: '/guide/upgrade-remove' },
        ],
      },
      {
        text: 'What it can do',
        items: [
          { text: 'Voice and personalities', link: '/features/voice' },
          { text: 'Room devices and music', link: '/features/devices-music' },
          { text: 'Announcements and schedules', link: '/features/announcements' },
          { text: 'Alarms and timers', link: '/features/alarms' },
          { text: 'Lists', link: '/features/lists' },
          { text: 'Recipes', link: '/features/recipes' },
          { text: 'Sums, words and facts', link: '/features/facts' },
          { text: 'Radio, sounds and audio', link: '/features/audio' },
          { text: 'Memory, history and the web', link: '/features/memory' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'How it fits together', link: '/reference/architecture' },
          { text: 'HTTP API', link: '/reference/http-api' },
          { text: 'Files and settings', link: '/reference/files' },
          { text: 'Environment variables', link: '/reference/env' },
        ],
      },
      {
        text: 'Developers',
        items: [
          { text: 'Working on Frog Hub', link: '/developers/' },
          { text: 'The Android apps', link: '/developers/android' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/froghub-assistant/froghub' }],
    editLink: { pattern: 'https://github.com/froghub-assistant/froghub/edit/master/docs/:path', text: 'Edit this page on GitHub' },
    search: { provider: 'local' },
    outline: { level: [2, 3], label: 'On this page' },
    docFooter: { prev: 'Previous', next: 'Next' },
    lastUpdated: { text: 'Last updated' },
  },
})
