// Seeded, forkable PRNG. Every random decision in the simulator flows through an
// Rng instance so that a scenario seed reproduces the exact same sortie.

export function hashString(str) {
  // cyrb53 — fast 53-bit string hash.
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export class Rng {
  constructor(seed = 1) {
    this.seed = typeof seed === 'string' ? hashString(seed) : Math.floor(Math.abs(seed)) || 1;
    this.state = this.seed >>> 0 || 0x9e3779b9;
  }

  // mulberry32
  float() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) { return min + (max - min) * this.float(); }
  int(min, max) { return Math.floor(this.range(min, max + 1)); }
  chance(p) { return this.float() < p; }
  pick(arr) { return arr[Math.floor(this.float() * arr.length)]; }
  sign() { return this.float() < 0.5 ? -1 : 1; }

  gauss(mean = 0, sd = 1) {
    const u = 1 - this.float();
    const v = this.float();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // weights: { key: weight } or [[key, weight], ...]
  weighted(weights) {
    const entries = Array.isArray(weights) ? weights : Object.entries(weights);
    const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
    if (total <= 0) return entries[0]?.[0];
    let r = this.float() * total;
    for (const [k, w] of entries) {
      r -= Math.max(0, w);
      if (r <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Independent child stream; consuming it never perturbs the parent.
  fork(label) {
    return new Rng(hashString(`${this.seed}:${label}`));
  }
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}
