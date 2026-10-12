import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStore } from '../server/store.js';
import { seedDemo, fileStoreAdapter, DEMO_TRAINEES } from '../public/js/ai/demo.js';

test('demo unit seeding creates trainees, sessions and mastery; lean mode drops old replays', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drona-demo-'));
  const store = new FileStore(dir);
  try {
    const progress = [];
    const res = await seedDemo(fileStoreAdapter(store), { trainees: DEMO_TRAINEES.slice(0, 2), perTrainee: 2, lean: true, onProgress: (d) => progress.push(d) });
    assert.equal(res.sessions, 4);
    assert.deepEqual(progress, [1, 2, 3, 4]);
    assert.equal(store.listUnits().length, 2);
    assert.equal(store.listSessions().length, 4);
    for (const t of store.listTrainees()) assert.equal(t.profile.sessions, 2);
    const full = store.listSessions().map((s) => store.getSession(s.id));
    assert.equal(full.filter((s) => s.replay.frames.length > 0).length, 2, 'only the latest sortie per trainee keeps its replay');
    // Re-running reuses existing units and trainees instead of duplicating them.
    await seedDemo(fileStoreAdapter(store), { trainees: DEMO_TRAINEES.slice(0, 2), perTrainee: 1 });
    assert.equal(store.listUnits().length, 2);
    assert.equal(store.listTrainees().length, 2);
  } finally {
    await store.save(); // let queued atomic writes finish before cleanup
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
