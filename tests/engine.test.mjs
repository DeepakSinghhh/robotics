import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../public/js/sim/engine.js';
import { generateScenario, MISSIONS, instantiateMission } from '../public/js/sim/scenario.js';
import { runExemplar } from '../public/js/ai/exemplar.js';
import { scoreSession } from '../public/js/ai/scoring.js';
import { coachDebrief } from '../public/js/ai/coach.js';

function runIdle(spec) {
  const sim = new Simulation(spec);
  while (!sim.finished) sim.step();
  return sim;
}

test('an idle operator lets threats leak and scores poorly', () => {
  const sim = runIdle(generateScenario({ seed: 11, difficulty: 'OPERATOR' }));
  const res = scoreSession(sim);
  assert.ok(sim.stats.impacts + sim.stats.drops + sim.stats.artillery > 0, 'threats should reach the asset');
  assert.ok(res.summary.total < 40, `idle score ${res.summary.total}`);
  assert.ok(res.tracks.some((t) => t.decision.rootCause === 'no_decision' || t.decision.rootCause === 'undetected'));
});

test('the doctrinal exemplar scores highly on every scripted mission below Elite', () => {
  for (const m of MISSIONS.filter((x) => x.difficulty !== 'ELITE')) {
    const sim = runExemplar(new Simulation(instantiateMission(m)));
    const res = scoreSession(sim);
    assert.ok(res.summary.total >= 85, `${m.id}: exemplar scored ${res.summary.total}`);
    assert.equal(sim.stats.fratricide, 0, `${m.id}: no fratricide`);
    assert.equal(sim.stats.roe, 0, `${m.id}: no ROE violations`);
  }
});

test('exemplar beats idle by a wide margin on procedural sorties', () => {
  for (const seed of [3, 8]) {
    const spec = generateScenario({ seed, difficulty: 'VETERAN' });
    const idle = scoreSession(runIdle(spec)).summary.total;
    const ex = scoreSession(runExemplar(new Simulation(spec))).summary.total;
    assert.ok(ex - idle > 40, `seed ${seed}: exemplar ${ex} vs idle ${idle}`);
  }
});

test('simulation is deterministic for the same seed and commands', () => {
  const spec = generateScenario({ seed: 21, difficulty: 'VETERAN' });
  const a = runExemplar(new Simulation(spec));
  const b = runExemplar(new Simulation(spec));
  assert.equal(a.t, b.t);
  assert.deepEqual(a.events.map((e) => e.msg), b.events.map((e) => e.msg));
  assert.deepEqual(scoreSession(a).summary, scoreSession(b).summary);
});

test('engaging a friendly UAV is fratricide and an ROE violation', () => {
  const m = MISSIONS.find((x) => x.id === 'm7-mayajaal');
  const sim = new Simulation(instantiateMission(m, { randomize: false }));
  let fired = false;
  while (!sim.finished && sim.t < 200) {
    sim.step();
    if (!fired) {
      const tr = sim.tracks.find((t) => sim.entity(t.entityId).identity === 'FRIEND' && t.est.hasPos && t.view.range < 3400);
      if (tr) {
        sim.command({ type: 'identify', trackId: tr.id, ident: 'FRIEND' });
        const r = sim.command({ type: 'engage', trackId: tr.id, effector: 'INTERCEPTOR' });
        assert.ok(r.ok, r.reason);
        fired = true;
      }
    }
  }
  assert.ok(fired);
  assert.ok(sim.stats.roe >= 1);
  const res = scoreSession(sim);
  const friend = res.tracks.find((t) => t.identity === 'FRIEND' && t.decision.action === 'INTERCEPTOR');
  assert.equal(friend.decision.truthRating, 'PROHIBITED');
  assert.ok(friend.decision.score < 0);
});

test('jamming has no effect on a fiber-optic FPV and the AAR attributes it to classification', () => {
  const spec = {
    id: 't', name: 'fiber test', seed: 5, difficulty: 'OPERATOR', kind: 'custom',
    env: { terrain: 'rural', time: 'day', weather: 'clear', ew: 0 },
    context: { assetType: 'FOB', assetName: 'FOB Test', wcs: 'FREE', civilianDensity: 0.1, corridor: null, ato: [] },
    effectors: { RF_JAM: true, GNSS_SPOOF: true, GUN: { ammo: 32 }, INTERCEPTOR: { count: 4 }, LASER: true },
    aiAid: { enabled: true, accuracy: 0.9 }, sensors: { protocolLibrary: true, radarPd: 1 }, speedMul: 1, duration: 200, popUps: 0,
    waves: [{ t: 2, type: 'FPV_FIBER', count: 1, bearing: 10, range: 1800, profile: 'attack', identity: 'HOSTILE', alt: 120 }],
  };
  const sim = new Simulation(spec);
  let jammed = false;
  while (!sim.finished) {
    sim.step();
    const tr = sim.tracks[0];
    if (tr && !jammed && tr.est.hasPos && tr.view.range < 1500) {
      sim.command({ type: 'classify', trackId: tr.id, cls: 'FPV' });
      sim.command({ type: 'identify', trackId: tr.id, ident: 'HOSTILE' });
      assert.ok(sim.command({ type: 'engage', trackId: tr.id, effector: 'RF_JAM' }).ok);
      jammed = true;
    }
  }
  const res = scoreSession(sim);
  const t = res.tracks[0];
  assert.equal(t.outcome.result, 'LEAKED');
  assert.equal(t.decision.rootCause, 'classification');
  const coach = coachDebrief(res, spec, []);
  assert.ok(coach.improvements.some((i) => i.kind === 'classification' && /RF-silent/.test(i.text)));
});

test('replay frames and events are recorded', () => {
  const sim = runExemplar(new Simulation(instantiateMission(MISSIONS[0])));
  assert.ok(sim.replay.frames.length >= Math.floor(sim.t) - 1);
  assert.ok(Object.keys(sim.replay.meta).length >= 3);
  assert.ok(sim.events.some((e) => e.kind === 'end'));
});
