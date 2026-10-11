// Session scoring: per-track kill-chain evaluation (detect → classify → identify →
// decide → outcome) on top of the doctrinal decision tree, plus penalties and
// skill observations for the mastery model.

import { TYPES, classScore, identityScore, EFFECTORS } from '../sim/catalog.js';
import { rateDecision, RATINGS, rank } from './doctrine.js';
import { relianceVerdict } from './atr.js';

export const WEIGHTS = { detection: 0.2, classification: 0.2, identification: 0.15, decision: 0.3, outcome: 0.15 };

export const GRADES = [
  { min: 90, key: 'A', name: 'Distinguished' },
  { min: 80, key: 'B', name: 'Proficient' },
  { min: 65, key: 'C', name: 'Qualified' },
  { min: 50, key: 'D', name: 'Needs improvement' },
  { min: 0, key: 'F', name: 'Not qualified' },
];

export const ROOT_CAUSES = {
  none: 'Correct',
  classification: 'Classification error: the decision followed from a wrong or missing platform ID',
  identification: 'Identification error: wrong affiliation (friend, neutral or hostile)',
  doctrine: 'Doctrine error: wrong effector for what you believed the target was',
  situation: 'Situation misread: TTI, restricted zone or swarm context',
  timing: 'Too late: decided with little or no time left',
  no_decision: 'No decision taken',
  undetected: 'Never detected or acknowledged',
};

export function gradeFor(score) {
  return GRADES.find((g) => score >= g.min) || GRADES[GRADES.length - 1];
}

function trackWeight(e) {
  if (e.phantom) return 0.5;
  if (e.identity === 'HOSTILE') return (TYPES[e.type].threat || 1) + 1;
  if (e.identity === 'FRIEND') return 3;
  if (e.identity === 'NEUTRAL') return 2;
  return 1;
}

function detectionScore(latency) {
  if (latency === null) return 0;
  if (latency <= 4) return 100;
  if (latency >= 45) return 15;
  return 100 - ((latency - 4) / 41) * 85;
}

function outcomeScore(e, tr) {
  const res = e.outcome?.result || 'ACTIVE';
  if (e.identity === 'HOSTILE' && !e.phantom) {
    if (res === 'NEUTRALISED' || res === 'SOFT_KILL') return e.dropped || e.isrEvents > 0 ? 40 : 100;
    if (res === 'LEAKED' || res === 'MISSION_COMPLETE') return 0;
    if (res === 'ACTIVE') return e.type === 'FIXED_WING' || e.state === 'orbit' ? 25 : 50;
    return 60;
  }
  if (e.identity === 'FRIEND') return res === 'FRATRICIDE' ? -100 : res === 'OWN_EW' ? 20 : 100;
  if (e.identity === 'NEUTRAL') {
    if (res === 'KILLED_NEUTRAL') return 0;
    if (res === 'SOFT_KILL') return e.strayed ? 100 : 60;
    return 100;
  }
  // Bird / clutter.
  const engaged = tr?.op.actions.some((a) => EFFECTORS[a.action]);
  return engaged ? 40 : 100;
}

export function evaluateTrack(sim, e, tr) {
  const scored = {
    trackId: tr?.id || null,
    entityId: e.id,
    type: e.type,
    typeName: TYPES[e.type].name,
    identity: e.identity,
    phantom: !!e.phantom,
    swarmId: e.swarmId || null,
    callsign: e.callsign || null,
    weight: trackWeight(e),
    spawnT: e.spawnT,
  };

  // Detection.
  const detectableAt = tr ? tr.createdAt : null;
  const ackAt = tr?.op.ackAt ?? null;
  const latency = ackAt !== null && detectableAt !== null ? Math.max(0, ackAt - detectableAt) : null;
  scored.detection = {
    detectableAt, ackAt, latency, visualFirst: !!tr?.visualFirst, createdBy: tr?.createdBy || null,
    score: tr ? (tr.visualFirst ? 100 : detectionScore(latency)) : 0,
  };

  // Classification.
  const truthCls = e.type;
  const ans = tr?.op.cls || null;
  const ai = tr?.op.aiAtCls || tr?.ai || null;
  const reliance = relianceVerdict(tr?.op.aiAtCls || null, ans, truthCls);
  let clsScore = classScore(truthCls, ans);
  if (ans && tr.op.clsAt - (ackAt ?? tr.op.clsAt) > 60) clsScore *= 0.85;
  scored.classification = {
    truth: truthCls, answer: ans, correct: ans === truthCls, at: tr?.op.clsAt ?? null,
    viaAI: !!tr?.op.clsViaAI, ai: ai ? { cls: ai.cls, conf: ai.conf, correct: ai.cls === truthCls } : null,
    reliance, score: Math.round(clsScore),
  };

  // Identification.
  const identAns = tr?.op.ident || null;
  scored.identification = {
    truth: e.identity, answer: identAns, iffAsked: tr?.op.iffAsked || 0, iff: tr?.op.iff || null,
    score: identityScore(e.identity, identAns),
  };

  // Decision.
  const dec = tr?.op.decision || null;
  const isThreat = e.identity === 'HOSTILE' && !e.phantom;
  if (dec) {
    const r = rateDecision(dec.action, dec.truth, dec.perceived, dec.available, {
      clsCorrect: dec.clsAtDecision === truthCls,
      identCorrect: !dec.identAtDecision || identityScore(e.identity, dec.identAtDecision) >= 70,
    });
    let timeliness = 1;
    if (isThreat && isFinite(dec.tti)) timeliness = dec.tti >= 30 ? 1 : 0.5 + 0.5 * Math.max(0, dec.tti) / 30;
    let score = r.score >= 0 ? r.score * timeliness : r.score;
    if (dec.implicit && !EFFECTORS[dec.action]) score = Math.min(score, 80);
    let rootCause = r.rootCause;
    if (rootCause === 'none' && isThreat && timeliness < 0.7) rootCause = 'timing';
    if (dec.implicit && rank(r.truthRating) >= rank('ACCEPTABLE')) score = Math.min(score, 85);
    scored.decision = {
      action: dec.action, t: dec.t, implicit: dec.implicit, tti: isFinite(dec.tti) ? Math.round(dec.tti) : null,
      truthRating: r.truthRating, perceivedRating: r.perceivedRating, bestAvailable: r.bestAvailable, optimal: r.optimal,
      truthPath: dec.truth.path, truthLeaf: dec.truth.leafId, perceivedPath: dec.perceived.path, perceivedLeaf: dec.perceived.leafId,
      ratings: dec.truth.ratings, modifiers: dec.truth.modifiers || [], available: dec.available, timeliness, rootCause, score: Math.round(score),
      clsAtDecision: dec.clsAtDecision, identAtDecision: dec.identAtDecision,
    };
  } else {
    // No explicit decision: passive is fine for non-threats; a failure for threats.
    const passiveOk = !isThreat;
    scored.decision = {
      action: null, t: null, implicit: true, tti: null, truthRating: passiveOk ? 'ACCEPTABLE' : 'WRONG',
      perceivedRating: null, bestAvailable: null, optimal: [], truthPath: [], truthLeaf: null, perceivedPath: [], perceivedLeaf: null,
      ratings: {}, available: {}, timeliness: 1,
      rootCause: passiveOk ? 'none' : tr ? 'no_decision' : 'undetected',
      score: passiveOk ? (tr ? 70 : 60) : 0,
    };
  }

  scored.outcome = { result: e.outcome?.result || 'ACTIVE', by: e.outcome?.by || null, t: e.outcome?.t ?? null, score: outcomeScore(e, tr) };
  scored.roe = tr?.op.roe || [];
  scored.actions = tr?.op.actions || [];

  const parts = {
    detection: scored.detection.score,
    classification: scored.classification.score,
    identification: scored.identification.score,
    decision: scored.decision.score,
    outcome: scored.outcome.score,
  };
  if (e.phantom || (!tr && !isThreat)) {
    // Clutter and untracked non-threats: only decision/outcome matter.
    scored.total = Math.round(0.5 * Math.max(0, parts.decision) + 0.5 * Math.max(0, parts.outcome));
  } else {
    let total = 0;
    for (const [k, w] of Object.entries(WEIGHTS)) total += w * parts[k];
    scored.total = Math.round(Math.max(-100, Math.min(100, total)));
  }
  return scored;
}

export function scoreSession(sim) {
  const tracks = [];
  for (const e of sim.entities) {
    const tr = sim.trackByEntity.get(e.id) || null;
    if (e.phantom && !tr) continue;
    if (!tr && e.identity !== 'HOSTILE') continue;
    tracks.push(evaluateTrack(sim, e, tr));
  }
  tracks.sort((a, b) => (a.detection.detectableAt ?? a.spawnT) - (b.detection.detectableAt ?? b.spawnT));

  const sumW = tracks.reduce((s, t) => s + t.weight, 0) || 1;
  const base = tracks.reduce((s, t) => s + t.weight * t.total, 0) / sumW;
  const st = sim.stats;
  const penalties = {
    fratricide: st.fratricide * 25,
    collateral: st.collateral * 8,
    roe: st.roe * 5,
    ownEw: st.ownEw * 6,
    wasted: Math.round(st.wasted * 3),
    damage: Math.round((100 - sim.asset.health) * 0.25),
  };
  const penaltyTotal = Object.values(penalties).reduce((a, b) => a + b, 0);
  const total = Math.max(0, Math.min(100, Math.round(base - penaltyTotal)));

  const scoredReal = tracks.filter((t) => !t.phantom);
  const threats = scoredReal.filter((t) => t.identity === 'HOSTILE');
  const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);
  const classified = scoredReal.filter((t) => t.classification.answer);
  const latencies = threats.map((t) => t.detection.latency).filter((v) => v !== null).sort((a, b) => a - b);
  const aiCases = scoredReal.filter((t) => t.classification.reliance !== 'n/a');
  const goodReliance = aiCases.filter((t) => ['appropriate', 'override'].includes(t.classification.reliance)).length;
  const defeated = threats.filter((t) => ['NEUTRALISED', 'SOFT_KILL'].includes(t.outcome.result)).length;

  const summary = {
    total,
    base: Math.round(base),
    grade: gradeFor(total),
    penalties,
    penaltyTotal,
    detection: round(avg(scoredReal, (t) => t.detection.score)),
    classification: round(avg(scoredReal, (t) => t.classification.score)),
    classAccuracy: classified.length ? Math.round((classified.filter((t) => t.classification.correct).length / scoredReal.length) * 100) : 0,
    identification: round(avg(scoredReal, (t) => t.identification.score)),
    decision: round(avg(scoredReal, (t) => Math.max(0, t.decision.score))),
    outcome: round(avg(scoredReal, (t) => Math.max(0, t.outcome.score))),
    medianDetection: latencies.length ? Math.round(latencies[Math.floor(latencies.length / 2)] * 10) / 10 : null,
    threats: threats.length,
    defeated,
    leaked: threats.filter((t) => ['LEAKED', 'MISSION_COMPLETE'].includes(t.outcome.result)).length,
    aiTeaming: aiCases.length ? Math.round((goodReliance / aiCases.length) * 100) : null,
    assetHealth: Math.round(sim.asset.health),
    stats: { ...sim.stats },
    endReason: sim.endReason,
    duration: Math.round(sim.t),
    warnings: sim.asset.warnings,
    rootCauses: countBy(tracks.filter((t) => t.decision.rootCause !== 'none'), (t) => t.decision.rootCause),
  };

  return { summary, tracks, observations: skillObservations(sim, tracks) };
}

function round(v) {
  return v === null ? null : Math.round(v);
}

function countBy(arr, f) {
  const out = {};
  for (const x of arr) out[f(x)] = (out[f(x)] || 0) + 1;
  return out;
}

export function skillObservations(sim, tracks) {
  const obs = [];
  const spec = sim.spec;
  const night = spec.env.time === 'night';
  const degraded = (spec.env.ew || 0) > 0 || spec.env.weather !== 'clear';
  const roeContext = sim.urban || spec.context.wcs !== 'FREE';
  for (const t of tracks) {
    if (t.phantom) {
      if (t.classification.answer) obs.push({ skill: 'cls.BIRD', correct: t.classification.answer === 'BIRD' });
      continue;
    }
    const threat = t.identity === 'HOSTILE';
    if (threat) obs.push({ skill: 'detect', correct: t.detection.latency !== null && t.detection.latency <= 6 });
    if (t.trackId) obs.push({ skill: `cls.${t.type}`, correct: t.classification.correct });
    if (t.trackId && t.identification.answer) obs.push({ skill: 'identify', correct: t.identification.score >= 70 });
    if (t.identity === 'FRIEND' && t.trackId) {
      obs.push({ skill: 'iff', correct: t.identification.answer === 'FRIEND' && !t.actions.some((a) => EFFECTORS[a.action]) && t.outcome.result !== 'FRATRICIDE' });
    }
    if (threat) {
      obs.push({ skill: 'engage', correct: rank(t.decision.truthRating) >= rank('ACCEPTABLE') && t.decision.score >= 85 && !!t.decision.action });
      if (t.decision.action) obs.push({ skill: 'timing', correct: t.decision.timeliness >= 0.9 });
      if (t.swarmId) obs.push({ skill: 'swarm', correct: ['NEUTRALISED', 'SOFT_KILL'].includes(t.outcome.result) });
      if (night) obs.push({ skill: 'night', correct: t.total >= 80 });
      if (degraded) obs.push({ skill: 'degraded', correct: t.total >= 80 });
    }
    if (roeContext && t.actions.some((a) => EFFECTORS[a.action])) obs.push({ skill: 'urban_roe', correct: t.roe.length === 0 && t.outcome.result !== 'KILLED_NEUTRAL' });
    if (t.classification.reliance !== 'n/a') obs.push({ skill: 'ai_teaming', correct: ['appropriate', 'override'].includes(t.classification.reliance) });
  }
  if (sim.stats.collateral > 0) obs.push({ skill: 'urban_roe', correct: false });
  if (sim.stats.fratricide > 0) obs.push({ skill: 'iff', correct: false });
  return obs;
}

export { RATINGS };
