import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server/server.js';

test('REST API round-trip: units, trainees, sessions, scenarios, CSV, static', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drona-test-'));
  const server = createServer({ dataDir: dir, quiet: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (p, opts = {}) => {
    const res = await fetch(base + p, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  };
  try {
    assert.equal((await j('/api/health')).body.ok, true);
    const unit = (await j('/api/units', { method: 'POST', body: { name: 'Test Det' } })).body;
    const tr = (await j('/api/trainees', { method: 'POST', body: { name: 'Test Trainee', rank: 'Hav', unitId: unit.id } })).body;
    assert.ok(tr.id);
    const up = (await j(`/api/trainees/${tr.id}`, { method: 'PUT', body: { profile: { sessions: 1 } } })).body;
    assert.equal(up.profile.sessions, 1);
    const saved = (await j('/api/sessions', {
      method: 'POST',
      body: { traineeId: tr.id, unitId: unit.id, scenarioName: 'X, "quoted"', startedAt: new Date().toISOString(), score: { total: 77, grade: { key: 'C' } }, tracks: [1, 2], replay: { frames: [] } },
    })).body;
    assert.ok(saved.id);
    assert.equal(saved.tracks, undefined, 'summary excludes heavy fields');
    const list = (await j(`/api/sessions?unitId=${unit.id}`)).body;
    assert.equal(list.length, 1);
    const full = (await j(`/api/sessions/${saved.id}`)).body;
    assert.deepEqual(full.tracks, [1, 2]);
    const csv = (await j(`/api/export/sessions.csv?unitId=${unit.id}`)).body;
    assert.match(csv, /"X, ""quoted"""/);
    assert.match(csv, /Hav Test Trainee/);
    const sc = (await j('/api/scenarios', { method: 'POST', body: { name: 'Custom', waves: [] } })).body;
    assert.equal((await j('/api/scenarios')).body.length, 1);
    assert.equal((await j(`/api/scenarios/${sc.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await j('/api/sessions/../../etc/passwd')).status, 404);
    const res = await fetch(`${base}/%2e%2e/package.json`);
    assert.ok([403, 404].includes(res.status), 'no path traversal');
    const idx = await fetch(`${base}/`);
    assert.equal(idx.status, 200);
  } finally {
    server.close();
    await new Promise((r) => setTimeout(r, 50));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
