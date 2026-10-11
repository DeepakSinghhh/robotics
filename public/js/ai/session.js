// Assemble the persistent session record from a finished simulation: scoring,
// mastery update, AI coach debrief and replay. Shared by the browser and the
// demo-data seeding script.

import { scoreSession } from './scoring.js';
import { normaliseProfile, applyObservations, certification } from './mastery.js';
import { coachDebrief } from './coach.js';

export function buildSessionRecord({ sim, spec, trainee, mode = 'sortie', startedAt = new Date().toISOString(), extra = {} }) {
  const result = scoreSession(sim);
  const before = normaliseProfile(trainee?.profile);
  // Exemplar (AI) runs are demonstrations: they never change anyone's mastery.
  const learn = mode !== 'exemplar' && !!trainee?.id;
  const { profile: after, deltas } = learn ? applyObservations(before, result.observations) : { profile: before, deltas: [] };
  const coach = coachDebrief(result, spec, deltas);
  const cert = certification(after);
  const session = {
    traineeId: trainee?.id || null,
    unitId: trainee?.unitId || null,
    mode,
    scenarioId: spec.id,
    scenarioName: spec.name,
    scenarioKind: spec.kind,
    difficulty: spec.difficulty,
    env: spec.env,
    wcs: spec.context.wcs,
    seed: spec.seed,
    fingerprint: spec.fingerprint,
    startedAt,
    duration: Math.round(sim.t),
    score: result.summary,
    cert: cert.level.key,
    tracks: result.tracks,
    events: sim.events,
    coach,
    deltas,
    observations: result.observations,
    spec,
    replay: { frames: sim.replay.frames, meta: sim.replay.meta },
    ...extra,
  };
  const history = [...(trainee?.history || []), spec.fingerprint].slice(-20);
  return { session, profile: after, history, cert };
}
