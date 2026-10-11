// Exemplar operator: a doctrine-driven AI that plays a scenario the way the
// decision tree prescribes. Trainees can watch it as a model run, and the test
// suite uses it to check that scoring is consistent (a doctrinal run must score high).
// It is ground-truth aware, so it shows doctrine rather than perception.

import { evaluate, truthContext, perceivedContext, rank, ALL_ACTIONS } from './doctrine.js';
import { EFFECTORS, TYPES } from '../sim/catalog.js';
import { Rng } from '../core/rng.js';

const HOLD_TIME = { RF_JAM: 5, GNSS_SPOOF: 9, GUN: 6, INTERCEPTOR: 25, LASER: 9 };

// The exemplar knows ground truth, so it never wastes an effector on a target that
// is really out of reach (a trainee firing on a bearing-only track might).
function withinTrueRange(sim, a, e) {
  const r = Math.hypot(e.pos.x, e.pos.y);
  if (a === 'RF_JAM') return r <= sim.jamRange() - 50;
  if (a === 'GNSS_SPOOF') return r <= EFFECTORS.GNSS_SPOOF.range - 50;
  if (a === 'LASER') return r <= sim.laserRange() - 30;
  return true;
}

export class ExemplarOperator {
  constructor(sim, { reaction = 1.2, classifyDelay = 1.5 } = {}) {
    this.sim = sim;
    this.reaction = reaction;
    this.classifyDelay = classifyDelay;
    this.busyUntil = new Map();
    this.tried = new Map();
  }

  update() {
    const sim = this.sim;
    if (sim.finished || sim.tick % 5 !== 0) return;
    const t = sim.t;
    let anyImminent = false;
    for (const tr of sim.tracks) {
      if (tr.closed) continue;
      const e = sim.entity(tr.entityId);
      if (!e || !e.alive) continue;
      if (tr.op.ackAt === null) {
        if (t - tr.createdAt >= this.reaction) sim.command({ type: 'ack', trackId: tr.id });
        continue;
      }
      if (!tr.op.cls) {
        if (t - tr.op.ackAt >= this.classifyDelay) sim.command({ type: 'classify', trackId: tr.id, cls: e.type, viaAI: tr.ai?.cls === e.type });
        continue;
      }
      if (!tr.op.ident) {
        const needsIff = e.type === 'TACTICAL_UAV' || e.type === 'FIXED_WING';
        if (needsIff && !tr.op.iffAsked) { sim.command({ type: 'iff', trackId: tr.id }); continue; }
        if (tr.op.iffPendingUntil !== null) continue;
        sim.command({ type: 'identify', trackId: tr.id, ident: e.identity });
        continue;
      }
      const sit = sim.situation(e);
      if (sim.isThreatActive(e) && sit.tti < 40) anyImminent = true;
      if ((this.busyUntil.get(tr.id) || 0) > t) continue;

      const neutralViolating = e.identity === 'NEUTRAL' && sit.inRestricted && e.status === 'active';
      if (!sim.isThreatActive(e) && !neutralViolating) {
        if (!tr.op.decision) sim.command({ type: e.type === 'BIRD' ? 'dismiss' : 'monitor', trackId: tr.id });
        continue;
      }
      const ev = evaluate(truthContext({
        entity: e, wcs: sim.ctx.wcs, urban: sim.urban, weather: sim.W.key, tti: sit.tti, inRestricted: sit.inRestricted, swarmCount: sit.swarmCount,
        friendlyInJamBeam: sit.friendlyInJamBeam, friendlyInSpoofRange: sit.friendlyInSpoofRange,
      }));
      const wantWide = ev.leafId === 'L_SWARM_RF' ? 'wide' : 'narrow';
      if (sim.effectors.RF_JAM.mode !== wantWide && ev.ratings.RF_JAM === 'OPTIMAL') sim.command({ type: 'jamMode', mode: wantWide });
      const avail = sim.availability(tr);
      const tried = this.tried.get(tr.id) || new Set();
      const candidates = ALL_ACTIONS
        .filter((a) => EFFECTORS[a] && avail[a] && rank(ev.ratings[a]) >= rank('ACCEPTABLE'))
        .filter((a) => a === 'GUN' || !tried.has(a))
        .filter((a) => !(a === 'GUN' && sim.effectors.GUN.engagement && sim.effectors.GUN.engagement.entityId !== e.id && sit.tti > 10))
        .filter((a) => withinTrueRange(sim, a, e))
        .sort((a, b) => rank(ev.ratings[b]) - rank(ev.ratings[a]));
      const choice = candidates[0];
      if (!choice) {
        if (ev.ratings.MONITOR === 'OPTIMAL' && !tr.op.decision) sim.command({ type: 'monitor', trackId: tr.id });
        continue;
      }
      // Wait for the optimal effector while time allows, rather than settle early.
      const optimalSoon = ALL_ACTIONS.some((a) => EFFECTORS[a] && ev.ratings[a] === 'OPTIMAL' && (!avail[a] || !withinTrueRange(sim, a, e)) && !tried.has(a) && sim.effectors[a]?.enabled);
      if (ev.ratings[choice] !== 'OPTIMAL' && optimalSoon && isFinite(sit.tti) && sit.tti > 45) continue;
      const res = sim.command({ type: 'engage', trackId: tr.id, effector: choice });
      if (res.ok) {
        tried.add(choice);
        this.tried.set(tr.id, tried);
        this.busyUntil.set(tr.id, t + HOLD_TIME[choice]);
      }
    }
    if (anyImminent && t > sim.asset.warnedUntil) sim.command({ type: 'warn' });
  }
}

export function runExemplar(sim, maxSeconds = 1200) {
  const bot = new ExemplarOperator(sim);
  const steps = Math.round(maxSeconds / 0.05);
  for (let i = 0; i < steps && !sim.finished; i++) {
    sim.step();
    bot.update();
  }
  return sim;
}

// ---------------------------------------------------------------------------
// TraineeBot: an imperfect simulated operator with tunable skills. It is used to
// generate realistic demo history for the AAR / unit dashboards and to stress the
// scoring with genuine classification, identification and doctrine errors.


const CONFUSE = {
  QUAD: ['HEXA', 'BIRD'], HEXA: ['QUAD'], FPV: ['FPV_FIBER', 'QUAD'], FPV_FIBER: ['FPV'], FIXED_WING: ['TACTICAL_UAV', 'LOITER'],
  LOITER: ['DECOY', 'FIXED_WING'], DECOY: ['LOITER'], TACTICAL_UAV: ['FIXED_WING'], BIRD: ['QUAD', 'FPV'],
};

export class TraineeBot {
  // skill: { reaction, clsAcc, doctrine, aiTrust, iffDiscipline, warn }
  constructor(sim, skill, seed = 1) {
    this.sim = sim;
    this.s = { reaction: 3, clsAcc: 0.7, doctrine: 0.7, aiTrust: 0.5, iffDiscipline: 0.6, warn: 0.5, ...skill };
    this.rng = new Rng(seed).fork('trainee-bot');
    this.delay = new Map();
    this.busyUntil = new Map();
    this.warned = false;
  }

  wait(tr, key, base) {
    const k = `${tr.id}:${key}`;
    if (!this.delay.has(k)) this.delay.set(k, this.sim.t + base * this.rng.range(0.6, 1.8));
    return this.sim.t >= this.delay.get(k);
  }

  update() {
    const sim = this.sim;
    if (sim.finished || sim.tick % 5 !== 0) return;
    const r = this.rng;
    for (const tr of sim.tracks) {
      if (tr.closed) continue;
      const e = sim.entity(tr.entityId);
      if (!e || !e.alive) continue;
      if (tr.op.ackAt === null) {
        if (this.wait(tr, 'ack', this.s.reaction)) sim.command({ type: 'ack', trackId: tr.id });
        continue;
      }
      if (!tr.op.cls) {
        if (!this.wait(tr, 'cls', this.s.reaction * 0.8 + 1)) continue;
        let cls;
        if (tr.ai && r.chance(this.s.aiTrust)) {
          cls = tr.ai.cls;
          sim.command({ type: 'classify', trackId: tr.id, cls, viaAI: true });
        } else {
          cls = r.chance(this.s.clsAcc) ? e.type : r.pick(CONFUSE[e.type] || [e.type]);
          sim.command({ type: 'classify', trackId: tr.id, cls });
        }
        continue;
      }
      if (!tr.op.ident) {
        const cls = tr.op.cls;
        if ((cls === 'TACTICAL_UAV' || cls === 'FIXED_WING') && r.chance(this.s.iffDiscipline) && !tr.op.iffAsked) {
          sim.command({ type: 'iff', trackId: tr.id });
          continue;
        }
        if (tr.op.iffPendingUntil !== null) continue;
        let ident;
        if (cls === 'BIRD') ident = 'NON_UAS';
        else if (tr.op.iff?.valid) ident = 'FRIEND';
        else if (cls === 'TACTICAL_UAV') ident = r.chance(this.s.iffDiscipline) ? 'FRIEND' : 'HOSTILE';
        else if (e.identity === 'NEUTRAL') ident = r.chance(this.s.doctrine) ? 'NEUTRAL' : 'HOSTILE';
        else if (e.identity === 'FRIEND') ident = r.chance(this.s.iffDiscipline * 0.8) ? 'FRIEND' : 'HOSTILE';
        else ident = r.chance(0.85) ? 'HOSTILE' : 'SUSPECT';
        sim.command({ type: 'identify', trackId: tr.id, ident });
        continue;
      }
      if ((this.busyUntil.get(tr.id) || 0) > sim.t) continue;
      if (tr.op.decision && !EFFECTORS[tr.op.decision.action] && ['FRIEND', 'NEUTRAL', 'NON_UAS'].includes(tr.op.ident)) continue;
      const sit = sim.situation(e);
      const ev = evaluate(perceivedContext({
        cls: tr.op.cls, ident: tr.op.ident, rfEvidence: sim.t - tr.sources.rf < 6, wcs: sim.ctx.wcs, urban: sim.urban, weather: sim.W.key,
        tti: sit.tti, inRestricted: sit.inRestricted, swarmCount: sit.perceivedSwarm,
        friendlyInJamBeam: sit.perceivedFriendlyInJamBeam, friendlyInSpoofRange: sit.perceivedFriendlyInSpoofRange,
      }));
      const avail = sim.availability(tr);
      const passive = ev.ratings.MONITOR === 'OPTIMAL' || ev.ratings.DISMISS === 'OPTIMAL';
      if (passive) {
        if (!tr.op.decision) sim.command({ type: ev.ratings.DISMISS === 'OPTIMAL' ? 'dismiss' : 'monitor', trackId: tr.id });
        continue;
      }
      const effs = Object.keys(EFFECTORS).filter((a) => avail[a]);
      if (!effs.length) continue;
      let choice;
      if (r.chance(this.s.doctrine)) {
        choice = effs.slice().sort((a, b) => rank(ev.ratings[b]) - rank(ev.ratings[a]))[0];
        if (rank(ev.ratings[choice]) < rank('ACCEPTABLE') && isFinite(sit.tti) && sit.tti > 30) continue;
      } else {
        choice = r.pick(effs);
      }
      const res = sim.command({ type: 'engage', trackId: tr.id, effector: choice });
      if (res.ok) this.busyUntil.set(tr.id, sim.t + (HOLD_TIME[choice] || 6) * r.range(1, 1.6));
      if (TYPES[e.type].threat >= 4 && sit.tti < 40 && !this.warned && r.chance(this.s.warn)) {
        this.warned = true;
        sim.command({ type: 'warn' });
      }
    }
  }
}

export function runTraineeBot(sim, skill, seed, maxSeconds = 1200) {
  const bot = new TraineeBot(sim, skill, seed);
  const steps = Math.round(maxSeconds / 0.05);
  for (let i = 0; i < steps && !sim.finished; i++) {
    sim.step();
    bot.update();
  }
  return sim;
}
