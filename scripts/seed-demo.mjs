#!/usr/bin/env node
// Populate the datastore with a realistic demo unit: simulated trainees with
// different starting skills and learning rates fly a series of sorties. This lets the
// AAR, trainee and unit dashboards be demonstrated straight away. Run it while the
// server is stopped (the server keeps its index in memory).
//
//   node scripts/seed-demo.mjs [--data ./data] [--sessions 8] [--reset]

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FileStore } from '../server/store.js';
import { seedDemo, fileStoreAdapter, DEMO_TRAINEES } from '../public/js/ai/demo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const dataDir = path.resolve(arg('--data', process.env.DRONA_DATA || path.join(ROOT, 'data')));
const perTrainee = Number(arg('--sessions', 8));
if (process.argv.includes('--reset')) fs.rmSync(dataDir, { recursive: true, force: true });

const store = new FileStore(dataDir);
const tty = process.stdout.isTTY;
const res = await seedDemo(fileStoreAdapter(store), {
  perTrainee,
  onProgress: (done, total) => {
    if (tty) process.stdout.write(`\r  seeded ${done}/${total} sessions`);
    else if (done === total || done % 16 === 0) console.log(`  seeded ${done}/${total} sessions`);
  },
});
await store.save();
console.log(`\n  Demo data written to ${dataDir}: ${res.units.length} units, ${DEMO_TRAINEES.length} trainees, ${res.sessions} sessions.`);
