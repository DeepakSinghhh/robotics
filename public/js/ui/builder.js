// Instructor Scenario Builder: author scripted scenarios (waves on a map),
// validate them headlessly with the exemplar and an idle operator, then publish
// them to the unit or fly them straight away.

import { h, mount, toast, download } from '../core/dom.js';
import { TYPES, TYPE_KEYS, DIFFICULTIES, TERRAINS, TIMES, WEATHERS, EW_LEVELS, WCS, ASSETS, EFFECTORS, GEOMETRY } from '../sim/catalog.js';
import { MISSIONS, instantiateMission, generateScenario, PROFILES, SPAWN_DEFAULTS, SWARM_TACTICS } from '../sim/scenario.js';
import { Simulation } from '../sim/engine.js';
import { runExemplar } from '../ai/exemplar.js';
import { scoreSession } from '../ai/scoring.js';
import { randomSeed } from '../core/rng.js';
import { polar, DEG, fmtTime } from '../core/math.js';

const IDENTS = ['HOSTILE', 'FRIEND', 'NEUTRAL', 'NON_UAS'];
const ID_COL = { HOSTILE: '#ff5a5a', FRIEND: '#4da6ff', NEUTRAL: '#3ddc84', NON_UAS: '#9aa5b1' };
const CALLSIGNS = ['NETRA-21', 'GARUDA-14', 'HANSA-07', 'DRISHTI-32', 'TAPAS-11'];

function blank() {
  return {
    id: null, kind: 'custom', name: 'New scenario', difficulty: 'OPERATOR', seed: randomSeed(),
    summary: 'Instructor-authored scenario.', learning: [],
    env: { terrain: 'rural', time: 'day', weather: 'clear', ew: 0 },
    context: { assetType: 'FOB', assetName: 'FOB Tiger', wcs: 'FREE', civilianDensity: 0.15, threatAxis: 0, corridor: null, ato: [] },
    effectors: { RF_JAM: true, GNSS_SPOOF: true, GUN: { ammo: 32 }, INTERCEPTOR: { count: 4 }, LASER: true },
    aiAid: { enabled: true, accuracy: 0.85 }, sensors: { protocolLibrary: true, radarPd: 0.95 }, speedMul: 1, duration: 300, popUps: 0,
    waves: [{ t: 10, type: 'QUAD', count: 1, bearing: 45, range: 2200, profile: 'isr', identity: 'HOSTILE' }],
  };
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

export async function render(main, app, id) {
  let custom = [];
  try { custom = await app.store.scenarios(); } catch { /* offline */ }
  let m = id ? clone(custom.find((c) => c.id === id) || blank()) : blank();
  const mapCanvas = h('canvas', { class: 'replay-map', style: { maxHeight: '460px' } });
  const validation = h('div');
  const formHost = h('div');
  const wavesHost = h('div');

  const field = (label, el) => h('label', { class: 'field' }, label, el);
  const select = (opts, val, on) => {
    const s = h('select', { onchange: (e) => { on(e.target.value); refresh(false); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) ? true : null }, l)));
    return s;
  };
  const input = (type, val, on, attrs = {}) => h('input', { type, value: val, ...attrs, onchange: (e) => { on(type === 'number' ? Number(e.target.value) : e.target.value); refresh(false); } });

  const syncAto = () => {
    const friends = m.waves.filter((w) => w.type === 'TACTICAL_UAV');
    friends.forEach((w, i) => { w.identity = 'FRIEND'; w.profile = 'corridor'; w.callsign ||= CALLSIGNS[i % CALLSIGNS.length]; });
    m.context.corridor = friends.length ? { bearing: friends[0].bearing, width: 20 } : null;
    m.context.ato = friends.map((w) => ({ callsign: w.callsign, type: 'TACTICAL_UAV', windowStart: Math.max(0, Math.round(w.t - 10)), windowEnd: Math.round(w.t + 210), alt: '300–600 m', corridor: w.bearing }));
  };

  const renderForm = () => mount(formHost, h('div', { class: 'card' },
    h('div', { class: 'grid g2' },
      field('Scenario name', input('text', m.name, (v) => { m.name = v; })),
      field('Difficulty tier (for adaptive matching)', select(Object.values(DIFFICULTIES).map((d) => [d.key, d.name]), m.difficulty, (v) => { m.difficulty = v; })),
      h('label', { class: 'field', style: { gridColumn: 'span 2' } }, 'Summary / brief', input('text', m.summary, (v) => { m.summary = v; })),
      field('Terrain', select(Object.values(TERRAINS).map((x) => [x.key, x.name]), m.env.terrain, (v) => { m.env.terrain = v; m.context.civilianDensity = TERRAINS[v].civilianDensity; })),
      field('Time of day', select(Object.values(TIMES).map((x) => [x.key, x.name]), m.env.time, (v) => { m.env.time = v; })),
      field('Weather', select(Object.values(WEATHERS).map((x) => [x.key, x.name]), m.env.weather, (v) => { m.env.weather = v; })),
      field('Enemy EW', select(EW_LEVELS.map((x) => [x.level, x.name]), m.env.ew, (v) => { m.env.ew = Number(v); })),
      field('Defended asset', select(Object.values(ASSETS).map((x) => [x.key, x.name]), m.context.assetType, (v) => { m.context.assetType = v; m.context.assetName = ASSETS[v].names[0]; })),
      field('Weapons control status', select(Object.values(WCS).map((x) => [x.key, x.name]), m.context.wcs, (v) => { m.context.wcs = v; })),
      field('AI aid accuracy', input('number', m.aiAid.accuracy, (v) => { m.aiAid.accuracy = Math.max(0.3, Math.min(0.99, v)); }, { step: 0.05, min: 0.3, max: 0.99 })),
      field('Duration (s)', input('number', m.duration, (v) => { m.duration = Math.max(60, Math.min(900, v)); }, { step: 10, min: 60, max: 900 })),
      field('Gun ammunition (bursts)', input('number', m.effectors.GUN ? m.effectors.GUN.ammo : 0, (v) => { m.effectors.GUN = v > 0 ? { ammo: v } : false; }, { min: 0, max: 60 })),
      field('Interceptors', input('number', m.effectors.INTERCEPTOR ? m.effectors.INTERCEPTOR.count : 0, (v) => { m.effectors.INTERCEPTOR = v > 0 ? { count: v } : false; }, { min: 0, max: 10 })),
    ),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      ...['RF_JAM', 'GNSS_SPOOF', 'LASER'].map((k) => h('label', { class: 'row secondary' }, h('input', { type: 'checkbox', checked: !!m.effectors[k], onchange: (e) => { m.effectors[k] = e.target.checked; refresh(false); } }), EFFECTORS[k].short)),
      h('label', { class: 'row secondary' }, h('input', { type: 'checkbox', checked: !!m.sensors.protocolLibrary, onchange: (e) => { m.sensors.protocolLibrary = e.target.checked; } }), 'RF protocol library'),
      h('label', { class: 'row secondary' }, 'AI pop-ups', h('input', { type: 'number', min: 0, max: 4, value: m.popUps, style: { width: '64px' }, onchange: (e) => { m.popUps = Number(e.target.value); } })))));

  const renderWaves = () => {
    const rows = m.waves.map((w, i) => {
      const upd = (k, conv = (v) => v) => (e) => { w[k] = conv(e.target.value); if (k === 'type') { w.profile = SPAWN_DEFAULTS[w.type].profile; w.range = SPAWN_DEFAULTS[w.type].range[0]; w.identity = TYPES[w.type].defaultIdentity; } refresh(); };
      return h('tr', {},
        h('td', {}, h('input', { type: 'number', value: w.t, min: 0, onchange: upd('t', Number) })),
        h('td', {}, h('select', { onchange: upd('type') }, TYPE_KEYS.map((k) => h('option', { value: k, selected: k === w.type ? true : null }, TYPES[k].short)))),
        h('td', {}, h('input', { type: 'number', value: w.count || 1, min: 1, max: 14, onchange: upd('count', Number) })),
        h('td', {}, h('input', { type: 'number', value: w.bearing, min: 0, max: 359, onchange: upd('bearing', Number) })),
        h('td', {}, h('input', { type: 'number', value: w.range, min: 300, max: 6500, step: 100, onchange: upd('range', Number) })),
        h('td', {}, h('select', { onchange: upd('profile') }, Object.keys(PROFILES).map((k) => h('option', { value: k, selected: k === w.profile ? true : null, title: PROFILES[k] }, k)))),
        h('td', {}, h('select', { onchange: upd('identity') }, IDENTS.map((k) => h('option', { value: k, selected: k === w.identity ? true : null }, k)))),
        h('td', {}, h('select', { onchange: (e) => { if (e.target.value) { w.swarm = true; w.tactic = e.target.value; w.mix = { [w.type]: w.count || 5 }; } else { delete w.swarm; delete w.tactic; delete w.mix; } refresh(); } },
          h('option', { value: '' }, '—'), Object.keys(SWARM_TACTICS).map((k) => h('option', { value: k, selected: w.swarm && w.tactic === k ? true : null }, k)))),
        h('td', {}, w.type === 'TACTICAL_UAV' ? h('label', { class: 'row secondary', title: 'Transponder failed' }, h('input', { type: 'checkbox', checked: !!w.iffFail, onchange: (e) => { w.iffFail = e.target.checked; } }), 'IFF fail')
          : w.profile === 'neutral' ? h('label', { class: 'row secondary' }, h('input', { type: 'checkbox', checked: !!w.strays, onchange: (e) => { w.strays = e.target.checked; } }), 'strays') : null),
        h('td', {}, h('button', { class: 'btn sm danger', type: 'button', onclick: () => { m.waves.splice(i, 1); refresh(); } }, '✕')));
    });
    mount(wavesHost, h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Waves'), h('button', { class: 'btn sm', type: 'button', onclick: () => { const last = m.waves[m.waves.length - 1]; m.waves.push({ t: (last?.t || 0) + 30, type: 'FPV', count: 1, bearing: last?.bearing ?? 0, range: 3200, profile: 'lowlevel', identity: 'HOSTILE' }); refresh(); } }, '+ Add wave')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl wave-table' },
        h('thead', {}, h('tr', {}, ['T+ (s)', 'Type', 'Count', 'Bearing°', 'Range m', 'Profile', 'Affiliation', 'Swarm', 'Options', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, rows))),
      h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } }, 'Tactical UAV waves automatically create the friendly corridor and the ATO entries. Swarm tactics: ', Object.entries(SWARM_TACTICS).map(([k, v]) => `${k}: ${v}`).join(' · '), '.')));
  };

  const drawMap = () => {
    const c = mapCanvas.getContext('2d');
    const r = mapCanvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    mapCanvas.width = Math.max(10, r.width * dpr);
    mapCanvas.height = Math.max(10, r.height * dpr);
    const W = mapCanvas.width, H = mapCanvas.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 12 * dpr, k = R / 6500;
    c.fillStyle = '#0a100f'; c.fillRect(0, 0, W, H);
    c.font = `${10 * dpr}px ui-monospace, monospace`;
    for (let rr = 1000; rr <= 6000; rr += 1000) { c.strokeStyle = '#1c2a27'; c.beginPath(); c.arc(cx, cy, rr * k, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#4b5a56'; c.fillText(`${rr / 1000}`, cx + 3, cy - rr * k + 11 * dpr); }
    c.setLineDash([4 * dpr, 4 * dpr]);
    c.strokeStyle = 'rgba(255,179,71,.5)'; c.beginPath(); c.arc(cx, cy, GEOMETRY.restrictedRadius * k, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(255,90,90,.6)'; c.beginPath(); c.arc(cx, cy, GEOMETRY.defendedRadius * k, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    if (m.context.corridor) {
      const b = m.context.corridor.bearing;
      c.fillStyle = 'rgba(77,166,255,.1)'; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, (b - 10 - 90) * DEG, (b + 10 - 90) * DEG); c.closePath(); c.fill();
    }
    for (const w of m.waves) {
      const p = polar(w.bearing, w.range);
      const sx = cx + p.x * k, sy = cy - p.y * k;
      c.strokeStyle = ID_COL[w.identity] || '#888';
      c.fillStyle = ID_COL[w.identity] || '#888';
      c.lineWidth = (w.swarm ? 3 : 1.5) * dpr;
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(cx + p.x * k * 0.12, cy - p.y * k * 0.12); c.stroke();
      c.beginPath(); c.arc(sx, sy, 4 * dpr, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#d8e6e0';
      c.fillText(`T+${w.t} ${TYPES[w.type].short}${(w.count || 1) > 1 ? `×${w.count}` : ''}${w.swarm ? ` ${w.tactic}` : ''}`, sx + 6 * dpr, sy - 6 * dpr);
    }
    c.lineWidth = 1;
  };

  const validate = () => {
    syncAto();
    const spec = instantiateMission(m, { seed: m.seed, randomize: false });
    const ex = scoreSession(runExemplar(new Simulation(spec))).summary;
    const idleSim = new Simulation(spec);
    while (!idleSim.finished) idleSim.step();
    const idle = scoreSession(idleSim).summary;
    mount(validation, h('div', { class: 'card' }, h('h3', {}, 'Headless validation'),
      h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}), h('th', { class: 'num' }, 'Score'), h('th', { class: 'num' }, 'Defeated'), h('th', { class: 'num' }, 'Vital area'), h('th', { class: 'num' }, 'Ends at'))),
        h('tbody', {},
          h('tr', {}, h('td', {}, 'Doctrinal exemplar'), h('td', { class: 'num' }, ex.total), h('td', { class: 'num' }, `${ex.defeated}/${ex.threats}`), h('td', { class: 'num' }, `${ex.assetHealth}%`), h('td', { class: 'num' }, fmtTime(ex.duration))),
          h('tr', {}, h('td', {}, 'Idle operator'), h('td', { class: 'num' }, idle.total), h('td', { class: 'num' }, `${idle.defeated}/${idle.threats}`), h('td', { class: 'num' }, `${idle.assetHealth}%`), h('td', { class: 'num' }, fmtTime(idle.duration))))),
      h('p', { class: 'secondary', style: { marginTop: '8px' } }, ex.total - idle.total < 30
        ? 'The gap between exemplar and idle is small, so the scenario may not discriminate skill. Add threats or tighten timings.'
        : ex.total < 70 ? 'Even the exemplar struggles. This is a stress scenario, which suits the Elite tier.' : 'Well calibrated: doctrine is rewarded and inaction is punished.')));
  };

  const save = async () => {
    syncAto();
    try {
      const saved = await app.store.saveScenario(m);
      m.id = saved.id;
      toast(`Saved "${m.name}" to ${app.store.mode === 'server' ? 'the unit server' : 'this device'}`);
      app.go(`/builder/${saved.id}`);
    } catch (err) {
      toast(`Save failed: ${err.message}`, 'bad');
    }
  };

  const fly = async () => {
    syncAto();
    const tr = await app.requireTrainee();
    if (!tr) return;
    app.startRun(instantiateMission({ ...m, kind: 'custom' }, { seed: randomSeed(), randomize: true }), 'custom', {});
  };

  const fromDirector = () => {
    const spec = generateScenario({ seed: randomSeed(), difficulty: m.difficulty });
    m = { ...clone(spec), id: m.id, kind: 'custom', name: `${m.name === 'New scenario' ? 'Director draft' : m.name}`, summary: spec.brief };
    refresh();
    toast('Draft generated by the AI Director. Edit the waves as needed.');
  };

  const importJson = () => {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', async () => {
      try {
        const obj = JSON.parse(await inp.files[0].text());
        if (!Array.isArray(obj.waves)) throw new Error('missing waves');
        m = { ...blank(), ...obj, id: null };
        refresh();
      } catch (err) { toast(`Import failed: ${err.message}`, 'bad'); }
    });
    inp.click();
  };

  const refresh = (rebuild = true) => {
    syncAto();
    if (rebuild) { renderForm(); renderWaves(); }
    drawMap();
    mount(validation);
  };

  const templates = h('select', { onchange: (e) => {
    const v = e.target.value;
    if (!v) return;
    const src = v.startsWith('c:') ? custom.find((c) => c.id === v.slice(2)) : MISSIONS.find((x) => x.id === v);
    m = { ...clone(src), id: v.startsWith('c:') ? src.id : null, kind: 'custom', name: v.startsWith('c:') ? src.name : `${src.name} (copy)` };
    refresh();
  } }, h('option', { value: '' }, 'Load template…'), MISSIONS.map((x) => h('option', { value: x.id }, x.name)), custom.map((x) => h('option', { value: `c:${x.id}` }, `★ ${x.name}`)));

  mount(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Scenario builder'), h('p', {}, 'Script waves on the map, validate them with the doctrinal exemplar, and publish to the unit. Published scenarios appear under Missions for every trainee.')),
      h('div', { class: 'row' }, templates,
        h('button', { class: 'btn', type: 'button', onclick: () => { m = blank(); refresh(); } }, 'New'),
        h('button', { class: 'btn', type: 'button', onclick: fromDirector }, 'Draft with AI Director'),
        h('button', { class: 'btn', type: 'button', onclick: importJson }, 'Import'),
        h('button', { class: 'btn', type: 'button', onclick: () => download(`${m.name.replace(/\W+/g, '-')}.json`, JSON.stringify(m, null, 2)) }, 'Export'))),
    h('div', { class: 'builder' },
      formHost,
      h('div', {},
        h('div', { class: 'card' }, h('h3', {}, 'Map preview'), mapCanvas,
          h('div', { class: 'row', style: { marginTop: '10px' } },
            h('button', { class: 'btn', type: 'button', onclick: validate }, 'Validate (headless)'),
            h('button', { class: 'btn', type: 'button', onclick: save }, m.id ? 'Save changes' : 'Publish to unit'),
            h('button', { class: 'btn primary', type: 'button', onclick: fly }, 'Fly it'),
            m.id ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { await app.store.deleteScenario(m.id); toast('Deleted'); app.go('/builder'); } }, 'Delete') : null)),
        validation)),
    h('div', { style: { marginTop: '14px' } }, wavesHost)));
  const ro = new ResizeObserver(() => drawMap());
  ro.observe(mapCanvas);
  refresh();
  return () => ro.disconnect();
}
