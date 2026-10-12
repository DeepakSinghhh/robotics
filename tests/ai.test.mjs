import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, truthContext, perceivedContext, rateDecision, NODES, LEAVES, TREE_ORDER } from '../public/js/ai/doctrine.js';
import { newProfile, applyObservations, bktUpdate, certification, recommendedDifficulty, SKILLS } from '../public/js/ai/mastery.js';
import { adaptiveOptions, buildSortie } from '../public/js/ai/director.js';
import { atrSuggest, relianceVerdict } from '../public/js/ai/atr.js';
import { Rng } from '../public/js/core/rng.js';

const base = { wcs: 'FREE', urban: false, weather: 'clear', tti: 90, inRestricted: true, swarmCount: 1 };
const ent = (type, identity = 'HOSTILE', rfEmitting) => ({ type, identity, rfEmitting: rfEmitting ?? !['LOITER', 'DECOY', 'FPV_FIBER', 'BIRD'].includes(type) });

test('tree layout covers every node and leaf', () => {
  for (const id of [...Object.keys(NODES), ...Object.keys(LEAVES)]) assert.ok(TREE_ORDER.includes(id), id);
});

test('friendly UAV: hold fire, any kinetic engagement is prohibited', () => {
  const ev = evaluate(truthContext({ entity: ent('TACTICAL_UAV', 'FRIEND'), ...base }));
  assert.equal(ev.leafId, 'L_HOLD');
  assert.equal(ev.ratings.MONITOR, 'OPTIMAL');
  assert.equal(ev.ratings.GUN, 'PROHIBITED');
  assert.equal(ev.ratings.RF_JAM, 'PROHIBITED');
});

test('bird: dismiss; engaging is wasteful', () => {
  const ev = evaluate(truthContext({ entity: ent('BIRD', 'NON_UAS'), ...base }));
  assert.equal(ev.leafId, 'L_DISMISS');
  assert.equal(ev.ratings.DISMISS, 'OPTIMAL');
  assert.equal(ev.ratings.INTERCEPTOR, 'WRONG');
});

test('RF-controlled quad in rural terrain: jam is optimal', () => {
  const ev = evaluate(truthContext({ entity: ent('QUAD'), ...base }));
  assert.equal(ev.leafId, 'L_RF_RURAL');
  assert.equal(ev.ratings.RF_JAM, 'OPTIMAL');
});

test('fiber-optic FPV: jamming is wrong, hard-kill required', () => {
  const ev = evaluate(truthContext({ entity: ent('FPV_FIBER'), ...base, tti: 40 }));
  assert.equal(ev.ratings.RF_JAM, 'WRONG');
  assert.equal(ev.ratings.GUN, 'OPTIMAL');
});

test('urban collateral constraints downgrade the gun', () => {
  const ev = evaluate(truthContext({ entity: ent('LOITER'), ...base, urban: true, tti: 40 }));
  assert.equal(ev.leafId, 'L_HARD_URBAN');
  assert.equal(ev.ratings.INTERCEPTOR, 'OPTIMAL');
  assert.equal(ev.ratings.GUN, 'POOR');
});

test('imminent threat: hard-kill now regardless of RF link', () => {
  const ev = evaluate(truthContext({ entity: ent('QUAD'), ...base, tti: 12 }));
  assert.equal(ev.leafId, 'L_IMMINENT');
  assert.equal(ev.ratings.GUN, 'OPTIMAL');
});

test('weapons hold: report unless self-defence', () => {
  const ev = evaluate(truthContext({ entity: ent('HEXA'), ...base, wcs: 'HOLD', tti: 120 }));
  assert.equal(ev.leafId, 'L_REPORT');
  const ev2 = evaluate(truthContext({ entity: ent('HEXA'), ...base, wcs: 'HOLD', tti: 15 }));
  assert.equal(ev2.leafId, 'L_IMMINENT');
});

test('neutral drone: monitor; violation of restricted zone makes it engageable', () => {
  const ok = evaluate(truthContext({ entity: ent('QUAD', 'NEUTRAL'), ...base, inRestricted: false }));
  assert.equal(ok.leafId, 'L_NEUTRAL');
  assert.equal(ok.ratings.GUN, 'PROHIBITED');
  const viol = evaluate(truthContext({ entity: ent('QUAD', 'NEUTRAL'), ...base, inRestricted: true }));
  assert.equal(viol.ratings.RF_JAM, 'OPTIMAL');
});

test('swarm of RF drones: area jam optimal; interceptor poor', () => {
  const ev = evaluate(truthContext({ entity: ent('FPV'), ...base, swarmCount: 8 }));
  assert.equal(ev.leafId, 'L_SWARM_RF');
  assert.equal(ev.ratings.INTERCEPTOR, 'POOR');
});

test('EW fratricide modifier downgrades jam/spoof near own UAVs', () => {
  const ev = evaluate(truthContext({ entity: ent('QUAD'), ...base, friendlyInJamBeam: true, friendlyInSpoofRange: true }));
  assert.equal(ev.ratings.RF_JAM, 'POOR');
  assert.equal(ev.modifiers.length, 2);
});

test('root cause: jamming a fiber FPV you thought was an FPV is a classification error', () => {
  const truth = evaluate(truthContext({ entity: ent('FPV_FIBER'), ...base }));
  const perceived = evaluate(perceivedContext({ cls: 'FPV', ident: 'HOSTILE', rfEvidence: false, ...base }));
  const r = rateDecision('RF_JAM', truth, perceived, { RF_JAM: true, GUN: true, MONITOR: true }, { clsCorrect: false, identCorrect: true });
  assert.equal(r.truthRating, 'WRONG');
  assert.equal(r.perceivedRating, 'OPTIMAL');
  assert.equal(r.rootCause, 'classification');
});

test('root cause: wrong effector for a correctly classified target is a doctrine error', () => {
  const truth = evaluate(truthContext({ entity: ent('QUAD'), ...base }));
  const perceived = evaluate(perceivedContext({ cls: 'QUAD', ident: 'HOSTILE', rfEvidence: true, ...base }));
  const r = rateDecision('MONITOR', truth, perceived, { RF_JAM: true, MONITOR: true }, { clsCorrect: true, identCorrect: true });
  assert.equal(r.rootCause, 'doctrine');
});

test('best-available normalisation: acceptable choice scores full when optimal is unavailable', () => {
  const truth = evaluate(truthContext({ entity: ent('QUAD'), ...base }));
  const r = rateDecision('GUN', truth, truth, { GUN: true, MONITOR: true, RF_JAM: false }, { clsCorrect: true, identCorrect: true });
  assert.equal(r.truthRating, 'ACCEPTABLE');
  assert.equal(r.score, 100);
});

test('BKT update moves mastery in the right direction', () => {
  assert.ok(bktUpdate(0.3, true) > 0.3);
  assert.ok(bktUpdate(0.6, false) < 0.6);
  const { profile, deltas } = applyObservations(newProfile(), [{ skill: 'detect', correct: true }, { skill: 'detect', correct: true }]);
  assert.ok(profile.skills.detect.p > 0.5);
  assert.equal(profile.sessions, 1);
  assert.equal(deltas.length, 1);
});

test('certification requires both mastery and sessions', () => {
  const p = newProfile();
  for (const s of SKILLS) p.skills[s.key].p = 0.95;
  p.sessions = 1;
  assert.equal(certification(p).level.key, 'UNQ');
  p.sessions = 12;
  assert.equal(certification(p).level.key, 'INS');
  assert.equal(recommendedDifficulty(p), 'ELITE');
});

test('adaptive director targets weak skills', () => {
  const p = newProfile();
  p.sessions = 5;
  for (const s of SKILLS) p.skills[s.key].p = 0.8;
  p.skills.night.p = 0.15;
  p.skills['cls.FPV_FIBER'].p = 0.1;
  const a = adaptiveOptions(p);
  assert.ok(a.focus.night, 'night focus expected');
  assert.ok(a.typeBias.FPV_FIBER > a.typeBias.QUAD);
  let nights = 0;
  for (let s = 1; s <= 20; s++) if (buildSortie({ profile: p, adaptive: true, seed: s }).env.time === 'night') nights++;
  assert.ok(nights >= 10, `weak night skill should give mostly night sorties, got ${nights}/20`);
});

test('ATR aid is reproducible and less accurate in bad conditions', () => {
  const e = { type: 'QUAD' };
  const acc = (ctx) => {
    let ok = 0;
    for (let i = 0; i < 400; i++) if (atrSuggest(new Rng(i), e, ctx).correct) ok++;
    return ok / 400;
  };
  const good = acc({ accuracy: 0.9 });
  const bad = acc({ accuracy: 0.9, night: true, weatherVisual: 0.35, ew: 2 });
  assert.ok(good > bad + 0.1, `${good} vs ${bad}`);
  assert.deepEqual(atrSuggest(new Rng(5), e, { accuracy: 0.8 }), atrSuggest(new Rng(5), e, { accuracy: 0.8 }));
  assert.equal(relianceVerdict({ cls: 'LOITER', correct: false }, 'LOITER', 'DECOY'), 'over');
  assert.equal(relianceVerdict({ cls: 'LOITER', correct: false }, 'DECOY', 'DECOY'), 'override');
});
