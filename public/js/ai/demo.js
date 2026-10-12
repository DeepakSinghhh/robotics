// Demo unit generator: simulated trainees with different starting skills and
// learning rates fly a series of sorties through the real engine, scoring, coach and
// mastery pipeline. It is shared by the Node seed script / server and by the browser
// ("Load demo unit"), so a fresh deployment can show populated dashboards at once.
//
// `store` is any object with async methods:
//   units(), createUnit(u), trainees(), createTrainee(t), updateTrainee(id, patch), saveSession(s)

import { Simulation } from '../sim/engine.js';
import { MISSIONS, instantiateMission } from '../sim/scenario.js';
import { buildSortie } from './director.js';
import { runTraineeBot } from './exemplar.js';
import { buildSessionRecord } from './session.js';
import { Rng } from '../core/rng.js';

export const DEMO_UNITS = [
  { name: 'Alpha C-UAS Detachment', formation: 'Air Defence Training Battalion' },
  { name: 'Bravo C-UAS Detachment', formation: 'Air Defence Training Battalion' },
];

// base: starting skill, gain: improvement per sortie, ai: trust in the AI aid.
export const DEMO_TRAINEES = [
  { name: 'Arjun Mehta', rank: 'Hav', unit: 0, base: 0.55, gain: 0.04, ai: 0.4 },
  { name: 'Priya Nair', rank: 'Lt', unit: 0, base: 0.68, gain: 0.03, ai: 0.3 },
  { name: 'Ravi Kumar', rank: 'Nk', unit: 0, base: 0.35, gain: 0.06, ai: 0.8 },
  { name: 'Simran Kaur', rank: 'Capt', unit: 0, base: 0.75, gain: 0.02, ai: 0.25 },
  { name: 'Imran Shaikh', rank: 'Sep', unit: 0, base: 0.3, gain: 0.05, ai: 0.7 },
  { name: 'Vikram Rathore', rank: 'Sub', unit: 1, base: 0.6, gain: 0.03, ai: 0.5 },
  { name: 'Ananya Iyer', rank: 'Lt', unit: 1, base: 0.45, gain: 0.05, ai: 0.6 },
  { name: 'Karan Thapa', rank: 'Hav', unit: 1, base: 0.5, gain: 0.04, ai: 0.45 },
];

// opts: { trainees, perTrainee, lean, onProgress, yieldToUi }
// lean = keep the tactical replay only for each trainee's latest sortie (fits browser storage).
export async function seedDemo(store, opts = {}) {
  const { trainees: defs = DEMO_TRAINEES, perTrainee = 8, lean = false, onProgress, yieldToUi = false } = opts;
  const rng = new Rng(2026);
  const existingUnits = await store.units();
  const units = [];
  for (const u of DEMO_UNITS) units.push(existingUnits.find((x) => x.name === u.name) || await store.createUnit(u));
  const existingTrainees = await store.trainees();
  const now = Date.now();
  const total = defs.length * perTrainee;
  let done = 0;
  const created = [];

  for (const [ti, def] of defs.entries()) {
    let trainee = existingTrainees.find((t) => t.name === def.name) || await store.createTrainee({
      name: def.name, rank: def.rank, serviceNo: `JC-${String(400000 + ti * 1337).slice(0, 6)}`, unitId: units[def.unit].id,
    });
    for (let i = 0; i < perTrainee; i++) {
      const lvl = Math.min(0.97, def.base + def.gain * i + rng.gauss(0, 0.04));
      const skill = {
        reaction: Math.max(1, 8 - lvl * 7), clsAcc: lvl, doctrine: Math.min(0.98, lvl + 0.05),
        aiTrust: def.ai, iffDiscipline: lvl, warn: lvl,
      };
      const seed = rng.int(1, 1e6);
      const mission = i % 3 === 2;
      const spec = mission
        ? instantiateMission(MISSIONS[(ti + i) % MISSIONS.length], { seed })
        : buildSortie({ profile: trainee.profile, adaptive: true, seed, history: trainee.history || [] });
      const sim = runTraineeBot(new Simulation(spec), skill, seed);
      const days = (perTrainee - i) * 3 + rng.range(0, 2);
      const startedAt = new Date(now - days * 86400000 - rng.range(0, 8) * 3600000).toISOString();
      const { session, profile, history } = buildSessionRecord({
        sim, spec, trainee, mode: mission ? 'mission' : 'sortie', startedAt, extra: { demo: true },
      });
      if (lean && i < perTrainee - 1) session.replay = { frames: [], meta: session.replay.meta };
      await store.saveSession(session);
      trainee = await store.updateTrainee(trainee.id, { profile, history });
      done += 1;
      onProgress?.(done, total);
      if (yieldToUi) await new Promise((r) => setTimeout(r, 0));
    }
    created.push(trainee);
  }
  return { units, trainees: created, sessions: done };
}

// Adapter for the server's synchronous FileStore.
export function fileStoreAdapter(fs) {
  return {
    units: async () => fs.listUnits(),
    createUnit: async (u) => fs.createUnit(u),
    trainees: async () => fs.listTrainees(),
    createTrainee: async (t) => fs.createTrainee(t),
    updateTrainee: async (id, p) => fs.updateTrainee(id, p),
    saveSession: (s) => fs.saveSession(s),
  };
}
