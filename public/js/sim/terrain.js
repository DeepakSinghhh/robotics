// Deterministic procedural terrain shared by the simulation (radar masking, line of
// sight) and the renderer (meshes, buildings, vegetation).

import { Rng } from '../core/rng.js';
import { smoothstep, DEG } from '../core/math.js';
import { TERRAINS, GEOMETRY } from './catalog.js';

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
}

export function fbm(x, y, seed, octaves = 4) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

export class Terrain {
  constructor(kind = 'rural', seed = 1) {
    this.kind = TERRAINS[kind] ? kind : 'rural';
    this.def = TERRAINS[this.kind];
    this.seed = (Math.abs(Math.floor(seed)) % 100000) + 1;
    this.maskTan = Math.tan(this.def.maskDeg * DEG);
    this.mastHeight = GEOMETRY.sensorMastHeight;
    this.originHeight = this.heightAt(0, 0);
    this._features = null;
  }

  heightAt(x, y) {
    const r = Math.hypot(x, y);
    const s = this.seed;
    switch (this.kind) {
      case 'mountain': {
        const ridge = 1 - Math.abs(fbm(x / 1500, y / 1500, s, 4));
        const big = 280 * ridge * ridge * smoothstep(700, 3400, r);
        const small = 14 * (fbm(x / 260, y / 260, s + 7, 3) * 0.5 + 0.5) * smoothstep(250, 900, r);
        return big + small;
      }
      case 'urban':
        return 2.5 * (fbm(x / 1200, y / 1200, s, 2) * 0.5 + 0.5);
      default: {
        const hills = 22 * (fbm(x / 950, y / 950, s, 4) * 0.5 + 0.5) * smoothstep(380, 1300, r);
        return hills;
      }
    }
  }

  // Absolute height of the sensor head above datum.
  get sensorZ() {
    return this.originHeight + this.mastHeight;
  }

  // Is a target at (x, y, agl) visible from the sensor mast? Combines a ground-clutter
  // horizon (trees/buildings) with a true heightfield line-of-sight check.
  lineOfSight(x, y, agl) {
    const d = Math.hypot(x, y);
    if (d < 60) return true;
    if (agl < d * this.maskTan + 2.5) return false;
    const tz = this.heightAt(x, y) + agl;
    const sz = this.sensorZ;
    const steps = Math.min(28, Math.max(6, Math.floor(d / 180)));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      const lz = sz + (tz - sz) * f;
      if (this.heightAt(x * f, y * f) > lz) return false;
    }
    return true;
  }

  // Scenery used by the renderer (deterministic).
  features() {
    if (this._features) return this._features;
    const rng = new Rng(this.seed * 31 + 7);
    const buildings = [];
    const trees = [];
    if (this.kind === 'urban') {
      const block = 95, street = 22, inner = 220, outer = 2700;
      for (let gx = -outer; gx <= outer; gx += block + street) {
        for (let gy = -outer; gy <= outer; gy += block + street) {
          const cx = gx + block / 2, cy = gy + block / 2;
          const r = Math.hypot(cx, cy);
          if (r < inner || r > outer) continue;
          const towerZone = r < 1100 ? 1 : r < 1900 ? 0.6 : 0.35;
          const n = rng.int(1, 4);
          for (let k = 0; k < n; k++) {
            const w = rng.range(18, 45), dpt = rng.range(18, 45);
            const tall = rng.chance(0.08 * towerZone);
            const h = tall ? rng.range(45, 85) : rng.range(6, 18 + 22 * towerZone);
            buildings.push({
              x: cx + rng.range(-block / 2 + w / 2, block / 2 - w / 2),
              y: cy + rng.range(-block / 2 + dpt / 2, block / 2 - dpt / 2),
              w, d: dpt, h, shade: rng.range(0.55, 1),
            });
          }
        }
      }
      for (let i = 0; i < 500; i++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(140, 2600);
        trees.push({ x: Math.sin(a) * r, y: Math.cos(a) * r, h: rng.range(5, 10), s: rng.range(0.8, 1.3) });
      }
    } else {
      const villages = this.kind === 'mountain' ? rng.int(3, 5) : rng.int(6, 10);
      for (let v = 0; v < villages; v++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(900, 3800);
        const vx = Math.sin(a) * r, vy = Math.cos(a) * r;
        const n = rng.int(8, 22);
        for (let k = 0; k < n; k++) {
          const w = rng.range(7, 14), dpt = rng.range(7, 14);
          buildings.push({ x: vx + rng.gauss(0, 60), y: vy + rng.gauss(0, 60), w, d: dpt, h: rng.range(3.5, 7), shade: rng.range(0.6, 1) });
        }
      }
      const lines = this.kind === 'mountain' ? 40 : 90;
      for (let l = 0; l < lines; l++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(350, 4200);
        let x = Math.sin(a) * r, y = Math.cos(a) * r;
        const dir = rng.range(0, Math.PI * 2);
        const len = rng.int(10, 40);
        for (let k = 0; k < len; k++) {
          x += Math.cos(dir) * rng.range(8, 16) + rng.gauss(0, 3);
          y += Math.sin(dir) * rng.range(8, 16) + rng.gauss(0, 3);
          trees.push({ x, y, h: rng.range(6, 14), s: rng.range(0.8, 1.4) });
        }
      }
      const scatter = this.kind === 'mountain' ? 1400 : 700;
      for (let i = 0; i < scatter; i++) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(300, 5000);
        trees.push({ x: Math.sin(a) * r, y: Math.cos(a) * r, h: rng.range(6, 15), s: rng.range(0.7, 1.4) });
      }
    }
    this._features = { buildings, trees };
    return this._features;
  }
}
