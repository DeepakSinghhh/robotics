// C-UAS doctrinal decision tree. It is plain data so the AAR can draw it, and it is
// evaluated twice per decision: once on ground truth and once on what the trainee
// perceived (their classification and identification). Comparing the two paths tells
// us WHY a decision was wrong (classification vs identification vs doctrine vs timing).

import { TYPES, EFFECTOR_KEYS } from '../sim/catalog.js';

export const RATINGS = {
  OPTIMAL: { key: 'OPTIMAL', points: 100, label: 'Optimal', color: '#3ddc84' },
  ACCEPTABLE: { key: 'ACCEPTABLE', points: 70, label: 'Acceptable', color: '#a3d977' },
  POOR: { key: 'POOR', points: 35, label: 'Poor', color: '#ffb347' },
  WRONG: { key: 'WRONG', points: 0, label: 'Wrong', color: '#ff6b6b' },
  PROHIBITED: { key: 'PROHIBITED', points: -100, label: 'Prohibited', color: '#d63031' },
};
const RANK = { OPTIMAL: 4, ACCEPTABLE: 3, POOR: 2, WRONG: 1, PROHIBITED: 0 };
export const rank = (r) => RANK[r] ?? 0;

export const ALL_ACTIONS = ['MONITOR', 'DISMISS', ...EFFECTOR_KEYS];

const weatherDegradesLaser = (c) => c.weather !== 'clear';

export const NODES = {
  D1: { id: 'D1', short: 'UAS?', q: 'Is the contact a UAS?', yes: 'D2', no: 'L_DISMISS', test: (c) => c.isUAS,
    explain: 'Birds, flocks and radar clutter are not UAS. Dismiss them to free operator attention.' },
  D2: { id: 'D2', short: 'Friendly (IFF / ATO)?', q: 'Is it friendly (valid IFF or matches the ATO in the corridor)?', yes: 'L_HOLD', no: 'D3', test: (c) => c.friendly,
    explain: 'Own aircraft must be deconflicted before any engagement. Engaging them is fratricide.' },
  D3: { id: 'D3', short: 'Hostile act / intent?', q: 'Does it show hostile act or intent?', yes: 'D4', no: 'L_NEUTRAL', test: (c) => c.hostileIntent,
    explain: 'Hostile intent: a weaponised or hostile class, closing on the vital area, or entering the restricted zone.' },
  D4: { id: 'D4', short: 'WCS permits?', q: 'Does the weapons control status permit engagement?', yes: 'D5', no: 'L_REPORT', test: (c) => c.wcs !== 'HOLD' || c.tti < 25,
    explain: 'Under WEAPONS HOLD you may fire only in self-defence (imminent impact).' },
  D5: { id: 'D5', short: 'Imminent (TTI < 20 s)?', q: 'Is impact imminent (TTI < 20 s)?', yes: 'L_IMMINENT', no: 'D5B', test: (c) => c.tti < 20,
    explain: 'Very little time left: use the fastest effector with the highest Pk, and warn the troops.' },
  D5B: { id: 'D5B', short: 'Decoy?', q: 'Is it a decoy?', yes: 'L_DECOY', no: 'D6', test: (c) => c.decoy,
    explain: 'Defeat decoys with the cheapest effective means and keep high-value effectors for real threats.' },
  D6: { id: 'D6', short: 'RF command link?', q: 'Is there an RF command link?', yes: 'D7', no: 'D8', test: (c) => c.rfLink,
    explain: 'RF-controlled drones can be soft-killed by jamming. Autonomous and fiber-guided drones cannot.' },
  D7: { id: 'D7', short: 'Swarm (≥ 5)?', q: 'Is it a swarm (5 or more hostiles at once)?', yes: 'L_SWARM_RF', no: 'D7B', test: (c) => c.swarm,
    explain: 'Area soft-kill handles many RF-controlled drones at once.' },
  D7B: { id: 'D7B', short: 'Collateral constraints?', q: 'Are there collateral constraints (urban or civilians)?', yes: 'L_RF_URBAN', no: 'L_RF_RURAL', test: (c) => c.urban,
    explain: 'In built-up areas, avoid kinetic effects that throw rounds and debris over civilians.' },
  D8: { id: 'D8', short: 'GNSS-guided & TTI > 45 s?', q: 'Is it GNSS-guided, with time to act (TTI > 45 s)?', yes: 'L_SPOOF', no: 'D9', test: (c) => c.gnss && c.tti > 45,
    explain: 'GNSS spoofing can divert autonomous drones, but it needs time to take effect.' },
  D9: { id: 'D9', short: 'Collateral constraints?', q: 'Are there collateral constraints (urban or civilians)?', yes: 'L_HARD_URBAN', no: 'L_HARD_RURAL', test: (c) => c.urban,
    explain: 'Pick the hard-kill effector with the lowest collateral risk.' },
};

// Leaves rate every action. Functions receive the context.
export const LEAVES = {
  L_DISMISS: {
    id: 'L_DISMISS', title: 'DISMISS — non-UAS', guidance: 'Mark it non-UAS and dismiss. Do not spend effectors.',
    rate: () => ({ DISMISS: 'OPTIMAL', MONITOR: 'ACCEPTABLE', RF_JAM: 'POOR', GNSS_SPOOF: 'POOR', LASER: 'WRONG', GUN: 'WRONG', INTERCEPTOR: 'WRONG' }),
  },
  L_HOLD: {
    id: 'L_HOLD', title: 'HOLD FIRE — friendly', guidance: 'Hold fire, deconflict and keep monitoring. Keep jammers and spoofers off its sector.',
    rate: () => ({ MONITOR: 'OPTIMAL', DISMISS: 'POOR', RF_JAM: 'PROHIBITED', GNSS_SPOOF: 'WRONG', GUN: 'PROHIBITED', INTERCEPTOR: 'PROHIBITED', LASER: 'PROHIBITED' }),
  },
  L_NEUTRAL: {
    id: 'L_NEUTRAL', title: 'MONITOR & REPORT — neutral', guidance: 'Monitor and report it to the civil authority. Soft-kill only if it violates the restricted zone.',
    rate: () => ({ MONITOR: 'OPTIMAL', DISMISS: 'POOR', RF_JAM: 'WRONG', GNSS_SPOOF: 'WRONG', GUN: 'PROHIBITED', INTERCEPTOR: 'PROHIBITED', LASER: 'PROHIBITED' }),
  },
  L_REPORT: {
    id: 'L_REPORT', title: 'REPORT — WEAPONS HOLD', guidance: 'Track it, report it and request release authority. Engage only if impact becomes imminent.',
    rate: () => ({ MONITOR: 'OPTIMAL', DISMISS: 'WRONG', RF_JAM: 'WRONG', GNSS_SPOOF: 'WRONG', GUN: 'WRONG', INTERCEPTOR: 'WRONG', LASER: 'WRONG' }),
  },
  L_IMMINENT: {
    id: 'L_IMMINENT', title: 'HARD-KILL NOW — imminent', guidance: 'Use the fastest, highest-Pk effector now (gun, or laser in clear weather) and warn the troops.',
    rate: (c) => ({
      GUN: 'OPTIMAL',
      LASER: weatherDegradesLaser(c) ? 'POOR' : 'ACCEPTABLE',
      RF_JAM: c.rfLink ? 'ACCEPTABLE' : 'WRONG',
      INTERCEPTOR: 'POOR',
      GNSS_SPOOF: 'WRONG', MONITOR: 'WRONG', DISMISS: 'WRONG',
    }),
  },
  L_DECOY: {
    id: 'L_DECOY', title: 'CHEAP KILL — decoy', guidance: 'Gun or laser (cheap per shot), or spoof it if there is time. Save interceptors.',
    rate: (c) => ({
      GUN: c.urban ? 'ACCEPTABLE' : 'OPTIMAL',
      LASER: weatherDegradesLaser(c) ? 'POOR' : 'OPTIMAL',
      GNSS_SPOOF: c.tti > 45 ? 'OPTIMAL' : 'ACCEPTABLE',
      INTERCEPTOR: 'POOR', RF_JAM: 'WRONG',
      MONITOR: c.tti > 60 ? 'ACCEPTABLE' : 'POOR', DISMISS: 'WRONG',
    }),
  },
  L_SWARM_RF: {
    id: 'L_SWARM_RF', title: 'AREA SOFT-KILL — swarm', guidance: 'Use wide-sector RF jamming against the swarm, then hard-kill the leakers in TTI order.',
    rate: (c) => ({
      RF_JAM: 'OPTIMAL',
      GNSS_SPOOF: c.gnss ? 'ACCEPTABLE' : 'POOR',
      GUN: c.urban ? 'POOR' : 'ACCEPTABLE',
      LASER: weatherDegradesLaser(c) ? 'POOR' : 'ACCEPTABLE',
      INTERCEPTOR: 'POOR', MONITOR: 'WRONG', DISMISS: 'WRONG',
    }),
  },
  L_RF_URBAN: {
    id: 'L_RF_URBAN', title: 'SOFT-KILL (RF JAM) — urban', guidance: 'Jam the RF link. Use an interceptor or laser as the low-collateral backup. Avoid the gun.',
    rate: (c) => ({
      RF_JAM: 'OPTIMAL', INTERCEPTOR: 'ACCEPTABLE',
      LASER: weatherDegradesLaser(c) ? 'POOR' : 'ACCEPTABLE',
      GNSS_SPOOF: c.gnss ? 'ACCEPTABLE' : 'WRONG',
      GUN: 'POOR', MONITOR: 'WRONG', DISMISS: 'WRONG',
    }),
  },
  L_RF_RURAL: {
    id: 'L_RF_RURAL', title: 'SOFT-KILL (RF JAM)', guidance: 'Jam the RF link first. Gun, laser or interceptor are acceptable backups.',
    rate: (c) => ({
      RF_JAM: 'OPTIMAL', GUN: 'ACCEPTABLE', INTERCEPTOR: 'ACCEPTABLE',
      LASER: weatherDegradesLaser(c) ? 'POOR' : 'ACCEPTABLE',
      GNSS_SPOOF: c.gnss ? 'ACCEPTABLE' : 'WRONG',
      MONITOR: 'WRONG', DISMISS: 'WRONG',
    }),
  },
  L_SPOOF: {
    id: 'L_SPOOF', title: 'GNSS SPOOF + hard-kill backup', guidance: 'Spoof GNSS to divert it while time allows, and keep a hard-kill effector laid on as backup.',
    rate: (c) => ({
      GNSS_SPOOF: 'OPTIMAL',
      GUN: c.urban ? 'POOR' : 'OPTIMAL',
      INTERCEPTOR: c.urban ? 'OPTIMAL' : 'ACCEPTABLE',
      LASER: weatherDegradesLaser(c) ? 'POOR' : 'ACCEPTABLE',
      RF_JAM: 'WRONG', MONITOR: 'WRONG', DISMISS: 'WRONG',
    }),
  },
  L_HARD_URBAN: {
    id: 'L_HARD_URBAN', title: 'LOW-COLLATERAL HARD-KILL', guidance: 'Use an interceptor drone, or the laser in clear weather. The gun risks collateral damage.',
    rate: (c) => ({
      INTERCEPTOR: 'OPTIMAL',
      LASER: weatherDegradesLaser(c) ? 'POOR' : 'OPTIMAL',
      GUN: 'POOR',
      GNSS_SPOOF: c.gnss ? 'ACCEPTABLE' : 'WRONG',
      RF_JAM: 'WRONG', MONITOR: 'WRONG', DISMISS: 'WRONG',
    }),
  },
  L_HARD_RURAL: {
    id: 'L_HARD_RURAL', title: 'HARD-KILL', guidance: 'Gun (or laser in clear weather). The interceptor is an acceptable alternative.',
    rate: (c) => ({
      GUN: 'OPTIMAL',
      LASER: weatherDegradesLaser(c) ? 'POOR' : 'OPTIMAL',
      INTERCEPTOR: 'ACCEPTABLE',
      GNSS_SPOOF: c.gnss ? 'ACCEPTABLE' : 'WRONG',
      RF_JAM: 'WRONG', MONITOR: 'WRONG', DISMISS: 'WRONG',
    }),
  },
};

// Tree layout for drawing (depth-first order, parent links).
export const TREE_ORDER = ['D1', 'L_DISMISS', 'D2', 'L_HOLD', 'D3', 'L_NEUTRAL', 'D4', 'L_REPORT', 'D5', 'L_IMMINENT', 'D5B', 'L_DECOY', 'D6', 'D7', 'L_SWARM_RF', 'D7B', 'L_RF_URBAN', 'L_RF_RURAL', 'D8', 'L_SPOOF', 'D9', 'L_HARD_URBAN', 'L_HARD_RURAL'];

export function evaluate(ctx) {
  const path = [];
  let id = 'D1';
  let guard = 0;
  while (NODES[id] && guard++ < 20) {
    const node = NODES[id];
    const answer = !!node.test(ctx);
    path.push({ id, q: node.q, answer });
    id = answer ? node.yes : node.no;
  }
  const leaf = LEAVES[id];
  const ratings = leaf.rate(ctx);
  for (const a of ALL_ACTIONS) if (!ratings[a]) ratings[a] = 'WRONG';
  // EW-fratricide modifiers: own UAVs near soft-kill effects.
  const modifiers = [];
  if (ctx.friendlyInJamBeam && rank(ratings.RF_JAM) > rank('POOR')) {
    ratings.RF_JAM = 'POOR';
    modifiers.push({ id: 'M_JAM', text: 'An own UAV is inside the jammer beam, so jamming would also cut its link.' });
  }
  if (ctx.friendlyInSpoofRange && rank(ratings.GNSS_SPOOF) > rank('POOR')) {
    ratings.GNSS_SPOOF = 'POOR';
    modifiers.push({ id: 'M_SPOOF', text: 'An own UAV is within spoofer range, so spoofing would corrupt its navigation.' });
  }
  return { path, leafId: id, leaf: { id, title: leaf.title, guidance: leaf.guidance }, ratings, modifiers };
}

// Context builders --------------------------------------------------------------

// Truth context: what an omniscient doctrine expert would know.
export function truthContext({ entity, tti, inRestricted, wcs, urban, weather, swarmCount, friendlyInJamBeam = false, friendlyInSpoofRange = false }) {
  const def = TYPES[entity.type];
  const isUAS = entity.type !== 'BIRD' && !entity.phantom;
  return {
    view: 'truth',
    type: entity.type,
    isUAS,
    friendly: entity.identity === 'FRIEND',
    hostileIntent: entity.identity === 'HOSTILE' || (entity.identity === 'NEUTRAL' && inRestricted),
    wcs, tti, urban, weather,
    rfLink: !!entity.rfEmitting,
    gnss: !!def?.gnss,
    decoy: entity.type === 'DECOY',
    swarm: swarmCount >= 5,
    friendlyInJamBeam, friendlyInSpoofRange,
  };
}

// Perceived context: built from the trainee's own classification/identification
// and from observable sensor evidence.
export function perceivedContext({ cls, ident, rfEvidence, tti, inRestricted, wcs, urban, weather, swarmCount, friendlyInJamBeam = false, friendlyInSpoofRange = false }) {
  const def = cls ? TYPES[cls] : null;
  const isUAS = cls ? cls !== 'BIRD' && ident !== 'NON_UAS' : ident !== 'NON_UAS';
  const unknownIdent = !ident || ident === 'UNKNOWN' || ident === 'SUSPECT';
  const hostileIntent = ident === 'HOSTILE'
    || (ident === 'NEUTRAL' && inRestricted)
    || (unknownIdent && (tti < 180 || inRestricted || (def && def.threat >= 3)));
  return {
    view: 'perceived',
    type: cls,
    isUAS,
    friendly: ident === 'FRIEND',
    hostileIntent,
    wcs, tti, urban, weather,
    rfLink: def ? def.rf.emits : !!rfEvidence,
    gnss: def ? def.gnss : true,
    decoy: cls === 'DECOY',
    swarm: swarmCount >= 5,
    friendlyInJamBeam, friendlyInSpoofRange,
  };
}

// Score a chosen action given the truth evaluation and what was available.
export function rateDecision(action, truthEval, perceivedEval, available, { clsCorrect, identCorrect }) {
  const truthRating = truthEval.ratings[action] || 'WRONG';
  const perceivedRating = perceivedEval ? perceivedEval.ratings[action] || 'WRONG' : truthRating;
  const availableActions = ALL_ACTIONS.filter((a) => available[a]);
  let best = null;
  for (const a of availableActions) {
    const r = truthEval.ratings[a];
    if (!best || rank(r) > rank(truthEval.ratings[best])) best = a;
  }
  const bestPoints = best ? RATINGS[truthEval.ratings[best]].points : 100;
  const pts = RATINGS[truthRating].points;
  const score = pts < 0 ? pts : bestPoints > 0 ? Math.min(100, (pts / bestPoints) * 100) : 0;
  let rootCause = 'none';
  if (rank(truthRating) < rank('ACCEPTABLE')) {
    if (rank(perceivedRating) >= rank('ACCEPTABLE')) {
      rootCause = !clsCorrect ? 'classification' : !identCorrect ? 'identification' : 'situation';
    } else {
      rootCause = 'doctrine';
    }
  }
  const optimal = ALL_ACTIONS.filter((a) => truthEval.ratings[a] === 'OPTIMAL');
  return { truthRating, perceivedRating, score, bestAvailable: best, optimal, rootCause };
}
