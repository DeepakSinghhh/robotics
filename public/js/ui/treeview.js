// SVG rendering of the doctrinal decision tree with two overlaid paths: the
// ground-truth doctrine path and the path implied by the trainee's own
// classification and identification. Where they diverge shows the root cause.

import { h, s } from '../core/dom.js';
import { NODES, LEAVES } from '../ai/doctrine.js';

const POS = {
  D1: [0, 0], L_DISMISS: [1, 0],
  D2: [0, 1], L_HOLD: [1, 1],
  D3: [0, 2], L_NEUTRAL: [1, 2],
  D4: [0, 3], L_REPORT: [1, 3],
  D5: [0, 4], L_IMMINENT: [1, 4],
  D5B: [0, 5], L_DECOY: [1, 5],
  D6: [0, 6],
  D7: [1, 6], L_SWARM_RF: [2, 6],
  D7B: [1, 7], L_RF_URBAN: [2, 7], L_RF_RURAL: [2, 8],
  D8: [1, 9], L_SPOOF: [2, 9],
  D9: [1, 10], L_HARD_URBAN: [2, 10], L_HARD_RURAL: [2, 11],
};

const TRUTH = '#3ddc84';
const YOURS = '#ffb347';

function edgesOf(path, leafId) {
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const n = NODES[path[i].id];
    const to = path[i].answer ? n.yes : n.no;
    out.push(`${path[i].id}>${to}`);
  }
  if (!leafId) return out;
  return out;
}

export function treeView({ truthPath = [], truthLeaf = null, perceivedPath = [], perceivedLeaf = null, compact = false }) {
  const colW = 250, rowH = compact ? 44 : 50, boxW = 212, boxH = 28, padX = 10, padY = 10;
  const W = padX * 2 + colW * 2 + boxW, H = padY * 2 + rowH * 11 + boxH;
  const at = (id) => {
    const [c, r] = POS[id];
    return { x: padX + c * colW, y: padY + r * rowH };
  };
  const tEdges = new Set(edgesOf(truthPath, truthLeaf));
  const pEdges = new Set(edgesOf(perceivedPath, perceivedLeaf));
  const tNodes = new Set([...truthPath.map((p) => p.id), truthLeaf]);
  const pNodes = new Set([...perceivedPath.map((p) => p.id), perceivedLeaf]);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tree-svg', role: 'img', 'aria-label': 'Doctrinal decision tree with your path and the doctrine path' });

  // Edges.
  for (const [id, n] of Object.entries(NODES)) {
    for (const [to, label] of [[n.yes, 'yes'], [n.no, 'no']]) {
      const a = at(id), b = at(to);
      const x1 = a.x + boxW, y1 = a.y + boxH / 2;
      let d;
      if (POS[to][0] === POS[id][0]) d = `M${a.x + 20},${a.y + boxH} L${b.x + 20},${b.y}`;
      else d = `M${x1},${y1} C${x1 + 20},${y1} ${b.x - 20},${b.y + boxH / 2} ${b.x},${b.y + boxH / 2}`;
      const key = `${id}>${to}`;
      svg.append(s('path', { d, fill: 'none', stroke: 'var(--line-2)', 'stroke-width': 1 }));
      if (tEdges.has(key)) svg.append(s('path', { d, fill: 'none', stroke: TRUTH, 'stroke-width': 3, opacity: 0.9 }));
      if (pEdges.has(key)) svg.append(s('path', { d, fill: 'none', stroke: YOURS, 'stroke-width': 2, 'stroke-dasharray': '6 4' }));
      const vertical = POS[to][0] === POS[id][0];
      const mx = vertical ? a.x + 26 : x1 + 6;
      const my = vertical ? a.y + boxH + (rowH - boxH) / 2 + 3 : y1 - 4;
      svg.append(s('text', { x: mx, y: my, 'font-size': 9.5, fill: 'var(--text-muted)' }, label));
    }
  }
  // Nodes.
  for (const id of Object.keys(POS)) {
    const p = at(id);
    const leaf = !!LEAVES[id];
    const inT = tNodes.has(id), inP = pNodes.has(id);
    const g = s('g', {});
    g.append(s('rect', {
      x: p.x, y: p.y, width: boxW, height: boxH, rx: leaf ? 15 : 4,
      fill: leaf ? '#13221d' : 'var(--surface-2)', stroke: inT ? TRUTH : inP ? YOURS : 'var(--line-2)', 'stroke-width': inT || inP ? 2 : 1,
      'stroke-dasharray': !inT && inP ? '5 3' : null,
    }));
    if (inT && inP) g.append(s('rect', { x: p.x - 4, y: p.y - 4, width: boxW + 8, height: boxH + 8, rx: leaf ? 18 : 6, fill: 'none', stroke: YOURS, 'stroke-width': 1.5, 'stroke-dasharray': '5 3' }));
    const label = leaf ? LEAVES[id].title : NODES[id].short;
    g.append(s('text', { x: p.x + 10, y: p.y + boxH / 2 + 4, 'font-size': 11.5, fill: inT || inP ? 'var(--text-primary)' : 'var(--text-secondary)', 'font-weight': leaf ? 600 : 400 }, label));
    g.append(s('title', {}, leaf ? `${LEAVES[id].title}: ${LEAVES[id].guidance}` : `${NODES[id].q} ${NODES[id].explain}`));
    svg.append(g);
  }
  return h('div', {},
    h('div', { class: 'tree-legend' },
      h('span', {}, h('i', { style: { background: TRUTH } }), 'Doctrine path (ground truth)'),
      h('span', {}, h('i', { style: { background: `repeating-linear-gradient(90deg, ${YOURS} 0 6px, transparent 6px 10px)` } }), 'Your path (from your classification and ID)')),
    svg);
}
