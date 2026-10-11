// Threat Library: interactive recognition guide (3D turntable, signatures, cues),
// effector vulnerability, effector reference and the doctrinal decision tree.

import { h, mount } from '../core/dom.js';
import { TYPES, TYPE_KEYS, EFFECTORS, IDENTITIES } from '../sim/catalog.js';
import { NODES, LEAVES, evaluate, truthContext, RATINGS } from '../ai/doctrine.js';
import { Turntable } from '../render/turntable.js';
import { playSignature } from '../render/audio.js';
import { treeView } from './treeview.js';
import { hBars } from './charts.js';

export async function render(main) {
  let tt = null;
  let current = 'QUAD';
  let viewMode = { time: 'day', thermal: false };
  const list = h('div', { class: 'lib-list' });
  const body = h('div');

  const nav = () => mount(list,
    h('h4', {}, 'Threats & contacts'),
    TYPE_KEYS.map((k) => h('button', { class: current === k ? 'on' : '', type: 'button', onclick: () => { current = k; show(); } },
      h('span', { class: `sym ${TYPES[k].defaultIdentity}` }), TYPES[k].name)),
    h('h4', { style: { marginTop: '14px' } }, 'Reference'),
    h('button', { class: current === 'EFF' ? 'on' : '', type: 'button', onclick: () => { current = 'EFF'; show(); } }, 'C-UAS effectors'),
    h('button', { class: current === 'TREE' ? 'on' : '', type: 'button', onclick: () => { current = 'TREE'; show(); } }, 'Doctrine decision tree'));

  const show = () => {
    nav();
    if (current === 'EFF') return showEffectors();
    if (current === 'TREE') return showTree();
    const def = TYPES[current];
    const stage = h('div', { class: 'drill-stage' });
    const typical = evaluate(truthContext({
      entity: { type: current, identity: def.defaultIdentity, rfEmitting: def.rf.emits },
      tti: 90, inRestricted: true, wcs: 'FREE', urban: false, weather: 'clear', swarmCount: 1,
    }));
    const opt = Object.entries(typical.ratings).filter(([, r]) => r === 'OPTIMAL').map(([a]) => EFFECTORS[a]?.name || (a === 'MONITOR' ? 'Monitor / hold fire' : 'Dismiss'));
    const modeBtn = (label, m) => h('button', { class: `btn sm${viewMode.time === m.time && viewMode.thermal === m.thermal ? ' primary' : ''}`, type: 'button', onclick: () => { viewMode = m; show(); } }, label);
    mount(body,
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {}, h('h2', { style: { margin: 0 } }, def.name), h('span', { class: 'muted' }, `${def.nato} · default affiliation ${IDENTITIES[def.defaultIdentity].name}`)),
          h('div', { class: 'row' }, modeBtn('Day TV', { time: 'day', thermal: false }), modeBtn('Dusk', { time: 'dusk', thermal: false }), modeBtn('Thermal IR', { time: 'night', thermal: true }),
            def.acoustic ? h('button', { class: 'btn sm', type: 'button', onclick: () => playSignature(current) }, '▶ Acoustic signature') : null)),
        stage,
        h('p', { class: 'secondary', style: { marginTop: '10px' } }, def.role)),
      h('div', { class: 'grid g2', style: { marginTop: '14px' } },
        h('div', { class: 'card' }, h('h3', {}, 'Recognition cues'), h('ul', { class: 'coach-list' }, def.cues.map((c) => h('li', {}, c))),
          h('h4', { style: { marginTop: '12px' } }, 'Signatures'),
          h('table', { class: 'tbl' }, h('tbody', {},
            row('Speed', `${def.speed[0]}–${def.speed[1]} m/s`), row('Typical altitude', `${def.alt[0]}–${def.alt[1]} m AGL`),
            row('Size / RCS', `${def.size} m · ~${def.rcs} m²`),
            row('RF', def.rf.emits ? `${def.rf.bands.map((b) => `${b} GHz`).join(', ')} · ${def.rf.protocol}` : def.rf.protocol),
            row('GNSS dependent', def.gnss ? 'Yes' : 'No'),
            row('Acoustic', def.acoustic ? `f₀ ≈ ${def.acoustic.f0} Hz · ${def.acoustic.character}` : 'None'),
            row('Threat level', `${def.threat}/5 · warhead damage ${def.damage}`)))),
        h('div', { class: 'card' }, h('h3', {}, 'Effector vulnerability (probability of effect)'),
          hBars(Object.values(EFFECTORS).map((E) => ({ label: E.short, value: Math.round((def.vuln[E.key] || 0) * 100) })), { max: 100, fmt: (v) => `${v}%` }),
          h('h4', { style: { marginTop: '14px' } }, 'Doctrine (rural, weapons free, TTI 90 s)'),
          h('p', {}, h('b', {}, typical.leaf.title), ` — ${typical.leaf.guidance}`),
          h('p', { class: 'secondary' }, `Optimal: ${opt.join(', ') || '—'}.`),
          h('div', { class: 'row' }, Object.entries(typical.ratings).map(([a, r]) => h('span', { class: `rating ${r}`, title: RATINGS[r].label }, EFFECTORS[a]?.short || (a === 'MONITOR' ? 'MON' : 'DIS'))))),
      ));
    tt?.dispose();
    tt = new Turntable(stage, { spin: true });
    tt.show(current, { time: viewMode.time, thermal: viewMode.thermal, apparentPx: 230, yaw: 0.8, pitch: 0.25 });
    return null;
  };

  const showEffectors = () => {
    tt?.dispose();
    tt = null;
    mount(body, h('div', { class: 'card' }, h('h2', {}, 'C-UAS effectors'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Effector', 'Kind', 'Range', 'Notes'].map((x) => h('th', {}, x)))),
        h('tbody', {}, Object.values(EFFECTORS).map((E) => h('tr', {}, h('td', {}, h('b', {}, E.name), h('div', { class: 'muted' }, `key ${E.hotkey.toUpperCase()}`)), h('td', {}, E.kind === 'soft' ? 'Soft-kill' : 'Hard-kill'), h('td', { class: 'num' }, `${E.range} m`), h('td', { class: 'secondary' }, E.note))))))),
      h('div', { class: 'card' }, h('h3', {}, 'Passive measures'),
        h('ul', { class: 'coach-list secondary' },
          h('li', {}, 'AIR SENTRY warning (W): troops take cover for 90 s and impact damage drops by about 45%. Issue it as soon as a threat is inside about 40 s TTI.'),
          h('li', {}, 'IFF interrogation (Q): own UAVs answer Mode-5 unless the transponder has failed or EW is heavy. Then cross-check the ATO corridor and time window.'),
          h('li', {}, 'EO lock (E): precise track and better AI recognition; it needs the target within visual or thermal range.'))));
    return null;
  };

  const showTree = () => {
    tt?.dispose();
    tt = null;
    mount(body, h('div', { class: 'card' }, h('h2', {}, 'C-UAS doctrinal decision tree'),
      h('p', { class: 'secondary' }, 'Every decision is scored against this tree twice: on ground truth and on what you reported. When the two paths split, the AAR names the root cause of the error.'),
      treeView({}),
      h('div', { class: 'grid g2', style: { marginTop: '14px' } },
        h('div', {}, h('h3', {}, 'Decision nodes'), h('table', { class: 'tbl' }, h('tbody', {}, Object.values(NODES).map((n) => h('tr', {}, h('td', {}, h('b', {}, n.short)), h('td', { class: 'secondary' }, n.explain)))))),
        h('div', {}, h('h3', {}, 'Outcomes'), h('table', { class: 'tbl' }, h('tbody', {}, Object.values(LEAVES).map((l) => h('tr', {}, h('td', {}, h('b', {}, l.title)), h('td', { class: 'secondary' }, l.guidance))))),
          h('h3', { style: { marginTop: '14px' } }, 'Ratings'),
          h('div', { class: 'row' }, Object.values(RATINGS).map((r) => h('span', { class: `rating ${r.key}` }, `${r.label} (${r.points})`))),
          h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } }, 'Scores are normalised to the best action available at the time, given range, ammunition and cooldowns. Modifiers downgrade jamming and spoofing when own UAVs are in the effect.')))));
    return null;
  };

  mount(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Threat library'), h('p', {}, 'Recognition guide for every contact type in DRONA: 3D models in day and thermal views, acoustic signatures, RF fingerprints, effector vulnerability and doctrine.'))),
    h('div', { class: 'lib' }, h('div', { class: 'card' }, list), body)));
  show();
  return () => tt?.dispose();
}

function row(k, v) {
  return h('tr', {}, h('td', { class: 'secondary' }, k), h('td', {}, v));
}
