// Individual progress: mastery, qualification, trends across repeated sessions,
// recognition confusion matrix, root-cause profile and session history.

import { h, mount, fmtDate, fmtDay } from '../core/dom.js';
import { TYPES, TYPE_KEYS, DIFFICULTIES, TERRAINS, TIMES } from '../sim/catalog.js';
import { SKILLS, normaliseProfile, certification, overallMastery, weakestSkills } from '../ai/mastery.js';
import { adaptiveOptions, buildSortie } from '../ai/director.js';
import { ROOT_CAUSES } from '../ai/scoring.js';
import { randomSeed } from '../core/rng.js';
import { lineChart, skillMeters, heatmap, hBars, tile, rampLegend } from './charts.js';

export async function render(main, app, id) {
  let trainee = id ? await app.store.trainee(id) : app.trainee;
  if (!trainee) {
    trainee = await app.requireTrainee();
    if (!trainee) {
      mount(main, h('div', { class: 'page' }, h('div', { class: 'card' }, h('h2', {}, 'No trainee selected'), h('p', { class: 'muted' }, 'Select a trainee to see their progress.'))));
      return null;
    }
  } else if (!id) {
    trainee = (await app.refreshTrainee()) || trainee;
  }
  const units = await app.store.units();
  const unit = units.find((u) => u.id === trainee.unitId);
  const all = (await app.store.sessions({ traineeId: trainee.id })).slice().sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const flights = all.filter((s) => s.mode !== 'drill' && s.mode !== 'exemplar');
  const drills = all.filter((s) => s.mode === 'drill');
  const prof = normaliseProfile(trainee.profile);
  const cert = certification(prof);
  const mastery = overallMastery(prof);

  // Full records of recent sorties for the confusion matrix and root causes.
  const recentFull = (await Promise.all(flights.slice(-12).map((s) => app.store.session(s.id).catch(() => null)))).filter(Boolean);
  const confusion = {};
  for (const s of recentFull) for (const t of s.tracks || []) {
    if (t.phantom || !t.trackId) continue;
    const row = (confusion[t.type] ||= {});
    const col = t.classification.answer || 'NONE';
    row[col] = (row[col] || 0) + 1;
  }
  for (const d of drills) for (const [truth, cols] of Object.entries(d.score?.confusion || {})) {
    const row = (confusion[truth] ||= {});
    for (const [c, n] of Object.entries(cols)) row[c] = (row[c] || 0) + n;
  }
  const causes = {};
  for (const s of flights) for (const [k, v] of Object.entries(s.score?.rootCauses || {})) causes[k] = (causes[k] || 0) + v;

  const last5 = flights.slice(-5);
  const avg = (arr, f) => (arr.length ? Math.round(arr.reduce((a, x) => a + f(x), 0) / arr.length) : null);
  const det = last5.map((s) => s.score?.medianDetection).filter((v) => v !== null && v !== undefined);
  const defeated = flights.reduce((a, s) => a + (s.score?.defeated || 0), 0);
  const threats = flights.reduce((a, s) => a + (s.score?.threats || 0), 0);
  const ai = flights.map((s) => s.score?.aiTeaming).filter((v) => v !== null && v !== undefined);
  const plan = adaptiveOptions(prof);

  const startAdaptive = async () => {
    if (app.trainee?.id !== trainee.id) await app.setTrainee(trainee);
    const next = () => buildSortie({ profile: app.trainee.profile, adaptive: true, seed: randomSeed(), history: app.trainee.history || [] });
    app.startRun(next(), 'sortie', { next });
  };

  const core = SKILLS.filter((s) => s.group !== 'Classify');
  const cls = SKILLS.filter((s) => s.group === 'Classify');
  const cols = [...TYPE_KEYS.map((k) => ({ key: k, label: TYPES[k].name, short: TYPES[k].short })), { key: 'NONE', label: 'Not classified', short: 'none' }];
  const rows = TYPE_KEYS.filter((k) => confusion[k]).map((k) => ({ key: k, label: TYPES[k].name }));

  mount(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, `${trainee.rank ? `${trainee.rank} ` : ''}${trainee.name}`),
        h('p', {}, `${unit ? unit.name : 'No unit'}${trainee.serviceNo ? ` · ${trainee.serviceNo}` : ''} · ${flights.length} sorties · ${drills.length} drills`)),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: startAdaptive }, 'Adaptive sortie'),
        h('a', { class: 'btn', href: '#/drill' }, 'Recognition drill'),
        unit ? h('a', { class: 'btn ghost', href: `#/unit/${unit.id}` }, 'Unit dashboard') : null)),
    h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)' } },
      h('div', { class: 'card' },
        h('h4', {}, 'Overall mastery'),
        h('div', { class: 'hero' }, h('span', { class: 'figure' }, Math.round(mastery * 100)), h('span', { class: 'secondary' }, '/ 100')),
        h('p', { style: { marginTop: '8px' } }, h('span', { class: 'chip info' }, cert.level.name)),
        cert.next ? h('p', { class: 'muted', style: { fontSize: '13px' } }, `Next: ${cert.next.name}. Needs mastery ≥ ${Math.round(cert.next.min * 100)} and ${cert.next.minSessions} sorties (you have ${prof.sessions}).`) : h('p', { class: 'muted' }, 'Highest qualification reached.'),
        h('div', { class: 'meter' }, h('i', { style: { width: `${Math.min(100, (mastery / (cert.next?.min || 1)) * 100)}%` } }))),
      h('div', { class: 'tiles' },
        tile('Sorties flown', flights.length, `${drills.length} recognition drills`),
        tile('Average (last 5)', avg(last5, (s) => s.score?.total || 0) ?? '—', 'mission score'),
        tile('Best score', flights.length ? Math.max(...flights.map((s) => s.score?.total || 0)) : '—'),
        tile('Detection (last 5)', det.length ? `${(det.reduce((a, b) => a + b, 0) / det.length).toFixed(1)} s` : '—', 'median time to acknowledge'),
        tile('Threats defeated', threats ? `${Math.round((defeated / threats) * 100)}%` : '—', `${defeated} of ${threats}`),
        tile('AI teaming', ai.length ? `${Math.round(ai.reduce((a, b) => a + b, 0) / ai.length)}%` : '—', 'appropriate reliance'))),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } },
      h('div', { class: 'card' }, h('h3', {}, 'Mission score over sessions'),
        lineChart(flights.map((s, i) => ({ x: i, y: s.score?.total || 0, id: s.id, label: s.scenarioName, tip: `${fmtDay(s.startedAt)} · ${s.scenarioName} · ${DIFFICULTIES[s.difficulty]?.name || ''}` })),
          { xFmt: (x) => `#${x + 1}`, ref: { y: 65, label: 'Qualified (65)' }, onClick: (p) => app.go(`/aar/${p.id}`) }),
        h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Click a point to open that session\'s AAR. Difficulty rises with mastery, so scores reflect harder sorties over time.')),
      h('div', { class: 'card' }, h('h3', {}, 'Time to acknowledge new threats (s)'),
        (() => {
          const pts = flights.map((s, i) => ({ x: i, y: s.score?.medianDetection, tip: `${fmtDay(s.startedAt)} · ${s.scenarioName}` })).filter((p) => p.y !== null && p.y !== undefined);
          const ymax = Math.max(10, ...pts.map((p) => Math.ceil(p.y / 5) * 5));
          return lineChart(pts, { yMax: ymax, yTicks: [0, ymax / 2, ymax].map(Math.round), xFmt: (x) => `#${x + 1}`, yFmt: (v) => `${Math.round(v * 10) / 10}` });
        })(),
        h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Median latency from a track appearing to you acknowledging it. Lower is better.'))),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } },
      h('div', { class: 'card' }, h('h3', {}, 'Core skill mastery'), skillMeters(core.map((s) => ({ label: s.name, value: prof.skills[s.key].p, note: `${prof.skills[s.key].n} observations` })))),
      h('div', { class: 'card' }, h('h3', {}, 'Recognition mastery by threat type'), skillMeters(cls.map((s) => ({ label: TYPES[s.type].name, value: prof.skills[s.key].p, note: `${prof.skills[s.key].n} observations` }))))),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', {}, 'Recognition confusion matrix'), rampLegend('0%', '100% of row')),
        rows.length ? heatmap(rows, cols, (r, c) => {
          const row = confusion[r.key] || {};
          const tot = Object.values(row).reduce((a, b) => a + b, 0);
          return tot ? (row[c.key] || 0) / tot : null;
        }, { fmt: (v) => (v > 0 ? Math.round(v * 100) : ''), tip: (r, c, v) => `Truth ${r.label}, classified as ${c.label}: ${Math.round(v * 100)}%` }) : h('p', { class: 'muted' }, 'Fly a sortie or a drill to build the matrix.'),
        h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Rows are the true type and columns are your answer. Off-diagonal cells show systematic confusions (for example fiber FPV mistaken for FPV).')),
      h('div', { class: 'card' },
        h('h3', {}, 'Why decisions went wrong'),
        Object.keys(causes).length ? hBars(Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k.replace('_', ' '), value: v }))) : h('p', { class: 'muted' }, 'No decision errors recorded yet.'),
        h('div', { style: { marginTop: '10px' } }, Object.keys(causes).map((k) => h('p', { class: 'muted', style: { fontSize: '12px', margin: '2px 0' } }, `${k.replace('_', ' ')}: ${ROOT_CAUSES[k]}`))),
        h('h4', { style: { marginTop: '14px' } }, 'AI Director plan for the next sortie'),
        h('div', { class: 'note director' }, plan.notes.join(' ')),
        h('h4', { style: { marginTop: '14px' } }, 'Weakest skills'),
        h('ul', { class: 'coach-list' }, weakestSkills(prof, 4).map((w) => h('li', {}, `${w.name}: ${Math.round(w.p * 100)}%`))))),
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('h3', {}, 'Session history'),
      all.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Date', 'Scenario', 'Mode', 'Tier', 'Conditions', 'Defeated', 'Score'].map((x, i) => h('th', { class: i >= 5 ? 'num' : '' }, x)))),
        h('tbody', {}, all.slice().reverse().map((s) => h('tr', { class: s.mode === 'drill' ? '' : 'clickable', onclick: s.mode === 'drill' ? null : () => app.go(`/aar/${s.id}`) },
          h('td', { class: 'secondary' }, fmtDate(s.startedAt)),
          h('td', {}, s.scenarioName),
          h('td', { class: 'secondary' }, s.mode),
          h('td', { class: 'secondary' }, DIFFICULTIES[s.difficulty]?.name || '—'),
          h('td', { class: 'secondary' }, s.env ? `${TERRAINS[s.env.terrain]?.name || ''} · ${TIMES[s.env.time]?.name || ''}` : '—'),
          h('td', { class: 'num' }, s.score?.threats ? `${s.score.defeated}/${s.score.threats}` : '—'),
          h('td', { class: 'num' }, h('span', { class: `grade ${s.score?.grade?.key}` }, s.score?.total ?? '—'))))))) : h('p', { class: 'muted' }, 'No sessions yet.')),
  ));
  return null;
}
