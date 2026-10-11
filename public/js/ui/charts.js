// Lightweight SVG/HTML charts (no external libraries, so they work offline).
// Thin marks, hairline grid, a single axis and hover tooltips. Every chart sits
// next to a table or labels that carry the same values.

import { h, s } from '../core/dom.js';

// Sequential blue ramp (dark surface): low = dark, high = light.
const RAMP = ['#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];

export function rampColor(t) {
  const v = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.floor(v), f = v - i;
  if (i >= RAMP.length - 1) return RAMP[RAMP.length - 1];
  return mix(RAMP[i], RAMP[i + 1], f);
}

export function rampInk(t) {
  return t > 0.62 ? '#0b0b0b' : '#f0efec';
}

function mix(a, b, f) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((x, i) => Math.round(x + (pb[i] - x) * f).toString(16).padStart(2, '0')).join('')}`;
}

export function rampLegend(lo = '0%', hi = '100%') {
  return h('div', { class: 'legend-ramp' }, lo, h('div', { class: 'ramp', style: { background: `linear-gradient(90deg, ${RAMP.join(',')})` } }), hi);
}

// Single-series line chart with crosshair tooltip.
// points: [{ x: number (ms or index), y: number, label: string, tip?: string }]
export function lineChart(points, { height = 200, yMin = 0, yMax = 100, yTicks = [0, 25, 50, 75, 100], yFmt = (v) => v, xFmt = (v) => v, color = 'var(--series-1)', ref = null, onClick } = {}) {
  const W = 640, H = height, padL = 34, padR = 14, padT = 12, padB = 26;
  const wrap = h('div', { class: 'chart' });
  if (!points.length) {
    wrap.append(h('p', { class: 'muted' }, 'No data yet.'));
    return wrap;
  }
  const xs = points.map((p) => p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const sx = (x) => padL + (x1 === x0 ? (W - padL - padR) / 2 : ((x - x0) / (x1 - x0)) * (W - padL - padR));
  const sy = (y) => padT + (1 - (y - yMin) / (yMax - yMin)) * (H - padT - padB);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  for (const t of yTicks) {
    svg.append(s('line', { x1: padL, x2: W - padR, y1: sy(t), y2: sy(t), stroke: 'var(--grid)', 'stroke-width': 1 }));
    svg.append(s('text', { x: padL - 6, y: sy(t) + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: 'var(--text-muted)' }, yFmt(t)));
  }
  if (ref) {
    svg.append(s('line', { x1: padL, x2: W - padR, y1: sy(ref.y), y2: sy(ref.y), stroke: 'var(--axis)', 'stroke-width': 1 }));
    svg.append(s('text', { x: padL + 4, y: sy(ref.y) - 4, 'text-anchor': 'start', 'font-size': 10.5, fill: 'var(--text-muted)' }, ref.label));
  }
  const n = points.length;
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  points.forEach((p, i) => {
    if (i % labelEvery === 0 || i === n - 1) svg.append(s('text', { x: sx(p.x), y: H - 8, 'text-anchor': 'middle', 'font-size': 10.5, fill: 'var(--text-muted)' }, xFmt(p.x, i)));
  });
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  svg.append(s('path', { d: `${d} L${sx(points[n - 1].x)},${sy(yMin)} L${sx(points[0].x)},${sy(yMin)} Z`, fill: color, opacity: 0.1 }));
  svg.append(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  const last = points[n - 1];
  svg.append(s('circle', { cx: sx(last.x), cy: sy(last.y), r: 4, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
  svg.append(s('text', { x: sx(last.x) - 8, y: sy(last.y) - 9, 'text-anchor': 'end', 'font-size': 11.5, fill: 'var(--text-primary)', 'font-weight': 600 }, yFmt(last.y)));
  const cross = s('line', { y1: padT, y2: H - padB, stroke: 'var(--text-muted)', 'stroke-width': 1, visibility: 'hidden' });
  const dot = s('circle', { r: 5, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2, visibility: 'hidden' });
  svg.append(cross, dot);
  const tip = h('div', { class: 'tip hidden' });
  const hit = s('rect', { x: padL, y: 0, width: W - padL - padR, height: H, fill: 'transparent', style: onClick ? 'cursor:pointer' : '' });
  const nearest = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    points.forEach((p, i) => { const dd = Math.abs(sx(p.x) - px); if (dd < bd) { bd = dd; best = i; } });
    return best;
  };
  hit.addEventListener('mousemove', (evt) => {
    const i = nearest(evt);
    const p = points[i];
    cross.setAttribute('x1', sx(p.x)); cross.setAttribute('x2', sx(p.x)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', sx(p.x)); dot.setAttribute('cy', sy(p.y)); dot.setAttribute('visibility', 'visible');
    const r = svg.getBoundingClientRect();
    tip.classList.remove('hidden');
    tip.style.left = `${(sx(p.x) / W) * r.width}px`;
    tip.style.top = `${(sy(p.y) / H) * r.height}px`;
    tip.innerHTML = '';
    tip.append(h('b', {}, yFmt(p.y)), h('div', { class: 'muted' }, p.tip || p.label || ''));
  });
  hit.addEventListener('mouseleave', () => { tip.classList.add('hidden'); cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
  if (onClick) hit.addEventListener('click', (evt) => onClick(points[nearest(evt)]));
  svg.append(hit);
  wrap.append(svg, tip);
  return wrap;
}

// Horizontal bars for nominal categories (one colour; value at the tip).
export function hBars(items, { max = null, fmt = (v) => v, color = 'var(--series-1)' } = {}) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return h('div', {}, items.map((it) => h('div', { class: 'vuln-row', title: `${it.label}: ${fmt(it.value)}` },
    h('span', { class: 'secondary' }, it.label),
    h('div', { class: 'meter', style: { background: 'transparent' } }, h('i', { style: { width: `${(it.value / m) * 100}%`, background: color } })),
    h('span', { class: 'num', style: { textAlign: 'right' } }, fmt(it.value)))));
}

// Skill meters: label, bar (fill on a lighter track of the same hue), percentage.
export function skillMeters(items) {
  return h('div', {}, items.map((it) => h('div', { class: 'skill-row', title: `${it.label}: ${Math.round(it.value * 100)}%${it.note ? ` · ${it.note}` : ''}` },
    h('span', {}, it.label),
    h('div', { class: 'meter' }, h('i', { style: { width: `${Math.round(it.value * 100)}%`, background: it.value < 0.45 ? 'var(--serious)' : 'var(--series-1)' } })),
    h('span', { class: 'pct' }, `${Math.round(it.value * 100)}%`))));
}

// Heat-map table (sequential ramp). rows/cols: [{ key, label }]; value(r, c) in 0..1 or null.
export function heatmap(rows, cols, value, { fmt = (v) => `${Math.round(v * 100)}`, rowClick, tip } = {}) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'heat' },
    h('thead', {}, h('tr', {}, h('th', {}), cols.map((c) => h('th', { class: 'rot', title: c.label }, h('div', {}, c.short || c.label))))),
    h('tbody', {}, rows.map((r) => h('tr', { style: rowClick ? { cursor: 'pointer' } : null, onclick: rowClick ? () => rowClick(r) : null },
      h('th', {}, r.label),
      cols.map((c) => {
        const v = value(r, c);
        if (v === null || v === undefined || Number.isNaN(v)) return h('td', { style: { background: 'var(--surface-2)', color: 'var(--text-muted)' }, title: `${r.label} · ${c.label}: no data` }, '·');
        return h('td', { style: { background: rampColor(v), color: rampInk(v) }, title: tip ? tip(r, c, v) : `${r.label} · ${c.label}: ${fmt(v)}` }, fmt(v));
      }))))));
}

export function sparkline(values, { w = 90, hgt = 22, yMax = 100 } = {}) {
  if (!values.length) return h('span', { class: 'muted' }, '—');
  const sx = (i) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 4) + 2);
  const sy = (v) => hgt - 3 - (v / yMax) * (hgt - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  return s('svg', { width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, 'aria-label': `trend ${values.join(', ')}` },
    s('path', { d, fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
    s('circle', { cx: sx(values.length - 1), cy: sy(values[values.length - 1]), r: 2.5, fill: 'var(--series-1)' }));
}

export function tile(label, value, sub = null) {
  return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
}
