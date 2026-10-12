// Operator console: the C-UAS training screen. It joins the simulation, the 3D
// EO/IR view, radar PPI, RF waterfall, acoustic array, track management and effector
// control, and handles mission brief, debrief and saving the session.

import { h, mount, openModal, toast, isTyping, closeAllModals } from '../core/dom.js';
import { Simulation, SIM_DT } from '../sim/engine.js';
import { TYPES, TYPE_KEYS, IDENTITIES, EFFECTORS, ACTIONS, WCS, TERRAINS, TIMES, WEATHERS, EW_LEVELS, DIFFICULTIES, ASSETS } from '../sim/catalog.js';
import { fmtTime, fmtBearing, DEG, RAD } from '../core/math.js';
import { World3D } from '../render/world3d.js';
import { PPI, drawSymbol } from '../render/ppi.js';
import { Waterfall } from '../render/waterfall.js';
import { sfx, playSignature, setMuted, isMuted } from '../render/audio.js';
import { ExemplarOperator } from '../ai/exemplar.js';
import { buildSessionRecord } from '../ai/session.js';
import { evaluate, perceivedContext } from '../ai/doctrine.js';

const IDENT_ORDER = ['HOSTILE', 'SUSPECT', 'NEUTRAL', 'FRIEND', 'NON_UAS'];
const IDENT_COL = { HOSTILE: '#ff5a5a', SUSPECT: '#ff9f43', FRIEND: '#4da6ff', NEUTRAL: '#3ddc84', NON_UAS: '#9aa5b1', UNKNOWN: '#ffd84d' };

export async function render(main, app) {
  const pending = app.pending;
  if (!pending) {
    app.go('/');
    return null;
  }
  const { spec, mode, options = {} } = pending;
  const watching = mode === 'exemplar';
  const trainee = watching ? null : await app.requireTrainee();
  if (!watching && !trainee) {
    toast('Select a trainee before starting a sortie.', 'bad');
    app.go('/');
    return null;
  }

  const sim = new Simulation(spec);
  const bot = watching ? new ExemplarOperator(sim) : null;
  const state = {
    selected: null, speed: watching ? 2 : 1, paused: true, running: false, ended: false,
    hints: options.hints ?? (spec.difficulty === 'RECRUIT'), cardSig: '', drag: null,
  };

  // ---------------------------------------------------------------- layout
  const el = {};
  el.clock = h('span', { class: 'clock' }, '00:00');
  el.health = h('i', { style: { width: '100%' } });
  el.healthTxt = h('span', { class: 'num' }, '100%');
  el.threats = h('span', { class: 'env' });
  el.pause = h('button', { class: 'btn', type: 'button', onclick: () => togglePause() }, 'Pause');
  el.speedBtns = [1, 2, 4].map((s) => h('button', { class: 'btn', type: 'button', onclick: () => { state.speed = s; renderTop(); } }, `${s}×`));
  el.sound = h('button', { class: 'btn', type: 'button', onclick: () => { setMuted(!isMuted()); renderTop(); } }, 'Sound');
  el.hintBtn = h('button', { class: 'btn', type: 'button', title: 'Show the doctrinal recommendation for what you have reported (training wheels)', onclick: () => { state.hints = !state.hints; state.cardSig = ''; renderTop(); } }, 'Coach');
  const env = spec.env;
  const top = h('div', { class: 'c-top' },
    h('img', { src: 'assets/icon.svg', width: 22, height: 22, alt: '' }),
    h('span', { class: 'title' }, spec.name),
    h('span', { class: `wcs ${spec.context.wcs}` }, WCS[spec.context.wcs].name),
    h('span', { class: 'env' }, `${TIMES[env.time].name} · ${WEATHERS[env.weather].name} · ${TERRAINS[env.terrain].name}${env.ew ? ` · EW-${env.ew}` : ''}${watching ? ' · EXEMPLAR' : ''}`),
    h('span', { class: 'spacer', style: { flex: 1 } }),
    el.threats,
    h('span', { class: 'health', title: 'Vital area integrity' }, 'VA', h('span', { class: 'bar' }, el.health), el.healthTxt),
    h('span', {}, 'T+', el.clock),
    ...el.speedBtns, el.pause, el.sound, el.hintBtn,
    h('button', { class: 'btn danger', type: 'button', onclick: () => abort() }, 'End'),
  );

  el.ppiCanvas = h('canvas');
  el.rfCanvas = h('canvas');
  el.acCanvas = h('canvas');
  el.hud = h('canvas', { class: 'hud' });
  el.noise = h('div', { class: 'eo-noise' });
  el.eoWrap = h('div', { class: 'eo-wrap' });
  el.irBtn = h('button', { type: 'button', title: 'Toggle TV / thermal IR (V)', onclick: () => toggleIR() }, 'IR');
  el.lockBtn = h('button', { type: 'button', title: 'Lock EO tracker on selected track (E)', onclick: () => lockSelected() }, 'LOCK');
  el.eoTools = h('div', { class: 'eo-tools' },
    el.irBtn, el.lockBtn,
    h('button', { type: 'button', title: 'Zoom out ([)', onclick: () => world.zoom(1.6) }, '−'),
    h('button', { type: 'button', title: 'Zoom in (])', onclick: () => world.zoom(1 / 1.6) }, '+'),
    h('button', { type: 'button', title: 'Wide field of view', onclick: () => { world.fov = 50; } }, 'WFOV'),
  );
  el.tbody = h('tbody');
  el.card = h('div', { class: 'tcard' });
  el.log = h('div', { class: 'log' });
  el.eff = h('div', { class: 'eff-list' });
  el.acInfo = h('div', { class: 'evidence', style: { padding: '4px 8px' } });
  el.rfInfo = h('span', { class: 'spacer', style: { textAlign: 'right', textTransform: 'none', letterSpacing: 0 } });

  const layout = h('div', { class: 'console' },
    top,
    h('section', { class: 'pane c-ppi' }, h('div', { class: 'pane-title' }, 'Radar PPI', h('span', { class: 'spacer' }), h('span', { class: 'muted', style: { textTransform: 'none', letterSpacing: 0 } }, 'wheel: range · click: select')), h('div', { class: 'pane-body' }, el.ppiCanvas)),
    h('section', { class: 'pane c-eo' }, h('div', { class: 'pane-title' }, 'EO / IR gimbal', h('span', { class: 'spacer' }), h('span', { class: 'muted', style: { textTransform: 'none', letterSpacing: 0 } }, 'drag: slew · wheel: zoom · click drone: designate')), h('div', { class: 'pane-body' }, el.eoWrap)),
    h('section', { class: 'pane c-tracks' }, h('div', { class: 'pane-title' }, 'Track table', h('span', { class: 'spacer' }), h('span', { class: 'muted', style: { textTransform: 'none', letterSpacing: 0 } }, 'Tab: next · Space: ack')),
      h('div', { class: 'pane-body' }, h('div', { class: 'scroll' }, h('table', { class: 'trk-table' },
        h('thead', {}, h('tr', {}, ['ID', 'CLASS', 'RNG', 'BRG', 'ALT', 'SPD', 'TTI', 'SRC'].map((t) => h('th', {}, t)))), el.tbody)))),
    h('section', { class: 'pane c-rf' }, h('div', { class: 'pane-title' }, 'RF detector', el.rfInfo), h('div', { class: 'pane-body' }, el.rfCanvas)),
    h('section', { class: 'pane c-card' }, h('div', { class: 'pane-title' }, 'Track card · kill chain'), h('div', { class: 'pane-body' }, el.card)),
    h('section', { class: 'pane c-acou' }, h('div', { class: 'pane-title' }, 'Acoustic array'), h('div', { class: 'pane-body acou-body' }, el.acInfo, h('div', { style: { position: 'relative', minHeight: 0 } }, el.acCanvas))),
    h('div', { class: 'c-bottom' },
      h('section', { class: 'pane' }, h('div', { class: 'pane-title' }, 'Effectors'), h('div', { class: 'pane-body' }, el.eff)),
      h('section', { class: 'pane' }, h('div', { class: 'pane-title' }, 'Event log'), h('div', { class: 'pane-body' }, el.log)),
    ),
  );
  mount(main, layout);
  el.eoWrap.append(el.hud, el.noise, el.eoTools);

  // ---------------------------------------------------------------- renderers
  const world = new World3D(el.eoWrap, sim, {
    onPick: (eid) => designate(eid),
    onVrAction: (a) => vrAction(a),
  });
  el.eoWrap.insertBefore(world.renderer.domElement, el.hud);
  const ppi = new PPI(el.ppiCanvas, sim, { onSelect: (id) => select(id, true) });
  const wf = new Waterfall(el.rfCanvas, sim);
  const hudCtx = el.hud.getContext('2d');
  const acCtx = el.acCanvas.getContext('2d');
  makeNoise(el.noise);

  function resizeAll() {
    world.resize();
    const r = el.eoWrap.getBoundingClientRect();
    el.hud.width = r.width; el.hud.height = r.height;
    ppi.resize();
    wf.resize();
    const ar = el.acCanvas.getBoundingClientRect();
    el.acCanvas.width = Math.max(10, ar.width); el.acCanvas.height = Math.max(10, ar.height);
  }
  const ro = new ResizeObserver(() => resizeAll());
  ro.observe(el.eoWrap);
  ro.observe(el.ppiCanvas);
  resizeAll();

  // ---------------------------------------------------------------- events
  const unsub = sim.on((ev) => {
    appendLog(ev);
    if (ev.kind === 'track_new') sfx.newTrack();
    else if (ev.kind === 'kill') sfx.splash();
    else if (ev.kind === 'damage') sfx.impact();
    else if (ev.kind === 'warn') sfx.warn();
    else if (ev.kind === 'fratricide' || ev.kind === 'roe' || ev.kind === 'collateral') sfx.bad();
    else if (ev.kind === 'softkill') sfx.good();
    else if (ev.kind === 'engage') { if (ev.effector === 'GUN') sfx.gun(); else sfx.engage(); }
  });

  function appendLog(ev) {
    const cls = ev.op ? 'op' : ev.sev === 'good' ? 'good' : ev.sev === 'bad' ? 'bad' : ev.sev === 'warn' ? 'warn' : '';
    const row = h('div', { class: cls, title: ev.msg }, h('span', { class: 't' }, fmtTime(ev.t)), ev.msg);
    if (ev.trackId) { row.style.cursor = 'pointer'; row.addEventListener('click', () => select(ev.trackId, true)); }
    el.log.prepend(row);
    while (el.log.childNodes.length > 120) el.log.lastChild.remove();
  }
  for (const ev of sim.events) appendLog(ev);

  // ---------------------------------------------------------------- commands
  function cmd(c) {
    const res = sim.command(c);
    if (!res.ok && res.reason) toast(res.reason, 'bad');
    state.cardSig = '';
    return res;
  }

  function select(id, slew = false) {
    state.selected = id;
    ppi.selected = id;
    wf.selected = id;
    state.cardSig = '';
    const tr = sim.track(id);
    if (tr && tr.op.ackAt === null && !watching) cmd({ type: 'ack', trackId: id });
    if (tr && slew && sim.eo.trackId !== id) {
      let elev = null;
      if (tr.view.range) elev = Math.atan2(sim.terrain.heightAt(tr.view.x, tr.view.y) + (tr.view.alt || 0) - sim.terrain.sensorZ, tr.view.range) * RAD;
      else elev = 2;
      if (tr.view.bearing != null) world.slewTo(tr.view.bearing, elev);
    }
    renderTable();
  }

  function designate(eid) {
    if (watching) return;
    const res = cmd({ type: 'designate', entityId: eid });
    if (res.ok) {
      select(res.trackId, false);
      toast(`EO designation: ${res.trackId} locked`);
    }
  }

  function lockSelected() {
    if (!state.selected) return;
    if (sim.eo.trackId === state.selected) { cmd({ type: 'eoUnlock' }); return; }
    const res = cmd({ type: 'eoLock', trackId: state.selected });
    if (res.ok) {
      const tr = sim.track(state.selected);
      const e = sim.entity(tr.entityId);
      // Auto-zoom so the target spans roughly 50 px.
      const range = Math.hypot(e.pos.x, e.pos.y, e.pos.z);
      const want = Math.atan((e.def.size * world.height / 50) / range) * 2 * RAD;
      world.fov = Math.max(0.6, Math.min(30, want));
    }
  }

  function toggleIR() {
    world.setThermal(!world.thermal);
    el.irBtn.classList.toggle('on', world.thermal);
  }

  function cycle(dir = 1) {
    const list = sim.trackList().filter((t) => !t.closed);
    if (!list.length) return;
    const i = list.findIndex((t) => t.id === state.selected);
    const next = list[(i + dir + list.length) % list.length];
    select(next.id, true);
  }

  function ackNext() {
    const tr = state.selected && sim.track(state.selected);
    if (tr && tr.op.ackAt === null) { cmd({ type: 'ack', trackId: tr.id }); return; }
    const unread = sim.trackList().find((t) => !t.closed && t.op.ackAt === null);
    if (unread) select(unread.id, true);
  }

  function act(action) {
    const tr = state.selected && sim.track(state.selected);
    if (!tr || watching) return;
    if (action === 'MONITOR') cmd({ type: 'monitor', trackId: tr.id });
    else if (action === 'DISMISS') cmd({ type: 'dismiss', trackId: tr.id });
    else cmd({ type: 'engage', trackId: tr.id, effector: action });
  }

  function classify(cls, viaAI = false) {
    const tr = state.selected && sim.track(state.selected);
    if (!tr || watching) return;
    cmd({ type: 'classify', trackId: tr.id, cls, viaAI });
  }

  function identify(ident) {
    const tr = state.selected && sim.track(state.selected);
    if (!tr || watching) return;
    cmd({ type: 'identify', trackId: tr.id, ident });
  }

  function vrAction(a) {
    const tr = state.selected && sim.track(state.selected);
    if (a === 'next') return ackNext();
    if (a === 'warn') return cmd({ type: 'warn' });
    if (!tr) return;
    if (a === 'ai' && tr.ai) return classify(tr.ai.cls, true);
    if (a === 'hostile') return identify('HOSTILE');
    if (a === 'friend') return identify('FRIEND');
    if (a === 'monitor') return act('MONITOR');
    if (EFFECTORS[a]) return act(a);
    return null;
  }

  function togglePause() {
    if (state.ended) return;
    state.paused = !state.paused;
    renderTop();
  }

  async function abort() {
    if (state.ended) { app.go('/'); return; }
    state.paused = true;
    const close = openModal(h('div', {},
      h('h2', {}, 'End the mission now?'),
      h('p', { class: 'secondary' }, watching ? 'The exemplar run will stop.' : 'The sortie is scored as it stands. Threats that are still active count as not defeated.'),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn', type: 'button', onclick: () => { close(); state.paused = false; renderTop(); } }, 'Resume'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => { close(); sim.end('Ended early by operator'); } }, 'End & debrief'),
      )));
  }

  // ---------------------------------------------------------------- keyboard
  const onKey = (e) => {
    if (isTyping(e) || document.querySelector('.modal-back')) return;
    const k = e.key;
    const kl = k.toLowerCase();
    if (k === 'Tab') { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); return; }
    if (k === ' ') { e.preventDefault(); ackNext(); return; }
    if (k === 'Escape') { state.selected = null; ppi.selected = null; state.cardSig = ''; return; }
    if (/^[1-9]$/.test(k)) { classify(TYPE_KEYS[Number(k) - 1]); return; }
    if (k === 'ArrowLeft') { world.slew(-world.fov * 0.08, 0); return; }
    if (k === 'ArrowRight') { world.slew(world.fov * 0.08, 0); return; }
    if (k === 'ArrowUp') { e.preventDefault(); world.slew(0, world.fov * 0.06); return; }
    if (k === 'ArrowDown') { e.preventDefault(); world.slew(0, -world.fov * 0.06); return; }
    if (k === '[') { world.zoom(1.5); return; }
    if (k === ']') { world.zoom(1 / 1.5); return; }
    const map = {
      h: () => identify('HOSTILE'), u: () => identify('SUSPECT'), n: () => identify('NEUTRAL'), f: () => identify('FRIEND'), b: () => identify('NON_UAS'),
      q: () => state.selected && cmd({ type: 'iff', trackId: state.selected }),
      m: () => act('MONITOR'), x: () => act('DISMISS'), j: () => act('RF_JAM'), k: () => act('GNSS_SPOOF'), g: () => act('GUN'), i: () => act('INTERCEPTOR'), l: () => act('LASER'),
      w: () => cmd({ type: 'warn' }), v: () => toggleIR(), e: () => lockSelected(), p: () => togglePause(),
      a: () => { const tr = state.selected && sim.track(state.selected); if (tr?.ai) classify(tr.ai.cls, true); },
      r: () => cmd({ type: 'jamMode', mode: sim.effectors.RF_JAM.mode === 'wide' ? 'narrow' : 'wide' }),
    };
    if (map[kl] && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); map[kl](); }
  };
  document.addEventListener('keydown', onKey);

  // ---------------------------------------------------------------- EO mouse
  const eoCanvas = world.renderer.domElement;
  eoCanvas.addEventListener('pointerdown', (e) => {
    state.drag = { x: e.clientX, y: e.clientY, moved: false };
    eoCanvas.setPointerCapture(e.pointerId);
  });
  eoCanvas.addEventListener('pointermove', (e) => {
    if (!state.drag) return;
    const dx = e.clientX - state.drag.x, dy = e.clientY - state.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.drag.moved = true;
    if (state.drag.moved) {
      if (sim.eo.trackId) cmd({ type: 'eoUnlock' });
      const vf = world.fov, hf = hfov();
      world.slew(-dx * hf / world.width, dy * vf / world.height);
      state.drag.x = e.clientX; state.drag.y = e.clientY;
    }
  });
  eoCanvas.addEventListener('pointerup', (e) => {
    const d = state.drag;
    state.drag = null;
    if (d && !d.moved) {
      const r = eoCanvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const ent = world.pickAt(px, py);
      if (ent) { designate(ent.id); return; }
      // Otherwise select a track marker near the click.
      let best = null, bd = 22;
      for (const tr of sim.tracks) {
        if (tr.closed || tr.view.x == null) continue;
        const p = world.project(tr.view.x, tr.view.y, tr.view.alt || 0);
        if (!p.visible) continue;
        const dd = Math.hypot(p.x - px, p.y - py);
        if (dd < bd) { bd = dd; best = tr; }
      }
      if (best) select(best.id, false);
    }
  });
  eoCanvas.addEventListener('wheel', (e) => { e.preventDefault(); world.zoom(e.deltaY > 0 ? 1.25 : 0.8); }, { passive: false });

  const hfov = () => 2 * Math.atan(Math.tan((world.fov * DEG) / 2) * (world.width / world.height)) * RAD;

  // ---------------------------------------------------------------- HUD
  function drawHud() {
    const c = hudCtx, W = el.hud.width, H = el.hud.height;
    c.clearRect(0, 0, W, H);
    const ir = world.thermal;
    const ink = ir ? 'rgba(255,255,255,0.92)' : 'rgba(150,255,190,0.95)';
    c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 1;
    c.font = '11px ui-monospace, monospace';
    // Dark halo behind HUD symbology keeps it legible against a bright day sky.
    c.shadowColor = 'rgba(0,0,0,0.85)';
    c.shadowBlur = 3;
    // Reticle.
    const cx = W / 2, cy = H / 2;
    c.beginPath();
    for (const [a, b, d, e2] of [[-40, 0, -10, 0], [10, 0, 40, 0], [0, -40, 0, -10], [0, 10, 0, 40]]) { c.moveTo(cx + a, cy + b); c.lineTo(cx + d, cy + e2); }
    c.stroke();
    // Bearing tape.
    const hf = hfov();
    const ppd = W / hf;
    const step = hf > 30 ? 10 : hf > 10 ? 5 : hf > 3 ? 1 : 0.5;
    c.textAlign = 'center';
    const start = Math.floor((world.yaw - hf / 2) / step) * step;
    for (let b = start; b <= world.yaw + hf / 2; b += step) {
      const x = cx + (b - world.yaw) * ppd;
      const major = Math.abs(b / (step * 2) - Math.round(b / (step * 2))) < 1e-6;
      c.beginPath(); c.moveTo(x, 14); c.lineTo(x, major ? 24 : 19); c.stroke();
      if (major) c.fillText(fmtBearing(b), x, 36);
    }
    c.beginPath(); c.moveTo(cx, 8); c.lineTo(cx - 5, 2); c.lineTo(cx + 5, 2); c.closePath(); c.fill();
    c.textAlign = 'left';
    const mode = ir ? 'IR-WHT' : 'EO-TV';
    c.fillText(`${mode}  FOV ${world.fov.toFixed(world.fov < 5 ? 1 : 0)}°  AZ ${world.yaw.toFixed(1).padStart(5, '0')}  EL ${world.pitch >= 0 ? '+' : ''}${world.pitch.toFixed(1)}`, 10, H - 12);
    if (sim.eo.trackId) c.fillText(`TRK LOCK ${sim.eo.trackId}`, 10, 52);
    // Track markers.
    for (const tr of sim.tracks) {
      if (tr.closed) continue;
      const col = IDENT_COL[tr.op.ident || 'UNKNOWN'];
      const sel = tr.id === state.selected;
      const locked = sim.eo.trackId === tr.id;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = sel ? 2 : 1;
      if (tr.view.x != null) {
        let p;
        if (locked) {
          const e = sim.entity(tr.entityId);
          p = world.project(e.pos.x, e.pos.y, e.pos.z);
        } else {
          p = world.project(tr.view.x, tr.view.y, tr.view.alt || 0);
        }
        if (!p.visible) continue;
        const s = locked ? 26 : 14;
        brackets(c, p.x, p.y, s);
        c.fillText(tr.id, p.x + s + 4, p.y - s + 8);
        if (sel || locked) c.fillText(`${(tr.view.range / 1000).toFixed(2)} km`, p.x + s + 4, p.y - s + 21);
      } else if (tr.view.bearing != null) {
        const dB = ((tr.view.bearing - world.yaw + 540) % 360) - 180;
        if (Math.abs(dB) > hf / 2) continue;
        const x = cx + dB * ppd;
        c.setLineDash([4, 6]);
        c.beginPath(); c.moveTo(x, 44); c.lineTo(x, H - 30); c.stroke();
        c.setLineDash([]);
        c.fillText(`${tr.id} ${tr.rf ? 'RF' : 'AC'} strobe`, x + 4, 58);
      }
    }
    // Off-screen indicator for the selected track.
    const sel = state.selected && sim.track(state.selected);
    if (sel && sel.view.bearing != null) {
      const dB = ((sel.view.bearing - world.yaw + 540) % 360) - 180;
      if (Math.abs(dB) > hf / 2) {
        c.fillStyle = '#ffd84d';
        c.textAlign = dB > 0 ? 'right' : 'left';
        c.fillText(dB > 0 ? `${sel.id} ▶ ${Math.round(dB)}°` : `◀ ${sel.id} ${Math.round(-dB)}°`, dB > 0 ? W - 10 : 10, cy);
        c.textAlign = 'left';
      }
    }
    c.shadowBlur = 0;
    // Sensor noise grain (IR, fog, EW).
    const grain = (ir ? 0.16 : 0.04) + 0.07 * (spec.env.ew || 0) + (spec.env.weather !== 'clear' ? 0.05 : 0);
    el.noise.style.opacity = String(Math.min(0.55, grain));
    el.noise.style.backgroundPosition = `${Math.floor(Math.random() * 128)}px ${Math.floor(Math.random() * 128)}px`;
  }

  // ---------------------------------------------------------------- panels
  function renderTop() {
    el.clock.textContent = `${fmtTime(sim.t)} / ${fmtTime(sim.duration)}`;
    const hp = Math.round(sim.asset.health);
    el.health.style.width = `${hp}%`;
    el.health.style.background = hp > 66 ? 'var(--good)' : hp > 33 ? 'var(--warning)' : 'var(--critical)';
    el.healthTxt.textContent = `${hp}%`;
    const open = sim.tracks.filter((t) => !t.closed && t.status !== 'lost').length;
    const unread = sim.tracks.filter((t) => !t.closed && t.op.ackAt === null).length;
    el.threats.textContent = `TRACKS ${open}${unread ? ` · ${unread} NEW` : ''}`;
    el.speedBtns.forEach((b, i) => b.classList.toggle('primary', [1, 2, 4][i] === state.speed));
    el.pause.textContent = state.paused ? 'Resume' : 'Pause';
    el.sound.textContent = isMuted() ? 'Sound off' : 'Sound on';
    el.hintBtn.classList.toggle('primary', state.hints);
    el.irBtn.classList.toggle('on', world.thermal);
    el.lockBtn.classList.toggle('on', !!sim.eo.trackId);
  }

  function fmtRange(v) { return v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)}k` : `${Math.round(v)}`; }
  function srcStr(tr) {
    const s = tr.sources, t = sim.t;
    const f = (v, ch) => (t - v < 3 ? h('b', {}, ch) : ch);
    return h('span', { class: 'src' }, f(s.radar, 'R'), f(s.rf, 'F'), f(s.acoustic, 'A'), f(s.eo, 'E'));
  }

  function renderTable() {
    const rows = sim.trackList().map((tr) => {
      const ident = tr.op.ident || 'UNKNOWN';
      const tti = ['FRIEND', 'NON_UAS'].includes(ident) ? Infinity : tr.view.tti;
      const cls = tr.closed ? 'closed' : tr.status === 'lost' ? 'lost' : '';
      return h('tr', {
        class: `${cls}${tr.id === state.selected ? ' sel' : ''}${tr.op.ackAt === null && !tr.closed ? ' unread' : ''}`,
        onclick: () => select(tr.id, true),
      },
      h('td', {}, h('i', { class: `sym ${ident}` }), tr.id),
      h('td', {}, tr.closed ? (tr.closed.status || '').toUpperCase() : tr.op.cls ? TYPES[tr.op.cls].short : tr.op.dismissed ? 'DISM' : '?'),
      h('td', { class: 'r' }, fmtRange(tr.view.range)),
      h('td', { class: 'r' }, tr.view.bearing != null ? fmtBearing(tr.view.bearing) : '—'),
      h('td', { class: 'r' }, tr.view.alt != null ? Math.round(tr.view.alt) : '—'),
      h('td', { class: 'r' }, tr.view.speed != null ? Math.round(tr.view.speed) : '—'),
      h('td', { class: 'r', style: { color: tti < 30 ? '#ff7b7b' : '' } }, isFinite(tti) ? Math.round(tti) : '—'),
      h('td', {}, srcStr(tr)));
    });
    mount(el.tbody, rows.length ? rows : h('tr', {}, h('td', { colspan: 8, class: 'empty' }, state.running ? 'No tracks. Scan the PPI and the EO view.' : 'Awaiting mission start')));
  }

  function renderEffectors() {
    const E = sim.effectors;
    const t = sim.t;
    const st = (txt, k) => h('span', { class: `st ${k}` }, txt);
    const pips = (n, max) => h('span', { class: 'pips' }, Array.from({ length: Math.min(max, 32) }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
    const rows = [];
    const J = E.RF_JAM;
    rows.push(h('div', { class: 'eff' }, h('span', { class: 'nm' }, 'JAM'),
      h('span', {}, J.enabled ? (J.active ? st(`RADIATING ${fmtBearing(J.active.bearing)}° ${Math.ceil(J.active.until - t)}s`, 'active') : t < J.cooldownUntil ? st('COOLING', 'cool') : st('READY', 'ready')) : st('NOT FIELDED', 'out')),
      h('button', { class: 'cbtn', style: { minHeight: '22px', padding: '0 6px' }, type: 'button', title: 'Beam width (R)', onclick: () => cmd({ type: 'jamMode', mode: J.mode === 'wide' ? 'narrow' : 'wide' }) }, J.mode === 'wide' ? 'WIDE 90°' : 'NARROW 30°')));
    const S = E.GNSS_SPOOF;
    rows.push(h('div', { class: 'eff' }, h('span', { class: 'nm' }, 'SPOOF'),
      h('span', {}, S.enabled ? (S.active ? st(`RADIATING ${Math.ceil(S.active.until - t)}s`, 'active') : t < S.cooldownUntil ? st('COOLING', 'cool') : st('READY', 'ready')) : st('NOT FIELDED', 'out')), h('span')));
    const G = E.GUN;
    rows.push(h('div', { class: 'eff' }, h('span', { class: 'nm' }, 'GUN'),
      h('span', {}, G.enabled ? (G.engagement ? st(`FIRING ${G.engagement.trackId}`, 'active') : G.ammo > 0 ? st('READY', 'ready') : st('NO AMMO', 'out')) : st('NOT FIELDED', 'out')),
      h('span', { title: `${G.ammo} bursts` }, pips(G.ammo, G.ammoMax))));
    const I = E.INTERCEPTOR;
    const flying = sim.interceptors.filter((x) => x.alive).length;
    rows.push(h('div', { class: 'eff' }, h('span', { class: 'nm' }, 'INTCP'),
      h('span', {}, I.enabled ? (flying ? st(`${flying} IN FLIGHT`, 'active') : I.count > 0 ? st('READY', 'ready') : st('EXPENDED', 'out')) : st('NOT FIELDED', 'out')),
      h('span', {}, pips(I.count, I.countMax))));
    const L = E.LASER;
    rows.push(h('div', { class: 'eff' }, h('span', { class: 'nm' }, 'LASER'),
      h('span', {}, L.enabled ? (L.engagement ? st(`DWELL ${L.engagement.trackId} ${Math.round((L.engagement.dwell / L.engagement.needed) * 100)}%`, 'active') : t < L.cooldownUntil ? st('COOLING', 'cool') : st(`READY · ${Math.round(sim.laserRange())} m`, 'ready')) : st('NOT FIELDED', 'out')), h('span')));
    const warnLeft = sim.asset.warnedUntil - t;
    rows.push(h('div', { class: 'eff' }, h('span', { class: 'nm' }, 'WARN'),
      h('span', {}, warnLeft > 0 ? st(`TROOPS UNDER COVER ${Math.ceil(warnLeft)}s`, 'active') : st('—', 'cool')),
      h('button', { class: 'cbtn warnbtn', style: { minHeight: '22px', padding: '0 8px' }, type: 'button', onclick: () => cmd({ type: 'warn' }) }, 'AIR SENTRY (W)')));
    mount(el.eff, rows);
  }

  function renderAcoustic() {
    const tr = state.selected && sim.track(state.selected);
    const c = acCtx, W = el.acCanvas.width, H = el.acCanvas.height;
    c.fillStyle = '#060c0b';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = '#1a2a26';
    for (let x = 0; x < W; x += W / 8) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    const fmax = 1800;
    c.strokeStyle = '#3ddc84';
    c.beginPath();
    const ac = tr?.acoustic && sim.t - tr.sources.acoustic < 3 ? tr.acoustic : null;
    const e = tr && sim.entity(tr.entityId);
    for (let x = 0; x < W; x++) {
      const f = (x / W) * fmax;
      let v = Math.random() * 0.08 + 0.05;
      if (ac && e?.def.acoustic) {
        e.def.acoustic.harmonics.forEach((a, i) => {
          const fi = ac.f0 * (i + 1);
          v += a * ac.level * Math.exp(-Math.pow((f - fi) / 12, 2));
        });
      }
      const y = H - 4 - Math.min(1, v) * (H - 10);
      x ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
    c.fillStyle = '#7d8a85';
    c.font = '10px ui-monospace, monospace';
    c.fillText('0', 2, H - 2);
    c.fillText(`${fmax} Hz`, W - 48, H - 2);
    const lib = spec.sensors?.protocolLibrary;
    const sig = `${tr?.id}|${!!ac}|${ac ? Math.round(ac.f0 / 5) : ''}`;
    if (el.acInfo.dataset.sig !== sig) {
      el.acInfo.dataset.sig = sig;
      if (ac) {
        mount(el.acInfo,
          h('div', {}, h('b', {}, tr.id), ` brg ${fmtBearing(ac.bearing)} · f₀ ≈ `, h('b', {}, `${ac.f0} Hz`), lib ? ` · ${ac.character}` : ''),
          h('button', { class: 'cbtn', style: { minHeight: '22px', marginTop: '3px' }, type: 'button', onclick: () => playSignature(e.type, { f0Override: ac.f0, level: 0.4 + ac.level * 0.6 }) }, '▶ Listen'),
        );
      } else {
        mount(el.acInfo, h('span', { class: 'muted' }, tr ? `${tr.id}: no acoustic contact (range ${Math.round(sim.T.acousticRange * sim.W.acoustic)} m)` : 'Select a track to see its acoustic signature.'));
      }
    }
  }

  function renderRfInfo() {
    const tr = state.selected && sim.track(state.selected);
    if (!tr) { el.rfInfo.textContent = ''; return; }
    if (tr.rf && sim.t - tr.sources.rf < 3) el.rfInfo.textContent = `${tr.id} · brg ${fmtBearing(tr.rf.bearing)} · ${tr.rf.protocol}`;
    else el.rfInfo.textContent = `${tr.id} · no RF emission detected`;
  }

  function kin(label, value, hot = false) {
    return h('div', { class: hot ? 'tti-hot' : '' }, h('span', {}, label), h('b', {}, value));
  }

  function renderCard() {
    const tr = state.selected && sim.track(state.selected);
    if (!tr) {
      if (state.cardSig !== 'none') {
        state.cardSig = 'none';
        mount(el.card, h('div', { class: 'empty' }, 'Select a track (Tab, click PPI or table), or click a drone in the EO view to designate it.'),
          h('div', { class: 'keys', style: { padding: '8px' } },
            ...[['Tab', 'next track'], ['Space', 'acknowledge'], ['1–9', 'classify'], ['H U N F B', 'identify'], ['Q', 'IFF'], ['A', 'accept AI'], ['M / X', 'monitor / dismiss'], ['J K G I L', 'effectors'], ['R', 'jam beam'], ['W', 'air sentry'], ['V', 'TV / IR'], ['E', 'EO lock'], ['[ ]', 'zoom'], ['P', 'pause']]
              .map(([k, d]) => h('div', {}, h('kbd', {}, k), d))));
      }
      return;
    }
    const avail = sim.availability(tr);
    const sig = JSON.stringify([tr.id, tr.op.cls, tr.op.ident, tr.op.iff, tr.op.iffPendingUntil !== null, tr.ai, tr.op.decision?.action, tr.closed?.status, avail,
      !!(tr.rf && sim.t - tr.sources.rf < 3), !!tr.est.hasPos, state.hints, sim.eo.trackId === tr.id, tr.op.ackAt !== null, tr.status, Math.round((tr.view.tti || 0) / 10)]);
    const ident = tr.op.ident || 'UNKNOWN';
    if (sig !== state.cardSig) {
      state.cardSig = sig;
      const hdr = h('div', { class: 'hdr' },
        h('canvas', { width: 20, height: 20, 'data-sym': ident }),
        h('span', { class: 'tid' }, tr.id),
        h('span', { class: 'chip', style: { color: IDENT_COL[ident] } }, IDENTITIES[ident]?.name || 'Unknown'),
        h('span', { class: 'chip' }, tr.closed ? `CLOSED · ${tr.closed.status}` : tr.status.toUpperCase()),
        h('span', { class: 'spacer', style: { flex: 1 } }),
        srcStr(tr));
      const symCanvas = hdr.querySelector('canvas');
      drawSymbol(symCanvas.getContext('2d'), 10, 10, ident, 7, IDENT_COL[ident]);
      el.kin = h('div', { class: 'kin' });
      const aiBox = tr.ai
        ? h('div', { class: 'ai-box' }, h('span', {}, '🤖 AI aid:'), h('b', {}, TYPES[tr.ai.cls].name), h('span', { class: 'conf' }, `${Math.round(tr.ai.conf * 100)}%`),
          h('button', { class: 'cbtn', style: { minHeight: '22px' }, type: 'button', disabled: watching || tr.closed, onclick: () => classify(tr.ai.cls, true) }, 'Accept (A)'))
        : h('div', { class: 'ai-box muted' }, spec.aiAid?.enabled ? 'AI aid: analysing…' : 'AI aid: off');
      const clsGrid = h('div', { class: 'btn-grid c3' }, TYPE_KEYS.map((k, i) => h('button', {
        class: `cbtn${tr.op.cls === k ? ' on' : ''}`, type: 'button', title: TYPES[k].name, disabled: watching || !!tr.closed, onclick: () => classify(k),
      }, h('span', { class: 'hk' }, String(i + 1)), TYPES[k].short)));
      const iffTxt = tr.op.iffPendingUntil !== null ? 'Interrogating…' : tr.op.iff ? (tr.op.iff.valid ? `MODE-5 VALID · ${tr.op.iff.callsign}` : 'NO RESPONSE') : 'Not interrogated';
      const idGrid = h('div', { class: 'btn-grid c3' },
        IDENT_ORDER.map((k) => h('button', { class: `cbtn${tr.op.ident === k ? ' on' : ''}`, type: 'button', disabled: watching || !!tr.closed, onclick: () => identify(k), style: { color: IDENT_COL[k] } },
          h('span', { class: 'hk' }, IDENTITIES[k].hotkey.toUpperCase()), IDENTITIES[k].name)),
        h('button', { class: 'cbtn', type: 'button', disabled: watching || !!tr.closed, title: iffTxt, onclick: () => cmd({ type: 'iff', trackId: tr.id }) }, h('span', { class: 'hk' }, 'Q'), 'IFF'),
      );
      const decGrid = h('div', { class: 'btn-grid c4' },
        ['MONITOR', 'DISMISS'].map((a) => h('button', { class: `cbtn${tr.op.decision?.action === a ? ' on' : ''}`, type: 'button', disabled: watching || !!tr.closed, onclick: () => act(a) },
          h('span', { class: 'hk' }, ACTIONS[a].hotkey.toUpperCase()), a === 'MONITOR' ? 'MON/HOLD' : 'DISMISS')),
        Object.values(EFFECTORS).map((E) => {
          const chk = sim.canEngage(E.key, tr);
          return h('button', {
            class: `cbtn eff ${E.kind}${tr.op.actions.some((x) => x.action === E.key) ? ' on' : ''}`, type: 'button',
            disabled: watching || !!tr.closed || !chk.ok, title: chk.ok ? E.note : chk.reason, onclick: () => act(E.key),
          }, h('span', { class: 'hk' }, E.hotkey.toUpperCase()), E.short);
        }),
      );
      const rfLine = tr.rf && sim.t - tr.sources.rf < 3
        ? h('div', {}, 'RF: ', h('b', {}, `${tr.rf.bands.map((b) => `${b} GHz`).join(' + ')}`), ` · ${tr.rf.protocol}`)
        : h('div', {}, 'RF: ', h('b', {}, tr.est.hasPos && tr.view.range < sim.rfRange() ? 'NONE on this bearing (inside RF detector range)' : 'no emission detected'));
      const acLine = tr.acoustic && sim.t - tr.sources.acoustic < 4 ? h('div', {}, 'Acoustic: ', h('b', {}, `f₀ ${tr.acoustic.f0} Hz`)) : null;
      const kids = [hdr, el.kin, aiBox,
        h('div', { class: 'sect' }, 'Classify'), clsGrid,
        h('div', { class: 'sect' }, 'Identify', h('span', { class: 'muted', style: { textTransform: 'none', letterSpacing: 0 } }, `IFF: ${iffTxt}`)), idGrid,
        h('div', { class: 'sect' }, 'Decide & engage'), decGrid,
        h('div', { class: 'sect' }, 'Evidence'), h('div', { class: 'evidence' }, rfLine, acLine, ato(tr)),
      ];
      if (state.hints && !tr.closed) kids.push(hint(tr));
      if (tr.op.roe.length) kids.push(h('div', { class: 'hint', style: { borderColor: '#6a2a26', color: '#ffb0a6' } }, tr.op.roe.map((r) => r.msg).join(' · ')));
      mount(el.card, kids);
    }
    // Live kinematics.
    const v = tr.view;
    mount(el.kin,
      kin('RANGE', v.range != null ? `${(v.range / 1000).toFixed(2)} km` : 'brg only'),
      kin('BEARING', v.bearing != null ? `${fmtBearing(v.bearing)}°` : '—'),
      kin('ALT', v.alt != null ? `${Math.round(v.alt)} m` : '—'),
      kin('SPEED', v.speed != null ? `${Math.round(v.speed)} m/s` : '—'),
      kin('HEADING', v.heading != null && v.speed > 1 ? `${fmtBearing(v.heading)}°` : '—'),
      kin('TTI', isFinite(v.tti) && !['FRIEND', 'NON_UAS'].includes(tr.op.ident) ? `${Math.round(v.tti)} s` : '—', v.tti < 30 && !['FRIEND', 'NON_UAS'].includes(tr.op.ident)),
    );
  }

  function ato(tr) {
    const list = spec.context.ato || [];
    if (!list.length || !tr.view.bearing) return null;
    const match = list.find((a) => Math.abs(((tr.view.bearing - a.corridor + 540) % 360) - 180) < 15 && sim.t >= a.windowStart && sim.t <= a.windowEnd);
    return match ? h('div', {}, 'ATO: ', h('b', {}, `in ${match.callsign} corridor ${fmtBearing(match.corridor)}° (window open)`)) : h('div', {}, 'ATO: ', h('b', {}, 'no scheduled own aircraft on this bearing'));
  }

  function hint(tr) {
    const sit = sim.situation(sim.entity(tr.entityId));
    const ev = evaluate(perceivedContext({
      cls: tr.op.cls, ident: tr.op.ident, rfEvidence: sim.t - tr.sources.rf < 6, wcs: sim.ctx.wcs, urban: sim.urban, weather: sim.W.key,
      tti: tr.view.tti, inRestricted: !!tr.view.inRestricted, swarmCount: sit.perceivedSwarm,
      friendlyInJamBeam: sit.perceivedFriendlyInJamBeam, friendlyInSpoofRange: sit.perceivedFriendlyInSpoofRange,
    }));
    const opt = Object.entries(ev.ratings).filter(([, r]) => r === 'OPTIMAL').map(([a]) => ACTIONS[a].short);
    return h('div', { class: 'hint' }, h('b', {}, 'Coach: '), `Based on what you have reported (${tr.op.cls ? TYPES[tr.op.cls].short : 'unclassified'}, ${tr.op.ident || 'unidentified'}): `,
      h('b', {}, ev.leaf.title), ` — ${ev.leaf.guidance} Optimal: ${opt.join(', ') || '—'}.`);
  }

  // ---------------------------------------------------------------- brief / debrief
  function showBrief() {
    const ctx = spec.context;
    const effRows = Object.values(EFFECTORS).map((E) => {
      const cfg = spec.effectors?.[E.key];
      const on = cfg !== false && cfg !== undefined;
      const extra = E.key === 'GUN' && on ? `${cfg.ammo ?? E.ammo} bursts` : E.key === 'INTERCEPTOR' && on ? `${cfg.count ?? E.count} interceptors` : '';
      return h('tr', {}, h('td', {}, E.name), h('td', {}, on ? h('span', { class: 'chip good' }, 'Available') : h('span', { class: 'chip bad' }, 'Not fielded')), h('td', { class: 'secondary' }, extra || `${E.range} m`));
    });
    const body = h('div', { class: 'brief' },
      h('div', { class: 'row' }, h('span', { class: 'chip info' }, DIFFICULTIES[spec.difficulty]?.name || spec.difficulty), h('span', { class: 'chip' }, spec.kind === 'procedural' ? `Procedural · seed ${spec.seed}` : spec.kind === 'custom' ? 'Custom scenario' : 'Scripted mission'), watching ? h('span', { class: 'chip warn' }, 'Exemplar demonstration') : null),
      h('h2', { style: { marginTop: '10px' } }, spec.name),
      h('p', { class: 'secondary' }, spec.brief),
      h('div', { class: 'grid g2' },
        h('div', { class: 'card' }, h('h4', {}, 'Situation'), h('div', { class: 'kv' },
          h('span', {}, 'Defended asset'), h('b', {}, `${ctx.assetName} (${ASSETS[ctx.assetType]?.name || ctx.assetType})`),
          h('span', {}, 'Terrain'), h('b', {}, TERRAINS[env.terrain].name),
          h('span', {}, 'Light / weather'), h('b', {}, `${TIMES[env.time].name} · ${WEATHERS[env.weather].name}`),
          h('span', {}, 'Enemy EW'), h('b', {}, EW_LEVELS[env.ew || 0].name),
          h('span', {}, 'Vital area / no-fly'), h('b', {}, `${ctx.defendedRadius} m / ${ctx.restrictedRadius} m`),
          h('span', {}, 'Duration'), h('b', {}, fmtTime(spec.duration)),
        )),
        h('div', { class: 'card' }, h('h4', {}, 'Rules of engagement'),
          h('p', {}, h('span', { class: `wcs ${ctx.wcs}` }, WCS[ctx.wcs].name), ' ', WCS[ctx.wcs].desc),
          sim.urban ? h('p', { class: 'secondary' }, 'Collateral constraints: built-up area with civilians present. Minimise kinetic effects.') : null,
          h('p', { class: 'secondary' }, `AI decision aid: ${spec.aiAid?.enabled ? `on. Its nominal reliability is about ${Math.round((spec.aiAid.accuracy || 0.85) * 100)}% and falls further at night, in poor weather and under EW, so verify its suggestions.` : 'off.'}`),
          h('p', { class: 'secondary' }, `RF protocol library: ${spec.sensors?.protocolLibrary ? 'loaded' : 'not available. Read the waterfall yourself.'}`)),
      ),
      h('div', { class: 'grid g2', style: { marginTop: '14px' } },
        h('div', { class: 'card' }, h('h4', {}, 'C-UAS effectors'), h('table', { class: 'tbl' }, h('tbody', {}, effRows))),
        h('div', { class: 'card' }, h('h4', {}, 'Air tasking order (own aircraft)'),
          (ctx.ato || []).length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Callsign', 'Corridor', 'Window', 'Alt'].map((x) => h('th', {}, x)))),
            h('tbody', {}, ctx.ato.map((a) => h('tr', {}, h('td', {}, a.callsign), h('td', {}, `${fmtBearing(a.corridor)}°`), h('td', {}, `T+${fmtTime(a.windowStart)}–${fmtTime(a.windowEnd)}`), h('td', {}, a.alt)))))
            : h('p', { class: 'muted' }, 'No own aircraft are scheduled. Treat any UAV you cannot identify as unknown.'),
          h('h4', { style: { marginTop: '12px' } }, 'Intelligence estimate'),
          h('p', { class: 'secondary' }, `Expected threats (may be incomplete or wrong): ${(spec.intel || []).join(', ') || '—'}.`)),
      ),
      spec.directorNotes?.length ? h('div', { class: 'note director', style: { marginTop: '14px' } }, h('b', {}, 'AI Director: '), spec.directorNotes.join(' ')) : null,
      spec.learning?.length ? h('div', { class: 'note', style: { marginTop: '10px' } }, h('b', {}, 'Learning objectives: '), spec.learning.join(' · ')) : null,
      h('details', { style: { marginTop: '14px' } }, h('summary', { class: 'secondary' }, 'Keyboard controls'),
        h('div', { class: 'keys', style: { marginTop: '8px' } },
          ...[['Tab', 'next track'], ['Space', 'acknowledge / next new'], ['1–9', 'classify platform'], ['H U N F B', 'hostile/suspect/neutral/friend/non-UAS'], ['Q', 'IFF interrogate'], ['A', 'accept AI suggestion'], ['M', 'monitor / hold fire'], ['X', 'dismiss'], ['J', 'RF jam'], ['R', 'jam beam narrow/wide'], ['K', 'GNSS spoof'], ['G', 'gun'], ['I', 'interceptor'], ['L', 'laser'], ['W', 'air sentry warning'], ['V', 'TV / thermal'], ['E', 'EO lock'], ['[ ]', 'zoom'], ['Arrows', 'slew'], ['P', 'pause']]
            .map(([k, d]) => h('div', {}, h('kbd', {}, k), d)))),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn', type: 'button', onclick: () => { close(); app.go('/'); } }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); start(); } }, watching ? 'Start demonstration' : 'Begin mission'),
      ));
    const close = openModal(body, { wide: true, dismissable: false });
  }

  function start() {
    state.running = true;
    state.paused = false;
    renderTop();
  }

  async function finish() {
    state.ended = true;
    state.running = false;
    renderTop();
    let session;
    let saved = null;
    try {
      const rec = buildSessionRecord({ sim, spec, trainee: trainee || { id: null, profile: null }, mode });
      session = rec.session;
      if (!watching) {
        saved = await app.store.saveSession(session);
        session.id = saved.id;
        await app.store.updateTrainee(trainee.id, { profile: rec.profile, history: rec.history });
        await app.refreshTrainee();
      } else {
        session.id = 'last';
      }
      app.lastSession = session;
    } catch (err) {
      console.error(err);
      toast(`Could not save the session: ${err.message}`, 'bad');
    }
    showDebrief(session);
  }

  function showDebrief(session) {
    if (!session) return;
    const s = session.score;
    const again = () => {
      closeAllModals();
      const next = options.next ? options.next() : spec;
      app.startRun(next, mode, options);
    };
    openModal(h('div', {},
      h('h4', {}, watching ? 'Exemplar run complete' : 'Mission complete · ENDEX'),
      h('div', { class: 'hero', style: { margin: '8px 0 12px' } }, h('span', { class: 'figure' }, s.total), h('span', { class: `grade ${s.grade.key}` }, `${s.grade.key} · ${s.grade.name}`)),
      h('p', { class: 'secondary' }, session.coach.headline),
      h('div', { class: 'tiles' },
        tile('Threats defeated', `${s.defeated}/${s.threats}`),
        tile('Vital area', `${s.assetHealth}%`),
        tile('Median detection', s.medianDetection !== null ? `${s.medianDetection} s` : '—'),
        tile('Classification', `${s.classAccuracy}%`),
        tile('Decision quality', s.decision ?? '—'),
        tile('Penalties', `−${s.penaltyTotal}`),
      ),
      h('h3', { style: { marginTop: '16px' } }, 'AI coach: top points'),
      h('ul', { class: 'coach-list' }, session.coach.improvements.slice(0, 3).map((i) => h('li', {}, i.text))),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn', type: 'button', onclick: () => { closeAllModals(); app.go('/'); } }, 'Home'),
        h('button', { class: 'btn', type: 'button', onclick: again }, options.next ? 'New sortie (same settings)' : 'Fly again'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { closeAllModals(); app.go(`/aar/${session.id}`); } }, 'Open full AAR'),
      )), { wide: true, dismissable: false });
  }

  function tile(label, value) {
    return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  let acc = 0;
  let uiTick = 0, vrTick = 0;
  world.renderer.setAnimationLoop((now) => {
    // Allow large frame gaps so the sim keeps real time on low-end laptops (sub-10 fps).
    const dt = Math.min(0.3, (now - last) / 1000);
    last = now;
    if (state.running && !state.paused) {
      acc += dt * state.speed;
      let n = 0;
      while (acc >= SIM_DT && n < 120) {
        sim.step();
        bot?.update();
        acc -= SIM_DT;
        n += 1;
      }
    }
    ppi.camera = { yaw: world.yaw, fov: hfov() };
    world.update(dt, state.running && !state.paused ? acc / SIM_DT : 0);
    drawHud();
    ppi.draw();
    wf.update(state.running && !state.paused ? dt * state.speed : 0);
    uiTick += dt;
    if (uiTick > 0.15) {
      uiTick = 0;
      renderTop();
      renderTable();
      renderCard();
      renderEffectors();
      renderAcoustic();
      renderRfInfo();
    }
    vrTick += dt;
    if (vrTick > 0.3 && world.renderer.xr.isPresenting) {
      vrTick = 0;
      const tr = state.selected && sim.track(state.selected);
      world.drawVrPanel(tr ? {
        title: `${tr.id} · ${tr.op.cls ? TYPES[tr.op.cls].short : 'UNCLASSIFIED'} · ${tr.op.ident || 'UNKNOWN'}`,
        lines: [`RNG ${tr.view.range ? (tr.view.range / 1000).toFixed(2) + ' km' : '—'}  BRG ${tr.view.bearing != null ? fmtBearing(tr.view.bearing) : '—'}  TTI ${isFinite(tr.view.tti) ? Math.round(tr.view.tti) + ' s' : '—'}`,
          `AI: ${tr.ai ? `${TYPES[tr.ai.cls].short} ${Math.round(tr.ai.conf * 100)}%` : '—'}   VA ${Math.round(sim.asset.health)}%   T+${fmtTime(sim.t)}`],
      } : { title: 'POINT AT A DRONE AND PULL TRIGGER', lines: [`Tracks: ${sim.tracks.filter((t) => !t.closed).length}   VA ${Math.round(sim.asset.health)}%`] });
    }
    if (sim.finished && !state.ended) finish();
  });

  // Instructor / debugging hook: skip ahead (the exemplar keeps acting while skipping).
  app.debug = {
    sim,
    skip(seconds) {
      const n = Math.round(seconds / SIM_DT);
      for (let i = 0; i < n && !sim.finished; i++) { sim.step(); bot?.update(); }
    },
  };

  const beforeUnload = (e) => { if (state.running && !state.ended) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  renderTop();
  renderTable();
  renderEffectors();
  if (world.thermal) el.irBtn.classList.add('on');
  showBrief();

  return () => {
    unsub();
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', beforeUnload);
    world.dispose();
    closeAllModals();
    app.pending = null;
    app.debug = null;
  };
}

function brackets(c, x, y, s) {
  const k = s * 0.45;
  c.beginPath();
  c.moveTo(x - s, y - s + k); c.lineTo(x - s, y - s); c.lineTo(x - s + k, y - s);
  c.moveTo(x + s - k, y - s); c.lineTo(x + s, y - s); c.lineTo(x + s, y - s + k);
  c.moveTo(x + s, y + s - k); c.lineTo(x + s, y + s); c.lineTo(x + s - k, y + s);
  c.moveTo(x - s + k, y + s); c.lineTo(x - s, y + s); c.lineTo(x - s, y + s - k);
  c.stroke();
}

// Fine sensor grain: a 128 px noise tile used as a repeating background.
function makeNoise(div) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d');
  const img = c.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  div.style.backgroundImage = `url(${canvas.toDataURL()})`;
}

