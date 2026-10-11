import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../public/js/core/rng.js';
import { generateScenario, MISSIONS, instantiateMission, expandWaves, fingerprint } from '../public/js/sim/scenario.js';
import { Terrain } from '../public/js/sim/terrain.js';
import { DIFFICULTY_KEYS, TYPE_KEYS, classScore, identityScore } from '../public/js/sim/catalog.js';

test('rng is deterministic and forks are independent', () => {
  const a = new Rng(1234), b = new Rng(1234);
  const sa = Array.from({ length: 50 }, () => a.float());
  const sb = Array.from({ length: 50 }, () => b.float());
  assert.deepEqual(sa, sb);
  const p1 = new Rng(99), p2 = new Rng(99);
  const f1 = p1.fork('radar');
  f1.float(); f1.float();
  assert.equal(p1.float(), p2.float(), 'consuming a fork must not perturb the parent');
  assert.notEqual(new Rng(99).fork('a').float(), new Rng(99).fork('b').float());
});

test('rng helpers stay in range', () => {
  const r = new Rng(7);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(3, 6);
    assert.ok(v >= 3 && v <= 6);
    assert.ok(['x', 'y'].includes(r.weighted({ x: 1, y: 3 })));
  }
});

test('same seed reproduces the same procedural scenario', () => {
  for (const d of DIFFICULTY_KEYS) {
    const a = generateScenario({ seed: 77, difficulty: d });
    const b = generateScenario({ seed: 77, difficulty: d });
    assert.deepEqual(a, b);
    assert.deepEqual(expandWaves(a), expandWaves(b));
  }
});

test('different seeds produce varied scenarios (anti-rote)', () => {
  const prints = new Set();
  for (let s = 1; s <= 40; s++) prints.add(generateScenario({ seed: s * 13, difficulty: 'VETERAN' }).fingerprint);
  assert.ok(prints.size >= 36, `expected high variety, got ${prints.size}/40 unique`);
});

test('history fingerprints force a re-roll', () => {
  const first = generateScenario({ seed: 5, difficulty: 'OPERATOR' });
  const second = generateScenario({ seed: 5, difficulty: 'OPERATOR', history: [first.fingerprint] });
  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.ok(second.directorNotes.some((n) => n.includes('Re-rolled')));
});

test('difficulty scales threat load', () => {
  const avg = (d) => {
    let n = 0;
    for (let s = 1; s <= 20; s++) n += expandWaves(generateScenario({ seed: s, difficulty: d })).filter((o) => o.identity === 'HOSTILE').length;
    return n / 20;
  };
  const r = avg('RECRUIT'), o = avg('OPERATOR'), v = avg('VETERAN'), e = avg('ELITE');
  assert.ok(r < o && o < v && v < e, `threat load should increase: ${r} ${o} ${v} ${e}`);
});

test('scripted missions are valid and jitter with randomize', () => {
  for (const m of MISSIONS) {
    const plain = instantiateMission(m, { randomize: false });
    assert.equal(plain.waves.length, m.waves.length);
    assert.ok(plain.fingerprint);
    const j1 = instantiateMission(m, { seed: 1 });
    const j2 = instantiateMission(m, { seed: 2 });
    assert.notDeepEqual(j1.waves.map((w) => w.bearing), j2.waves.map((w) => w.bearing), `${m.id} should jitter`);
    for (const w of j1.waves) assert.ok(TYPE_KEYS.includes(w.type));
  }
});

test('swarm waves expand into members with tactics', () => {
  const m = MISSIONS.find((x) => x.id === 'm6-chakravyuh');
  const spec = instantiateMission(m, { randomize: false });
  const orders = expandWaves(spec).filter((o) => o.swarmId);
  assert.equal(orders.length, 10);
  assert.ok(orders.every((o) => o.tactic === 'saturation' && o.waypoints.length === 1));
  assert.equal(orders.filter((o) => o.type === 'FPV_FIBER').length, 3);
  assert.equal(typeof fingerprint(spec), 'string');
});

test('terrain line of sight masks low targets behind ridges and clutter', () => {
  const urban = new Terrain('urban', 3);
  assert.equal(urban.lineOfSight(0, 2000, 10), false, 'low target at 2 km in urban clutter is masked');
  assert.equal(urban.lineOfSight(0, 2000, 200), true);
  const rural = new Terrain('rural', 3);
  assert.equal(rural.lineOfSight(0, 300, 30), true);
  const feats = urban.features();
  assert.ok(feats.buildings.length > 500, 'urban terrain generates buildings');
});

test('classification and identity partial credit', () => {
  assert.equal(classScore('FPV', 'FPV'), 100);
  assert.equal(classScore('FPV_FIBER', 'FPV'), 45);
  assert.equal(classScore('LOITER', 'QUAD'), 0);
  assert.equal(classScore('QUAD', null), 0);
  assert.equal(identityScore('HOSTILE', 'SUSPECT'), 70);
  assert.equal(identityScore('FRIEND', 'HOSTILE'), 0);
});
