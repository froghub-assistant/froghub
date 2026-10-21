// Each personality changes the look, the on-screen words, the voice, and how the assistant talks
// (the assistant is told the personality with every request).

export const personalities = {
  frog: {
    name: 'Frog',
    pipeline: 'Frog Hub · Frog', // HA pipeline: wake word, speech-to-text and its Piper voice
    pitch: 0.9, // playback rate for the spoken reply (raises or lowers the voice)
    face: 'frog',
    colours: { bg: '#0d2416', bg2: '#16391f', fg: '#eaffea', muted: '#9fc7a5', accent: '#5bd16b', faceFill: '#5bd16b', faceInk: '#0d2416' },
    greeting: (name) => `Ribbit! Hi ${name} 🐸`,
    listening: 'Listening… 🐸',
    thinking: 'Hmm, let me think…',
    error: 'Croak. Something went wrong.',
  },
  verity: {
    name: 'Verity',
    pipeline: 'Frog Hub · Verity', // HA pipeline: wake word, speech-to-text and its Piper voice
    pitch: 1, // the Verity mod itself speaks with stock Piper en_US-ryan-medium at normal speed
    face: 'smiley',
    colours: { bg: '#1a1a00', bg2: '#2f2e05', fg: '#fdfbd2', muted: '#d6d27a', accent: '#e4e22c', faceFill: '#e4e22c', faceInk: '#111100' },
    greeting: (name) => `Hi ${name}! It's me, it's Verity! 😊`,
    listening: "I'm listening! 😊",
    thinking: 'I know everything… one sec!',
    error: 'Oops! Even I got confused.',
  },
  falsity: {
    name: 'Falsity',
    pipeline: 'Frog Hub · Falsity', // HA pipeline: wake word, speech-to-text and its Piper voice
    pitch: 1.1, // playback rate for the spoken reply (raises or lowers the voice)
    face: 'smiley',
    colours: { bg: '#04142a', bg2: '#0a2547', fg: '#e3f1ff', muted: '#8fb6e0', accent: '#3aa0ff', faceFill: '#3aa0ff', faceInk: '#04142a' },
    greeting: (name) => `Hi ${name}! I'm definitely not Falsity. 🤥`,
    listening: 'Listening (honest!) 👂',
    thinking: 'Thinking of something totally true…',
    error: "That didn't happen. (It did.)",
  },
  lovity: {
    name: 'Lovity',
    pipeline: 'Frog Hub · Lovity', // HA pipeline: wake word, speech-to-text and its Piper voice
    pitch: 1.12, // playback rate for the spoken reply (raises or lowers the voice)
    face: 'smiley',
    colours: { bg: '#2a0618', bg2: '#45102b', fg: '#ffe6f2', muted: '#e9a3c6', accent: '#ff6fb5', faceFill: '#ff6fb5', faceInk: '#2a0618' },
    greeting: (name) => `Hiii ${name}! 💕`,
    listening: "I'm all ears! 💕",
    thinking: 'Thinking lovely thoughts…',
    error: 'Aww, something went wrong 💔',
  },
}

export function personality(id) {
  return personalities[id] || personalities.frog
}
