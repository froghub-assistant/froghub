---
layout: home

hero:
  name: Frog Hub
  text: A homemade smart display for children's tablets
  tagline: Like an Echo Show or a Nest Hub, on the tablets you already have (even old Fire tablets), with your own assistant, your own rules and four personalities.
  image:
    src: /frog.svg
    alt: Frog Hub's frog
  actions:
    - theme: brand
      text: Install it
      link: /guide/install
    - theme: alt
      text: Try the demo
      link: /demo/
      target: _self
    - theme: alt
      text: What it can do
      link: /features/voice
    - theme: alt
      text: Get the app
      link: /guide/displays#getting-the-app
    - theme: alt
      text: For developers
      link: /developers/

features:
  - icon: '<svg class="lucide lucide-audio-lines" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path d="M2 10v3" /><path d="M6 6v11" /><path d="M10 3v18" /><path d="M14 8v7" /><path d="M18 5v13" /><path d="M22 10v3" /></svg>'
    title: Talk to it
    details: '"Hey Jarvis", then ask. Wake word, speech-to-text and voices run in your house through Home Assistant, in Verity, Falsity, Lovity or Frog''s voice.'
    link: /features/voice
  - icon: '<svg class="lucide lucide-lightbulb" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></svg>'
    title: Music, radio and the room
    details: Lights, switches, fans and speakers in the display's own room, music by name on an Echo or a Music Assistant speaker, internet radio and sound clips.
    link: /features/devices-music
  - icon: '<svg class="lucide lucide-alarm-clock" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3 2 6" /><path d="m22 6-3-3" /><path d="M6.38 18.7 4 21" /><path d="M17.64 18.67 20 21" /></svg>'
    title: Alarms, lists and announcements
    details: '"Wake me at seven", "add milk to the shopping list", "tell the kitchen I''m hungry", "every school day at 7:45, tell them to get their shoes on".'
    link: /features/announcements
  - icon: '<svg class="lucide lucide-moon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" /></svg>'
    title: Goodnight
    details: 'Say goodnight and the lights go down, the screen stays dark until morning and rain or waves play you to sleep. A bedtime story too, if you ask.'
    link: /features/goodnight
  - icon: '<svg class="lucide lucide-chef-hat" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z" /><path d="M6 17h12" /></svg>'
    title: Recipes, words and facts
    details: Recipes by name or by what's in the fridge, exact sums and unit conversions, a dictionary, Wikipedia and Wikidata, with cards and pictures on the screen.
    link: /features/recipes
  - icon: '<svg class="lucide lucide-shield-check" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></svg>'
    title: Grown-ups decide
    details: A PIN-protected admin page and switches for everything it may use, from looking things up online to playing music. Displays for grown-ups drop the children's rules.
    link: /guide/grown-ups
  - icon: '<svg class="lucide lucide-house" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>'
    title: Yours, at home
    details: Your own server (a Raspberry Pi is plenty) and your own brain, Claude Code on your Claude subscription or a model API, even a local one.
    link: /reference/architecture
---
