// DRONA threat, effector, environment and difficulty catalog.
// All figures are generic, open-source-representative values for training only.

export const TYPES = {
  QUAD: {
    key: 'QUAD', name: 'Commercial Quadcopter', short: 'QUAD', hotkey: '1', family: 'multirotor',
    nato: 'Class I · Mini', defaultIdentity: 'HOSTILE',
    size: 0.38, rcs: 0.01, speed: [8, 16], alt: [50, 140], agility: 6,
    rf: { emits: true, bands: ['2.4', '5.8'], protocol: 'OcuSync-type FHSS', pattern: 'hop' },
    gnss: true,
    acoustic: { f0: 190, character: 'High-pitched steady whine', harmonics: [1, 0.6, 0.35, 0.2] },
    heat: 0.7, threat: 2, damage: 6, cost: 'Low',
    vuln: { RF_JAM: 0.92, GNSS_SPOOF: 0.6, GUN: 1, INTERCEPTOR: 1, LASER: 1 },
    hardness: 1.0,
    role: 'ISR overwatch, grenade dropping, artillery correction',
    cues: [
      'Four rotors on an X-frame, compact grey body',
      'Hovers or orbits slowly; speed under 16 m/s',
      'Frequency-hopping bursts in 2.4 and 5.8 GHz',
      'Steady whine around 190 Hz',
    ],
  },
  HEXA: {
    key: 'HEXA', name: 'Heavy Multirotor (Bomber)', short: 'HEXA', hotkey: '2', family: 'multirotor',
    nato: 'Class I · Small', defaultIdentity: 'HOSTILE',
    size: 1.4, rcs: 0.06, speed: [9, 15], alt: [60, 180], agility: 4,
    rf: { emits: true, bands: ['0.9', '2.4'], protocol: 'Long-range FHSS (900 MHz)', pattern: 'narrowhop' },
    gnss: true,
    acoustic: { f0: 85, character: 'Deep heavy drone, slow beat', harmonics: [1, 0.8, 0.5, 0.3] },
    heat: 0.85, threat: 4, damage: 22, cost: 'Medium',
    vuln: { RF_JAM: 0.85, GNSS_SPOOF: 0.6, GUN: 1, INTERCEPTOR: 0.95, LASER: 0.9 },
    hardness: 1.6,
    role: 'Night bomber that drops mortar-class munitions on positions',
    cues: [
      'Six large rotors; slung payload under the body',
      'Flies mostly at night; hovers before dropping',
      'Narrow hopping signal near 900 MHz, plus 2.4 GHz',
      'Deep low-frequency drone around 85 Hz',
    ],
  },
  FPV: {
    key: 'FPV', name: 'FPV Strike Drone', short: 'FPV', hotkey: '3', family: 'fpv',
    nato: 'Class I · Micro', defaultIdentity: 'HOSTILE',
    size: 0.25, rcs: 0.008, speed: [28, 42], alt: [6, 35], agility: 14,
    rf: { emits: true, bands: ['0.9', '5.8'], protocol: 'ELRS control + analogue video', pattern: 'analog' },
    gnss: false,
    acoustic: { f0: 420, character: 'Aggressive high screaming whine', harmonics: [1, 0.7, 0.5, 0.4] },
    heat: 0.8, threat: 4, damage: 14, cost: 'Very low',
    vuln: { RF_JAM: 0.88, GNSS_SPOOF: 0, GUN: 1, INTERCEPTOR: 0.8, LASER: 1 },
    hardness: 0.8,
    role: 'Manually piloted kamikaze carrying an RPG/shaped-charge warhead',
    cues: [
      'Small X-frame with a warhead strapped under it',
      'Fast and low; weaves and hugs the terrain',
      'Wide continuous analogue video carrier at 5.8 GHz',
      'Screaming whine around 420 Hz',
    ],
  },
  FPV_FIBER: {
    key: 'FPV_FIBER', name: 'Fiber-Optic FPV', short: 'FPV-F', hotkey: '4', family: 'fpv',
    nato: 'Class I · Micro', defaultIdentity: 'HOSTILE',
    size: 0.3, rcs: 0.009, speed: [24, 36], alt: [6, 30], agility: 12,
    rf: { emits: false, bands: [], protocol: 'None (fiber-optic tether)', pattern: 'none' },
    gnss: false,
    acoustic: { f0: 400, character: 'High whine, nearly the same as FPV', harmonics: [1, 0.7, 0.5, 0.35] },
    heat: 0.8, threat: 4, damage: 14, cost: 'Low',
    vuln: { RF_JAM: 0, GNSS_SPOOF: 0, GUN: 1, INTERCEPTOR: 0.8, LASER: 1 },
    hardness: 0.8,
    role: 'Kamikaze FPV controlled over a fiber tether, so it cannot be jammed',
    cues: [
      'FPV frame with a cylindrical spool on its back',
      'Fast and low like an FPV',
      'NO RF emission: the RF detector stays silent on its bearing',
      'Defeat with hard-kill only (gun, laser or interceptor)',
    ],
  },
  FIXED_WING: {
    key: 'FIXED_WING', name: 'Fixed-Wing ISR (Spotter)', short: 'FW-ISR', hotkey: '5', family: 'fixedwing',
    nato: 'Class I · Small', defaultIdentity: 'HOSTILE',
    size: 3.0, rcs: 0.2, speed: [24, 36], alt: [400, 1100], agility: 3,
    rf: { emits: true, bands: ['0.9', '2.4'], protocol: 'Encrypted C2 / video datalink', pattern: 'datalink' },
    gnss: true,
    acoustic: { f0: 125, character: 'Two-stroke buzz, rises and falls as it orbits', harmonics: [1, 0.9, 0.6, 0.45] },
    heat: 0.65, threat: 3, damage: 16, cost: 'Medium',
    vuln: { RF_JAM: 0.75, GNSS_SPOOF: 0.7, GUN: 0.8, INTERCEPTOR: 0.9, LASER: 0.7 },
    hardness: 1.5,
    role: 'Spots for artillery. While it orbits unengaged, the position will be shelled',
    cues: [
      'High straight wing with a pusher or tractor propeller and a conventional tail',
      'Orbits at 400–1100 m and 2–3 km stand-off; does not close in',
      'Steady datalink in 0.9 and 2.4 GHz',
      'Two-stroke engine buzz around 125 Hz',
    ],
  },
  LOITER: {
    key: 'LOITER', name: 'Loitering Munition (Delta)', short: 'LM', hotkey: '6', family: 'delta',
    nato: 'Class II · OWA', defaultIdentity: 'HOSTILE',
    size: 2.5, rcs: 0.25, speed: [45, 52], alt: [120, 600], agility: 2.5,
    rf: { emits: false, bands: [], protocol: 'None (pre-programmed GNSS/INS)', pattern: 'none' },
    gnss: true,
    acoustic: { f0: 95, character: 'Loud "moped" piston engine with a pulsing note', harmonics: [1, 1.0, 0.8, 0.6] },
    heat: 0.95, threat: 5, damage: 40, cost: 'Medium',
    vuln: { RF_JAM: 0, GNSS_SPOOF: 0.35, GUN: 0.85, INTERCEPTOR: 0.85, LASER: 0.6 },
    hardness: 2.2,
    role: 'One-way attack munition with a 40–50 kg warhead; dives steeply onto the target',
    cues: [
      'Delta wing with vertical winglets and a rear pusher propeller',
      'Fast (about 50 m/s), straight course, steep terminal dive',
      'No command link. GNSS/INS guided, so jamming has no effect',
      'Loud moped-like engine around 95 Hz',
    ],
  },
  DECOY: {
    key: 'DECOY', name: 'Decoy Drone (Delta)', short: 'DECOY', hotkey: '7', family: 'delta',
    nato: 'Class I · Decoy', defaultIdentity: 'HOSTILE',
    size: 2.0, rcs: 0.22, speed: [36, 44], alt: [150, 500], agility: 2.5,
    rf: { emits: false, bands: [], protocol: 'None (pre-programmed GNSS)', pattern: 'none' },
    gnss: true,
    acoustic: { f0: 110, character: 'Thinner, quieter engine note than the LM', harmonics: [1, 0.6, 0.3, 0.15] },
    heat: 0.55, threat: 1, damage: 2, cost: 'Very low',
    vuln: { RF_JAM: 0, GNSS_SPOOF: 0.65, GUN: 1, INTERCEPTOR: 1, LASER: 1 },
    hardness: 0.9,
    role: 'Cheap foam/plywood copy that saturates defences and draws expensive interceptors',
    cues: [
      'Looks like a loitering munition but smaller and plain-coloured',
      'About 20% slower than a real LM; cooler thermal signature',
      'Quieter, thinner engine note around 110 Hz',
      'Use the cheapest effector and save interceptors',
    ],
  },
  TACTICAL_UAV: {
    key: 'TACTICAL_UAV', name: 'Tactical UAV (Own Forces)', short: 'TUAV', hotkey: '8', family: 'fixedwing',
    nato: 'Class II · Tactical', defaultIdentity: 'FRIEND',
    size: 6.0, rcs: 0.5, speed: [30, 40], alt: [300, 600], agility: 2,
    rf: { emits: true, bands: ['1.3'], protocol: 'Military C-band/L-band datalink', pattern: 'mil' },
    gnss: true,
    acoustic: { f0: 70, character: 'Low rotary engine hum', harmonics: [1, 0.7, 0.4, 0.2] },
    heat: 0.7, threat: 0, damage: 0, cost: 'High',
    vuln: { RF_JAM: 0.6, GNSS_SPOOF: 0.3, GUN: 0.8, INTERCEPTOR: 0.9, LASER: 0.6 },
    hardness: 2.5,
    role: 'Own-force surveillance UAV. Must be deconflicted (IFF + air tasking order)',
    cues: [
      'Twin-boom tail, large high wing, pusher engine',
      'Flies in the published friendly corridor during its ATO window',
      'Military datalink in the L-band (1.3 GHz)',
      'Answers IFF Mode-5 interrogation (unless the transponder has failed)',
    ],
  },
  BIRD: {
    key: 'BIRD', name: 'Bird / Clutter (Non-UAS)', short: 'BIRD', hotkey: '9', family: 'bio',
    nato: 'Non-UAS', defaultIdentity: 'NON_UAS',
    size: 0.9, rcs: 0.012, speed: [7, 14], alt: [20, 160], agility: 5,
    rf: { emits: false, bands: [], protocol: 'None', pattern: 'none' },
    gnss: false,
    acoustic: null,
    heat: 0.4, threat: 0, damage: 0, cost: '—',
    vuln: { RF_JAM: 0, GNSS_SPOOF: 0, GUN: 0.9, INTERCEPTOR: 0.5, LASER: 0.9 },
    hardness: 0.5,
    role: 'Birds, flocks and radar clutter that cause false tracks',
    cues: [
      'Flapping wings; flocks move together erratically',
      'Slow, wandering course with no clear destination',
      'No RF and no engine sound',
      'Wing-beat micro-Doppler on radar; dismiss it to free operator attention',
    ],
  },
};

export const TYPE_KEYS = Object.keys(TYPES);
export const CLASS_KEYS = TYPE_KEYS; // operator classification options (hotkeys 1-9)

export const IDENTITIES = {
  HOSTILE: { key: 'HOSTILE', name: 'Hostile', short: 'HOS', hotkey: 'h', color: '#ff4d4d' },
  SUSPECT: { key: 'SUSPECT', name: 'Suspect', short: 'SUS', hotkey: 'u', color: '#ff9f43' },
  NEUTRAL: { key: 'NEUTRAL', name: 'Neutral', short: 'NEU', hotkey: 'n', color: '#3ddc84' },
  FRIEND: { key: 'FRIEND', name: 'Friend', short: 'FRD', hotkey: 'f', color: '#4da6ff' },
  NON_UAS: { key: 'NON_UAS', name: 'Non-UAS', short: 'N/U', hotkey: 'b', color: '#9aa5b1' },
};

export const EFFECTORS = {
  RF_JAM: {
    key: 'RF_JAM', name: 'RF Jammer (directional)', short: 'JAM', hotkey: 'j', kind: 'soft',
    range: 2200, sectorDeg: 30, wideRange: 1400, wideSectorDeg: 90, activation: 2.5, duration: 10, cooldown: 2, cost: 1,
    note: 'Breaks the RF command link inside a 30° beam (2.2 km), or a 90° WIDE beam (1.4 km) against swarms. Useless against autonomous or fiber-guided drones. Also hits own UAVs inside the beam.',
  },
  GNSS_SPOOF: {
    key: 'GNSS_SPOOF', name: 'GNSS Spoofer (area)', short: 'SPOOF', hotkey: 'k', kind: 'soft',
    range: 2600, activation: 6, duration: 18, cooldown: 8, cost: 1,
    note: 'Omni-directional. Pulls GNSS-guided drones off course after about 6 s. INS-aided munitions resist it. Also affects friendly navigation.',
  },
  GUN: {
    key: 'GUN', name: 'AD Gun (programmable ammo)', short: 'GUN', hotkey: 'g', kind: 'hard',
    range: 2000, minRange: 40, burstInterval: 1.1, burstsPerEngagement: 4, ammo: 32, cost: 2,
    note: 'Hard-kill out to 2 km. Pk falls with speed, small size and poor visibility. Falling rounds and debris risk collateral damage in built-up areas.',
  },
  INTERCEPTOR: {
    key: 'INTERCEPTOR', name: 'Interceptor Drone', short: 'INTCP', hotkey: 'i', kind: 'hard',
    range: 3500, speed: 70, count: 4, pk: 0.85, endurance: 70, cost: 6,
    note: 'Low-collateral hard-kill that chases its target. Stock is limited; do not spend it on decoys or birds.',
  },
  LASER: {
    key: 'LASER', name: 'Laser DEW (10 kW class)', short: 'LASER', hotkey: 'l', kind: 'hard',
    range: 1300, dwell: 2.6, cooldown: 4, cost: 1,
    note: 'Cheap per shot and silent, but it needs dwell time on target. Range drops sharply in fog, rain or dust. Handles one target at a time.',
  },
};
export const EFFECTOR_KEYS = Object.keys(EFFECTORS);

export const ACTIONS = {
  MONITOR: { key: 'MONITOR', name: 'Monitor / Hold fire', short: 'MON', hotkey: 'm', kind: 'passive' },
  DISMISS: { key: 'DISMISS', name: 'Dismiss (non-threat)', short: 'DIS', hotkey: 'x', kind: 'passive' },
  ...EFFECTORS,
};
export const ACTION_KEYS = Object.keys(ACTIONS);

export const TERRAINS = {
  rural: {
    key: 'rural', name: 'Rural / Plains', maskDeg: 0.25, clutter: 0.6, rfNoise: 0.15, acousticRange: 650,
    civilianDensity: 0.15, desc: 'Open fields, tree lines and small villages. Long sight lines.',
  },
  urban: {
    key: 'urban', name: 'Urban / Built-up', maskDeg: 1.1, clutter: 1.3, rfNoise: 0.7, acousticRange: 340,
    civilianDensity: 0.8, desc: 'Dense buildings, heavy Wi-Fi RF noise and radar multipath. Collateral constraints apply.',
  },
  mountain: {
    key: 'mountain', name: 'Mountain / Valley', maskDeg: 0.6, clutter: 1.0, rfNoise: 0.1, acousticRange: 520,
    civilianDensity: 0.1, desc: 'Post in a valley with ridgelines that mask low-level approaches.',
  },
};

export const TIMES = {
  day: { key: 'day', name: 'Day', visual: 1.0, thermalDefault: false },
  dusk: { key: 'dusk', name: 'Dusk', visual: 0.6, thermalDefault: false },
  night: { key: 'night', name: 'Night', visual: 0.25, thermalDefault: true },
};

export const WEATHERS = {
  clear: { key: 'clear', name: 'Clear', visual: 1.0, radar: 1.0, laser: 1.0, acoustic: 1.0 },
  fog: { key: 'fog', name: 'Fog / Haze', visual: 0.35, radar: 0.97, laser: 0.35, acoustic: 0.95 },
  rain: { key: 'rain', name: 'Rain', visual: 0.6, radar: 0.82, laser: 0.6, acoustic: 0.6 },
  dust: { key: 'dust', name: 'Dust Storm', visual: 0.45, radar: 0.9, laser: 0.45, acoustic: 0.75 },
};

export const EW_LEVELS = [
  { level: 0, name: 'None', radarRange: 1.0, bearingErr: 1.0, iffFail: 0, rfFalse: 0 },
  { level: 1, name: 'Light jamming', radarRange: 0.85, bearingErr: 2.0, iffFail: 0.15, rfFalse: 0.2 },
  { level: 2, name: 'Heavy jamming', radarRange: 0.7, bearingErr: 3.5, iffFail: 0.35, rfFalse: 0.45 },
];

export const WCS = {
  FREE: { key: 'FREE', name: 'WEAPONS FREE', desc: 'You may engage any target not positively identified as friendly.' },
  TIGHT: { key: 'TIGHT', name: 'WEAPONS TIGHT', desc: 'Engage only targets you have positively identified as HOSTILE.' },
  HOLD: { key: 'HOLD', name: 'WEAPONS HOLD', desc: 'Fire only in self-defence, when impact is imminent (TTI < 25 s). Otherwise monitor and report.' },
};

export const ASSETS = {
  FOB: { key: 'FOB', name: 'Forward Operating Base', names: ['FOB Tiger', 'FOB Rajput', 'FOB Shikari', 'FOB Kesari'] },
  ARTY: { key: 'ARTY', name: 'Artillery Gun Area', names: ['Gun Area Bravo', 'Gun Area Sudha', 'Gun Area Kali'] },
  AIRBASE: { key: 'AIRBASE', name: 'Forward Airstrip', names: ['ALG Garuda', 'ALG Hansa', 'Airstrip Vayu'] },
  POWER: { key: 'POWER', name: 'Critical Infrastructure (Power Sub-station)', names: ['Sub-station Prakash', 'Grid Node Jyoti'] },
  VIP: { key: 'VIP', name: 'VIP Event Site', names: ['Parade Ground Rajpath', 'Stadium Vijay', 'Convention Centre Ashoka'] },
};

export const DIFFICULTIES = {
  RECRUIT: {
    key: 'RECRUIT', name: 'Recruit', order: 0,
    threats: [2, 3], swarmChance: 0, swarmSize: [0, 0], decoyChance: 0, fiberChance: 0, birds: [0, 1],
    friendlyChance: 0.3, neutralChance: 0.15, clutter: 0.25, speedMul: 0.8, aiAccuracy: 0.95,
    ewMax: 0, nightChance: 0.1, weatherChance: 0.1, protocolLibrary: true, iffFail: 0,
    waveGap: [35, 55], duration: 240, popUps: 0, radarPd: 1.0,
  },
  OPERATOR: {
    key: 'OPERATOR', name: 'Operator', order: 1,
    threats: [3, 5], swarmChance: 0.25, swarmSize: [4, 6], decoyChance: 0.2, fiberChance: 0.15, birds: [1, 2],
    friendlyChance: 0.5, neutralChance: 0.3, clutter: 0.5, speedMul: 0.9, aiAccuracy: 0.88,
    ewMax: 1, nightChance: 0.3, weatherChance: 0.3, protocolLibrary: true, iffFail: 0.05,
    waveGap: [25, 45], duration: 300, popUps: 1, radarPd: 0.95,
  },
  VETERAN: {
    key: 'VETERAN', name: 'Veteran', order: 2,
    threats: [4, 7], swarmChance: 0.5, swarmSize: [5, 8], decoyChance: 0.4, fiberChance: 0.3, birds: [1, 3],
    friendlyChance: 0.6, neutralChance: 0.4, clutter: 0.9, speedMul: 1.0, aiAccuracy: 0.8,
    ewMax: 2, nightChance: 0.45, weatherChance: 0.45, protocolLibrary: false, iffFail: 0.15,
    waveGap: [15, 35], duration: 330, popUps: 2, radarPd: 0.9,
  },
  ELITE: {
    key: 'ELITE', name: 'Elite', order: 3,
    threats: [6, 9], swarmChance: 0.75, swarmSize: [7, 11], decoyChance: 0.6, fiberChance: 0.45, birds: [2, 4],
    friendlyChance: 0.7, neutralChance: 0.5, clutter: 1.4, speedMul: 1.1, aiAccuracy: 0.7,
    ewMax: 2, nightChance: 0.55, weatherChance: 0.55, protocolLibrary: false, iffFail: 0.3,
    waveGap: [8, 25], duration: 360, popUps: 3, radarPd: 0.85,
  },
};
export const DIFFICULTY_KEYS = Object.keys(DIFFICULTIES);

export const GEOMETRY = {
  defendedRadius: 450, // vital area — impact radius
  restrictedRadius: 1500, // no-drone zone around the asset
  radarRange: 6000,
  rfRange: 3800,
  sensorMastHeight: 14,
  worldRadius: 7000,
};

// Classification partial-credit: same family earns partial credit.
export function classScore(truth, answer) {
  if (!answer) return 0;
  if (truth === answer) return 100;
  const a = TYPES[truth], b = TYPES[answer];
  if (a && b && a.family === b.family && a.family !== 'bio') return 45;
  return 0;
}

export function identityScore(truth, answer) {
  if (!answer || answer === 'UNKNOWN') return 0;
  if (truth === answer) return 100;
  if (truth === 'HOSTILE' && answer === 'SUSPECT') return 70;
  if (truth === 'NEUTRAL' && answer === 'SUSPECT') return 60;
  return 0;
}
