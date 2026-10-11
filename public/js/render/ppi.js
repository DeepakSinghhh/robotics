// Radar Plan Position Indicator (PPI): phosphor sweep, raw plots, fused tracks with
// operator-assigned symbology, RF/acoustic bearing strobes, zones and effector coverage.

import { polar, wrap360, DEG } from '../core/math.js';
import { EFFECTORS } from '../sim/catalog.js';

const IDENT_COLOR = { HOSTILE: '#ff5a5a', SUSPECT: '#ff9f43', FRIEND: '#4da6ff', NEUTRAL: '#3ddc84', NON_UAS: '#9aa5b1' };

export class PPI {
  constructor(canvas, sim, { onSelect } = {}) {
    this.canvas = canvas;
    this.sim = sim;
    this.onSelect = onSelect;
    this.range = 4000;
    this.selected = null;
    this.camera = null;
    this.ctx = canvas.getContext('2d');
    canvas.addEventListener('click', (e) => this.click(e));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const steps = [1000, 2000, 3000, 4000, 6000];
      const i = steps.indexOf(this.range);
      this.range = steps[Math.max(0, Math.min(steps.length - 1, i + (e.deltaY > 0 ? 1 : -1)))];
    }, { passive: false });
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(10, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(10, Math.floor(r.height * dpr));
    this.dpr = dpr;
  }

  geom() {
    const w = this.canvas.width, h = this.canvas.height;
    const R = Math.min(w, h) / 2 - 14 * this.dpr;
    return { cx: w / 2, cy: h / 2, R, k: R / this.range };
  }

  toScreen(x, y) {
    const { cx, cy, k } = this.geom();
    return [cx + x * k, cy - y * k];
  }

  click(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * this.dpr, py = (e.clientY - rect.top) * this.dpr;
    let best = null, bd = 18 * this.dpr;
    const { cx, cy, R } = this.geom();
    for (const tr of this.sim.tracks) {
      if (tr.closed) continue;
      let sx, sy;
      if (tr.view.x !== null && tr.view.x !== undefined) [sx, sy] = this.toScreen(tr.view.x, tr.view.y);
      else if (tr.view.bearing != null) {
        // Bearing-only: distance from click to the strobe line.
        const b = tr.view.bearing * DEG;
        const ux = Math.sin(b), uy = -Math.cos(b);
        const t = Math.max(0, Math.min(R, (px - cx) * ux + (py - cy) * uy));
        sx = cx + ux * t; sy = cy + uy * t;
      } else continue;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bd) { bd = d; best = tr; }
    }
    if (best) this.onSelect?.(best.id);
  }

  draw() {
    const c = this.ctx, sim = this.sim, dpr = this.dpr || 1;
    const { cx, cy, R, k } = this.geom();
    const W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    c.save();
    // Scope face.
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, '#08201a');
    g.addColorStop(1, '#040c0a');
    c.fillStyle = g;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();

    // Friendly corridor.
    const cor = sim.ctx.corridor;
    if (cor) {
      c.fillStyle = 'rgba(77,166,255,0.08)';
      c.beginPath();
      c.moveTo(cx, cy);
      c.arc(cx, cy, R, (cor.bearing - cor.width / 2 - 90) * DEG, (cor.bearing + cor.width / 2 - 90) * DEG);
      c.closePath();
      c.fill();
    }
    // Range rings.
    c.lineWidth = 1 * dpr;
    const ringStep = this.range <= 2000 ? 500 : 1000;
    c.font = `${10 * dpr}px ui-monospace, monospace`;
    for (let r = ringStep; r <= this.range; r += ringStep) {
      c.strokeStyle = 'rgba(61,220,132,0.16)';
      c.beginPath(); c.arc(cx, cy, r * k, 0, Math.PI * 2); c.stroke();
      c.fillStyle = 'rgba(61,220,132,0.4)';
      c.fillText(`${r / 1000}`, cx + 3 * dpr, cy - r * k + 11 * dpr);
    }
    // Zones.
    c.setLineDash([4 * dpr, 4 * dpr]);
    c.strokeStyle = 'rgba(255,179,71,0.55)';
    c.beginPath(); c.arc(cx, cy, sim.ctx.restrictedRadius * k, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,90,90,0.6)';
    c.beginPath(); c.arc(cx, cy, sim.ctx.defendedRadius * k, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    // Effector coverage (faint).
    const cov = [[EFFECTORS.GUN.range, 'rgba(255,210,122,0.12)'], [sim.laserRange(), 'rgba(102,255,153,0.12)']];
    for (const [rr, col] of cov) { c.strokeStyle = col; c.beginPath(); c.arc(cx, cy, rr * k, 0, Math.PI * 2); c.stroke(); }
    // Bearing ticks.
    c.strokeStyle = 'rgba(61,220,132,0.35)';
    for (let b = 0; b < 360; b += 10) {
      const a = (b - 90) * DEG;
      const r0 = R - (b % 30 === 0 ? 10 : 5) * dpr;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke();
    }

    // Jammer beam & spoofer.
    const J = sim.effectors.RF_JAM.active;
    if (J) {
      const half = sim.jamSector() / 2;
      c.fillStyle = 'rgba(255,159,67,0.16)';
      c.beginPath(); c.moveTo(cx, cy);
      c.arc(cx, cy, sim.jamRange() * k, (J.bearing - half - 90) * DEG, (J.bearing + half - 90) * DEG);
      c.closePath(); c.fill();
    }
    if (sim.effectors.GNSS_SPOOF.active) {
      c.strokeStyle = `rgba(200,140,255,${0.35 + 0.25 * Math.sin(sim.t * 6)})`;
      c.lineWidth = 2 * dpr;
      c.beginPath(); c.arc(cx, cy, EFFECTORS.GNSS_SPOOF.range * k, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 1 * dpr;
    }
    // EO camera field of view.
    if (this.camera) {
      const { yaw, fov } = this.camera;
      c.fillStyle = 'rgba(230,236,233,0.06)';
      c.beginPath(); c.moveTo(cx, cy);
      c.arc(cx, cy, R, (yaw - Math.max(fov, 1) / 2 - 90) * DEG, (yaw + Math.max(fov, 1) / 2 - 90) * DEG);
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(230,236,233,0.35)';
      const a = (yaw - 90) * DEG;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke();
    }

    // Sweep with afterglow.
    const sweepA = (sim.radar.angle - 90) * DEG;
    for (let i = 0; i < 24; i++) {
      c.strokeStyle = `rgba(61,220,132,${0.28 * (1 - i / 24)})`;
      const a = sweepA - i * 1.4 * DEG;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke();
    }

    // Raw plots with phosphor decay.
    for (const p of sim.plots) {
      const age = sim.t - p.t;
      if (age > 8) continue;
      const [sx, sy] = this.toScreen(p.x, p.y);
      c.fillStyle = `rgba(110,255,170,${0.85 * (1 - age / 8)})`;
      c.fillRect(sx - 1.5 * dpr, sy - 1.5 * dpr, 3 * dpr, 3 * dpr);
    }

    // Interceptors.
    c.fillStyle = '#4da6ff';
    for (const ic of sim.interceptors) {
      if (!ic.alive) continue;
      const [sx, sy] = this.toScreen(ic.pos.x, ic.pos.y);
      c.beginPath(); c.moveTo(sx, sy - 4 * dpr); c.lineTo(sx + 3 * dpr, sy + 3 * dpr); c.lineTo(sx - 3 * dpr, sy + 3 * dpr); c.fill();
    }

    // Tracks.
    c.font = `${10.5 * dpr}px ui-monospace, monospace`;
    for (const tr of sim.tracks) {
      if (tr.closed) continue;
      const ident = tr.op.ident || 'UNKNOWN';
      const col = IDENT_COLOR[ident] || '#ffd84d';
      const sel = tr.id === this.selected;
      const lost = tr.status === 'lost';
      c.globalAlpha = lost ? 0.4 : tr.op.dismissed ? 0.45 : 1;
      if (tr.view.x !== null && tr.view.x !== undefined) {
        const [sx, sy] = this.toScreen(tr.view.x, tr.view.y);
        // Velocity leader: 20 s ahead.
        if (tr.view.speed > 1) {
          const lx = tr.view.x + tr.est.vx * 20, ly = tr.view.y + tr.est.vy * 20;
          const [ex, ey] = this.toScreen(lx, ly);
          c.strokeStyle = col; c.lineWidth = 1 * dpr;
          c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
        }
        drawSymbol(c, sx, sy, ident, 5.5 * dpr, col, tr.status === 'tentative');
        if (sel) {
          c.strokeStyle = '#ffffff'; c.lineWidth = 1.5 * dpr;
          c.strokeRect(sx - 10 * dpr, sy - 10 * dpr, 20 * dpr, 20 * dpr);
        }
        c.fillStyle = tr.op.ackAt === null && Math.floor(sim.t * 2) % 2 ? '#ffd84d' : '#d8e6e0';
        c.fillText(tr.id, sx + 8 * dpr, sy - 6 * dpr);
      } else if (tr.view.bearing != null) {
        const a = (tr.view.bearing - 90) * DEG;
        c.strokeStyle = tr.rf && sim.t - tr.sources.rf < 2 ? 'rgba(255,159,67,0.75)' : 'rgba(180,140,255,0.7)';
        c.lineWidth = (sel ? 2 : 1) * dpr;
        c.setLineDash([6 * dpr, 4 * dpr]);
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#d8e6e0';
        c.fillText(`${tr.id}${tr.rf && sim.t - tr.sources.rf < 2 ? ' RF' : ' AC'}`, cx + Math.cos(a) * (R - 40 * dpr) + 4 * dpr, cy + Math.sin(a) * (R - 40 * dpr));
      }
      c.globalAlpha = 1;
    }
    c.restore();

    // Bezel labels.
    c.fillStyle = 'rgba(61,220,132,0.65)';
    c.font = `${10 * dpr}px ui-monospace, monospace`;
    for (const [b, t] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
      const p = polar(b, 1);
      c.fillText(t, cx + p.x * (R + 7 * dpr) - 3 * dpr, cy - p.y * (R + 7 * dpr) + 4 * dpr);
    }
    c.fillText(`${this.range / 1000} km`, 6 * dpr, H - 6 * dpr);
    c.restore();
  }
}

export function drawSymbol(c, x, y, ident, r, col, tentative = false) {
  c.save();
  c.strokeStyle = col;
  c.fillStyle = col;
  c.lineWidth = 1.6 * (r / 5.5);
  c.beginPath();
  switch (ident) {
    case 'HOSTILE':
    case 'SUSPECT':
      c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath();
      ident === 'HOSTILE' && !tentative ? c.fill() : c.stroke();
      break;
    case 'FRIEND':
      c.arc(x, y, r * 0.9, 0, Math.PI * 2);
      tentative ? c.stroke() : c.fill();
      break;
    case 'NEUTRAL':
      c.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
      tentative ? c.stroke() : c.fill();
      break;
    case 'NON_UAS':
      c.moveTo(x - r * 0.7, y - r * 0.7); c.lineTo(x + r * 0.7, y + r * 0.7);
      c.moveTo(x + r * 0.7, y - r * 0.7); c.lineTo(x - r * 0.7, y + r * 0.7);
      c.stroke();
      break;
    default:
      c.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
      c.stroke();
  }
  c.restore();
}

export { wrap360 };
