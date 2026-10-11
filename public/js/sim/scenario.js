// Scenario specs: procedural generation, scripted missions and wave expansion.
// A ScenarioSpec is plain JSON so it can be stored, edited in the builder and replayed.

import { Rng, hashString } from '../core/rng.js';
import { wrap360, polar, dist2 } from '../core/math.js';
import { TYPES, DIFFICULTIES, TERRAINS, ASSETS, GEOMETRY } from './catalog.js';

export const PROFILES = {
  isr: 'ISR approach then hover/orbit; may drop munitions',
  bomber: 'Fly to target, hover, drop, egress',
  lowlevel: 'Low-level terrain-masked attack with pop-up and dive',
  attack: 'Direct attack with terminal dive',
  orbit: 'Stand-off ISR orbit (artillery spotting)',
  corridor: 'Friendly corridor transit and overwatch orbit',
  neutral: 'Civil/hobby flight wandering near the site',
  bird: 'Wandering bird flock',
};

export const SPAWN_DEFAULTS = {
  QUAD: { range: [1900, 2700], profile: 'isr' },
  HEXA: { range: [1900, 2500], profile: 'bomber' },
  FPV: { range: [3000, 4000], profile: 'lowlevel' },
  FPV_FIBER: { range: [2400, 3300], profile: 'lowlevel' },
  FIXED_WING: { range: [5000, 5800], profile: 'orbit' },
  LOITER: { range: [5800, 6300], profile: 'attack' },
  DECOY: { range: [5600, 6100], profile: 'attack' },
  TACTICAL_UAV: { range: [5200, 5700], profile: 'corridor' },
  BIRD: { range: [700, 2600], profile: 'bird' },
};

export const SWARM_TACTICS = {
  saturation: 'Fan out onto multiple axes and arrive together',
  wedge: 'Tight wedge formation behind a leader',
  split: 'Split into two pincers at 2 km',
  decoy_screen: 'Decoys lead to draw fire; real munitions follow',
};

const CALLSIGNS = ['NETRA-21', 'GARUDA-14', 'HANSA-07', 'DRISHTI-32', 'TAPAS-11', 'RUSTOM-05'];

function defaultIdentity(type) {
  return TYPES[type]?.defaultIdentity || 'HOSTILE';
}

function meanSpeed(type, mul = 1) {
  const s = TYPES[type].speed;
  return ((s[0] + s[1]) / 2) * mul;
}

export function travelTime(type, profile, range, mul = 1) {
  const v = meanSpeed(type, mul);
  switch (profile) {
    case 'isr': return (range - 550) / v + 50;
    case 'bomber': return range / v + 12;
    case 'orbit': return Math.max(0, range - 2600) / v + 70;
    case 'lowlevel':
    case 'attack': return (range - GEOMETRY.defendedRadius) / v;
    default: return 0;
  }
}

export function fingerprint(spec) {
  const comp = {};
  for (const w of spec.waves) {
    if (w.mix) for (const [k, n] of Object.entries(w.mix)) comp[k] = (comp[k] || 0) + n;
    else comp[w.type] = (comp[w.type] || 0) + (w.count || 1);
  }
  const swarm = spec.waves.filter((w) => w.swarm).map((w) => w.tactic).sort();
  const key = JSON.stringify({
    e: [spec.env.terrain, spec.env.time, spec.env.weather, spec.env.ew],
    c: Object.keys(comp).sort().map((k) => `${k}${comp[k]}`),
    s: swarm,
    a: Math.round(wrap360(spec.context.threatAxis || 0) / 45) % 8,
    w: spec.context.wcs,
  });
  return hashString(key).toString(36);
}

function pickAsset(rng, terrain) {
  const options = terrain === 'urban' ? ['VIP', 'POWER', 'FOB'] : terrain === 'mountain' ? ['FOB', 'ARTY'] : ['FOB', 'ARTY', 'AIRBASE', 'POWER'];
  const type = rng.pick(options);
  return { type, name: rng.pick(ASSETS[type].names) };
}

function intelEstimate(rng, waves) {
  const actual = [...new Set(waves.filter((w) => w.identity === 'HOSTILE').flatMap((w) => (w.mix ? Object.keys(w.mix) : [w.type])))];
  const pool = ['QUAD', 'HEXA', 'FPV', 'FIXED_WING', 'LOITER'];
  const shown = rng.shuffle(actual).slice(0, Math.max(1, Math.ceil(actual.length * 0.7)));
  const red = rng.pick(pool.filter((p) => !actual.includes(p)));
  if (red && rng.chance(0.6)) shown.push(red);
  return rng.shuffle(shown).map((k) => TYPES[k].name);
}

// opts: { seed, difficulty, overrides, typeBias, focus, notes, history }
export function generateScenario(opts = {}) {
  const history = opts.history || [];
  let spec;
  for (let attempt = 0; attempt < 8; attempt++) {
    spec = buildProcedural({ ...opts, seed: (opts.seed ?? 1) + attempt * 7919 });
    if (!history.includes(spec.fingerprint)) {
      if (attempt > 0) spec.directorNotes.push(`Re-rolled ${attempt}× so a recent sortie is not repeated (anti-rote check).`);
      return spec;
    }
  }
  return spec;
}

function buildProcedural({ seed = 1, difficulty = 'OPERATOR', overrides = {}, typeBias = {}, focus = {}, notes = [] }) {
  const D = DIFFICULTIES[difficulty] || DIFFICULTIES.OPERATOR;
  const rng = new Rng(seed);
  const envRng = rng.fork('env');
  const terrain = overrides.terrain || envRng.weighted({ rural: 1.2, urban: focus.urban ? 3.5 : 1, mountain: 1 });
  const time = overrides.time || (envRng.chance(focus.night ? 0.75 : D.nightChance) ? 'night' : envRng.chance(0.22) ? 'dusk' : 'day');
  const weather = overrides.weather || (envRng.chance(focus.degraded ? 0.65 : D.weatherChance) ? envRng.pick(['fog', 'rain', 'dust']) : 'clear');
  let ew = overrides.ew ?? (D.ewMax === 0 ? 0 : envRng.chance(focus.degraded ? 0.8 : 0.45) ? envRng.int(1, D.ewMax) : 0);
  ew = Math.max(0, Math.min(2, ew));
  const asset = overrides.assetType ? { type: overrides.assetType, name: envRng.pick(ASSETS[overrides.assetType].names) } : pickAsset(envRng, terrain);
  const wcs = overrides.wcs || (asset.type === 'VIP' ? 'TIGHT' : D.order === 0 ? 'FREE'
    : envRng.weighted({ FREE: 0.45, TIGHT: focus.urban_roe ? 1.2 : 0.45, HOLD: D.order >= 2 ? 0.12 : 0 }));
  const civilianDensity = Math.min(1, TERRAINS[terrain].civilianDensity + (asset.type === 'VIP' ? 0.15 : 0));
  const threatAxis = envRng.range(0, 360);
  const duration = overrides.duration || D.duration;

  const waveRng = rng.fork('waves');
  const waves = [];
  const speedMul = D.speedMul;

  const weights = {
    QUAD: 3, HEXA: time === 'night' ? 3 : 1, FPV: 3, FPV_FIBER: D.fiberChance * 8,
    FIXED_WING: 1.3, LOITER: D.order === 0 ? 0.5 : 2, DECOY: D.decoyChance * 3,
  };
  for (const k of Object.keys(weights)) weights[k] *= typeBias[k] ?? 1;

  const nThreats = waveRng.int(D.threats[0], D.threats[1]);
  let t = waveRng.range(8, 16);
  for (let i = 0; i < nThreats; i++) {
    const type = waveRng.weighted(weights);
    const def = SPAWN_DEFAULTS[type];
    let range = waveRng.range(def.range[0], def.range[1]);
    const bearing = waveRng.chance(0.75) ? wrap360(threatAxis + waveRng.gauss(0, 32)) : waveRng.range(0, 360);
    const tt = travelTime(type, def.profile, range, speedMul);
    const latest = duration - tt - 15;
    let at = t;
    if (at > latest) {
      at = Math.max(4, latest);
      if (latest < 4) range = Math.max(1200, range - (4 - latest) * meanSpeed(type, speedMul));
    }
    waves.push({ t: round1(at), type, count: 1, bearing: round1(bearing), range: Math.round(range), profile: def.profile, identity: 'HOSTILE' });
    const simultaneous = waveRng.chance(0.12 + 0.08 * D.order);
    t += simultaneous ? waveRng.range(2, 6) : waveRng.range(D.waveGap[0], D.waveGap[1]);
  }

  if (D.swarmSize[1] > 0 && waveRng.chance(focus.swarm ? 0.85 : D.swarmChance)) {
    const size = waveRng.int(D.swarmSize[0], D.swarmSize[1]);
    const tactics = ['saturation', 'wedge', 'split'];
    if (D.decoyChance > 0) tactics.push('decoy_screen');
    const tactic = waveRng.pick(tactics);
    const at = round1(waveRng.range(duration * 0.28, duration * 0.5));
    const bearing = round1(wrap360(threatAxis + waveRng.gauss(0, 25)));
    if (tactic === 'decoy_screen') {
      const real = Math.max(2, Math.round(size * 0.4));
      waves.push({ t: at, type: 'LOITER', swarm: true, tactic, mix: { DECOY: size - real, LOITER: real }, count: size, bearing, range: 6000, profile: 'attack', identity: 'HOSTILE' });
    } else {
      const base = time === 'day' && waveRng.chance(0.35) ? 'QUAD' : 'FPV';
      const mix = { [base]: size };
      if (base === 'FPV' && D.fiberChance > 0) {
        const fibers = Math.min(size - 1, waveRng.int(0, Math.ceil(size * D.fiberChance)));
        if (fibers > 0) { mix.FPV = size - fibers; mix.FPV_FIBER = fibers; }
      }
      const range = base === 'QUAD' ? 2600 : 3800;
      const profile = base === 'QUAD' ? 'attack' : 'lowlevel';
      waves.push({ t: at, type: base, swarm: true, tactic, mix, count: size, bearing, range, profile, identity: 'HOSTILE' });
    }
  }

  const nBirds = waveRng.int(D.birds[0], D.birds[1]);
  for (let i = 0; i < nBirds; i++) {
    waves.push({ t: round1(waveRng.range(5, duration * 0.7)), type: 'BIRD', count: 1, bearing: round1(waveRng.range(0, 360)), range: Math.round(waveRng.range(700, 2400)), profile: 'bird', identity: 'NON_UAS' });
  }

  const ato = [];
  let corridor = null;
  if (waveRng.chance(focus.iff ? 0.95 : D.friendlyChance)) {
    corridor = { bearing: round1(wrap360(threatAxis + 180 + waveRng.gauss(0, 35))), width: 20 };
    const nf = D.order >= 2 && waveRng.chance(0.4) ? 2 : 1;
    for (let i = 0; i < nf; i++) {
      const at = round1(waveRng.range(15, Math.max(30, duration * 0.45)));
      const callsign = waveRng.pick(CALLSIGNS.filter((c) => !ato.some((a) => a.callsign === c)));
      const iffFail = waveRng.chance(focus.iff ? Math.max(0.35, D.iffFail) : D.iffFail);
      waves.push({ t: at, type: 'TACTICAL_UAV', count: 1, bearing: corridor.bearing, range: 5400, profile: 'corridor', identity: 'FRIEND', iffFail, callsign });
      ato.push({ callsign, type: 'TACTICAL_UAV', windowStart: Math.max(0, Math.round(at - 10)), windowEnd: Math.round(at + 210), alt: '300–600 m', corridor: corridor.bearing });
    }
  }

  const neutralChance = D.neutralChance * (terrain === 'urban' ? 1.6 : 0.8);
  if (waveRng.chance(Math.min(0.95, neutralChance))) {
    waves.push({ t: round1(waveRng.range(10, duration * 0.5)), type: 'QUAD', count: 1, bearing: round1(waveRng.range(0, 360)), range: 2400, profile: 'neutral', identity: 'NEUTRAL', strays: waveRng.chance(0.5) });
  }

  waves.sort((a, b) => a.t - b.t);

  const effectors = {
    RF_JAM: true, GNSS_SPOOF: true,
    GUN: { ammo: D.order >= 3 ? 26 : 32 },
    INTERCEPTOR: { count: D.order >= 3 ? 3 : 4 },
    LASER: !(D.order >= 2 && waveRng.chance(0.2)),
  };
  const aiAccuracy = Math.max(0.55, D.aiAccuracy - (focus.ai_teaming ? 0.08 : 0));

  const spec = {
    id: `proc-${seed}`,
    kind: 'procedural',
    name: `Sortie ${String(seed % 100000).padStart(5, '0')}`,
    seed,
    difficulty: D.key,
    env: { terrain, time, weather, ew },
    context: {
      assetType: asset.type, assetName: asset.name, wcs, civilianDensity, threatAxis: round1(threatAxis),
      defendedRadius: GEOMETRY.defendedRadius, restrictedRadius: GEOMETRY.restrictedRadius, corridor, ato,
    },
    effectors,
    aiAid: { enabled: true, accuracy: aiAccuracy },
    sensors: { protocolLibrary: D.protocolLibrary && ew < 2, radarPd: D.radarPd },
    speedMul,
    duration,
    popUps: D.popUps,
    waves,
    directorNotes: [...notes],
  };
  spec.intel = intelEstimate(rng.fork('intel'), waves);
  spec.brief = autoBrief(spec);
  spec.fingerprint = fingerprint(spec);
  return spec;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

export function autoBrief(spec) {
  const T = TERRAINS[spec.env.terrain];
  const a = ASSETS[spec.context.assetType];
  return `You are the C-UAS detachment commander at ${spec.context.assetName} (${a.name}) in ${T.name.toLowerCase()} terrain. `
    + `Hostile UAS activity has been reported on the ${compass(spec.context.threatAxis)} axis. `
    + `Detect, track, identify and defeat hostile drones before they enter the ${spec.context.defendedRadius} m vital area. Protect civilians and own aircraft.`;
}

export function compass(b) {
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return names[Math.round(wrap360(b) / 45) % 8];
}

// Expand waves into concrete, deterministic spawn orders.
export function expandWaves(spec) {
  const rng = new Rng(spec.seed).fork('spawn');
  const orders = [];
  let swarmNo = 0;
  for (const w of spec.waves) {
    const identity = w.identity || defaultIdentity(w.type);
    const profile = w.profile || SPAWN_DEFAULTS[w.type]?.profile || 'attack';
    if (w.swarm) {
      swarmNo += 1;
      const swarmId = `S${swarmNo}`;
      const members = [];
      const mix = w.mix || { [w.type]: w.count || 5 };
      for (const [type, n] of Object.entries(mix)) for (let i = 0; i < n; i++) members.push(type);
      const order = rng.shuffle(members);
      const tactic = w.tactic || 'saturation';
      const spread = tactic === 'saturation' ? 100 : 70;
      order.forEach((type, i) => {
        const bearing = wrap360(w.bearing + rng.gauss(0, 3));
        const range = w.range + rng.range(-120, 120);
        let at = w.t + rng.range(0, 2);
        const o = {
          t: at, type, identity, profile: type === 'LOITER' || type === 'DECOY' ? 'attack' : profile,
          bearing, range, swarmId, tactic, slot: i, size: order.length, waypoints: [], speedFactor: 1,
        };
        if (tactic === 'saturation') {
          const off = order.length > 1 ? -spread / 2 + (spread * i) / (order.length - 1) : 0;
          o.waypoints.push(polar(wrap360(w.bearing + off), 1700));
        } else if (tactic === 'split') {
          const side = i % 2 === 0 ? -1 : 1;
          o.waypoints.push(polar(wrap360(w.bearing + side * 38), 2100));
        } else if (tactic === 'wedge') {
          o.leaderSlot = 0;
          const row = Math.ceil(i / 2), side = i % 2 === 0 ? 1 : -1;
          o.offset = { lateral: i === 0 ? 0 : side * row * 22, back: row * 26 };
        } else if (tactic === 'decoy_screen') {
          if (type !== 'DECOY') o.t = at + rng.range(12, 18);
          o.bearing = wrap360(w.bearing + rng.gauss(0, 6));
        }
        orders.push(o);
      });
      // Saturation/split: synchronise arrival at waypoints.
      const group = orders.filter((o) => o.swarmId === swarmId && o.waypoints.length);
      if (group.length) {
        const dists = group.map((o) => dist2(polar(o.bearing, o.range), o.waypoints[0]));
        const max = Math.max(...dists);
        group.forEach((o, i) => { o.speedFactor = Math.max(0.6, dists[i] / max); });
      }
    } else {
      const n = w.count || 1;
      let at = w.t;
      for (let i = 0; i < n; i++) {
        orders.push({
          t: at, type: w.type, identity, profile,
          bearing: wrap360(w.bearing + (n > 1 ? rng.gauss(0, 6) : 0)),
          range: w.range + (n > 1 ? rng.range(-150, 150) : 0),
          iffFail: !!w.iffFail, callsign: w.callsign || null, strays: !!w.strays,
          alt: w.alt || null, waypoints: [], speedFactor: 1,
        });
        at += rng.range(3, 7);
      }
    }
  }
  orders.sort((a, b) => a.t - b.t);
  return orders;
}

// ---------------------------------------------------------------------------
// Scripted doctrinal vignettes. `randomize` jitters timings/bearings so that
// even scripted missions cannot be memorised.

export const MISSIONS = [
  {
    id: 'm1-first-contact', name: 'OP KESARI DAWN — First Contact', difficulty: 'RECRUIT', seed: 1101,
    summary: 'Basic detect, classify and soft-kill drill against commercial ISR quadcopters, with one bird track.',
    learning: ['Acknowledge new tracks quickly', 'Use RF evidence to classify', 'Prefer soft-kill on RF-controlled drones'],
    env: { terrain: 'rural', time: 'day', weather: 'clear', ew: 0 },
    context: { assetType: 'FOB', assetName: 'FOB Kesari', wcs: 'FREE', civilianDensity: 0.15, threatAxis: 40, corridor: null, ato: [] },
    effectors: { RF_JAM: true, GNSS_SPOOF: true, GUN: { ammo: 32 }, INTERCEPTOR: { count: 4 }, LASER: true },
    aiAid: { enabled: true, accuracy: 0.95 }, sensors: { protocolLibrary: true, radarPd: 1 }, speedMul: 0.85, duration: 220, popUps: 0,
    waves: [
      { t: 8, type: 'QUAD', count: 1, bearing: 35, range: 2200, profile: 'isr', identity: 'HOSTILE' },
      { t: 20, type: 'BIRD', count: 1, bearing: 120, range: 1200, profile: 'bird', identity: 'NON_UAS' },
      { t: 55, type: 'QUAD', count: 1, bearing: 60, range: 2400, profile: 'isr', identity: 'HOSTILE' },
      { t: 95, type: 'HEXA', count: 1, bearing: 20, range: 2000, profile: 'bomber', identity: 'HOSTILE' },
    ],
  },
  {
    id: 'm2-night-hawk', name: 'OP NIGHT HAWK — Gun Area Bomber', difficulty: 'OPERATOR', seed: 2202,
    summary: 'Night defence of a gun area against heavy multirotor bombers, with a friendly tactical UAV in the corridor.',
    learning: ['Thermal (IR) recognition', 'IFF and ATO deconfliction', 'WEAPONS TIGHT procedure: identify before you engage'],
    env: { terrain: 'rural', time: 'night', weather: 'clear', ew: 1 },
    context: {
      assetType: 'ARTY', assetName: 'Gun Area Sudha', wcs: 'TIGHT', civilianDensity: 0.1, threatAxis: 300,
      corridor: { bearing: 140, width: 20 }, ato: [{ callsign: 'NETRA-21', type: 'TACTICAL_UAV', windowStart: 20, windowEnd: 240, alt: '300–600 m', corridor: 140 }],
    },
    effectors: { RF_JAM: true, GNSS_SPOOF: true, GUN: { ammo: 32 }, INTERCEPTOR: { count: 4 }, LASER: true },
    aiAid: { enabled: true, accuracy: 0.88 }, sensors: { protocolLibrary: true, radarPd: 0.95 }, speedMul: 0.9, duration: 290, popUps: 1,
    waves: [
      { t: 10, type: 'QUAD', count: 1, bearing: 290, range: 2300, profile: 'isr', identity: 'HOSTILE' },
      { t: 30, type: 'TACTICAL_UAV', count: 1, bearing: 140, range: 5400, profile: 'corridor', identity: 'FRIEND', callsign: 'NETRA-21' },
      { t: 50, type: 'HEXA', count: 1, bearing: 305, range: 2200, profile: 'bomber', identity: 'HOSTILE' },
      { t: 90, type: 'HEXA', count: 1, bearing: 330, range: 2300, profile: 'bomber', identity: 'HOSTILE' },
      { t: 120, type: 'BIRD', count: 1, bearing: 200, range: 900, profile: 'bird', identity: 'NON_UAS' },
    ],
  },
  {
    id: 'm3-shield-wall', name: 'OP SHIELD WALL — FPV Ambush in the Valley', difficulty: 'OPERATOR', seed: 3303,
    summary: 'Low-level FPV attacks masked by ridgelines, including a fiber-optic FPV that cannot be jammed.',
    learning: ['Use RF and acoustic cues against masked threats', 'Spot a fiber-optic FPV (no RF)', 'Act quickly when TTI is short'],
    env: { terrain: 'mountain', time: 'day', weather: 'clear', ew: 0 },
    context: { assetType: 'FOB', assetName: 'FOB Shikari', wcs: 'FREE', civilianDensity: 0.1, threatAxis: 70, corridor: null, ato: [] },
    effectors: { RF_JAM: true, GNSS_SPOOF: true, GUN: { ammo: 32 }, INTERCEPTOR: { count: 4 }, LASER: true },
    aiAid: { enabled: true, accuracy: 0.85 }, sensors: { protocolLibrary: true, radarPd: 0.95 }, speedMul: 0.9, duration: 260, popUps: 1,
    waves: [
      { t: 10, type: 'FPV', count: 1, bearing: 65, range: 3400, profile: 'lowlevel', identity: 'HOSTILE' },
      { t: 15, type: 'BIRD', count: 1, bearing: 250, range: 1500, profile: 'bird', identity: 'NON_UAS' },
      { t: 55, type: 'FPV_FIBER', count: 1, bearing: 95, range: 2800, profile: 'lowlevel', identity: 'HOSTILE' },
      { t: 95, type: 'FPV', count: 2, bearing: 50, range: 3600, profile: 'lowlevel', identity: 'HOSTILE' },
      { t: 140, type: 'QUAD', count: 1, bearing: 80, range: 2200, profile: 'isr', identity: 'HOSTILE' },
    ],
  },
  {
    id: 'm4-trinetra', name: 'OP TRINETRA — Urban VIP Event', difficulty: 'VETERAN', seed: 4404,
    summary: 'Defence of a crowded VIP event. Civil drones, a drone violating the no-fly zone, a grenade-dropper and an FPV. Collateral constraints apply.',
    learning: ['Neutral vs hostile intent', 'Collateral-aware effector choice', 'WEAPONS TIGHT discipline'],
    env: { terrain: 'urban', time: 'dusk', weather: 'clear', ew: 1 },
    context: { assetType: 'VIP', assetName: 'Parade Ground Rajpath', wcs: 'TIGHT', civilianDensity: 0.95, threatAxis: 200, corridor: null, ato: [] },
    effectors: { RF_JAM: true, GNSS_SPOOF: true, GUN: { ammo: 24 }, INTERCEPTOR: { count: 4 }, LASER: true },
    aiAid: { enabled: true, accuracy: 0.82 }, sensors: { protocolLibrary: true, radarPd: 0.9 }, speedMul: 1, duration: 300, popUps: 1,
    waves: [
      { t: 8, type: 'QUAD', count: 1, bearing: 20, range: 2400, profile: 'neutral', identity: 'NEUTRAL', strays: false },
      { t: 25, type: 'QUAD', count: 1, bearing: 210, range: 2300, profile: 'isr', identity: 'HOSTILE' },
      { t: 40, type: 'QUAD', count: 1, bearing: 110, range: 2400, profile: 'neutral', identity: 'NEUTRAL', strays: true },
      { t: 75, type: 'BIRD', count: 2, bearing: 300, range: 1300, profile: 'bird', identity: 'NON_UAS' },
      { t: 110, type: 'FPV', count: 1, bearing: 190, range: 3200, profile: 'lowlevel', identity: 'HOSTILE' },
      { t: 150, type: 'HEXA', count: 1, bearing: 230, range: 2100, profile: 'bomber', identity: 'HOSTILE' },
    ],
  },
  {
    id: 'm5-agni-varsha', name: 'OP AGNI VARSHA — LM Saturation on Airstrip', difficulty: 'VETERAN', seed: 5505,
    summary: 'Night raid of loitering munitions screened by decoys, with a fixed-wing spotter ahead of the raid.',
    learning: ['Tell LM from decoy', 'Keep interceptors for real munitions', 'Prioritise targets by TTI'],
    env: { terrain: 'rural', time: 'night', weather: 'clear', ew: 1 },
    context: { assetType: 'AIRBASE', assetName: 'ALG Garuda', wcs: 'FREE', civilianDensity: 0.1, threatAxis: 320, corridor: null, ato: [] },
    effectors: { RF_JAM: true, GNSS_SPOOF: true, GUN: { ammo: 32 }, INTERCEPTOR: { count: 4 }, LASER: true },
    aiAid: { enabled: true, accuracy: 0.8 }, sensors: { protocolLibrary: false, radarPd: 0.9 }, speedMul: 1, duration: 320, popUps: 1,
    waves: [
      { t: 10, type: 'FIXED_WING', count: 1, bearing: 330, range: 5400, profile: 'orbit', identity: 'HOSTILE' },
      { t: 70, type: 'LOITER', swarm: true, tactic: 'decoy_screen', mix: { DECOY: 4, LOITER: 3 }, count: 7, bearing: 315, range: 6000, profile: 'attack', identity: 'HOSTILE' },
      { t: 130, type: 'LOITER', count: 1, bearing: 20, range: 6000, profile: 'attack', identity: 'HOSTILE' },
      { t: 160, type: 'BIRD', count: 1, bearing: 90, range: 1500, profile: 'bird', identity: 'NON_UAS' },
    ],
  },
  {
    id: 'm6-chakravyuh', name: 'OP CHAKRAVYUH — Swarm Assault', difficulty: 'ELITE', seed: 6606,
    summary: 'A saturation swarm of FPVs, including fiber-optic FPVs, arrives on several axes in a dust storm while a friendly UAV is recovering.',
    learning: ['Use area soft-kill against swarms', 'Assign hard-kill to the drones jamming cannot stop', 'Keep IFF discipline under pressure'],
    env: { terrain: 'rural', time: 'day', weather: 'dust', ew: 2 },
    context: {
      assetType: 'FOB', assetName: 'FOB Rajput', wcs: 'FREE', civilianDensity: 0.15, threatAxis: 10,
      corridor: { bearing: 200, width: 20 }, ato: [{ callsign: 'GARUDA-14', type: 'TACTICAL_UAV', windowStart: 30, windowEnd: 260, alt: '300–600 m', corridor: 200 }],
    },
    effectors: { RF_JAM: true, GNSS_SPOOF: true, GUN: { ammo: 26 }, INTERCEPTOR: { count: 3 }, LASER: true },
    aiAid: { enabled: true, accuracy: 0.72 }, sensors: { protocolLibrary: false, radarPd: 0.85 }, speedMul: 1.05, duration: 330, popUps: 2,
    waves: [
      { t: 10, type: 'QUAD', count: 1, bearing: 15, range: 2300, profile: 'isr', identity: 'HOSTILE' },
      { t: 40, type: 'TACTICAL_UAV', count: 1, bearing: 200, range: 5400, profile: 'corridor', identity: 'FRIEND', callsign: 'GARUDA-14', iffFail: true },
      { t: 80, type: 'FPV', swarm: true, tactic: 'saturation', mix: { FPV: 7, FPV_FIBER: 3 }, count: 10, bearing: 5, range: 3800, profile: 'lowlevel', identity: 'HOSTILE' },
      { t: 150, type: 'LOITER', count: 1, bearing: 40, range: 6000, profile: 'attack', identity: 'HOSTILE' },
      { t: 60, type: 'BIRD', count: 2, bearing: 270, range: 1400, profile: 'bird', identity: 'NON_UAS' },
    ],
  },
  {
    id: 'm7-mayajaal', name: 'OP MAYAJAAL — Friend or Foe', difficulty: 'OPERATOR', seed: 7707,
    summary: 'IFF and ATO drill. Two own UAVs (one with a failed transponder), a hostile fixed-wing spotter and bird clutter.',
    learning: ['Never engage without deconfliction', 'Cross-check the ATO when IFF fails', 'Deny a hostile spotter before artillery arrives'],
    env: { terrain: 'rural', time: 'day', weather: 'clear', ew: 1 },
    context: {
      assetType: 'ARTY', assetName: 'Gun Area Bravo', wcs: 'TIGHT', civilianDensity: 0.1, threatAxis: 260,
      corridor: { bearing: 90, width: 20 },
      ato: [
        { callsign: 'HANSA-07', type: 'TACTICAL_UAV', windowStart: 0, windowEnd: 200, alt: '300–600 m', corridor: 90 },
        { callsign: 'DRISHTI-32', type: 'TACTICAL_UAV', windowStart: 60, windowEnd: 280, alt: '300–600 m', corridor: 90 },
      ],
    },
    effectors: { RF_JAM: true, GNSS_SPOOF: true, GUN: { ammo: 32 }, INTERCEPTOR: { count: 4 }, LASER: true },
    aiAid: { enabled: true, accuracy: 0.85 }, sensors: { protocolLibrary: true, radarPd: 0.95 }, speedMul: 0.9, duration: 280, popUps: 0,
    waves: [
      { t: 8, type: 'TACTICAL_UAV', count: 1, bearing: 90, range: 5400, profile: 'corridor', identity: 'FRIEND', callsign: 'HANSA-07' },
      { t: 30, type: 'FIXED_WING', count: 1, bearing: 255, range: 5400, profile: 'orbit', identity: 'HOSTILE' },
      { t: 45, type: 'BIRD', count: 2, bearing: 150, range: 1600, profile: 'bird', identity: 'NON_UAS' },
      { t: 70, type: 'TACTICAL_UAV', count: 1, bearing: 92, range: 5400, profile: 'corridor', identity: 'FRIEND', callsign: 'DRISHTI-32', iffFail: true },
      { t: 120, type: 'QUAD', count: 1, bearing: 270, range: 2300, profile: 'isr', identity: 'HOSTILE' },
    ],
  },
  {
    id: 'm8-andhakaar', name: 'OP ANDHAKAAR — Degraded Sensors', difficulty: 'VETERAN', seed: 8808,
    summary: 'Night, fog and heavy enemy EW. The radar is short-ranged and the RF library is unavailable. Mixed threats arrive through the valley.',
    learning: ['Fuse weak cues from several sensors', 'Effector limits in fog', 'Hold your nerve under uncertainty'],
    env: { terrain: 'mountain', time: 'night', weather: 'fog', ew: 2 },
    context: { assetType: 'FOB', assetName: 'FOB Tiger', wcs: 'FREE', civilianDensity: 0.1, threatAxis: 150, corridor: null, ato: [] },
    effectors: { RF_JAM: true, GNSS_SPOOF: true, GUN: { ammo: 30 }, INTERCEPTOR: { count: 4 }, LASER: true },
    aiAid: { enabled: true, accuracy: 0.74 }, sensors: { protocolLibrary: false, radarPd: 0.85 }, speedMul: 1, duration: 320, popUps: 2,
    waves: [
      { t: 10, type: 'HEXA', count: 1, bearing: 145, range: 2200, profile: 'bomber', identity: 'HOSTILE' },
      { t: 40, type: 'FPV_FIBER', count: 1, bearing: 170, range: 2800, profile: 'lowlevel', identity: 'HOSTILE' },
      { t: 70, type: 'BIRD', count: 1, bearing: 60, range: 1100, profile: 'bird', identity: 'NON_UAS' },
      { t: 95, type: 'LOITER', count: 1, bearing: 135, range: 6000, profile: 'attack', identity: 'HOSTILE' },
      { t: 130, type: 'FPV', count: 2, bearing: 160, range: 3400, profile: 'lowlevel', identity: 'HOSTILE' },
      { t: 175, type: 'QUAD', count: 1, bearing: 120, range: 2200, profile: 'isr', identity: 'HOSTILE' },
    ],
  },
];

// Turn a scripted/custom mission into a runnable spec. With randomize, timing,
// bearings and ranges are jittered (seeded) so trainees cannot memorise the mission.
export function instantiateMission(mission, { seed, randomize = true } = {}) {
  const s = seed ?? mission.seed ?? 1;
  const rng = new Rng(s).fork('mission-jitter');
  const waves = mission.waves.map((w) => {
    const out = { ...w, mix: w.mix ? { ...w.mix } : undefined };
    if (randomize) {
      out.t = Math.max(3, round1(w.t * rng.range(0.85, 1.15) + rng.range(-4, 4)));
      if (w.profile !== 'corridor') out.bearing = round1(wrap360(w.bearing + rng.gauss(0, 14)));
      out.range = Math.round(w.range * rng.range(0.93, 1.05));
    }
    return out;
  }).sort((a, b) => a.t - b.t);
  const spec = {
    id: mission.id,
    kind: mission.kind || 'scripted',
    name: mission.name,
    seed: s,
    difficulty: mission.difficulty,
    env: { ...mission.env },
    context: {
      defendedRadius: GEOMETRY.defendedRadius, restrictedRadius: GEOMETRY.restrictedRadius,
      ...JSON.parse(JSON.stringify(mission.context)),
    },
    effectors: JSON.parse(JSON.stringify(mission.effectors)),
    aiAid: { ...mission.aiAid },
    sensors: { ...mission.sensors },
    speedMul: mission.speedMul ?? 1,
    duration: mission.duration,
    popUps: mission.popUps ?? 0,
    waves,
    directorNotes: randomize ? ['Scripted mission. Timings and axes are randomised against rote learning.'] : [],
    summary: mission.summary,
    learning: mission.learning || [],
  };
  spec.intel = intelEstimate(new Rng(s).fork('intel'), waves);
  spec.brief = mission.brief || `${mission.summary} ${autoBrief(spec)}`;
  spec.fingerprint = fingerprint(spec);
  return spec;
}
