// WebAudio synthesis: console alert tones and acoustic drone signatures. The
// signatures are built from each type's fundamental and harmonics, so trainees can
// learn to tell drones apart by ear.

import { TYPES } from '../sim/catalog.js';

let ctx = null;
let master = null;
let muted = false;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }

function tone(freq, dur, { type = 'sine', gain = 0.15, when = 0, slide = null } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noiseBurst(dur, { gain = 0.3, freq = 800, when = 0 } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime + when;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  newTrack: () => { tone(1320, 0.08, { type: 'square', gain: 0.05 }); tone(1760, 0.08, { type: 'square', gain: 0.05, when: 0.1 }); },
  engage: () => tone(660, 0.12, { type: 'sawtooth', gain: 0.05, slide: 990 }),
  gun: () => { for (let i = 0; i < 4; i++) noiseBurst(0.07, { gain: 0.25, freq: 1800, when: i * 0.08 }); },
  splash: () => { noiseBurst(0.6, { gain: 0.4, freq: 600 }); tone(220, 0.3, { gain: 0.06, slide: 110 }); },
  impact: () => { noiseBurst(1.2, { gain: 0.7, freq: 300 }); tone(80, 0.9, { type: 'sine', gain: 0.25, slide: 40 }); },
  warn: () => { for (let i = 0; i < 3; i++) tone(880, 0.35, { type: 'square', gain: 0.06, when: i * 0.45, slide: 660 }); },
  bad: () => tone(196, 0.4, { type: 'square', gain: 0.07 }),
  good: () => { tone(880, 0.1, { gain: 0.06 }); tone(1175, 0.15, { gain: 0.06, when: 0.1 }); },
  click: () => tone(1000, 0.03, { type: 'square', gain: 0.03 }),
};

// Acoustic signature: fundamental and harmonics with blade-pass amplitude modulation.
export function playSignature(typeKey, { duration = 2.5, level = 1, f0Override = null } = {}) {
  const c = ac();
  const def = TYPES[typeKey];
  if (!c || !def?.acoustic) return;
  const t0 = c.currentTime;
  const f0 = f0Override || def.acoustic.f0;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(0.18 * level, t0 + 0.3);
  out.gain.setValueAtTime(0.18 * level, t0 + duration - 0.4);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  const piston = def.family === 'delta' || def.family === 'fixedwing';
  lfo.frequency.value = piston ? f0 / 4 : f0 / 9;
  lfoGain.gain.value = piston ? 0.5 : 0.2;
  const amp = c.createGain();
  amp.gain.value = 0.6;
  lfo.connect(lfoGain).connect(amp.gain);
  def.acoustic.harmonics.forEach((a, i) => {
    const o = c.createOscillator();
    o.type = piston ? 'sawtooth' : 'triangle';
    o.frequency.value = f0 * (i + 1) * (1 + (Math.random() - 0.5) * 0.004);
    const g = c.createGain();
    g.gain.value = a * 0.25;
    o.connect(g).connect(amp);
    o.start(t0);
    o.stop(t0 + duration + 0.1);
  });
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 50;
  amp.connect(hp).connect(out).connect(master);
  lfo.start(t0);
  lfo.stop(t0 + duration + 0.1);
}
