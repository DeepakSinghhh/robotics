// Passive RF detector: scrolling spectrum waterfall across the four bands drones use.
// Each emitter draws its own signature pattern (hopping bursts, an analogue video
// carrier, a steady datalink), so trainees learn to read RF evidence.

const BANDS = [
  { key: '0.9', label: '868–928 MHz' },
  { key: '1.3', label: '1.2–1.4 GHz' },
  { key: '2.4', label: '2.40–2.48 GHz' },
  { key: '5.8', label: '5.72–5.87 GHz' },
];

export class Waterfall {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.sim = sim;
    this.ctx = canvas.getContext('2d', { willReadFrequently: false });
    this.selected = null;
    this.acc = 0;
    this.emitters = new Map(); // trackId -> stable spectral placement
    this.rand = mulberry(sim.seed ^ 0x5eed);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(10, Math.floor(r.width));
    this.canvas.height = Math.max(10, Math.floor(r.height));
    this.ctx.fillStyle = '#030807';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  placement(trId) {
    if (!this.emitters.has(trId)) this.emitters.set(trId, { pos: 0.15 + this.rand() * 0.7, hop: this.rand() * 1000 });
    return this.emitters.get(trId);
  }

  update(dt) {
    this.acc += dt;
    while (this.acc > 0.08) {
      this.acc -= 0.08;
      this.row();
    }
    this.labels();
  }

  row() {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const top = 16;
    // Scroll everything below the header down by 1 px (new rows enter at the top).
    c.drawImage(this.canvas, 0, top, W, H - top - 1, 0, top + 1, W, H - top - 1);
    const sim = this.sim;
    const bw = W / BANDS.length;
    const noise = 0.08 + 0.12 * (sim.spec.env.ew || 0);
    const img = c.createImageData(W, 1);
    const d = img.data;
    for (let x = 0; x < W; x++) {
      const v = Math.random() * noise;
      const band = Math.floor(x / bw);
      let wifi = 0;
      if (sim.T.rfNoise > 0.3 && (band === 2 || band === 3) && Math.random() < sim.T.rfNoise * 0.02) wifi = 0.35;
      const i = x * 4;
      d[i] = 10 + (v + wifi) * 90; d[i + 1] = 30 + (v + wifi) * 200; d[i + 2] = 25 + (v + wifi) * 110; d[i + 3] = 255;
      if (x % Math.floor(bw) === 0) { d[i] = 40; d[i + 1] = 60; d[i + 2] = 55; }
    }
    // Emitters (only those currently detected by the RF sensor).
    for (const tr of sim.tracks) {
      if (tr.closed || !tr.rf || sim.t - tr.sources.rf > 1.2) continue;
      const pl = this.placement(tr.id);
      const s = Math.max(0.25, tr.rf.strength);
      const sel = tr.id === this.selected;
      for (const bk of tr.rf.bands) {
        const bi = BANDS.findIndex((b) => b.key === bk);
        if (bi < 0) continue;
        const x0 = bi * bw;
        let from, to;
        switch (tr.rf.pattern) {
          case 'hop':
          case 'narrowhop': {
            if (Math.random() > 0.55) continue;
            const w = tr.rf.pattern === 'hop' ? 0.06 : 0.025;
            const p = Math.random() * (1 - w);
            from = x0 + p * bw; to = from + w * bw;
            break;
          }
          case 'analog':
            if (bk === '5.8') { from = x0 + (pl.pos - 0.08) * bw; to = from + 0.16 * bw; }
            else { const p = Math.random() * 0.97; from = x0 + p * bw; to = from + 0.02 * bw; }
            break;
          case 'datalink':
            from = x0 + (pl.pos - 0.04) * bw; to = from + 0.08 * bw;
            break;
          case 'mil':
            from = x0 + 0.3 * bw; to = x0 + 0.62 * bw;
            break;
          default:
            continue;
        }
        for (let x = Math.max(0, Math.floor(from)); x < Math.min(W, Math.ceil(to)); x++) {
          const i = x * 4;
          if (sel) { d[i] = 255; d[i + 1] = 180 * s + 60; d[i + 2] = 60; }
          else { d[i] = 60 + 120 * s; d[i + 1] = 200 + 55 * s; d[i + 2] = 120 + 80 * s; }
        }
      }
    }
    c.putImageData(img, 0, top);
  }

  labels() {
    const c = this.ctx, W = this.canvas.width;
    const bw = W / BANDS.length;
    c.fillStyle = '#0d1413';
    c.fillRect(0, 0, W, 16);
    c.font = '10px ui-monospace, monospace';
    c.fillStyle = '#7d8a85';
    BANDS.forEach((b, i) => c.fillText(b.label, i * bw + 4, 11));
  }
}

function mulberry(a) {
  return () => {
    let t = (a = (a + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { BANDS };
