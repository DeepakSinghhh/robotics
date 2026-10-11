import { h, mount, fmtDate } from '../core/dom.js';
import { certification, weakestSkills, overallMastery, CERT_LEVELS } from '../ai/mastery.js';
import { adaptiveOptions, buildSortie } from '../ai/director.js';
import { MISSIONS, instantiateMission } from '../sim/scenario.js';
import { randomSeed } from '../core/rng.js';
import { DIFFICULTIES } from '../sim/catalog.js';

export async function render(main, app) {
  const t = app.trainee;
  const recent = t ? await app.store.sessions({ traineeId: t.id, limit: 6 }) : await app.store.sessions({ limit: 6 });

  const startAdaptive = async () => {
    const tr = await app.requireTrainee();
    if (!tr) return;
    const next = () => buildSortie({ profile: app.trainee.profile, adaptive: true, seed: randomSeed(), history: app.trainee.history || [] });
    app.startRun(next(), 'sortie', { next });
  };
  const watchExemplar = () => {
    const m = MISSIONS[Math.floor(Math.random() * MISSIONS.length)];
    app.startRun(instantiateMission(m, { seed: randomSeed() }), 'exemplar', { next: () => instantiateMission(MISSIONS[Math.floor(Math.random() * MISSIONS.length)], { seed: randomSeed() }) });
  };

  const mode = (ico, title, desc, onclick, featured = false) => h('button', { class: `mode${featured ? ' featured' : ''}`, type: 'button', onclick }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), h('b', {}, title), h('span', {}, desc));

  let traineeCard;
  if (t) {
    const cert = certification(t.profile);
    const m = overallMastery(t.profile);
    const weak = weakestSkills(t.profile, 3);
    const a = adaptiveOptions(t.profile);
    traineeCard = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, `${t.rank ? `${t.rank} ` : ''}${t.name}`), h('button', { class: 'btn sm', type: 'button', onclick: () => app.pickTrainee().then(() => app.go('/')) }, 'Switch')),
      h('div', { class: 'hero' }, h('span', { class: 'figure' }, `${Math.round(m * 100)}`), h('span', { class: 'secondary' }, 'overall mastery')),
      h('p', { style: { marginTop: '8px' } }, h('span', { class: 'chip info' }, cert.level.name), ' ', cert.next ? h('span', { class: 'muted' }, `Next: ${cert.next.name} (needs ${Math.round(cert.next.min * 100)}% and ${cert.next.minSessions} sorties)`) : null),
      h('div', { class: 'meter', title: 'Progress to next qualification' }, h('i', { style: { width: `${Math.min(100, (m / (cert.next?.min || 1)) * 100)}%` } })),
      h('h4', { style: { marginTop: '14px' } }, 'Focus areas'),
      h('ul', { class: 'coach-list' }, weak.map((w) => h('li', {}, `${w.name}: ${Math.round(w.p * 100)}%`))),
      h('h4', { style: { marginTop: '10px' } }, 'Next adaptive sortie'),
      h('p', { class: 'secondary', style: { fontSize: '13px' } }, `${DIFFICULTIES[a.difficulty].name} tier. ${a.notes.slice(1, 3).join(' ') || a.notes[0]}`),
    );
  } else {
    traineeCard = h('div', { class: 'card' },
      h('h3', {}, 'Welcome to DRONA'),
      h('p', { class: 'secondary' }, 'Select or create a trainee. Each sortie is scored and recorded, and the AI Director adapts the next one to your weak areas.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => app.pickTrainee().then(() => app.go('/')) }, 'Select trainee'),
    );
  }

  mount(main, h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, 'Counter-drone operator training'),
        h('p', {}, 'Detect, track, identify and defeat drone and swarm threats across day, night, urban and rural scenarios with degraded sensors. Every decision is scored against a doctrinal decision tree.'))),
    h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' } },
      h('div', {},
        h('div', { class: 'mode-grid' },
          mode('◎', 'Adaptive sortie', 'The AI Director builds a new procedural scenario aimed at your weakest skills.', startAdaptive, true),
          mode('⚙', 'Custom sortie', 'Choose difficulty, terrain, time, weather, EW and ROE, or let the generator randomise them.', () => app.go('/sortie')),
          mode('▤', 'Scripted missions', '8 doctrinal vignettes, from first contact to swarm assault. Timings are randomised against rote learning.', () => app.go('/missions')),
          mode('◉', 'Recognition drill', 'Rapid flash-ID of drones by silhouette, thermal image and sound. Many repetitions in minutes.', () => app.go('/drill')),
          mode('✦', 'Watch the exemplar', 'A doctrine-driven AI operator flies a mission so you can watch a model run.', watchExemplar),
          mode('☰', 'Threat library', 'Interactive 3D recognition guide, signatures, effector vulnerability and the decision tree.', () => app.go('/library')),
          mode('▦', 'My AAR & progress', 'Session replays, decision-path analysis, skill mastery and qualification progress.', () => app.go('/progress')),
          mode('▣', 'Unit dashboard', 'Detachment readiness, skill heat-map, trends and CSV export for the commander.', () => app.go('/unit')),
          mode('✎', 'Scenario builder', 'Instructors script their own waves on a map, check them with the exemplar and publish them to the unit.', () => app.go('/builder')),
        ),
      ),
      h('div', {},
        traineeCard,
        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', {}, t ? 'Your recent sessions' : 'Recent sessions'), h('a', { href: '#/progress' }, 'All')),
          recent.length ? h('table', { class: 'tbl' }, h('tbody', {}, recent.map((s) => h('tr', { class: 'clickable', onclick: () => app.go(`/aar/${s.id}`) },
            h('td', {}, h('div', {}, s.scenarioName), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${fmtDate(s.startedAt)} · ${DIFFICULTIES[s.difficulty]?.name || s.mode}`)),
            h('td', { class: 'num' }, h('span', { class: `grade ${s.score?.grade?.key}` }, s.score?.total ?? '—')),
          )))) : h('p', { class: 'muted' }, 'No sessions yet. Fly your first sortie.'),
        ),
        h('div', { class: 'card' },
          h('h4', {}, 'Qualification ladder'),
          h('table', { class: 'tbl' }, h('tbody', {}, CERT_LEVELS.slice(1).map((c) => h('tr', {}, h('td', {}, c.name), h('td', { class: 'num muted' }, `≥${Math.round(c.min * 100)}% · ${c.minSessions}+ sorties`))))),
        ),
      ),
    ),
  ));
  return null;
}
