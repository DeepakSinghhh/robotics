import { h, mount } from '../core/dom.js';
import { DIFFICULTIES, TERRAINS, TIMES, WEATHERS, EW_LEVELS, WCS, ASSETS, TYPES } from '../sim/catalog.js';
import { MISSIONS, instantiateMission, expandWaves } from '../sim/scenario.js';
import { buildSortie, adaptiveOptions } from '../ai/director.js';
import { randomSeed } from '../core/rng.js';
import { fmtTime } from '../core/math.js';

const sel = (options, value) => h('select', {}, options.map(([v, label]) => h('option', { value: v, selected: v === value ? true : null }, label)));

export async function renderSortie(main, app) {
  const t = app.trainee;
  const f = {
    adaptive: h('select', {}, h('option', { value: '1' }, 'Adaptive (AI Director)'), h('option', { value: '0' }, 'Fixed difficulty tier')),
    difficulty: sel(Object.values(DIFFICULTIES).map((d) => [d.key, d.name]), 'OPERATOR'),
    terrain: sel([['', 'Director decides'], ...Object.values(TERRAINS).map((x) => [x.key, x.name])], ''),
    time: sel([['', 'Director decides'], ...Object.values(TIMES).map((x) => [x.key, x.name])], ''),
    weather: sel([['', 'Director decides'], ...Object.values(WEATHERS).map((x) => [x.key, x.name])], ''),
    ew: sel([['', 'Director decides'], ...EW_LEVELS.map((x) => [String(x.level), x.name])], ''),
    wcs: sel([['', 'Director decides'], ...Object.values(WCS).map((x) => [x.key, x.name])], ''),
    asset: sel([['', 'Director decides'], ...Object.values(ASSETS).map((x) => [x.key, x.name])], ''),
    seed: h('input', { type: 'number', value: randomSeed() }),
  };
  const preview = h('div');

  const build = () => {
    const overrides = {};
    for (const k of ['terrain', 'time', 'weather', 'wcs']) if (f[k].value) overrides[k] = f[k].value;
    if (f.ew.value !== '') overrides.ew = Number(f.ew.value);
    if (f.asset.value) overrides.assetType = f.asset.value;
    return {
      opts: { profile: app.trainee?.profile, adaptive: f.adaptive.value === '1', difficulty: f.difficulty.value, overrides, history: app.trainee?.history || [] },
      overrides,
    };
  };

  const renderPreview = () => {
    const { opts } = build();
    const spec = buildSortie({ ...opts, seed: Number(f.seed.value) || 1 });
    const orders = expandWaves(spec);
    const counts = {};
    for (const o of orders) counts[o.type] = (counts[o.type] || 0) + 1;
    f.difficulty.disabled = f.adaptive.value === '1';
    mount(preview,
      h('div', { class: 'card' },
        h('h3', {}, 'Generated scenario preview'),
        h('p', { class: 'secondary' }, spec.brief),
        h('div', { class: 'row' },
          h('span', { class: 'chip info' }, DIFFICULTIES[spec.difficulty].name),
          h('span', { class: 'chip' }, TERRAINS[spec.env.terrain].name),
          h('span', { class: 'chip' }, TIMES[spec.env.time].name),
          h('span', { class: 'chip' }, WEATHERS[spec.env.weather].name),
          h('span', { class: 'chip' }, EW_LEVELS[spec.env.ew].name),
          h('span', { class: `wcs ${spec.context.wcs}` }, WCS[spec.context.wcs].name),
          h('span', { class: 'chip' }, `${fmtTime(spec.duration)} max`),
        ),
        h('p', { class: 'muted', style: { marginTop: '10px', fontSize: '13px' } }, 'The full threat composition stays hidden until the AAR, as in a real operation. The brief gives you an intelligence estimate.'),
        h('p', { class: 'secondary', style: { fontSize: '13px' } }, `Contacts expected: about ${orders.length} (${Object.keys(counts).length} kinds). Fingerprint ${spec.fingerprint}${(app.trainee?.history || []).includes(spec.fingerprint) ? ' (seen before)' : ' (new to you)'}.`),
        spec.directorNotes.length ? h('div', { class: 'note director' }, h('b', {}, 'AI Director: '), spec.directorNotes.join(' ')) : null,
      ));
  };

  for (const el of Object.values(f)) el.addEventListener('change', renderPreview);

  const go = async () => {
    const tr = await app.requireTrainee();
    if (!tr) return;
    const { opts } = build();
    const spec = buildSortie({ ...opts, profile: app.trainee.profile, history: app.trainee.history || [], seed: Number(f.seed.value) || randomSeed() });
    const next = () => buildSortie({ ...opts, profile: app.trainee.profile, history: app.trainee.history || [], seed: randomSeed() });
    app.startRun(spec, 'sortie', { next });
  };

  const adaptiveNote = t ? adaptiveOptions(t.profile).notes.join(' ') : 'Select a trainee so the Director can use their history.';
  mount(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Custom sortie'), h('p', {}, 'Procedural generation from a seed: the same seed gives the same sortie, and a new seed gives a new one. The Director re-rolls anything that matches a sortie you have already flown.'))),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' },
        h('div', { class: 'grid g2' },
          h('label', { class: 'field' }, 'Mode', f.adaptive),
          h('label', { class: 'field' }, 'Difficulty tier', f.difficulty),
          h('label', { class: 'field' }, 'Terrain', f.terrain),
          h('label', { class: 'field' }, 'Time of day', f.time),
          h('label', { class: 'field' }, 'Weather', f.weather),
          h('label', { class: 'field' }, 'Enemy EW / sensor degradation', f.ew),
          h('label', { class: 'field' }, 'Weapons control status', f.wcs),
          h('label', { class: 'field' }, 'Defended asset', f.asset),
          h('label', { class: 'field' }, 'Seed', h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, f.seed, h('button', { class: 'btn', type: 'button', title: 'New random seed', onclick: () => { f.seed.value = randomSeed(); renderPreview(); } }, '🎲'))),
        ),
        h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '12px' } }, adaptiveNote),
        h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn primary', type: 'button', onclick: go }, 'Generate & brief')),
      ),
      preview,
    ),
  ));
  renderPreview();
  return null;
}

export async function renderMissions(main, app) {
  let custom = [];
  try { custom = await app.store.scenarios(); } catch { /* offline */ }
  const randomize = h('input', { type: 'checkbox', checked: true });
  const launch = async (m) => {
    const tr = await app.requireTrainee();
    if (!tr) return;
    const seed = randomize.checked ? randomSeed() : m.seed;
    const spec = instantiateMission(m, { seed, randomize: randomize.checked });
    app.startRun(spec, m.kind === 'custom' ? 'custom' : 'mission', { next: () => instantiateMission(m, { seed: randomSeed(), randomize: true }) });
  };
  const watch = (m) => app.startRun(instantiateMission(m, { seed: randomSeed() }), 'exemplar', {});
  const card = (m) => {
    const types = [...new Set(m.waves.flatMap((w) => (w.mix ? Object.keys(w.mix) : [w.type])))];
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, h('span', { class: 'chip info' }, DIFFICULTIES[m.difficulty]?.name || m.difficulty), h('span', { class: `wcs ${m.context.wcs}` }, WCS[m.context.wcs].name),
        h('span', { class: 'chip' }, `${TERRAINS[m.env.terrain].name} · ${TIMES[m.env.time].name} · ${WEATHERS[m.env.weather].name}${m.env.ew ? ` · EW-${m.env.ew}` : ''}`), m.kind === 'custom' ? h('span', { class: 'chip warn' }, 'Custom') : null),
      h('h3', { style: { marginTop: '10px' } }, m.name),
      h('p', { class: 'secondary' }, m.summary || m.brief || ''),
      m.learning?.length ? h('ul', { class: 'coach-list secondary', style: { fontSize: '13px' } }, m.learning.map((l) => h('li', {}, l))) : null,
      h('p', { class: 'muted', style: { fontSize: '12px' } }, `Threat classes: ${types.length} · ${fmtTime(m.duration)} max${m.kind === 'custom' ? '' : ` · ${types.map((k) => TYPES[k].short).join(', ')}`}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => launch(m) }, 'Brief & fly'),
        h('button', { class: 'btn', type: 'button', onclick: () => watch(m) }, 'Watch exemplar'),
        m.kind === 'custom' ? h('a', { class: 'btn ghost', href: `#/builder/${m.id}` }, 'Edit') : null),
    );
  };
  mount(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Scripted missions'), h('p', {}, 'Doctrinal vignettes covering the full problem: night bombers, masked FPV ambushes, urban VIP defence, LM saturation with decoys, swarm assault, IFF drills and degraded sensors.')),
      h('label', { class: 'row secondary' }, randomize, 'Randomise timings & axes (anti-rote)')),
    h('div', { class: 'grid g2' }, MISSIONS.map(card)),
    custom.length ? h('h2', { style: { marginTop: '24px' } }, 'Custom scenarios (instructor-authored)') : null,
    custom.length ? h('div', { class: 'grid g2' }, custom.map((c) => card({ ...c, kind: 'custom' }))) : null,
  ));
  return null;
}
