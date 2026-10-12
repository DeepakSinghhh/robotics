// Trainee skill model: Bayesian Knowledge Tracing (BKT) per skill.
// Explainable, works with small data and is standard in intelligent tutoring systems.

import { TYPES, TYPE_KEYS } from '../sim/catalog.js';

export const SKILLS = [
  { key: 'detect', name: 'Detection speed', group: 'Detect' },
  { key: 'identify', name: 'Affiliation ID', group: 'Identify' },
  { key: 'iff', name: 'IFF / ATO deconfliction', group: 'Identify' },
  { key: 'engage', name: 'Effector selection', group: 'Decide' },
  { key: 'timing', name: 'Engagement timing', group: 'Decide' },
  { key: 'urban_roe', name: 'ROE & collateral discipline', group: 'Decide' },
  { key: 'swarm', name: 'Swarm defence', group: 'Context' },
  { key: 'night', name: 'Night / thermal ops', group: 'Context' },
  { key: 'degraded', name: 'Degraded sensors & EW', group: 'Context' },
  { key: 'ai_teaming', name: 'AI-aid trust calibration', group: 'Context' },
  ...TYPE_KEYS.map((k) => ({ key: `cls.${k}`, name: `Recognise ${TYPES[k].short}`, group: 'Classify', type: k })),
];
export const SKILL_MAP = Object.fromEntries(SKILLS.map((s) => [s.key, s]));

const PARAMS = { init: 0.2, transit: 0.08, slip: 0.1, guess: 0.22 };

export function newProfile() {
  const skills = {};
  for (const s of SKILLS) skills[s.key] = { p: PARAMS.init, n: 0, correct: 0 };
  return { skills, sessions: 0, drills: 0, updatedAt: null };
}

export function normaliseProfile(profile) {
  const base = newProfile();
  if (!profile || !profile.skills) return base;
  for (const k of Object.keys(base.skills)) {
    if (profile.skills[k]) base.skills[k] = { ...base.skills[k], ...profile.skills[k] };
  }
  base.sessions = profile.sessions || 0;
  base.drills = profile.drills || 0;
  base.updatedAt = profile.updatedAt || null;
  return base;
}

export function bktUpdate(p, correct, params = PARAMS) {
  const { slip, guess, transit } = params;
  const posterior = correct
    ? (p * (1 - slip)) / (p * (1 - slip) + (1 - p) * guess)
    : (p * slip) / (p * slip + (1 - p) * (1 - guess));
  return Math.min(0.999, posterior + (1 - posterior) * transit);
}

// Soft BKT update with fractional evidence r (share of correct attempts).
export function bktSoftUpdate(p, r, params = PARAMS) {
  const { slip, guess, transit } = params;
  const pc = (p * (1 - slip)) / (p * (1 - slip) + (1 - p) * guess);
  const pw = (p * slip) / (p * slip + (1 - p) * (1 - guess));
  const posterior = r * pc + (1 - r) * pw;
  return Math.min(0.999, posterior + (1 - posterior) * transit);
}

// observations: [{ skill, correct }]. They are aggregated per skill so that one
// session counts as one learning opportunity per skill. This stops mastery inflating
// just because a scenario contained many tracks.
export function applyObservations(profile, observations, kind = 'session') {
  const next = normaliseProfile(structuredCloneSafe(profile));
  const before = {};
  const agg = {};
  for (const ob of observations) {
    if (!next.skills[ob.skill]) continue;
    const a = (agg[ob.skill] ||= { n: 0, c: 0 });
    a.n += 1;
    if (ob.correct) a.c += 1;
  }
  for (const [skill, a] of Object.entries(agg)) {
    const s = next.skills[skill];
    before[skill] = s.p;
    s.p = bktSoftUpdate(s.p, a.c / a.n);
    s.n += a.n;
    s.correct += a.c;
  }
  if (kind === 'drill') next.drills += 1;
  else next.sessions += 1;
  next.updatedAt = new Date().toISOString();
  const deltas = Object.entries(before).map(([skill, p0]) => ({ skill, before: p0, after: next.skills[skill].p }));
  return { profile: next, deltas };
}

function structuredCloneSafe(o) {
  return o ? JSON.parse(JSON.stringify(o)) : o;
}

export function overallMastery(profile) {
  const p = normaliseProfile(profile);
  const core = SKILLS.filter((s) => s.group !== 'Classify');
  const cls = SKILLS.filter((s) => s.group === 'Classify');
  const avg = (arr) => arr.reduce((a, s) => a + p.skills[s.key].p, 0) / arr.length;
  return 0.65 * avg(core) + 0.35 * avg(cls);
}

export const CERT_LEVELS = [
  { key: 'UNQ', name: 'Not yet qualified', min: 0, minSessions: 0 },
  { key: 'GR3', name: 'C-UAS Operator Grade III', min: 0.45, minSessions: 2 },
  { key: 'GR2', name: 'C-UAS Operator Grade II', min: 0.62, minSessions: 4 },
  { key: 'GR1', name: 'C-UAS Operator Grade I', min: 0.78, minSessions: 6 },
  { key: 'INS', name: 'C-UAS Instructor Grade', min: 0.9, minSessions: 10 },
];

export function certification(profile) {
  const p = normaliseProfile(profile);
  const m = overallMastery(p);
  let level = CERT_LEVELS[0];
  for (const c of CERT_LEVELS) if (m >= c.min && p.sessions >= c.minSessions) level = c;
  const idx = CERT_LEVELS.indexOf(level);
  const next = CERT_LEVELS[idx + 1] || null;
  return { level, next, mastery: m };
}

export function weakestSkills(profile, n = 3, filter = () => true) {
  const p = normaliseProfile(profile);
  return SKILLS.filter(filter)
    .map((s) => ({ ...s, p: p.skills[s.key].p, n: p.skills[s.key].n }))
    .sort((a, b) => a.p - b.p || a.n - b.n)
    .slice(0, n);
}

export function recommendedDifficulty(profile) {
  const m = overallMastery(profile);
  if (m < 0.38) return 'RECRUIT';
  if (m < 0.58) return 'OPERATOR';
  if (m < 0.76) return 'VETERAN';
  return 'ELITE';
}
