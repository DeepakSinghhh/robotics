// Simulated Automatic Target Recognition (ATR) decision aid.
// Its reliability depends deliberately on conditions, and it can be fooled by
// decoys, so trainees learn to calibrate their trust in AI recommendations.

import { TYPES } from '../sim/catalog.js';

const CONFUSION = {
  QUAD: { HEXA: 3, BIRD: 1, FPV: 1 },
  HEXA: { QUAD: 3, FIXED_WING: 0.5 },
  FPV: { FPV_FIBER: 3, QUAD: 1, BIRD: 1 },
  FPV_FIBER: { FPV: 5, BIRD: 1 },
  FIXED_WING: { TACTICAL_UAV: 3, LOITER: 1 },
  LOITER: { DECOY: 3, FIXED_WING: 1 },
  DECOY: { LOITER: 5 },
  TACTICAL_UAV: { FIXED_WING: 4 },
  BIRD: { QUAD: 2, FPV: 1 },
};

// ctx: { accuracy, night, weatherVisual, ew, difficultyOrder, eo }
export function atrSuggest(rng, entity, ctx) {
  const truth = entity.type;
  let acc = ctx.accuracy;
  if (ctx.night) acc -= 0.05;
  acc -= (1 - (ctx.weatherVisual ?? 1)) * 0.15;
  acc -= (ctx.ew || 0) * 0.04;
  if (ctx.eo) acc += 0.05;
  acc = Math.max(0.35, Math.min(0.99, acc));

  // Adversarial mimicry: decoys are built to look like loitering munitions.
  if (truth === 'DECOY' && rng.chance(0.45 + 0.1 * (ctx.difficultyOrder || 0))) {
    return { cls: 'LOITER', conf: round2(rng.range(0.8, 0.95)), correct: false, adversarial: true };
  }
  if (rng.chance(acc)) {
    return { cls: truth, conf: round2(rng.range(0.72, 0.97)), correct: true };
  }
  const confusions = CONFUSION[truth] || {};
  const cls = Object.keys(confusions).length ? rng.weighted(confusions) : truth;
  if (cls === truth) return { cls, conf: round2(rng.range(0.6, 0.85)), correct: true };
  return { cls, conf: round2(rng.range(0.52, 0.88)), correct: false };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

// How should the trainee's reliance on the aid be judged?
// over = accepted a wrong suggestion, under = overrode a correct one with a wrong answer.
export function relianceVerdict(ai, answer, truth) {
  if (!ai || !answer) return 'n/a';
  const answerCorrect = answer === truth;
  if (ai.correct && answerCorrect) return 'appropriate';
  if (!ai.correct && answer === ai.cls) return 'over';
  if (!ai.correct && answerCorrect) return 'override';
  if (ai.correct && !answerCorrect) return 'under';
  return 'independent-error';
}

export const RELIANCE_LABELS = {
  appropriate: 'Appropriate reliance',
  override: 'Correct override of a wrong AI suggestion',
  over: 'Over-reliance (accepted a wrong AI suggestion)',
  under: 'Under-reliance (rejected a correct AI suggestion)',
  'independent-error': 'Wrong, and different from the AI',
  'n/a': '—',
};

export function typeName(k) {
  return TYPES[k]?.name || k || '—';
}
