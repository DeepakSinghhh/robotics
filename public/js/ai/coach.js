// AI Coach: deterministic, rule-driven natural-language debrief built from the
// decision-tree traces. It works offline and every statement can be audited back
// to a scored event.

import { TYPES, EFFECTORS, ACTIONS, IDENTITIES } from '../sim/catalog.js';
import { LEAVES, RATINGS } from './doctrine.js';
import { SKILL_MAP } from './mastery.js';
import { fmtTime } from '../core/math.js';

const CUE_HINTS = {
  'FPV_FIBER>FPV': 'A fiber-optic FPV is RF-silent. Check the waterfall on its bearing before you choose the jammer.',
  'FPV>FPV_FIBER': 'A normal FPV radiates a wide analogue-video carrier at 5.8 GHz. If you see it, the jammer will work.',
  'DECOY>LOITER': 'Decoys are about 20% slower (around 40 m/s against 50), cooler on IR, and have a thinner engine note around 110 Hz.',
  'LOITER>DECOY': 'A real loitering munition flies at about 50 m/s with a loud ~95 Hz engine. Treat it as the top priority.',
  'TACTICAL_UAV>FIXED_WING': 'Own tactical UAVs fly the ATO corridor, emit a 1.3 GHz military datalink and answer Mode-5 IFF.',
  'FIXED_WING>TACTICAL_UAV': 'A hostile spotter orbits at stand-off outside the friendly corridor and emits in 0.9/2.4 GHz.',
  'HEXA>QUAD': 'A heavy hexacopter has six rotors, a larger radar return and a deep ~85 Hz note. It usually comes at night.',
  'QUAD>HEXA': 'A commercial quad is small, with a ~190 Hz whine and OcuSync hopping in 2.4/5.8 GHz.',
  'BIRD>QUAD': 'Birds have no RF and no motor noise, and their tracks wander without purpose.',
  'QUAD>BIRD': 'A track with an RF emitter on its bearing is not a bird.',
  'BIRD>FPV': 'Birds are slow (under 15 m/s). A fast, low, weaving track is an FPV.',
  'FPV>BIRD': 'Anything faster than 25 m/s that weaves low towards the position is an FPV, not a bird.',
};

function hint(truth, answer) {
  return CUE_HINTS[`${truth}>${answer}`] || `Recognition cues for ${TYPES[truth].short}: ${TYPES[truth].cues.slice(0, 3).join('; ')}.`;
}

const actName = (a) => (a ? ACTIONS[a]?.name || a : 'no action');
const typeShort = (k) => TYPES[k]?.short || k || 'unclassified';
const outcomeText = {
  LEAKED: 'leaked and struck the vital area',
  MISSION_COMPLETE: 'completed its mission (artillery was called in)',
  ACTIVE: 'was still active at ENDEX',
  EXITED: 'left the area',
  NEUTRALISED: 'was destroyed',
  SOFT_KILL: 'was soft-killed',
};

export function coachDebrief(result, spec, deltas = []) {
  const { summary: s, tracks } = result;
  const strengths = [];
  const improvements = [];
  const moments = [];

  // Headline.
  const headline = `${s.grade.name} (${s.total}/100). ${s.defeated} of ${s.threats} hostile threats defeated; vital area at ${s.assetHealth}%.`;

  // Strengths.
  if (s.medianDetection !== null && s.medianDetection <= 5) strengths.push(`Fast detection: median ${s.medianDetection}s from track appearance to acknowledgement.`);
  const real = tracks.filter((t) => !t.phantom && t.trackId);
  const clsCorrect = real.filter((t) => t.classification.correct).length;
  if (real.length >= 2 && clsCorrect / real.length >= 0.85) strengths.push(`Accurate recognition: ${clsCorrect}/${real.length} tracks classified correctly.`);
  if (s.threats > 0 && s.defeated === s.threats) strengths.push('Every hostile threat was defeated before it reached the vital area.');
  const softGood = tracks.filter((t) => t.decision.action === 'RF_JAM' && t.decision.truthRating === 'OPTIMAL').length;
  if (softGood >= 2) strengths.push(`Good use of soft-kill: ${softGood} RF-controlled threats jammed, with no collateral risk.`);
  const overrides = tracks.filter((t) => t.classification.reliance === 'override');
  if (overrides.length) strengths.push(`Good human-machine teaming: you correctly overrode a wrong AI suggestion on ${overrides.map((t) => t.trackId).join(', ')}.`);
  if (spec.context.wcs !== 'FREE' && s.stats.roe === 0 && tracks.some((t) => t.actions.length)) strengths.push(`ROE discipline held under ${spec.context.wcs === 'HOLD' ? 'WEAPONS HOLD' : 'WEAPONS TIGHT'}: no violations.`);
  const friends = tracks.filter((t) => t.identity === 'FRIEND' && t.identification.answer === 'FRIEND');
  if (friends.length) strengths.push(`Own UAV${friends.length > 1 ? 's' : ''} ${friends.map((t) => t.callsign || t.trackId).join(', ')} correctly deconflicted.`);
  const visual = tracks.filter((t) => t.detection.visualFirst);
  if (visual.length) strengths.push(`Visual detection beat the sensors on ${visual.map((t) => t.trackId).join(', ')}.`);

  // Improvements, most important (by weight) first.
  const issues = tracks
    .filter((t) => t.decision.rootCause !== 'none' || (t.classification.answer && !t.classification.correct) || t.roe.length)
    .sort((a, b) => b.weight * (100 - b.total) - a.weight * (100 - a.total));
  for (const t of issues.slice(0, 6)) {
    const id = t.trackId || `Untracked ${typeShort(t.type)}`;
    const d = t.decision;
    const leaf = d.truthLeaf ? LEAVES[d.truthLeaf] : null;
    switch (d.rootCause) {
      case 'classification':
        improvements.push({
          trackId: t.trackId, kind: 'classification',
          text: `${id}: it was a ${TYPES[t.type].name}, but you ${d.clsAtDecision ? `classified it ${typeShort(d.clsAtDecision)}` : 'engaged before classifying it'}, so ${actName(d.action)} looked right. ${d.clsAtDecision ? hint(t.type, d.clsAtDecision) : 'Classify before you commit an effector.'} Doctrine: ${leaf?.guidance || ''}`,
        });
        break;
      case 'identification':
        improvements.push({
          trackId: t.trackId, kind: 'identification',
          text: `${id}: identified ${IDENTITIES[d.identAtDecision]?.name || d.identAtDecision}, actual ${IDENTITIES[t.identity]?.name || t.identity}. ${t.identity === 'FRIEND' ? 'Interrogate IFF, and if there is no response, cross-check the ATO corridor and time window before you engage.' : 'Judge intent from behaviour: closing on the vital area or entering the restricted zone.'}`,
        });
        break;
      case 'doctrine':
        improvements.push({
          trackId: t.trackId, kind: 'doctrine',
          text: `${id} (${typeShort(t.type)}): ${actName(d.action)} was rated ${RATINGS[d.truthRating].label.toLowerCase()}. Doctrine (${leaf?.title}): ${leaf?.guidance}`,
        });
        break;
      case 'situation':
        improvements.push({ trackId: t.trackId, kind: 'situation', text: `${id}: your platform ID was right, but the situation was misread (TTI ${d.tti ?? '∞'}s, restricted zone, swarm context). Re-check the track card before you commit.` });
        break;
      case 'timing':
        improvements.push({ trackId: t.trackId, kind: 'timing', text: `${id}: you engaged with only ${d.tti}s to impact. Commit the first effector as soon as the target is in range and keep a backup ready.` });
        break;
      case 'no_decision':
        improvements.push({ trackId: t.trackId, kind: 'no_decision', text: `${id} (${typeShort(t.type)}) was tracked but never engaged, and it ${outcomeText[t.outcome.result] || t.outcome.result.toLowerCase()}.` });
        break;
      case 'undetected':
        improvements.push({ trackId: null, kind: 'undetected', text: `A ${TYPES[t.type].name} was never detected or acknowledged, and it ${outcomeText[t.outcome.result] || t.outcome.result.toLowerCase()}. On masked approaches, use RF and acoustic strobes to cue the EO camera.` });
        break;
      default:
        if (t.classification.answer && !t.classification.correct) {
          improvements.push({ trackId: t.trackId, kind: 'classification', text: `${id}: classified ${typeShort(t.classification.answer)}, actual ${typeShort(t.type)}. ${hint(t.type, t.classification.answer)}` });
        }
    }
    for (const r of t.roe) improvements.push({ trackId: t.trackId, kind: 'roe', text: `${id}: ${r.msg}.` });
  }

  const over = tracks.filter((t) => t.classification.reliance === 'over');
  if (over.length) {
    improvements.push({
      trackId: over[0].trackId, kind: 'ai',
      text: `Over-reliance on the AI aid: you accepted ${over.map((t) => `${typeShort(t.classification.answer)} on ${t.trackId} (actual ${typeShort(t.type)})`).join(', ')}. Check the AI against RF, acoustic and kinematic evidence, especially in poor conditions.`,
    });
  }
  if (s.medianDetection !== null && s.medianDetection > 10) improvements.push({ kind: 'detect', text: `Detection is slow (median ${s.medianDetection}s). Acknowledge each new track (Tab/Space) as soon as it appears and triage it later.` });
  if (s.stats.impacts > 0 && s.warnings === 0) improvements.push({ kind: 'warn', text: 'Hits were taken without an AIR SENTRY WARNING. Press W when any threat is inside about 40 s TTI. Troops under cover take about 45% less damage.' });
  if (s.stats.fratricide) improvements.push({ kind: 'fratricide', text: `${s.stats.fratricide} fratricide incident(s). Nothing is engaged until IFF and the ATO have been checked.` });
  if (s.stats.collateral) improvements.push({ kind: 'collateral', text: `${s.stats.collateral} collateral incident(s). In built-up areas prefer the jammer, interceptor or laser to the gun.` });
  if (s.stats.wasted >= 1) improvements.push({ kind: 'waste', text: 'Effectors were spent on decoys, birds or clutter. Keep interceptors for real munitions.' });

  // Key moments for AAR timeline jump-points.
  for (const t of tracks) {
    if (t.detection.ackAt !== null && t.identity === 'HOSTILE' && moments.length < 30) moments.push({ t: t.detection.ackAt, trackId: t.trackId, sev: 'info', text: `${t.trackId} acknowledged (${typeShort(t.type)})` });
    if (t.decision.t !== null && t.decision.action) moments.push({ t: t.decision.t, trackId: t.trackId, sev: RATINGS[t.decision.truthRating].points >= 70 ? 'good' : 'bad', text: `${t.trackId}: ${actName(t.decision.action)} (${RATINGS[t.decision.truthRating].label})` });
    if (['LEAKED', 'MISSION_COMPLETE', 'FRATRICIDE', 'KILLED_NEUTRAL'].includes(t.outcome.result) && t.outcome.t !== null) moments.push({ t: t.outcome.t, trackId: t.trackId, sev: 'bad', text: `${t.trackId || typeShort(t.type)} ${outcomeText[t.outcome.result] || t.outcome.result}` });
  }
  moments.sort((a, b) => a.t - b.t);

  // Focus for the next sortie.
  const focus = [];
  const worstDeltas = deltas.slice().sort((a, b) => a.after - b.after).slice(0, 3);
  for (const dd of worstDeltas) {
    const sk = SKILL_MAP[dd.skill];
    if (sk && dd.after < 0.6) focus.push(`${sk.name} (mastery ${Math.round(dd.after * 100)}%)`);
  }
  const causes = s.rootCauses || {};
  const top = Object.entries(causes).sort((a, b) => b[1] - a[1])[0];
  if (top && top[0] === 'classification') focus.push('Run a Recognition Drill before the next sortie');
  if (top && top[0] === 'doctrine') focus.push('Review the decision tree in the Threat Library (effector selection)');

  const narrative = [
    `Mission ${spec.name}: ${spec.env.time} / ${spec.env.weather} / ${spec.env.terrain}, ${spec.context.wcs === 'FREE' ? 'weapons free' : spec.context.wcs === 'TIGHT' ? 'weapons tight' : 'weapons hold'}.`,
    `ENDEX at ${fmtTime(s.duration)}: ${s.endReason}.`,
    s.penaltyTotal > 0 ? `Penalties of ${s.penaltyTotal} points (asset damage ${s.penalties.damage}, ROE ${s.penalties.roe}, collateral ${s.penalties.collateral}, fratricide ${s.penalties.fratricide}).` : 'No penalties.',
  ].join(' ');

  if (!strengths.length) strengths.push('You completed the sortie. Every repetition builds pattern recognition.');
  if (!improvements.length) improvements.push({ kind: 'none', text: 'No significant errors. Try the next difficulty tier or Adaptive mode.' });

  return { headline, narrative, strengths, improvements, moments, focus };
}

export function effectorName(k) {
  return EFFECTORS[k]?.name || k;
}
