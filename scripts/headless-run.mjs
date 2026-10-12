#!/usr/bin/env node
// Headless batch runner: plays every scripted mission plus procedural sorties at
// each tier with the doctrinal exemplar and with an idle operator, then prints a
// calibration table. Useful for checking scoring after doctrine or engine changes.
//
//   node scripts/headless-run.mjs [--seeds 3]

import { Simulation } from '../public/js/sim/engine.js';
import { MISSIONS, instantiateMission, generateScenario } from '../public/js/sim/scenario.js';
import { DIFFICULTY_KEYS } from '../public/js/sim/catalog.js';
import { runExemplar } from '../public/js/ai/exemplar.js';
import { scoreSession } from '../public/js/ai/scoring.js';

const i = process.argv.indexOf('--seeds');
const seeds = i > 0 ? Number(process.argv[i + 1]) : 3;

function idle(spec) {
  const sim = new Simulation(spec);
  while (!sim.finished) sim.step();
  return scoreSession(sim).summary;
}

const rows = [];
for (const m of MISSIONS) {
  const spec = instantiateMission(m);
  const ex = scoreSession(runExemplar(new Simulation(spec))).summary;
  rows.push([m.name.split('—')[0].trim(), m.difficulty, ex.total, idle(spec).total, `${ex.defeated}/${ex.threats}`]);
}
for (const d of DIFFICULTY_KEYS) {
  const ex = [], id = [];
  for (let s = 1; s <= seeds; s++) {
    const spec = generateScenario({ seed: s * 97, difficulty: d });
    ex.push(scoreSession(runExemplar(new Simulation(spec))).summary.total);
    id.push(idle(spec).total);
  }
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  rows.push([`Procedural ×${seeds}`, d, avg(ex), avg(id), '']);
}
console.log('\nScenario                     Tier       Exemplar  Idle   Defeated');
for (const r of rows) console.log(`${r[0].padEnd(28)} ${r[1].padEnd(10)} ${String(r[2]).padStart(8)} ${String(r[3]).padStart(5)}   ${r[4]}`);
