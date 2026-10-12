// DRONA application shell: storage, trainee session, hash router.

import { createStore } from './core/store.js';
import { h, mount, openModal, toast, clear } from './core/dom.js';
import { certification } from './ai/mastery.js';

const ROUTES = [
  { re: /^\/?$/, view: () => import('./ui/home.js'), nav: 'home' },
  { re: /^\/sortie$/, view: () => import('./ui/setup.js'), nav: 'sortie', fn: 'renderSortie' },
  { re: /^\/missions$/, view: () => import('./ui/setup.js'), nav: 'missions', fn: 'renderMissions' },
  { re: /^\/run$/, view: () => import('./ui/console.js'), nav: null, fullscreen: true },
  { re: /^\/aar\/([\w-]+)$/, view: () => import('./ui/aar.js'), nav: 'progress' },
  { re: /^\/progress$/, view: () => import('./ui/trainee.js'), nav: 'progress' },
  { re: /^\/trainee\/([\w-]+)$/, view: () => import('./ui/trainee.js'), nav: 'progress' },
  { re: /^\/unit$/, view: () => import('./ui/unit.js'), nav: 'unit' },
  { re: /^\/unit\/([\w-]+)$/, view: () => import('./ui/unit.js'), nav: 'unit' },
  { re: /^\/drill$/, view: () => import('./ui/drill.js'), nav: 'drill' },
  { re: /^\/library$/, view: () => import('./ui/library.js'), nav: 'library' },
  { re: /^\/builder$/, view: () => import('./ui/builder.js'), nav: 'builder' },
  { re: /^\/builder\/([\w-]+)$/, view: () => import('./ui/builder.js'), nav: 'builder' },
];

const app = {
  store: null,
  trainee: null,
  pending: null, // { spec, mode, options } for the console
  lastSession: null,
  cleanup: null,

  go(path) {
    if (location.hash === `#${path}`) route();
    else location.hash = path;
  },

  async setTrainee(t) {
    this.trainee = t;
    try { localStorage.setItem('drona.currentTrainee', t ? t.id : ''); } catch { /* ignore */ }
    renderChip();
  },

  async refreshTrainee() {
    if (!this.trainee) return null;
    const t = await this.store.trainee(this.trainee.id);
    if (t) this.trainee = t;
    renderChip();
    return this.trainee;
  },

  async requireTrainee() {
    if (this.trainee) return this.trainee;
    return pickTrainee();
  },

  pickTrainee: () => pickTrainee(),

  // Populate an empty deployment with a simulated demo unit (runs the real
  // engine in the browser, so it works on static hosting such as GitHub Pages).
  async loadDemo() {
    const { seedDemo, DEMO_TRAINEES } = await import('./ai/demo.js');
    const local = this.store.mode === 'local';
    const defs = local ? DEMO_TRAINEES.filter((_, i) => [0, 1, 2, 4, 5, 6].includes(i)) : DEMO_TRAINEES;
    const bar = h('i', { style: { width: '0%' } });
    const label = h('p', { class: 'secondary' }, 'Simulating sorties…');
    const close = openModal(h('div', {},
      h('h2', {}, 'Loading demo unit'),
      h('p', { class: 'secondary' }, 'Simulated trainees with different skill levels fly sorties through the real engine, scoring and AI coach. This takes a few seconds.'),
      h('div', { class: 'meter' }, bar), label), { dismissable: false });
    try {
      const res = await seedDemo(this.store, {
        trainees: defs, perTrainee: local ? 4 : 6, lean: local, yieldToUi: true,
        onProgress: (d, t) => { bar.style.width = `${Math.round((d / t) * 100)}%`; label.textContent = `Simulated ${d} of ${t} sorties`; },
      });
      close();
      await this.setTrainee(res.trainees[0]);
      toast(`Demo unit loaded: ${res.sessions} sorties for ${res.trainees.length} trainees`);
      this.go('/unit');
    } catch (err) {
      close();
      toast(`Demo load failed: ${err.message}`, 'bad');
    }
  },

  startRun(spec, mode = 'sortie', options = {}) {
    this.pending = { spec, mode, options };
    this.go('/run');
  },
};
window.DRONA = app;

function renderChip() {
  const chip = document.getElementById('trainee-chip');
  if (!app.trainee) {
    chip.textContent = 'Select trainee';
    return;
  }
  const cert = certification(app.trainee.profile);
  chip.textContent = `${app.trainee.rank ? `${app.trainee.rank} ` : ''}${app.trainee.name} · ${cert.level.key === 'UNQ' ? 'Unqualified' : cert.level.name.replace('C-UAS Operator ', '')}`;
}

async function pickTrainee() {
  return new Promise((resolve) => {
    let resolved = false;
    const body = h('div');
    const done = (t) => {
      resolved = true;
      app.setTrainee(t);
      close();
      resolve(t);
    };
    const close = openModal(body, { onClose: () => { if (!resolved) resolve(app.trainee); } });
    (async () => {
      const [units, trainees] = await Promise.all([app.store.units(), app.store.trainees()]);
      const unitSel = h('select', {}, h('option', { value: '' }, '— no unit —'), units.map((u) => h('option', { value: u.id }, u.name)));
      const nameIn = h('input', { type: 'text', placeholder: 'Name', required: true });
      const rankIn = h('select', {}, ['', 'Sep', 'L/Nk', 'Nk', 'Hav', 'Nb Sub', 'Sub', 'Lt', 'Capt', 'Maj', 'Lt Col', 'Flt Lt', 'Sqn Ldr', 'Lt (N)'].map((r) => h('option', { value: r }, r || 'Rank')));
      const svcIn = h('input', { type: 'text', placeholder: 'Service no. (optional)' });
      const newUnit = h('input', { type: 'text', placeholder: 'New unit / detachment name' });
      const byUnit = {};
      for (const t of trainees) (byUnit[t.unitId || ''] ||= []).push(t);
      const unitName = Object.fromEntries(units.map((u) => [u.id, u.name]));
      mount(body,
        h('h2', {}, 'Select trainee'),
        h('p', { class: 'muted' }, `Storage: ${app.store.mode === 'server' ? 'DRONA unit server (shared across the LAN)' : 'this device only (offline mode)'}.`),
        trainees.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Trainee'), h('th', {}, 'Unit'), h('th', {}, 'Qualification'), h('th', {}))),
          h('tbody', {}, Object.entries(byUnit).flatMap(([uid, list]) => list.map((t) => h('tr', { class: 'clickable', onclick: () => done(t) },
            h('td', {}, `${t.rank ? `${t.rank} ` : ''}${t.name}`),
            h('td', { class: 'secondary' }, unitName[uid] || '—'),
            h('td', { class: 'secondary' }, certification(t.profile).level.name),
            h('td', {}, h('button', { class: 'btn sm', type: 'button' }, 'Select')),
          )))),
        )) : h('p', { class: 'muted' }, 'No trainees yet. Create one below.'),
        h('h3', { style: { marginTop: '18px' } }, 'New trainee'),
        h('form', {
          class: 'grid g4',
          onsubmit: async (e) => {
            e.preventDefault();
            if (!nameIn.value.trim()) return;
            let unitId = unitSel.value || null;
            if (newUnit.value.trim()) unitId = (await app.store.createUnit({ name: newUnit.value.trim() })).id;
            const t = await app.store.createTrainee({ name: nameIn.value.trim(), rank: rankIn.value, serviceNo: svcIn.value.trim(), unitId });
            toast(`Trainee ${t.name} created`);
            done(t);
          },
        },
        h('label', { class: 'field' }, 'Rank', rankIn),
        h('label', { class: 'field' }, 'Name', nameIn),
        h('label', { class: 'field' }, 'Service no.', svcIn),
        h('label', { class: 'field' }, 'Unit', unitSel),
        h('label', { class: 'field', style: { gridColumn: 'span 3' } }, 'or create a new unit', newUnit),
        h('div', { class: 'field', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn primary', type: 'submit' }, 'Create & select')),
        ),
      );
    })();
  });
}

async function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  const r = ROUTES.find((x) => x.re.test(path)) || ROUTES[0];
  const params = path.match(r.re).slice(1);
  if (app.cleanup) {
    try { app.cleanup(); } catch (e) { console.error(e); }
    app.cleanup = null;
  }
  document.body.classList.toggle('in-sim', !!r.fullscreen);
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('active', a.dataset.nav === r.nav);
  const main = document.getElementById('app');
  clear(main);
  try {
    const mod = await r.view();
    const fn = mod[r.fn || 'render'];
    app.cleanup = (await fn(main, app, ...params)) || null;
  } catch (err) {
    console.error(err);
    mount(main, h('div', { class: 'page' }, h('div', { class: 'card' }, h('h2', {}, 'Something went wrong'), h('pre', { class: 'mono muted' }, String(err?.stack || err)))));
  }
  main.focus({ preventScroll: true });
}

async function boot() {
  app.store = await createStore();
  const conn = document.getElementById('conn');
  conn.textContent = app.store.mode === 'server' ? '● UNIT SERVER' : '● OFFLINE (device)';
  conn.classList.toggle('server', app.store.mode === 'server');
  conn.title = app.store.mode === 'server' ? 'Connected to the DRONA unit server. Results are shared with the unit.' : 'No server found. Results are stored on this device.';
  document.getElementById('trainee-chip').addEventListener('click', () => pickTrainee());
  try {
    const id = localStorage.getItem('drona.currentTrainee');
    if (id) app.trainee = await app.store.trainee(id);
  } catch { /* ignore */ }
  renderChip();
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
