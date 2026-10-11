// Adaptive Red-Force AI Director: turns a trainee's mastery profile into the
// parameters of the next procedurally generated sortie, aimed at their weakest skills.

import { TYPE_KEYS, TYPES, DIFFICULTIES } from '../sim/catalog.js';
import { generateScenario } from '../sim/scenario.js';
import { normaliseProfile, weakestSkills, recommendedDifficulty, overallMastery } from './mastery.js';

const FOCUS_MAP = {
  night: { focus: ['night'], text: 'more night / thermal work' },
  degraded: { focus: ['degraded'], text: 'degraded sensors and EW' },
  swarm: { focus: ['swarm'], text: 'swarm attacks' },
  urban_roe: { focus: ['urban', 'urban_roe'], text: 'urban terrain under restrictive ROE' },
  iff: { focus: ['iff'], text: 'friendly traffic and IFF failures' },
  identify: { focus: ['iff'], text: 'mixed friendly, neutral and hostile traffic' },
  ai_teaming: { focus: ['ai_teaming'], text: 'a less reliable AI aid and adversarial decoys' },
};

export function adaptiveOptions(profile) {
  const prof = normaliseProfile(profile);
  const mastery = overallMastery(prof);
  if (prof.sessions === 0) {
    return {
      difficulty: 'RECRUIT', typeBias: {}, focus: {},
      notes: ['Baseline assessment sortie: no history yet, so the director starts at Recruit.'],
    };
  }
  const difficulty = recommendedDifficulty(prof);
  const notes = [`Adaptive tier: ${DIFFICULTIES[difficulty].name} (overall mastery ${Math.round(mastery * 100)}%).`];
  const typeBias = {};
  for (const k of TYPE_KEYS) {
    const p = prof.skills[`cls.${k}`].p;
    typeBias[k] = 0.6 + 2.2 * (1 - p);
  }
  const focus = {};
  const weak = weakestSkills(prof, 3, (s) => s.group !== 'Classify' && s.key !== 'detect');
  for (const w of weak) {
    const m = FOCUS_MAP[w.key];
    if (!m || w.p >= 0.65) continue;
    for (const f of m.focus) focus[f] = true;
    notes.push(`Targeting weakness: ${w.name} (${Math.round(w.p * 100)}%). Adding ${m.text}.`);
  }
  const weakTypes = weakestSkills(prof, 2, (s) => s.group === 'Classify');
  for (const w of weakTypes) {
    if (w.p < 0.65) notes.push(`More ${TYPES[w.type].name} contacts (recognition ${Math.round(w.p * 100)}%).`);
  }
  return { difficulty, typeBias, focus, notes };
}

// opts: { profile, adaptive, difficulty, overrides, seed, history }
export function buildSortie(opts) {
  const { profile, adaptive, difficulty = 'OPERATOR', overrides = {}, seed, history = [] } = opts;
  if (adaptive) {
    const a = adaptiveOptions(profile);
    return generateScenario({ seed, difficulty: a.difficulty, typeBias: a.typeBias, focus: a.focus, notes: a.notes, overrides, history });
  }
  return generateScenario({ seed, difficulty, overrides, history, notes: [`Fixed tier: ${DIFFICULTIES[difficulty]?.name || difficulty}. Scenario randomised from seed ${seed}.`] });
}
