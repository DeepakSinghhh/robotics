// After-Action Review for one session: score summary, AI coach debrief, tactical
// replay with a timeline scrubber, per-track kill-chain evaluation with the
// decision-path tree, and mastery changes.

import { h, mount, fmtDate, download } from '../core/dom.js';
import { TYPES, IDENTITIES, ACTIONS, EFFECTORS, DIFFICULTIES, TERRAINS, TIMES, WEATHERS, WCS, EW_LEVELS } from '../sim/catalog.js';
import { RATINGS } from '../ai/doctrine.js';
import { ROOT_CAUSES } from '../ai/scoring.js';
import { RELIANCE_LABELS } from '../ai/atr.js';
import { SKILL_MAP } from '../ai/mastery.js';
import { fmtTime, DEG, polar } from '../core/math.js';
import { treeView } from './treeview.js';
import { tile } from './charts.js';

const TRUTH_COL = { HOSTILE: '#ff5a5a', FRIEND: '#4da6ff', NEUTRAL: '#3ddc84', NON_UAS: '#9aa5b1' };
const STATUS_NAMES = ['active', 'soft-killed', 'landed', 'destroyed', 'diverted', 'impacted', 'exited', 'denied'];

export async function render(main, app, id) {
  let session = id === 'last' ? app.lastSession : null;
  if (!session) {
    try { session = await app.store.session(id); } catch { session = null; }
  }
  if (!session) {
    mount(main, h('div', { class: 'page' }, h('div', { class: 'card' }, h('h2', {}, 'Session not found'), h('a', { href: '#/progress' }, 'Back to progress'))));
    return null;
  }
  const trainee = session.traineeId ? await app.store.trainee(session.traineeId).catch(() => null) : null;
  const s = session.score;
  const spec = session.spec || {};
  const env = session.env || spec.env || {};
  const rowsById = new Map();
  let replay = null;

  const openTrack = (trackId) => {
    const r = rowsById.get(trackId);
    if (!r) return;
    r.toggle(true);
    r.row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = session.tracks.find((x) => x.trackId === trackId);
    if (t?.decision?.t != null) replay?.seek(t.decision.t);
  };

  // ------------------------------------------------------------ header
  const header = h('div', { class: 'page-head' },
    h('div', {},
      h('div', { class: 'row' },
        h('span', { class: 'chip info' }, DIFFICULTIES[session.difficulty]?.name || session.difficulty),
        h('span', { class: 'chip' }, session.mode === 'exemplar' ? 'Exemplar run' : session.mode),
        h('span', { class: 'chip' }, `${TERRAINS[env.terrain]?.name} · ${TIMES[env.time]?.name} · ${WEATHERS[env.weather]?.name} · ${EW_LEVELS[env.ew || 0]?.name}`),
        h('span', { class: `wcs ${session.wcs}` }, WCS[session.wcs]?.name)),
      h('h1', { style: { marginTop: '8px' } }, session.scenarioName),
      h('p', {}, `${trainee ? `${trainee.rank ? `${trainee.rank} ` : ''}${trainee.name} · ` : ''}${fmtDate(session.startedAt)} · seed ${session.seed} · ${fmtTime(session.duration)} · ${s.endReason}`)),
    h('div', { class: 'row no-print' },
      h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print report'),
      h('button', { class: 'btn', type: 'button', onclick: () => download(`drona-aar-${session.id}.json`, JSON.stringify(session, null, 1)) }, 'Export JSON'),
      spec.waves ? h('button', { class: 'btn primary', type: 'button', onclick: () => { app.startRun({ ...spec }, session.mode === 'exemplar' ? 'mission' : session.mode, {}); } }, 'Re-fly same scenario') : null,
      spec.waves ? h('button', { class: 'btn', type: 'button', onclick: () => app.startRun({ ...spec }, 'exemplar', {}) }, 'Watch exemplar fly it') : null),
  );

  // ------------------------------------------------------------ summary
  const summary = h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)' } },
    h('div', { class: 'card' },
      h('h4', {}, 'Mission score'),
      h('div', { class: 'hero' }, h('span', { class: 'figure' }, s.total), h('span', { class: `grade ${s.grade.key}` }, `${s.grade.key} · ${s.grade.name}`)),
      h('p', { class: 'secondary', style: { marginTop: '10px' } }, `Track score ${s.base} − penalties ${s.penaltyTotal}`),
      s.penaltyTotal ? h('table', { class: 'tbl' }, h('tbody', {}, Object.entries(s.penalties).filter(([, v]) => v).map(([k, v]) => h('tr', {}, h('td', { class: 'secondary' }, { fratricide: 'Fratricide', collateral: 'Collateral', roe: 'ROE violations', ownEw: 'Own-UAV EW hits', wasted: 'Wasted effectors', damage: 'Vital-area damage' }[k]), h('td', { class: 'num' }, `−${v}`))))) : null,
    ),
    h('div', { class: 'tiles' },
      tile('Detection', s.detection ?? '—', s.medianDetection !== null ? `median ${s.medianDetection} s to acknowledge` : 'no threats detected'),
      tile('Classification', s.classification ?? '—', `${s.classAccuracy}% exact`),
      tile('Identification', s.identification ?? '—', 'affiliation'),
      tile('Decision quality', s.decision ?? '—', 'vs decision tree'),
      tile('Outcome', s.outcome ?? '—', `${s.defeated}/${s.threats} defeated · ${s.leaked} leaked`),
      tile('Vital area', `${s.assetHealth}%`, s.warnings ? `${s.warnings} air-sentry warning(s)` : 'no warnings issued'),
      tile('AI teaming', s.aiTeaming !== null ? `${s.aiTeaming}%` : '—', 'appropriate reliance'),
      tile('Root causes', Object.values(s.rootCauses || {}).reduce((a, b) => a + b, 0), Object.entries(s.rootCauses || {}).map(([k, v]) => `${k.replace('_', ' ')} ${v}`).join(' · ') || 'no errors'),
    ),
  );

  // ------------------------------------------------------------ coach
  const c = session.coach;
  const coach = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, 'AI coach debrief'), h('span', { class: 'chip' }, 'rule-based · offline · auditable')),
    h('p', {}, h('b', {}, c.headline)),
    h('p', { class: 'secondary' }, c.narrative),
    h('div', { class: 'grid g2' },
      h('div', {}, h('h4', {}, 'Strengths'), h('ul', { class: 'coach-list' }, c.strengths.map((x) => h('li', {}, `✓ ${x}`)))),
      h('div', {}, h('h4', {}, 'Improve'), h('ul', { class: 'coach-list' }, c.improvements.map((x) => h('li', { class: x.trackId ? 'clickable' : '', onclick: x.trackId ? () => openTrack(x.trackId) : null }, x.text))))),
    c.focus?.length ? h('div', { class: 'note', style: { marginTop: '10px' } }, h('b', {}, 'Next focus: '), c.focus.join(' · ')) : null,
  );

  // ------------------------------------------------------------ replay
  const replayCard = h('div', { class: 'card' });
  if (session.replay?.frames?.length) {
    replay = new ReplayMap(session, c.moments || []);
    mount(replayCard, h('div', { class: 'card-head' }, h('h3', {}, 'Tactical replay (ground truth)'), h('span', { class: 'muted' }, 'Colours show true affiliation. Labels show your track ID and classification.')), replay.el);
  } else {
    mount(replayCard, h('h3', {}, 'Tactical replay'), h('p', { class: 'muted' }, 'Replay data is not stored for this session.'));
  }

  // ------------------------------------------------------------ track table
  const tbody = h('tbody');
  for (const t of session.tracks) {
    const d = t.decision;
    const detail = h('tr', { class: 'detail-row hidden' }, h('td', { colspan: 11 }, trackDetail(t)));
    const row = h('tr', { class: 'clickable' },
      h('td', {}, h('b', {}, t.trackId || '—'), t.swarmId ? h('div', { class: 'muted', style: { fontSize: '11px' } }, `swarm ${t.swarmId}`) : null),
      h('td', {}, h('span', { style: { color: TRUTH_COL[t.identity] } }, '■ '), t.phantom ? 'Radar clutter' : TYPES[t.type].short, t.callsign ? h('div', { class: 'muted', style: { fontSize: '11px' } }, t.callsign) : null),
      h('td', {}, clsCell(t)),
      h('td', { class: 'secondary' }, t.classification.ai ? `${TYPES[t.classification.ai.cls]?.short} ${Math.round(t.classification.ai.conf * 100)}%` : '—'),
      h('td', {}, identCell(t)),
      h('td', { class: 'num' }, t.detection.latency !== null ? `${t.detection.latency.toFixed(1)} s` : t.trackId ? 'not ack' : 'missed'),
      h('td', {}, d.action ? `${ACTIONS[d.action]?.short || d.action}${d.implicit ? '*' : ''}` : '—', d.tti !== null && d.tti !== undefined ? h('div', { class: 'muted', style: { fontSize: '11px' } }, `TTI ${d.tti}s`) : null),
      h('td', {}, d.truthRating ? h('span', { class: `rating ${d.truthRating}` }, RATINGS[d.truthRating].label) : '—'),
      h('td', { class: 'secondary', style: { fontSize: '12px' } }, d.rootCause === 'none' ? '—' : d.rootCause.replace('_', ' ')),
      h('td', { class: 'secondary', style: { fontSize: '12px' } }, t.outcome.result.replace('_', ' ').toLowerCase()),
      h('td', { class: 'num' }, h('b', {}, t.total)),
    );
    let open = false;
    const toggle = (force) => {
      open = force ?? !open;
      detail.classList.toggle('hidden', !open);
    };
    row.addEventListener('click', () => toggle());
    rowsById.set(t.trackId, { row, toggle });
    tbody.append(row, detail);
  }
  const trackCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, 'Kill-chain evaluation by track'), h('span', { class: 'muted' }, 'Click a row for its decision-path tree. * = effect credited from an area effector.')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['Track', 'Truth', 'Your class', 'AI aid', 'Your ID', 'Detect', 'Decision', 'Rating', 'Root cause', 'Outcome', 'Score'].map((x, i) => h('th', { class: [5, 10].includes(i) ? 'num' : '' }, x)))),
      tbody)));

  // ------------------------------------------------------------ mastery
  const deltas = (session.deltas || []).slice().sort((a, b) => (b.after - b.before) - (a.after - a.before));
  const masteryCard = h('div', { class: 'card' },
    h('h3', {}, 'Skill mastery change (Bayesian knowledge tracing)'),
    deltas.length ? h('div', {}, deltas.map((dd) => {
      const sk = SKILL_MAP[dd.skill];
      const up = dd.after >= dd.before;
      return h('div', { class: 'skill-row', title: `${sk?.name}: ${Math.round(dd.before * 100)}% → ${Math.round(dd.after * 100)}%` },
        h('span', {}, sk?.name || dd.skill),
        h('div', { class: 'meter', style: { position: 'relative' } },
          h('i', { style: { width: `${Math.round(dd.after * 100)}%`, background: up ? 'var(--series-1)' : 'var(--serious)' } }),
          h('b', { style: { position: 'absolute', left: `${Math.round(dd.before * 100)}%`, top: '-2px', width: '2px', height: '12px', background: 'var(--text-primary)' } })),
        h('span', { class: 'pct', style: { color: up ? '#8be29a' : '#ffb0a6' } }, `${up ? '+' : ''}${Math.round((dd.after - dd.before) * 100)}`));
    })) : h('p', { class: 'muted' }, 'No mastery update (exemplar run or no observations).'),
    h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } }, 'The white tick shows mastery before the session and the bar shows mastery after it.'),
  );

  mount(main, h('div', { class: 'page' }, header, summary, h('div', { style: { height: '14px' } }), coach, replayCard, trackCard, masteryCard));
  return () => replay?.dispose();

  function clsCell(t) {
    if (!t.classification.answer) return h('span', { class: 'muted' }, '—');
    const ok = t.classification.correct;
    return h('span', {}, h('span', { style: { color: ok ? '#8be29a' : '#ffb0a6' } }, ok ? '✓ ' : '✗ '), TYPES[t.classification.answer].short, t.classification.viaAI ? h('span', { class: 'muted', style: { fontSize: '11px' } }, ' (AI)') : null);
  }
  function identCell(t) {
    const a = t.identification.answer;
    if (!a) return h('span', { class: 'muted' }, '—');
    const ok = t.identification.score >= 70;
    return h('span', {}, h('span', { style: { color: ok ? '#8be29a' : '#ffb0a6' } }, ok ? '✓ ' : '✗ '), IDENTITIES[a]?.short || a, ok ? null : h('span', { class: 'muted' }, ` (was ${IDENTITIES[t.identity]?.short})`));
  }
}

function trackDetail(t) {
  const d = t.decision;
  const actions = Object.keys(d.ratings || {});
  return h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', padding: '8px 0' } },
    h('div', {}, d.truthPath?.length ? treeView({ truthPath: d.truthPath, truthLeaf: d.truthLeaf, perceivedPath: d.perceivedPath, perceivedLeaf: d.perceivedLeaf, compact: true }) : h('p', { class: 'muted' }, 'No decision was taken, so there is no path to show.')),
    h('div', { class: 'stack' },
      h('div', {}, h('h4', {}, 'Verdict'), h('p', {}, ROOT_CAUSES[d.rootCause] || d.rootCause)),
      d.action ? h('div', {}, h('h4', {}, 'Your decision'), h('p', {}, `${ACTIONS[d.action]?.name || d.action} at T+${fmtTime(d.t)}${d.tti !== null ? ` with TTI ${d.tti} s` : ''}. Rated `, h('span', { class: `rating ${d.truthRating}` }, RATINGS[d.truthRating].label), d.perceivedRating && d.perceivedRating !== d.truthRating ? h('span', {}, ' (would be ', h('span', { class: `rating ${d.perceivedRating}` }, RATINGS[d.perceivedRating].label), ' had your ID been right)') : null)) : null,
      actions.length ? h('div', {}, h('h4', {}, 'Doctrine ratings at the time of decision'),
        h('div', { class: 'row' }, actions.map((a) => h('span', { class: `rating ${d.ratings[a]}`, title: d.available?.[a] ? 'available at the time' : 'not available at the time (range, ammunition or cooldown)', style: { opacity: d.available?.[a] ? 1 : 0.45 } }, `${ACTIONS[a]?.short || a}`))),
        h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '6px' } }, `Best available: ${d.bestAvailable ? ACTIONS[d.bestAvailable].name : '—'}. Faded actions were unavailable.`)) : null,
      d.modifiers?.length ? h('div', { class: 'note director' }, d.modifiers.map((m) => m.text).join(' ')) : null,
      h('div', {}, h('h4', {}, 'Kill-chain scores'), h('table', { class: 'tbl' }, h('tbody', {},
        [['Detection', t.detection.score, t.detection.visualFirst ? 'visual detection before the sensors' : t.detection.latency !== null ? `${t.detection.latency.toFixed(1)} s after the track appeared (${t.detection.createdBy})` : 'not acknowledged'],
          ['Classification', t.classification.score, `${t.classification.answer ? TYPES[t.classification.answer].name : 'not classified'}; truth ${t.phantom ? 'radar clutter' : TYPES[t.type].name}`],
          ['AI aid', '', RELIANCE_LABELS[t.classification.reliance]],
          ['Identification', t.identification.score, `${t.identification.answer || 'none'} (truth ${t.identity})${t.identification.iffAsked ? ` · IFF ${t.identification.iff?.valid ? 'valid' : 'no response'}` : ''}`],
          ['Decision', d.score, d.timeliness < 1 ? `timeliness ×${d.timeliness.toFixed(2)}` : ''],
          ['Outcome', t.outcome.score, `${t.outcome.result}${t.outcome.by ? ` by ${EFFECTORS[t.outcome.by]?.short || t.outcome.by}` : ''}`],
        ].map(([k, v, note]) => h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, v), h('td', { class: 'secondary', style: { fontSize: '12px' } }, note)))))),
      t.actions.length ? h('div', {}, h('h4', {}, 'Actions'), h('p', { class: 'secondary', style: { fontSize: '13px' } }, t.actions.map((a) => `T+${fmtTime(a.t)} ${ACTIONS[a.action]?.short || a.action}`).join(' → '))) : null,
      t.roe.length ? h('div', { class: 'note', style: { borderLeftColor: 'var(--critical)', background: '#2a1212', color: '#ffc9c2' } }, t.roe.map((r) => `T+${fmtTime(r.t)} ${r.msg}`).join(' · ')) : null,
    ));
}

// ------------------------------------------------------------------ replay map
class ReplayMap {
  constructor(session, moments) {
    this.session = session;
    this.frames = session.replay.frames;
    this.meta = session.replay.meta;
    this.events = session.events || [];
    this.maxT = this.frames[this.frames.length - 1].t;
    this.t = 0;
    this.playing = false;
    this.speed = 4;
    this.range = 4000;
    const ctx = session.spec?.context || {};
    this.ctx = { defendedRadius: ctx.defendedRadius || 450, restrictedRadius: ctx.restrictedRadius || 1500, corridor: ctx.corridor || null };
    this.trackOf = new Map();
    this.canvas = h('canvas', { class: 'replay-map' });
    this.slider = h('input', { type: 'range', min: 0, max: this.maxT, step: 1, value: 0 });
    this.slider.addEventListener('input', () => { this.t = Number(this.slider.value); this.draw(); });
    this.clock = h('span', { class: 'mono' }, 'T+00:00');
    this.playBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => this.toggle() }, '▶ Play');
    const ticks = h('div', { class: 'ticks' }, moments.map((m) => h('i', { style: { left: `${(m.t / this.maxT) * 100}%`, background: m.sev === 'bad' ? 'var(--critical)' : m.sev === 'good' ? 'var(--good)' : 'var(--text-muted)' } })));
    const zoom = h('select', { onchange: (e) => { this.range = Number(e.target.value); this.draw(); } }, [2000, 3000, 4000, 6000].map((r) => h('option', { value: r, selected: r === 4000 ? true : null }, `${r / 1000} km`)));
    const speed = h('select', { onchange: (e) => { this.speed = Number(e.target.value); } }, [1, 4, 8, 16].map((v) => h('option', { value: v, selected: v === 4 ? true : null }, `${v}×`)));
    const list = h('div', { class: 'moments' }, moments.map((m) => h('button', { type: 'button', onclick: () => this.seek(m.t) }, h('span', { class: 't' }, fmtTime(m.t)), h('span', { style: { color: m.sev === 'bad' ? '#ffb0a6' : m.sev === 'good' ? '#9ff0a5' : '' } }, m.text))));
    const legend = h('div', { class: 'tree-legend', style: { marginTop: '6px' } },
      ...Object.entries(TRUTH_COL).map(([k, col]) => h('span', {}, h('i', { style: { background: col, height: '8px', width: '8px', borderRadius: '50%' } }), IDENTITIES[k].name)),
      h('span', {}, h('i', { style: { background: 'rgba(255,159,67,.6)', height: '8px' } }), 'Jammer beam'),
      h('span', {}, h('i', { style: { background: '#c88cff', height: '2px' } }), 'GNSS spoof'));
    this.el = h('div', { class: 'replay' },
      h('div', {}, this.canvas,
        h('div', { class: 'timeline' }, ticks, this.slider),
        h('div', { class: 'row' }, this.playBtn, this.clock, h('span', { class: 'spacer' }), h('label', { class: 'row muted' }, 'Speed', speed), h('label', { class: 'row muted' }, 'Range', zoom)),
        legend),
      h('div', {}, h('h4', {}, 'Key moments'), list));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas);
    // Open on the first key moment so the map is not empty.
    if (moments.length) this.seek(Math.max(0, moments[0].t - 5));
    this.last = performance.now();
    this.raf = requestAnimationFrame((ts) => this.tickFn(ts));
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(10, r.width * dpr);
    this.canvas.height = Math.max(10, r.height * dpr);
    this.dpr = dpr;
    this.draw();
  }

  toggle() {
    this.playing = !this.playing;
    if (this.playing && this.t >= this.maxT) this.t = 0;
    this.playBtn.textContent = this.playing ? '❚❚ Pause' : '▶ Play';
  }

  seek(t) {
    this.t = Math.max(0, Math.min(this.maxT, Math.round(t)));
    this.slider.value = this.t;
    this.draw();
  }

  tickFn(ts) {
    const dt = (ts - this.last) / 1000;
    this.last = ts;
    if (this.playing) {
      this.t = Math.min(this.maxT, this.t + dt * this.speed);
      this.slider.value = Math.floor(this.t);
      if (this.t >= this.maxT) this.toggle();
      this.draw();
    }
    this.raf = requestAnimationFrame((x) => this.tickFn(x));
  }

  frameAt(t) {
    const i = Math.max(0, Math.min(this.frames.length - 1, Math.floor(t)));
    return [this.frames[i], this.frames[Math.min(this.frames.length - 1, i + 1)], t - Math.floor(t)];
  }

  draw() {
    const c = this.canvas.getContext('2d');
    const W = this.canvas.width, H = this.canvas.height, dpr = this.dpr || 1;
    if (!W) return;
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 10 * dpr, k = R / this.range;
    const P = (x, y) => [cx + x * k, cy - y * k];
    c.fillStyle = '#0a100f';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = '#1c2a27';
    c.lineWidth = dpr;
    c.font = `${10 * dpr}px ui-monospace, monospace`;
    for (let r = 1000; r <= this.range; r += 1000) {
      c.beginPath(); c.arc(cx, cy, r * k, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#4b5a56'; c.fillText(`${r / 1000} km`, cx + 4, cy - r * k + 12 * dpr);
    }
    if (this.ctx.corridor) {
      const b = this.ctx.corridor.bearing, w = this.ctx.corridor.width / 2;
      c.fillStyle = 'rgba(77,166,255,0.08)';
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, (b - w - 90) * DEG, (b + w - 90) * DEG); c.closePath(); c.fill();
    }
    c.setLineDash([4 * dpr, 4 * dpr]);
    c.strokeStyle = 'rgba(255,179,71,0.5)';
    c.beginPath(); c.arc(cx, cy, this.ctx.restrictedRadius * k, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,90,90,0.6)';
    c.beginPath(); c.arc(cx, cy, this.ctx.defendedRadius * k, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    const [f0, f1, a] = this.frameAt(this.t);
    // Effects.
    if (f0.j) {
      const [b, sector, range] = Array.isArray(f0.j) ? f0.j : [f0.j, 30, 2200];
      c.fillStyle = 'rgba(255,159,67,0.16)';
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, range * k, (b - sector / 2 - 90) * DEG, (b + sector / 2 - 90) * DEG); c.closePath(); c.fill();
    }
    if (f0.s) {
      c.strokeStyle = 'rgba(200,140,255,0.7)';
      c.lineWidth = 2 * dpr;
      c.beginPath(); c.arc(cx, cy, 2600 * k, 0, Math.PI * 2); c.stroke();
      c.lineWidth = dpr;
    }
    // Trails (last 20 s).
    const startI = Math.max(0, Math.floor(this.t) - 20);
    const trails = new Map();
    for (let i = startI; i <= Math.floor(this.t) && i < this.frames.length; i++) {
      for (const e of this.frames[i].e) {
        if (!trails.has(e[0])) trails.set(e[0], []);
        trails.get(e[0]).push(e);
      }
    }
    for (const [id, pts] of trails) {
      const m = this.meta[id];
      if (!m || m.phantom) continue;
      c.strokeStyle = `${TRUTH_COL[m.identity] || '#888'}55`;
      c.beginPath();
      pts.forEach((p, i) => { const [x, y] = P(p[1], p[2]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
    }
    // Tracks map: entity -> [trackId, cls].
    const trk = new Map();
    for (const t of f0.tr) trk.set(t[1], t);
    const next = new Map(f1.e.map((e) => [e[0], e]));
    for (const e of f0.e) {
      const m = this.meta[e[0]];
      if (!m) continue;
      const n = next.get(e[0]) || e;
      const x = e[1] + (n[1] - e[1]) * a, y = e[2] + (n[2] - e[2]) * a;
      const [sx, sy] = P(x, y);
      const col = m.phantom ? '#6b7a75' : TRUTH_COL[m.identity] || '#888';
      const dead = e[4] !== 0;
      c.fillStyle = col;
      c.strokeStyle = col;
      if (m.phantom) {
        c.strokeRect(sx - 3 * dpr, sy - 3 * dpr, 6 * dpr, 6 * dpr);
      } else if (dead) {
        c.lineWidth = 2 * dpr;
        c.beginPath(); c.moveTo(sx - 5 * dpr, sy - 5 * dpr); c.lineTo(sx + 5 * dpr, sy + 5 * dpr); c.moveTo(sx + 5 * dpr, sy - 5 * dpr); c.lineTo(sx - 5 * dpr, sy + 5 * dpr); c.stroke();
        c.lineWidth = dpr;
      } else {
        c.beginPath(); c.arc(sx, sy, 4.5 * dpr, 0, Math.PI * 2); c.fill();
      }
      const tr = trk.get(e[0]);
      const label = `${tr ? tr[0] : '(untracked)'} ${m.phantom ? 'clutter' : TYPES[m.type].short}${tr && tr[2] ? ` → ${TYPES[tr[2]]?.short}` : ''}${dead ? ` · ${STATUS_NAMES[e[4]]}` : ''}`;
      c.fillStyle = tr ? '#d8e6e0' : '#ff9f9f';
      c.fillText(label, sx + 7 * dpr, sy - 6 * dpr);
    }
    // Interceptors.
    c.fillStyle = '#4da6ff';
    for (const ic of f0.i || []) {
      const [sx, sy] = P(ic[0], ic[1]);
      c.beginPath(); c.moveTo(sx, sy - 5 * dpr); c.lineTo(sx + 4 * dpr, sy + 4 * dpr); c.lineTo(sx - 4 * dpr, sy + 4 * dpr); c.fill();
    }
    // Recent events.
    c.font = `${11 * dpr}px system-ui, sans-serif`;
    const recent = this.events.filter((ev) => ev.t <= this.t && this.t - ev.t < 6 && ['kill', 'softkill', 'damage', 'fratricide', 'roe', 'collateral', 'engage'].includes(ev.kind)).slice(-5);
    recent.forEach((ev, i) => {
      c.fillStyle = ev.sev === 'bad' ? '#ff9f9f' : ev.sev === 'good' ? '#9ff0a5' : '#a9b6b1';
      c.fillText(`${fmtTime(ev.t)} ${ev.msg}`, 10 * dpr, H - (10 + (recent.length - 1 - i) * 16) * dpr);
    });
    c.fillStyle = '#a9b6b1';
    c.fillText(`Vital area ${f0.h}%`, 10 * dpr, 18 * dpr);
    const p = polar(0, 1);
    c.fillText('N', cx + p.x - 4 * dpr, cy - R + 12 * dpr);
    this.clock.textContent = `T+${fmtTime(this.t)} / ${fmtTime(this.maxT)}`;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
  }
}

