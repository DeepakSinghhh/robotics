// Unit / detachment dashboard for the commander: readiness, trends, the skill
// heat-map across trainees, roster and CSV export.

import { h, mount, fmtDay, download, toast } from '../core/dom.js';
import { SKILLS, normaliseProfile, certification, overallMastery, weakestSkills, CERT_LEVELS } from '../ai/mastery.js';
import { lineChart, heatmap, sparkline, tile, hBars, rampLegend } from './charts.js';
import { sessionsCsv } from '../core/csv.js';

export async function render(main, app, unitId) {
  const units = await app.store.units();
  if (!units.length) {
    mount(main, h('div', { class: 'page' }, h('div', { class: 'card' }, h('h2', {}, 'No units yet'),
      h('p', { class: 'secondary' }, 'Create a unit when you add a trainee, or run "npm run seed-demo" on the server to load a demonstration detachment.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => app.pickTrainee().then(() => app.go('/unit')) }, 'Add trainee & unit'))));
    return null;
  }
  const unit = units.find((u) => u.id === unitId) || units.find((u) => u.id === app.trainee?.unitId) || units[0];
  const [trainees, sessions] = await Promise.all([app.store.trainees(unit.id), app.store.sessions({ unitId: unit.id })]);
  const flights = sessions.filter((s) => s.mode !== 'drill' && s.mode !== 'exemplar').sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const now = Date.now();
  const last30 = flights.filter((s) => now - new Date(s.startedAt).getTime() < 30 * 86400000);
  const byTrainee = new Map(trainees.map((t) => [t.id, flights.filter((s) => s.traineeId === t.id)]));
  const certs = trainees.map((t) => certification(t.profile));
  const ready = certs.filter((c) => CERT_LEVELS.indexOf(c.level) >= 2).length;
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const det = last30.map((s) => s.score?.medianDetection).filter((v) => v !== null && v !== undefined);

  // Weekly unit average.
  const weeks = new Map();
  for (const s of flights) {
    const d = new Date(s.startedAt);
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    const k = monday.getTime();
    if (!weeks.has(k)) weeks.set(k, []);
    weeks.get(k).push(s.score?.total || 0);
  }
  const weekPts = [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ x: k, y: avg(v), tip: `Week of ${fmtDay(new Date(k).toISOString())} · ${v.length} sorties` }));

  const core = SKILLS.filter((s) => s.group !== 'Classify');
  const cols = [...core.map((s) => ({ key: s.key, label: s.name, short: s.name.split(' ')[0] })), { key: 'RECOG', label: 'Recognition (avg of 9 types)', short: 'Recognition' }];
  const profiles = new Map(trainees.map((t) => [t.id, normaliseProfile(t.profile)]));
  const rowDefs = trainees.map((t) => ({ key: t.id, label: `${t.rank ? `${t.rank} ` : ''}${t.name}` }));
  const cell = (r, c) => {
    const p = profiles.get(r.key);
    if (!p.sessions) return null;
    if (c.key === 'RECOG') {
      const cl = SKILLS.filter((s) => s.group === 'Classify');
      return cl.reduce((a, s) => a + p.skills[s.key].p, 0) / cl.length;
    }
    return p.skills[c.key].p;
  };
  const unitSkill = cols.map((c) => {
    const vals = rowDefs.map((r) => cell(r, c)).filter((v) => v !== null);
    return { key: c.key, label: c.label, value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
  }).sort((a, b) => a.value - b.value);

  const exportCsv = async () => {
    const url = app.store.csvUrl?.({ unitId: unit.id });
    if (url) { window.location.href = url; return; }
    const allT = await app.store.trainees();
    download(`drona-${unit.name.replace(/\W+/g, '-')}.csv`, sessionsCsv(sessions, allT, units), 'text/csv');
    toast('CSV exported');
  };

  const roster = trainees.map((t, i) => {
    const fl = byTrainee.get(t.id) || [];
    const scores = fl.map((s) => s.score?.total || 0);
    const weak = weakestSkills(t.profile, 1)[0];
    return h('tr', { class: 'clickable', onclick: () => app.go(`/trainee/${t.id}`) },
      h('td', {}, `${t.rank ? `${t.rank} ` : ''}${t.name}`),
      h('td', { class: 'num' }, fl.length),
      h('td', { class: 'num' }, scores.length ? scores[scores.length - 1] : '—'),
      h('td', { class: 'num' }, avg(scores.slice(-5)) ?? '—'),
      h('td', {}, sparkline(scores.slice(-10))),
      h('td', { class: 'num' }, Math.round(overallMastery(t.profile) * 100)),
      h('td', {}, h('span', { class: 'chip' }, certs[i].level.name.replace('C-UAS Operator ', ''))),
      h('td', { class: 'secondary' }, profiles.get(t.id).sessions ? `${weak.name} (${Math.round(weak.p * 100)}%)` : '—'));
  });

  mount(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, unit.name), h('p', {}, `${unit.formation || 'C-UAS detachment'} · ${trainees.length} trainees · ${flights.length} sorties recorded`)),
      h('div', { class: 'row' },
        units.length > 1 ? h('select', { onchange: (e) => app.go(`/unit/${e.target.value}`) }, units.map((u) => h('option', { value: u.id, selected: u.id === unit.id ? true : null }, u.name))) : null,
        h('button', { class: 'btn', type: 'button', onclick: exportCsv }, 'Export CSV'),
        h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print'))),
    h('div', { class: 'tiles' },
      tile('Operational readiness', `${trainees.length ? Math.round((ready / trainees.length) * 100) : 0}%`, `${ready}/${trainees.length} qualified Grade II or higher`),
      tile('Sorties (30 days)', last30.length, `${flights.length} total`),
      tile('Average score (30 days)', avg(last30.map((s) => s.score?.total || 0)) ?? '—'),
      tile('Median detection (30 days)', det.length ? `${det.sort((a, b) => a - b)[Math.floor(det.length / 2)]} s` : '—'),
      tile('Threats defeated (30 days)', (() => { const th = last30.reduce((a, s) => a + (s.score?.threats || 0), 0); const d = last30.reduce((a, s) => a + (s.score?.defeated || 0), 0); return th ? `${Math.round((d / th) * 100)}%` : '—'; })()),
      tile('Fratricide incidents', flights.reduce((a, s) => a + (s.score?.stats?.fratricide || 0), 0), 'all time')),
    h('div', { class: 'grid g2', style: { marginTop: '14px' } },
      h('div', { class: 'card' }, h('h3', {}, 'Unit average score by week'),
        lineChart(weekPts, { xFmt: (x) => fmtDay(new Date(x).toISOString()), ref: { y: 65, label: 'Qualified (65)' } })),
      h('div', { class: 'card' }, h('h3', {}, 'Weakest unit skills: training priorities'),
        hBars(unitSkill.slice(0, 6).map((s) => ({ label: s.label, value: Math.round(s.value * 100) })), { max: 100, fmt: (v) => `${v}%` }),
        h('div', { class: 'note director', style: { marginTop: '12px' } }, h('b', {}, 'Recommendation: '),
          `Schedule detachment training on ${unitSkill.slice(0, 2).map((s) => s.label.toLowerCase()).join(' and ')}. The AI Director already biases each trainee's adaptive sorties towards their own gaps.`))),
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'card-head' }, h('h3', {}, 'Skill heat-map (mastery by trainee)'), rampLegend('0%', '100%')),
      rowDefs.length ? heatmap(rowDefs, cols, cell, { rowClick: (r) => app.go(`/trainee/${r.key}`), tip: (r, c, v) => `${r.label} · ${c.label}: ${Math.round(v * 100)}%` }) : h('p', { class: 'muted' }, 'No trainees in this unit.')),
    h('div', { class: 'card', style: { marginTop: '14px' } },
      h('h3', {}, 'Roster'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Trainee', 'Sorties', 'Last', 'Avg (5)', 'Trend', 'Mastery', 'Qualification', 'Weakest skill'].map((x, i) => h('th', { class: [1, 2, 3, 5].includes(i) ? 'num' : '' }, x)))),
        h('tbody', {}, roster)))),
  ));
  return null;
}
