#!/usr/bin/env node
// Populate the datastore with a realistic demo unit: simulated trainees with
// different starting skills and learning rates fly a series of sorties. This lets the
// AAR, trainee and unit dashboards be demonstrated straight away. It uses the real
// engine, scoring, coach and mastery pipeline end to end.
//
//   node scripts/seed-demo.mjs [--data ./data] [--sessions 8] [--reset]

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FileStore } from '../server/store.js';
import { Simulation } from '../public/js/sim/engine.js';
import { MISSIONS, instantiateMission } from '../public/js/sim/scenario.js';
import { buildSortie } from '../public/js/ai/director.js';
import { runTraineeBot } from '../public/js/ai/exemplar.js';
import { buildSessionRecord } from '../public/js/ai/session.js';
import { Rng } from '../public/js/core/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const dataDir = path.resolve(arg('--data', process.env.DRONA_DATA || path.join(ROOT, 'data')));
const perTrainee = Number(arg('--sessions', 8));
if (process.argv.includes('--reset')) fs.rmSync(dataDir, { recursive: true, force: true });

const store = new FileStore(dataDir);
const rng = new Rng(2026);

const UNITS = [
  { name: 'Alpha C-UAS Detachment', formation: 'Air Defence Training Battalion' },
  { name: 'Bravo C-UAS Detachment', formation: 'Air Defence Training Battalion' },
];

// base: starting skill, gain: improvement per sortie, ai: trust in the AI aid.
const TRAINEES = [
  { name: 'Arjun Mehta', rank: 'Hav', unit: 0, base: 0.55, gain: 0.04, ai: 0.4 },
  { name: 'Priya Nair', rank: 'Lt', unit: 0, base: 0.68, gain: 0.03, ai: 0.3 },
  { name: 'Ravi Kumar', rank: 'Nk', unit: 0, base: 0.35, gain: 0.06, ai: 0.8 },
  { name: 'Simran Kaur', rank: 'Capt', unit: 0, base: 0.75, gain: 0.02, ai: 0.25 },
  { name: 'Imran Shaikh', rank: 'Sep', unit: 0, base: 0.3, gain: 0.05, ai: 0.7 },
  { name: 'Vikram Rathore', rank: 'Sub', unit: 1, base: 0.6, gain: 0.03, ai: 0.5 },
  { name: 'Ananya Iyer', rank: 'Lt', unit: 1, base: 0.45, gain: 0.05, ai: 0.6 },
  { name: 'Karan Thapa', rank: 'Hav', unit: 1, base: 0.5, gain: 0.04, ai: 0.45 },
];

const units = UNITS.map((u) => store.listUnits().find((x) => x.name === u.name) || store.createUnit(u));
const now = Date.now();
let total = 0;

for (const [ti, def] of TRAINEES.entries()) {
  let trainee = store.listTrainees().find((t) => t.name === def.name) || store.createTrainee({
    name: def.name, rank: def.rank, serviceNo: `JC-${String(400000 + ti * 1337).slice(0, 6)}`, unitId: units[def.unit].id,
  });
  for (let i = 0; i < perTrainee; i++) {
    const lvl = Math.min(0.97, def.base + def.gain * i + rng.gauss(0, 0.04));
    const skill = {
      reaction: Math.max(1, 8 - lvl * 7), clsAcc: lvl, doctrine: Math.min(0.98, lvl + 0.05),
      aiTrust: def.ai, iffDiscipline: lvl, warn: lvl,
    };
    const seed = rng.int(1, 1e6);
    let spec;
    let mode;
    if (i % 3 === 2) {
      spec = instantiateMission(MISSIONS[(ti + i) % MISSIONS.length], { seed });
      mode = 'mission';
    } else {
      spec = buildSortie({ profile: trainee.profile, adaptive: true, seed, history: trainee.history || [] });
      mode = 'sortie';
    }
    const sim = runTraineeBot(new Simulation(spec), skill, seed);
    const days = (perTrainee - i) * 3 + rng.range(0, 2);
    const startedAt = new Date(now - days * 86400000 - rng.range(0, 8) * 3600000).toISOString();
    const { session, profile, history } = buildSessionRecord({ sim, spec, trainee, mode, startedAt, extra: { demo: true } });
    await store.saveSession(session);
    trainee = store.updateTrainee(trainee.id, { profile, history });
    total += 1;
    process.stdout.write(`\r  seeded ${total} sessions`);
  }
}
await store.save();
console.log(`\n  Demo data written to ${dataDir}: ${units.length} units, ${TRAINEES.length} trainees.`);
