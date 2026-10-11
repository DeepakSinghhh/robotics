// Procedural low-poly drone models built from primitives (no external assets, so it
// works offline). Each mesh carries userData.heat (0..1) for the thermal (IR) palette.
// Models face -Z (north) and are built at real-world scale in metres.

import * as THREE from 'three';

const mats = new Map();
function mat(color, opts = {}) {
  const key = `${color}|${opts.metal || 0}|${opts.emissive || ''}`;
  if (!mats.has(key)) {
    mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: opts.metal ?? 0.15, emissive: opts.emissive || 0x000000 }));
  }
  return mats.get(key);
}

function mesh(geo, color, heat, opts) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.userData.heat = heat;
  return m;
}

function rotor(radius, heat = 0.6) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.userData.heat = 0.35;
  disc.userData.disc = true;
  const blade = mesh(new THREE.BoxGeometry(radius * 2, radius * 0.06, radius * 0.16), 0x1a1a1a, 0.3);
  const hub = mesh(new THREE.CylinderGeometry(radius * 0.12, radius * 0.12, radius * 0.25, 8), 0x333333, heat);
  g.add(disc, blade, hub);
  g.userData.spin = blade;
  return g;
}

function multirotor({ arms, span, body, bodyColor, armColor, heat, payload }) {
  const g = new THREE.Group();
  const armLen = span / 2;
  const core = mesh(new THREE.BoxGeometry(body[0], body[1], body[2]), bodyColor, heat);
  g.add(core);
  const rotors = [];
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + Math.PI / arms;
    const arm = mesh(new THREE.BoxGeometry(armLen, span * 0.035, span * 0.05), armColor, heat * 0.7);
    arm.position.set(Math.cos(a) * armLen / 2, 0, Math.sin(a) * armLen / 2);
    arm.rotation.y = -a;
    const motor = mesh(new THREE.CylinderGeometry(span * 0.04, span * 0.04, span * 0.06, 8), 0x2b2b2b, Math.min(1, heat + 0.25));
    motor.position.set(Math.cos(a) * armLen, span * 0.03, Math.sin(a) * armLen);
    const r = rotor(span * 0.19, heat);
    r.position.set(Math.cos(a) * armLen, span * 0.07, Math.sin(a) * armLen);
    g.add(arm, motor, r);
    rotors.push(r);
  }
  if (payload) {
    const p = mesh(new THREE.CylinderGeometry(payload[0], payload[0], payload[1], 10), 0x4a4a3a, heat * 0.5);
    p.rotation.x = Math.PI / 2;
    p.position.y = -body[1] * 0.9;
    g.add(p);
  }
  g.userData.rotors = rotors;
  return g;
}

function fixedWing({ span, length, color, heat, twinBoom = false, vtail = false }) {
  const g = new THREE.Group();
  const fus = mesh(new THREE.CylinderGeometry(length * 0.06, length * 0.045, length, 10), color, heat * 0.7);
  fus.rotation.x = Math.PI / 2;
  g.add(fus);
  const wing = mesh(new THREE.BoxGeometry(span, length * 0.025, length * 0.16), color, heat * 0.5);
  wing.position.set(0, length * 0.04, -length * 0.05);
  g.add(wing);
  const engine = mesh(new THREE.CylinderGeometry(length * 0.05, length * 0.05, length * 0.12, 10), 0x2a2a2a, Math.min(1, heat + 0.3));
  engine.rotation.x = Math.PI / 2;
  engine.position.z = length * 0.5;
  g.add(engine);
  const prop = rotor(length * 0.14, heat);
  prop.rotation.x = Math.PI / 2;
  prop.position.z = length * 0.58;
  g.add(prop);
  g.userData.rotors = [prop];
  if (twinBoom) {
    for (const s of [-1, 1]) {
      const boom = mesh(new THREE.CylinderGeometry(length * 0.015, length * 0.015, length * 0.7, 6), color, heat * 0.4);
      boom.rotation.x = Math.PI / 2;
      boom.position.set(s * span * 0.16, length * 0.04, length * 0.3);
      const fin = mesh(new THREE.BoxGeometry(length * 0.01, length * 0.14, length * 0.12), color, heat * 0.4);
      fin.position.set(s * span * 0.16, length * 0.1, length * 0.62);
      g.add(boom, fin);
    }
    const stab = mesh(new THREE.BoxGeometry(span * 0.34, length * 0.012, length * 0.08), color, heat * 0.4);
    stab.position.set(0, length * 0.15, length * 0.64);
    g.add(stab);
  } else if (vtail) {
    for (const s of [-1, 1]) {
      const fin = mesh(new THREE.BoxGeometry(length * 0.18, length * 0.01, length * 0.09), color, heat * 0.4);
      fin.position.set(s * length * 0.07, length * 0.06, length * 0.42);
      fin.rotation.z = s * 0.6;
      g.add(fin);
    }
  } else {
    const stab = mesh(new THREE.BoxGeometry(span * 0.3, length * 0.012, length * 0.08), color, heat * 0.4);
    stab.position.set(0, 0, length * 0.42);
    const fin = mesh(new THREE.BoxGeometry(length * 0.012, length * 0.13, length * 0.09), color, heat * 0.4);
    fin.position.set(0, length * 0.07, length * 0.42);
    g.add(stab, fin);
  }
  return g;
}

function delta({ span, color, heat, decoy = false }) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, -span * 0.75);
  shape.lineTo(span / 2, span * 0.22);
  shape.lineTo(-span / 2, span * 0.22);
  shape.lineTo(0, -span * 0.75);
  const wingGeo = new THREE.ExtrudeGeometry(shape, { depth: span * 0.025, bevelEnabled: false });
  wingGeo.rotateX(Math.PI / 2);
  const wing = mesh(wingGeo, color, heat * 0.45);
  g.add(wing);
  const body = mesh(new THREE.CylinderGeometry(span * 0.07, span * 0.05, span * 0.95, 10), color, heat * 0.6);
  body.rotation.x = Math.PI / 2;
  body.position.set(0, span * 0.04, -span * 0.15);
  g.add(body);
  if (!decoy) {
    const warhead = mesh(new THREE.ConeGeometry(span * 0.075, span * 0.22, 10), 0x50503c, heat * 0.5);
    warhead.rotation.x = -Math.PI / 2;
    warhead.position.set(0, span * 0.04, -span * 0.7);
    g.add(warhead);
  }
  for (const s of [-1, 1]) {
    const winglet = mesh(new THREE.BoxGeometry(span * 0.015, span * 0.14, span * 0.16), color, heat * 0.4);
    winglet.position.set(s * span * 0.49, span * 0.06, span * 0.16);
    g.add(winglet);
  }
  const engine = mesh(new THREE.CylinderGeometry(span * 0.06, span * 0.06, span * 0.12, 10), 0x2a2a2a, decoy ? heat : Math.min(1, heat + 0.2));
  engine.rotation.x = Math.PI / 2;
  engine.position.set(0, span * 0.04, span * 0.36);
  const prop = rotor(span * 0.13, heat);
  prop.rotation.x = Math.PI / 2;
  prop.position.set(0, span * 0.04, span * 0.44);
  g.add(engine, prop);
  g.userData.rotors = [prop];
  return g;
}

function bird({ span }) {
  const g = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(span * 0.1, 8, 6), 0x3a3530, 0.45);
  body.scale.z = 2.2;
  g.add(body);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    const w = mesh(new THREE.BoxGeometry(span * 0.48, span * 0.015, span * 0.16), 0x3a3530, 0.35);
    w.position.x = s * span * 0.24;
    pivot.add(w);
    pivot.userData.side = s;
    g.add(pivot);
    wings.push(pivot);
  }
  g.userData.wings = wings;
  return g;
}

export function buildDrone(type, opts = {}) {
  let g;
  switch (type) {
    case 'QUAD':
      g = multirotor({ arms: 4, span: 0.38, body: [0.11, 0.07, 0.2], bodyColor: 0x8a8d90, armColor: 0x7a7d80, heat: 0.75 });
      break;
    case 'HEXA':
      g = multirotor({ arms: 6, span: 1.4, body: [0.35, 0.18, 0.35], bodyColor: 0x2c3a2c, armColor: 0x222a22, heat: 0.85, payload: [0.07, 0.5] });
      break;
    case 'FPV':
    case 'FPV_FIBER': {
      g = multirotor({ arms: 4, span: 0.25, body: [0.06, 0.05, 0.14], bodyColor: 0x202020, armColor: 0x151515, heat: 0.85, payload: [0.04, 0.32] });
      if (type === 'FPV_FIBER') {
        const spool = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 12), 0xb8b8a8, 0.4);
        spool.rotation.z = Math.PI / 2;
        spool.position.set(0, 0.06, 0.05);
        g.add(spool);
      }
      break;
    }
    case 'FIXED_WING':
      g = fixedWing({ span: 3, length: 1.9, color: 0x9aa39a, heat: 0.65 });
      break;
    case 'TACTICAL_UAV':
      g = fixedWing({ span: 6.2, length: 4.2, color: 0xc8ccd0, heat: 0.7, twinBoom: true });
      break;
    case 'LOITER':
      g = delta({ span: 2.5, color: 0x6f7376, heat: 0.95 });
      break;
    case 'DECOY':
      g = delta({ span: 2.0, color: 0xb3a98f, heat: 0.55, decoy: true });
      break;
    case 'BIRD': {
      g = new THREE.Group();
      const n = opts.flock || 1;
      g.userData.birds = [];
      for (let i = 0; i < n; i++) {
        const b = bird({ span: 0.9 });
        b.position.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 9);
        b.userData.phase = Math.random() * Math.PI * 2;
        g.add(b);
        g.userData.birds.push(b);
      }
      break;
    }
    case 'INTERCEPTOR':
      g = multirotor({ arms: 4, span: 0.5, body: [0.12, 0.08, 0.3], bodyColor: 0x2e5d8a, armColor: 0x2e5d8a, heat: 0.9 });
      break;
    default:
      g = new THREE.Mesh(new THREE.SphereGeometry(0.5), mat(0xff00ff));
  }
  g.userData.type = type;
  return g;
}

// Animate rotors / wings. t in seconds.
export function animateDrone(g, t, dt) {
  const rotors = g.userData.rotors;
  if (rotors) for (let i = 0; i < rotors.length; i++) rotors[i].userData.spin.rotation.y += dt * 60 * (i % 2 ? 1 : -1);
  const birds = g.userData.birds;
  if (birds) {
    for (const b of birds) {
      const flap = Math.sin(t * 9 + b.userData.phase) * 0.7;
      for (const w of b.userData.wings) w.rotation.z = flap * w.userData.side;
    }
  }
}

// Thermal palette: swap every mesh to a basic grey/white material by heat.
const thermalMats = new Map();
export function thermalMaterial(heat, whiteHot = true) {
  const q = Math.round(heat * 20) / 20;
  const key = `${q}|${whiteHot}`;
  if (!thermalMats.has(key)) {
    // Heat is a perceptual brightness; convert to linear for the renderer.
    const v = Math.pow(whiteHot ? 0.08 + q * 0.92 : 1 - q * 0.9, 2.2);
    thermalMats.set(key, new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v) }));
  }
  return thermalMats.get(key);
}

export function setThermal(root, on) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.heat === undefined || o.userData.disc) return;
    if (on) {
      if (!o.userData.dayMat) o.userData.dayMat = o.material;
      o.material = thermalMaterial(o.userData.heat);
    } else if (o.userData.dayMat) {
      o.material = o.userData.dayMat;
    }
  });
}
