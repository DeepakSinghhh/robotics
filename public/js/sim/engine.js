// DRONA deterministic simulation engine (fixed 20 Hz step, no DOM).
// It runs in the browser for training and headless in Node for tests and the
// exemplar bot. Every random draw comes from forked, seeded RNG streams.

import { Rng } from '../core/rng.js';
import {
  clamp, wrap360, angleDiff, bearingOf, polar, dist2, dist3, len3, cpa, DEG,
} from '../core/math.js';
import {
  TYPES, EFFECTORS, TERRAINS, TIMES, WEATHERS, EW_LEVELS, GEOMETRY, DIFFICULTIES, WCS,
} from './catalog.js';
import { Terrain } from './terrain.js';
import { expandWaves, SPAWN_DEFAULTS } from './scenario.js';
import { evaluate, truthContext, perceivedContext } from '../ai/doctrine.js';
import { atrSuggest } from '../ai/atr.js';

export const SIM_DT = 0.05;
export const STATUS_CODES = { active: 0, rth: 1, landing: 1, landed: 2, downed: 3, diverted: 4, impacted: 5, exited: 6, denied: 7, crash: 3 };
const SOFT_STATUSES = new Set(['rth', 'landing', 'landed', 'diverted', 'denied', 'crash']);

export class Simulation {
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.opts = opts;
    this.t = 0;
    this.tick = 0;
    const seed = spec.seed ?? 1;
    const root = new Rng(seed);
    this.seed = seed;
    this.rng = {
      flight: root.fork('flight'), radar: root.fork('radar'), rf: root.fork('rf'), acoustic: root.fork('acoustic'),
      effect: root.fork('effect'), clutter: root.fork('clutter'), director: root.fork('director'), iff: root.fork('iff'),
    };
    this.D = DIFFICULTIES[spec.difficulty] || DIFFICULTIES.OPERATOR;
    this.terrain = new Terrain(spec.env.terrain, seed);
    this.T = TERRAINS[spec.env.terrain] || TERRAINS.rural;
    this.W = WEATHERS[spec.env.weather] || WEATHERS.clear;
    this.TM = TIMES[spec.env.time] || TIMES.day;
    this.EW = EW_LEVELS[spec.env.ew || 0];
    this.ctx = {
      defendedRadius: GEOMETRY.defendedRadius, restrictedRadius: GEOMETRY.restrictedRadius,
      ...spec.context,
    };
    this.civilianDensity = spec.context.civilianDensity ?? this.T.civilianDensity;
    this.urban = spec.env.terrain === 'urban' || this.civilianDensity >= 0.5;
    this.duration = spec.duration || 300;

    this.entities = [];
    this.byId = new Map();
    this.nextEntity = 1;
    this.tracks = [];
    this.trackById = new Map();
    this.trackByEntity = new Map();
    this.nextTrack = 1;
    this.plots = [];
    this.events = [];
    this.fx = [];
    this.interceptors = [];
    this.swarms = new Map();
    this.spawnQueue = expandWaves(spec);
    this.radar = { angle: 0, period: 2.0 };
    this.eo = { trackId: null, lostFor: 0 };
    this.effectors = this.initEffectors(spec.effectors || {});
    this.asset = { health: 100, warnedUntil: -Infinity, warnings: 0, firstImpactAt: null };
    this.stats = { fratricide: 0, collateral: 0, roe: 0, ownEw: 0, wasted: 0, impacts: 0, kills: 0, softKills: 0, artillery: 0, drops: 0 };
    this.director = { popUpsLeft: spec.popUps ?? 0, nextCheck: 30, lastEase: -999 };
    this.replay = { frames: [], next: 0, meta: {} };
    this.commandLog = [];
    this.listeners = new Set();
    this.finished = false;
    this.endReason = null;
    this.nextRf = 0.25;
    this.nextAcoustic = 0.5;
    this.nextInterceptorId = 1;
    this.log('info', 'system', `${spec.name} — ${WCS[this.ctx.wcs]?.name || this.ctx.wcs}. Defend ${this.ctx.assetName}.`);
  }

  // ------------------------------------------------------------------ utilities
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  log(sev, kind, msg, extra = {}) {
    const ev = { t: Math.round(this.t * 10) / 10, sev, kind, msg, ...extra };
    this.events.push(ev);
    this.emit(ev);
    return ev;
  }

  initEffectors(cfg) {
    const on = (k) => cfg[k] !== false && cfg[k] !== undefined && cfg[k] !== null;
    return {
      RF_JAM: { enabled: on('RF_JAM'), active: null, cooldownUntil: 0, activations: 0, mode: 'narrow' },
      GNSS_SPOOF: { enabled: on('GNSS_SPOOF'), active: null, cooldownUntil: 0, activations: 0 },
      GUN: { enabled: on('GUN'), ammo: cfg.GUN?.ammo ?? EFFECTORS.GUN.ammo, ammoMax: cfg.GUN?.ammo ?? EFFECTORS.GUN.ammo, engagement: null },
      INTERCEPTOR: { enabled: on('INTERCEPTOR'), count: cfg.INTERCEPTOR?.count ?? EFFECTORS.INTERCEPTOR.count, countMax: cfg.INTERCEPTOR?.count ?? EFFECTORS.INTERCEPTOR.count },
      LASER: { enabled: on('LASER'), engagement: null, cooldownUntil: 0 },
    };
  }

  get mast() { return { x: 0, y: 0, z: GEOMETRY.sensorMastHeight }; }
  laserRange() { return EFFECTORS.LASER.range * this.W.laser; }
  rfRange() { return GEOMETRY.rfRange * (1 - 0.3 * this.T.rfNoise); }
  jamRange() { return this.effectors.RF_JAM.mode === 'wide' ? EFFECTORS.RF_JAM.wideRange : EFFECTORS.RF_JAM.range; }
  jamSector() { return this.effectors.RF_JAM.mode === 'wide' ? EFFECTORS.RF_JAM.wideSectorDeg : EFFECTORS.RF_JAM.sectorDeg; }
  entity(id) { return this.byId.get(id); }
  track(id) { return this.trackById.get(id); }

  isDefeated(e) { return SOFT_STATUSES.has(e.status) || e.status === 'downed'; }
  isThreatActive(e) { return e.alive && !e.phantom && e.identity === 'HOSTILE' && e.status === 'active'; }

  // Visual detection range for EO/IR (best of daylight TV and thermal channels).
  visualRange(e) {
    const def = e.def;
    const tv = this.TM.visual * this.W.visual;
    const ir = 0.75 * Math.sqrt(this.W.visual) * (0.5 + 0.5 * def.heat);
    return Math.min(7000, clamp(def.size, 0.2, 6) * 4000 * Math.max(tv, ir));
  }

  eoVisible(e) {
    if (!e || !e.alive || e.phantom || !e.airborne) return false;
    if (dist3(this.mast, e.pos) > this.visualRange(e)) return false;
    return this.terrain.lineOfSight(e.pos.x, e.pos.y, Math.max(e.pos.z, 1));
  }

  ttiOf(pos, vel) {
    const r = Math.hypot(pos.x, pos.y);
    const DR = this.ctx.defendedRadius;
    if (r <= DR) return 0;
    const vr = -(pos.x * vel.x + pos.y * vel.y) / r;
    if (vr < 2) return Infinity;
    const c = cpa(pos, vel);
    if (c.d > DR * 1.6) return Infinity;
    return (r - DR) / vr;
  }

  truthTTI(e) {
    if (!e.alive || e.identity === 'FRIEND' || e.phantom) return Infinity;
    if (e.profile === 'orbit' || e.state === 'orbit' || e.state === 'egress') return Infinity;
    return this.ttiOf(e.pos, e.vel);
  }

  situation(e) {
    const tti = this.truthTTI(e);
    const inRestricted = Math.hypot(e.pos.x, e.pos.y) < this.ctx.restrictedRadius;
    const swarmCount = this.entities.filter((o) => this.isThreatActive(o) && Math.hypot(o.pos.x, o.pos.y) < 4500).length;
    const perceivedSwarm = this.tracks.filter((t) => !t.closed && t.status !== 'lost' && !['FRIEND', 'NEUTRAL', 'NON_UAS'].includes(t.op.ident)).length;
    // EW fratricide risk — truth (own UAV entities) and perceived (tracks marked FRIEND).
    const brg = bearingOf(e.pos.x, e.pos.y);
    const half = this.jamSector() / 2 + 3;
    // Margins cover own aircraft that will fly into the effect while it is radiating.
    const inBeam = (x, y) => Math.hypot(x, y) <= this.jamRange() + 300 && Math.abs(angleDiff(bearingOf(x, y), brg)) <= half;
    const inSpoof = (x, y) => Math.hypot(x, y) <= EFFECTORS.GNSS_SPOOF.range + 700;
    const friends = this.entities.filter((o) => o !== e && o.alive && o.identity === 'FRIEND' && o.status === 'active');
    const friendTracks = this.tracks.filter((t) => !t.closed && t.entityId !== e.id && t.op.ident === 'FRIEND' && t.view.x !== null && t.view.x !== undefined);
    return {
      tti, inRestricted, swarmCount, perceivedSwarm,
      friendlyInJamBeam: friends.some((o) => inBeam(o.pos.x, o.pos.y)),
      friendlyInSpoofRange: friends.some((o) => inSpoof(o.pos.x, o.pos.y)),
      perceivedFriendlyInJamBeam: friendTracks.some((t) => inBeam(t.view.x, t.view.y)),
      perceivedFriendlyInSpoofRange: friendTracks.some((t) => inSpoof(t.view.x, t.view.y)),
    };
  }

  // ------------------------------------------------------------------ main loop
  step() {
    if (this.finished) return;
    const dt = SIM_DT;
    this.t += dt;
    this.tick += 1;
    this.processSpawns();
    for (const e of this.entities) if (e.alive) this.updateEntity(e, dt);
    this.updateInterceptors(dt);
    this.updateEffectors(dt);
    this.updateRadar(dt);
    if (this.t >= this.nextRf) { this.updateRf(); this.nextRf += 0.5; }
    if (this.t >= this.nextAcoustic) { this.updateAcoustic(); this.nextAcoustic += 1; }
    this.updateClutter(dt);
    this.updateEo(dt);
    this.updateTracks();
    this.updateDirector();
    if (this.fx.length) this.fx = this.fx.filter((f) => f.until > this.t);
    if (this.plots.length && this.tick % 20 === 0) this.plots = this.plots.filter((p) => this.t - p.t < 12);
    if (this.t >= this.replay.next) { this.recordFrame(); this.replay.next += 1; }
    this.checkEnd();
  }

  advance(seconds, perStep) {
    const n = Math.round(seconds / SIM_DT);
    for (let i = 0; i < n && !this.finished; i++) {
      this.step();
      if (perStep) perStep(this);
    }
  }

  // ------------------------------------------------------------------ spawning
  processSpawns() {
    while (this.spawnQueue.length && this.spawnQueue[0].t <= this.t) this.spawn(this.spawnQueue.shift());
  }

  spawn(o) {
    const def = TYPES[o.type];
    if (!def) return null;
    const r = this.rng.flight;
    const p = polar(o.bearing, o.range);
    const speedMul = (this.spec.speedMul || 1) * (o.speedFactor || 1);
    const speed = r.range(def.speed[0], def.speed[1]) * speedMul;
    const alt = o.alt ?? r.range(def.alt[0], def.alt[1]);
    const id = `E${String(this.nextEntity++).padStart(2, '0')}`;
    const inward = wrap360(o.bearing + 180);
    const e = {
      id, type: o.type, def, identity: o.identity, profile: o.profile, phantom: false,
      pos: { x: p.x, y: p.y, z: alt },
      vel: { x: Math.sin(inward * DEG) * speed, y: Math.cos(inward * DEG) * speed, z: 0 },
      heading: inward, cruiseSpeed: speed, baseSpeed: speed / (o.speedFactor || 1), cruiseAlt: alt,
      state: 'ingress', stateT: 0, spawnT: this.t, alive: true, airborne: true, status: 'active',
      rfEmitting: def.rf.emits, iffOk: o.identity === 'FRIEND' && !o.iffFail, iffFail: !!o.iffFail, callsign: o.callsign || null,
      aim: { x: r.gauss(0, 55), y: r.gauss(0, 55) },
      waypoints: (o.waypoints || []).map((w) => ({ ...w })),
      swarmId: o.swarmId || null, tactic: o.tactic || null, slot: o.slot ?? 0, offset: o.offset || null,
      weavePhase: r.range(0, Math.PI * 2), weaveAmp: r.range(18, 32), weavePeriod: r.range(5, 8),
      orbitR: 0, orbitDir: r.sign(), isrTimer: 0, isrTime: 50, isrEvents: 0,
      strays: !!o.strays, strayed: false, wander: null, life: 0,
      jam: { exposure: 0, resolved: false }, spoof: { act: -1, exposure: 0, resolved: false },
      radarState: { hits: 0, misses: 0, lastHit: -99 },
      outcome: null, dropped: false, flock: 1, deadAt: null, divertPoint: null,
    };
    switch (o.profile) {
      case 'isr': e.orbitR = r.range(380, 700); e.isrTime = r.range(35, 55); break;
      case 'orbit': e.orbitR = r.range(1800, 2600); e.isrTime = r.range(50, 62); break;
      case 'corridor': e.orbitR = r.range(1500, 1900); e.isrTime = r.range(110, 170); e.corridorBearing = o.bearing; break;
      case 'neutral': e.life = r.range(150, 230); break;
      case 'bird': e.life = r.range(90, 200); e.flock = r.int(3, 9); e.heading = r.range(0, 360); break;
      default: break;
    }
    if (e.swarmId) {
      if (!this.swarms.has(e.swarmId)) this.swarms.set(e.swarmId, { id: e.swarmId, tactic: e.tactic, members: [] });
      this.swarms.get(e.swarmId).members.push(e.id);
    }
    this.entities.push(e);
    this.byId.set(e.id, e);
    this.replay.meta[e.id] = { type: e.type, identity: e.identity, spawnT: Math.round(this.t * 10) / 10, swarmId: e.swarmId, callsign: e.callsign, phantom: false };
    return e;
  }

  spawnPhantom() {
    const r = this.rng.clutter;
    const b = r.range(0, 360), rg = r.range(800, 4500);
    const p = polar(b, rg);
    const id = `C${String(this.nextEntity++).padStart(2, '0')}`;
    const heading = r.range(0, 360);
    const spd = r.range(2, 9);
    const e = {
      id, type: 'BIRD', def: TYPES.BIRD, identity: 'NON_UAS', profile: 'clutter', phantom: true,
      pos: { x: p.x, y: p.y, z: r.range(30, 300) },
      vel: { x: Math.sin(heading * DEG) * spd, y: Math.cos(heading * DEG) * spd, z: 0 },
      heading, cruiseSpeed: spd, cruiseAlt: 100, state: 'clutter', stateT: 0, spawnT: this.t,
      alive: true, airborne: true, status: 'active', rfEmitting: false, iffOk: false, life: r.range(10, 24),
      rcs: r.range(0.03, 0.12), radarState: { hits: 0, misses: 0, lastHit: -99 }, outcome: null,
      jam: { exposure: 0, resolved: false }, spoof: { act: -1 }, aim: { x: 0, y: 0 }, waypoints: [], flock: 1,
    };
    this.entities.push(e);
    this.byId.set(id, e);
    this.replay.meta[id] = { type: 'BIRD', identity: 'NON_UAS', spawnT: Math.round(this.t * 10) / 10, phantom: true };
  }

  // ------------------------------------------------------------------ flight
  updateEntity(e, dt) {
    e.stateT += dt;
    if (e.phantom) {
      e.pos.x += e.vel.x * dt;
      e.pos.y += e.vel.y * dt;
      if (e.stateT > e.life) this.retire(e, 'exited');
      return;
    }
    if (e.status === 'downed') {
      e.vel.z -= 9.8 * dt;
      e.vel.x *= 0.985; e.vel.y *= 0.985;
      this.integrate(e, dt);
      if (e.pos.z <= 0) {
        e.pos.z = 0;
        this.retire(e, 'downed');
        if (e.def.damage > 10 && e.identity === 'HOSTILE') this.addFx({ kind: 'blast', x: e.pos.x, y: e.pos.y, z: 0, size: 6, ttl: 2.5 });
      }
      return;
    }
    if (e.status === 'landing') {
      e.vel.x *= 0.95; e.vel.y *= 0.95; e.vel.z = -3;
      this.integrate(e, dt);
      if (e.pos.z <= 0) { e.pos.z = 0; e.status = 'landed'; this.retire(e, 'landed'); }
      return;
    }
    if (e.status === 'crash') {
      if (e.stateT > 1.2) { e.status = 'downed'; e.vel.z = -6; }
      this.integrate(e, dt);
      return;
    }

    const def = e.def;
    const d = Math.hypot(e.pos.x - e.aim.x, e.pos.y - e.aim.y);
    const rFromAsset = Math.hypot(e.pos.x, e.pos.y);
    let goal = null;
    let speed = e.cruiseSpeed;
    let targetAlt = e.cruiseAlt;
    let climb = def.family === 'delta' ? 35 : def.family === 'fpv' ? 15 : 5;
    let weave = 0;
    let hover = false;

    switch (e.state) {
      case 'ingress': {
        if (e.profile === 'attack' || e.profile === 'lowlevel') {
          const leader = this.swarmLeader(e);
          if (e.tactic === 'wedge' && leader && leader !== e && rFromAsset > 1000) {
            const h = leader.heading * DEG;
            const fx = Math.sin(h), fy = Math.cos(h);
            const rx = Math.cos(h), ry = -Math.sin(h);
            goal = {
              x: leader.pos.x - fx * e.offset.back + rx * e.offset.lateral + leader.vel.x * 1.5,
              y: leader.pos.y - fy * e.offset.back + ry * e.offset.lateral + leader.vel.y * 1.5,
            };
            speed = e.cruiseSpeed * 1.15;
          } else if (e.waypoints.length) {
            goal = e.waypoints[0];
            if (dist2(e.pos, goal) < 140) { e.waypoints.shift(); e.cruiseSpeed = e.baseSpeed; }
          } else {
            goal = e.aim;
          }
          if (e.profile === 'lowlevel') {
            if (d > 450) weave = Math.sin(e.stateT * (2 * Math.PI / e.weavePeriod) + e.weavePhase) * e.weaveAmp;
            if (d < 450) { targetAlt = Math.min(e.cruiseAlt + 18, 45); speed *= 1.1; }
            if (d < 230) { targetAlt = Math.max(0, d * 0.1); goal = e.aim; }
          } else {
            const diveStart = clamp(e.cruiseAlt * 1.5, 250, 900);
            if (d < diveStart && !e.waypoints.length) {
              targetAlt = e.cruiseAlt * Math.max(0, (d - 20) / diveStart);
              speed *= 1.15;
              goal = e.aim;
            }
          }
          if (Math.hypot(d, e.pos.z) < 28 || (d < 50 && e.pos.z < 4)) { this.impact(e); return; }
        } else if (e.profile === 'isr' || e.profile === 'orbit' || e.profile === 'corridor') {
          const b = e.profile === 'corridor' ? e.corridorBearing : bearingOf(e.pos.x, e.pos.y);
          goal = polar(b, e.orbitR);
          if (Math.abs(rFromAsset - e.orbitR) < 80) this.setState(e, 'orbit');
        } else if (e.profile === 'bomber') {
          goal = e.aim;
          if (d < 25) this.setState(e, 'hover');
        } else if (e.profile === 'neutral') {
          this.setState(e, 'wander');
        } else if (e.profile === 'bird') {
          this.setState(e, 'wander');
        }
        break;
      }
      case 'orbit': {
        const b = bearingOf(e.pos.x, e.pos.y);
        goal = polar(wrap360(b + e.orbitDir * 25), e.orbitR);
        if (e.profile === 'isr') speed = e.cruiseSpeed * 0.6;
        e.isrTimer += dt;
        if (e.isrTimer >= e.isrTime) {
          if (e.profile === 'isr') {
            this.setState(e, 'droprun');
          } else if (e.profile === 'orbit') {
            e.isrTimer = 0;
            e.isrEvents += 1;
            this.stats.artillery += 1;
            this.damage(def.damage, e, 'Hostile spotter adjusted artillery fire onto the position');
            if (e.isrEvents >= 3) this.setState(e, 'egress');
          } else if (e.profile === 'corridor') {
            this.setState(e, 'egress');
          }
        }
        break;
      }
      case 'droprun': {
        goal = e.aim;
        targetAlt = 70;
        if (d < 25) this.setState(e, 'hover');
        break;
      }
      case 'hover': {
        hover = true;
        goal = e.aim;
        targetAlt = e.profile === 'bomber' ? Math.min(e.cruiseAlt, 90) : 70;
        if (e.stateT > (e.profile === 'bomber' ? 6 : 4)) {
          e.dropped = true;
          this.stats.drops += 1;
          this.addFx({ kind: 'blast', x: e.aim.x, y: e.aim.y, z: 0, size: e.profile === 'bomber' ? 10 : 4, ttl: 2.5 });
          this.damage(def.damage, e, `${def.short} dropped a munition on the vital area`);
          this.setState(e, 'egress');
        }
        break;
      }
      case 'wander': {
        if (e.profile === 'bird') {
          e.heading = wrap360(e.heading + this.rng.flight.gauss(0, 35) * dt);
          if (rFromAsset > 3000) e.heading = wrap360(bearingOf(-e.pos.x, -e.pos.y) + this.rng.flight.gauss(0, 20));
          if (rFromAsset < 300) e.heading = wrap360(bearingOf(e.pos.x, e.pos.y));
          const dir = polar(e.heading, 100);
          goal = { x: e.pos.x + dir.x, y: e.pos.y + dir.y };
          targetAlt = e.cruiseAlt + Math.sin(e.stateT * 0.3) * 15;
          if (e.stateT > e.life) { this.retire(e, 'exited'); return; }
        } else {
          speed = e.cruiseSpeed * 0.7;
          const rr = this.ctx.restrictedRadius;
          if (!e.wander || dist2(e.pos, e.wander) < 90) {
            const b = bearingOf(e.pos.x, e.pos.y);
            if (e.strays && !e.strayed && e.stateT > 25) {
              e.strayed = true;
              e.wander = polar(wrap360(b + this.rng.flight.gauss(0, 20)), this.rng.flight.range(650, 1050));
            } else {
              e.wander = polar(wrap360(b + this.rng.flight.gauss(0, 50)), this.rng.flight.range(rr + 150, rr + 1100));
            }
          }
          goal = e.wander;
          if (e.stateT > e.life) this.setState(e, 'egress');
        }
        break;
      }
      case 'egress':
      default: {
        const b = e.status === 'diverted' && e.divertPoint ? null : bearingOf(e.pos.x, e.pos.y);
        goal = b === null ? e.divertPoint : polar(b, 7600);
        if (e.status === 'diverted' && e.divertPoint && dist2(e.pos, e.divertPoint) < 120) {
          if (e.def.family === 'delta') {
            this.addFx({ kind: 'blast', x: e.pos.x, y: e.pos.y, z: 0, size: 5, ttl: 2 });
            this.retire(e, 'diverted');
          } else {
            e.status = 'landing';
          }
          return;
        }
        if (rFromAsset > 6900) {
          this.retire(e, e.status === 'active' ? 'exited' : e.status);
          return;
        }
      }
    }

    // Steering.
    let desired = { x: 0, y: 0, z: 0 };
    if (goal && !hover) {
      const dx = goal.x - e.pos.x, dy = goal.y - e.pos.y;
      const dd = Math.hypot(dx, dy) || 1;
      let ang = Math.atan2(dx, dy) + weave * DEG;
      const hs = speed;
      desired.x = Math.sin(ang) * hs;
      desired.y = Math.cos(ang) * hs;
      if (dd < 40 && e.state !== 'ingress') { desired.x *= dd / 40; desired.y *= dd / 40; }
    } else if (hover && goal) {
      desired.x = clamp((goal.x - e.pos.x) * 0.5, -4, 4);
      desired.y = clamp((goal.y - e.pos.y) * 0.5, -4, 4);
    }
    desired.z = clamp((targetAlt - e.pos.z) * 0.6, -climb, climb);

    if (e.swarmId) {
      const sw = this.swarms.get(e.swarmId);
      for (const id of sw.members) {
        if (id === e.id) continue;
        const o = this.byId.get(id);
        if (!o || !o.alive) continue;
        const dx = e.pos.x - o.pos.x, dy = e.pos.y - o.pos.y;
        const dd = Math.hypot(dx, dy);
        if (dd > 0.1 && dd < 18) { desired.x += (dx / dd) * (18 - dd) * 0.8; desired.y += (dy / dd) * (18 - dd) * 0.8; }
      }
    }

    const accMax = Math.max(def.agility, len3(e.vel) * 0.28);
    const ax = clamp(desired.x - e.vel.x, -accMax * dt, accMax * dt);
    const ay = clamp(desired.y - e.vel.y, -accMax * dt, accMax * dt);
    e.vel.x += ax; e.vel.y += ay;
    e.vel.z += clamp(desired.z - e.vel.z, -20 * dt, 20 * dt);
    this.integrate(e, dt);
    if (e.pos.z < 1 && !(e.profile === 'lowlevel' || e.profile === 'attack')) e.pos.z = 1;
    if (Math.hypot(e.vel.x, e.vel.y) > 0.5) e.heading = bearingOf(e.vel.x, e.vel.y);
  }

  integrate(e, dt) {
    e.pos.x += e.vel.x * dt;
    e.pos.y += e.vel.y * dt;
    e.pos.z = Math.max(0, e.pos.z + e.vel.z * dt);
  }

  setState(e, s) { e.state = s; e.stateT = 0; }

  swarmLeader(e) {
    if (!e.swarmId) return null;
    const sw = this.swarms.get(e.swarmId);
    for (const id of sw.members) {
      const o = this.byId.get(id);
      if (o && o.alive && o.status === 'active') return o;
    }
    return null;
  }

  retire(e, status) {
    e.alive = false;
    e.airborne = false;
    e.status = status;
    e.deadAt = this.t;
    if (!e.outcome) {
      if (status === 'exited') e.outcome = { result: e.dropped ? 'LEAKED' : 'EXITED', t: this.t };
    }
  }

  // ------------------------------------------------------------------ effects on targets
  addFx(f) {
    this.fx.push({ ...f, t0: this.t, until: this.t + (f.ttl ?? 1) });
  }

  damage(amount, e, reason) {
    const warned = this.t <= this.asset.warnedUntil;
    const dmg = amount * (warned ? 0.55 : 1);
    this.asset.health = Math.max(0, this.asset.health - dmg);
    if (this.asset.firstImpactAt === null) this.asset.firstImpactAt = this.t;
    const tr = this.trackByEntity.get(e.id);
    this.log('bad', 'damage', `${reason}. Vital area -${Math.round(dmg)}%${warned ? ' (reduced: troops under cover)' : ''}.`, { trackId: tr?.id, entityId: e.id });
  }

  impact(e) {
    e.status = 'impacted';
    e.outcome = { result: 'LEAKED', t: this.t };
    this.stats.impacts += 1;
    this.addFx({ kind: 'blast', x: e.pos.x, y: e.pos.y, z: Math.max(0, e.pos.z), size: e.def.damage > 20 ? 18 : 8, ttl: 3 });
    this.retire(e, 'impacted');
    this.damage(e.def.damage, e, `IMPACT: ${e.def.short} struck the vital area`);
  }

  destroy(e, by) {
    if (!e.alive || e.status === 'downed') return;
    const wasDefeated = this.isDefeated(e);
    e.status = 'downed';
    e.vel.z = Math.min(e.vel.z, -4);
    if (!wasDefeated || !e.outcome) e.outcome = { result: 'NEUTRALISED', t: this.t, by };
    this.stats.kills += 1;
    this.addFx({ kind: 'burst', x: e.pos.x, y: e.pos.y, z: e.pos.z, size: Math.max(3, e.def.size * 2.5), ttl: 1.6 });
    const tr = this.trackByEntity.get(e.id);
    const label = tr ? tr.id : 'Untracked target';
    if (e.identity === 'FRIEND') {
      this.stats.fratricide += 1;
      e.outcome.result = 'FRATRICIDE';
      this.log('bad', 'fratricide', `FRATRICIDE: ${label} was own UAV ${e.callsign || ''}, destroyed by ${EFFECTORS[by]?.short || by}.`, { trackId: tr?.id, entityId: e.id });
    } else if (e.identity === 'NEUTRAL') {
      this.stats.collateral += 1;
      e.outcome.result = 'KILLED_NEUTRAL';
      this.log('bad', 'collateral', `Civil (neutral) drone ${label} destroyed. Investigation initiated.`, { trackId: tr?.id, entityId: e.id });
    } else if (e.type === 'BIRD') {
      this.stats.wasted += 1;
      this.log('warn', 'waste', `${label} destroyed: it was a bird. Munitions wasted.`, { trackId: tr?.id, entityId: e.id });
    } else {
      this.log('good', 'kill', `${label} SPLASH: destroyed by ${EFFECTORS[by]?.short || by}.`, { trackId: tr?.id, entityId: e.id });
    }
    if (by === 'GUN' && this.urban && this.rng.effect.chance(0.12 * this.civilianDensity)) {
      this.stats.collateral += 1;
      this.log('bad', 'collateral', `Debris and rounds from ${label} fell on a built-up area. Civilian property damaged.`, { trackId: tr?.id });
    }
    this.onDefeat(e, by);
  }

  softKill(e, by, mode) {
    if (!e.alive || e.status !== 'active') return;
    const tr = this.trackByEntity.get(e.id);
    const label = tr ? tr.id : 'Untracked target';
    e.status = mode;
    e.stateT = 0;
    if (mode === 'rth' || mode === 'denied') this.setState(e, 'egress');
    if (mode === 'diverted') {
      const b = this.rng.effect.range(0, 360);
      e.divertPoint = polar(b, this.rng.effect.range(2200, 3200));
      this.setState(e, 'egress');
    }
    if (e.identity === 'FRIEND') {
      this.stats.ownEw += 1;
      e.outcome = { result: 'OWN_EW', t: this.t, by };
      this.log('bad', 'ownew', `Own UAV ${e.callsign || label} affected by own ${EFFECTORS[by].short}: ${mode === 'diverted' ? 'navigation corrupted' : 'link lost'}. Mission aborted.`, { trackId: tr?.id, entityId: e.id });
    } else {
      e.outcome = { result: 'SOFT_KILL', t: this.t, by, mode };
      this.stats.softKills += 1;
      const what = { rth: 'link lost, returning home', landing: 'link lost, landing', crash: 'link lost, crashing', diverted: 'GNSS spoofed, diverted', denied: 'datalink denied, ISR mission defeated' }[mode];
      this.log('good', 'softkill', `${label} ${what}.`, { trackId: tr?.id, entityId: e.id });
    }
    this.onDefeat(e, by);
  }

  onDefeat(e, by) {
    const tr = this.trackByEntity.get(e.id);
    if (tr && !tr.op.decision) this.captureDecision(tr, by, true);
  }

  // ------------------------------------------------------------------ sensors
  updateRadar(dt) {
    const prev = this.radar.angle;
    const sweep = (360 * dt) / this.radar.period;
    this.radar.angle = (prev + sweep) % 360;
    for (const e of this.entities) {
      if (!e.alive || !e.airborne) continue;
      const b = bearingOf(e.pos.x, e.pos.y);
      if (wrap360(b - prev) < sweep) this.radarLook(e, b);
    }
    if (prev + sweep >= 360) this.radarClutterSweep();
  }

  radarLook(e, bearing) {
    const r = Math.hypot(e.pos.x, e.pos.y);
    const rs = e.radarState;
    const rcs = e.phantom ? e.rcs : e.def.rcs;
    const rmax = Math.min(GEOMETRY.radarRange, 5000 * Math.pow(rcs / 0.1, 0.25) * this.W.radar * this.EW.radarRange);
    let pd = 0;
    if (r <= rmax) pd = 0.95 * (r < 0.7 * rmax ? 1 : 1 - (r - 0.7 * rmax) / (0.3 * rmax));
    pd *= this.spec.sensors?.radarPd ?? 0.95;
    if (!e.phantom && !this.terrain.lineOfSight(e.pos.x, e.pos.y, e.pos.z)) pd = Math.min(pd, 0.03);
    if (e.type === 'BIRD' && !e.phantom) pd *= 0.85;
    if (e.status === 'downed') pd *= 0.5;
    const rng = this.rng.radar;
    if (rng.chance(pd)) {
      const ebe = this.EW.bearingErr;
      const rr = r + rng.gauss(0, 7 * Math.sqrt(ebe));
      const bb = bearing + rng.gauss(0, 0.45 * ebe);
      const pl = polar(bb, rr);
      const plot = { x: pl.x, y: pl.y, z: Math.max(0, e.pos.z + rng.gauss(0, 10)), t: this.t, eid: e.id };
      this.plots.push(plot);
      if (rs.misses >= 2) rs.hits = 0;
      rs.hits += 1;
      rs.misses = 0;
      rs.lastHit = this.t;
      if (rs.hits >= 2 || this.trackByEntity.has(e.id)) {
        const tr = this.ensureTrack(e, 'radar');
        this.updateTrackPosition(tr, plot, 0.55);
        tr.sources.radar = this.t;
      }
    } else {
      rs.misses += 1;
    }
  }

  radarClutterSweep() {
    const rng = this.rng.clutter;
    const lambda = this.D.clutter * this.T.clutter * (this.W.key === 'rain' ? 1.8 : 1) * 2;
    let n = 0;
    let L = Math.exp(-lambda), p = 1;
    do { n++; p *= rng.float(); } while (p > L && n < 30);
    n -= 1;
    for (let i = 0; i < n; i++) {
      const pl = polar(rng.range(0, 360), rng.range(300, 5200));
      this.plots.push({ x: pl.x, y: pl.y, z: rng.range(0, 200), t: this.t, eid: null });
    }
  }

  updateClutter(dt) {
    const rate = this.D.clutter * this.T.clutter * (this.W.key === 'rain' ? 1.5 : 1) * 0.011;
    if (this.t > 5 && this.t < this.duration - 20 && this.rng.clutter.chance(rate * dt)) this.spawnPhantom();
  }

  updateRf() {
    const range = this.rfRange();
    const rng = this.rng.rf;
    for (const e of this.entities) {
      if (!e.alive || !e.airborne || !e.rfEmitting || e.phantom) continue;
      const r = Math.hypot(e.pos.x, e.pos.y);
      if (r > range) continue;
      let pd = 0.9 * (r < range * 0.7 ? 1 : (range - r) / (range * 0.3));
      pd *= 1 - 0.25 * this.T.rfNoise;
      if (!rng.chance(pd)) continue;
      const brg = wrap360(bearingOf(e.pos.x, e.pos.y) + rng.gauss(0, 3.5 * this.EW.bearingErr));
      const tr = this.ensureTrack(e, 'rf');
      tr.sources.rf = this.t;
      tr.rf = {
        bearing: brg, bands: e.def.rf.bands, pattern: e.def.rf.pattern,
        protocol: this.spec.sensors?.protocolLibrary ? e.def.rf.protocol : 'Unknown emitter (no library match)',
        strength: clamp(1 - r / range, 0.05, 1), t: this.t,
      };
      if (!tr.est.hasPos) tr.est.bearing = tr.est.bearing == null ? brg : wrap360(tr.est.bearing + angleDiff(tr.est.bearing, brg) * 0.4);
    }
  }

  updateAcoustic() {
    const range = this.T.acousticRange * this.W.acoustic;
    const rng = this.rng.acoustic;
    for (const e of this.entities) {
      if (!e.alive || !e.airborne || e.phantom || !e.def.acoustic) continue;
      const r = dist3(this.mast, e.pos);
      if (r > range || !rng.chance(0.85)) continue;
      const brg = wrap360(bearingOf(e.pos.x, e.pos.y) + rng.gauss(0, 6));
      const tr = this.ensureTrack(e, 'acoustic');
      tr.sources.acoustic = this.t;
      tr.acoustic = { bearing: brg, f0: Math.round(e.def.acoustic.f0 * (1 + rng.gauss(0, 0.04))), character: e.def.acoustic.character, level: clamp(1 - r / range, 0.1, 1), t: this.t };
      if (!tr.est.hasPos) tr.est.bearing = tr.est.bearing == null ? brg : wrap360(tr.est.bearing + angleDiff(tr.est.bearing, brg) * 0.4);
    }
  }

  updateEo(dt) {
    if (!this.eo.trackId) return;
    const tr = this.trackById.get(this.eo.trackId);
    const e = tr && this.byId.get(tr.entityId);
    if (!tr || tr.closed || !e) { this.eo.trackId = null; return; }
    if (this.eoVisible(e)) {
      this.eo.lostFor = 0;
      tr.sources.eo = this.t;
      this.updateTrackPosition(tr, { x: e.pos.x, y: e.pos.y, z: e.pos.z }, 0.9);
    } else {
      this.eo.lostFor += dt;
      if (this.eo.lostFor > 3) {
        this.log('warn', 'eo', `EO/IR lost lock on ${tr.id}.`, { trackId: tr.id });
        this.eo.trackId = null;
      }
    }
  }

  // ------------------------------------------------------------------ tracks
  ensureTrack(e, source) {
    let tr = this.trackByEntity.get(e.id);
    if (tr) return tr;
    const id = `T${String(this.nextTrack++).padStart(2, '0')}`;
    const aiDelay = 2.5 + new Rng(this.seed).fork(`aidelay:${e.id}`).float() * 3;
    tr = {
      id, entityId: e.id, createdAt: this.t, createdBy: source, status: 'tentative', unread: true,
      sources: { radar: -99, rf: -99, acoustic: -99, eo: -99 },
      est: { x: null, y: null, z: null, vx: 0, vy: 0, lastT: null, hasPos: false, bearing: null },
      view: { range: null, bearing: null, alt: null, speed: null, heading: null, tti: Infinity, inRestricted: false },
      rf: null, acoustic: null, ai: null, aiAt: this.t + aiDelay, aiRefined: false,
      op: { ackAt: null, cls: null, clsAt: null, clsViaAI: false, aiAtCls: null, ident: null, identAt: null, iff: null, iffPendingUntil: null, decision: null, actions: [], roe: [], dismissed: false, monitored: false },
      closed: null,
    };
    this.tracks.push(tr);
    this.trackById.set(id, tr);
    this.trackByEntity.set(e.id, tr);
    const srcName = { radar: 'radar', rf: 'RF detector', acoustic: 'acoustic array', eo: 'EO/IR' }[source];
    this.log('info', 'track_new', `New track ${id} from ${srcName}.`, { trackId: id, entityId: e.id });
    return tr;
  }

  updateTrackPosition(tr, p, alpha) {
    const est = tr.est;
    if (!est.hasPos) {
      est.x = p.x; est.y = p.y; est.z = p.z; est.lastT = this.t; est.hasPos = true; est.n = 1;
      return;
    }
    const dtp = Math.max(0.05, this.t - est.lastT);
    est.n = (est.n || 1) + 1;
    if (est.n === 2) {
      // Two-point initialisation of the velocity estimate.
      est.vx = (p.x - est.x) / dtp; est.vy = (p.y - est.y) / dtp;
      est.x = p.x; est.y = p.y; est.z = p.z; est.lastT = this.t;
      return;
    }
    const px = est.x + est.vx * dtp, py = est.y + est.vy * dtp;
    const rx = p.x - px, ry = p.y - py;
    est.x = px + alpha * rx;
    est.y = py + alpha * ry;
    est.z = est.z + 0.5 * (p.z - est.z);
    const beta = alpha > 0.8 ? 0.5 : 0.25;
    est.vx += (beta * rx) / dtp;
    est.vy += (beta * ry) / dtp;
    const sp = Math.hypot(est.vx, est.vy);
    if (sp > 90) { est.vx *= 90 / sp; est.vy *= 90 / sp; }
    est.lastT = this.t;
  }

  updateTracks() {
    for (const tr of this.tracks) {
      if (tr.closed) continue;
      const e = this.byId.get(tr.entityId);
      const s = tr.sources;
      const last = Math.max(s.radar, s.rf, s.acoustic, s.eo);
      const age = this.t - last;
      const posFresh = Math.max(s.radar, s.eo);
      if (tr.est.hasPos && this.t - posFresh > 6) tr.est.hasPos = false;
      let status;
      if (age > 8) status = 'lost';
      else if (this.t - s.eo < 1.5 || (this.t - s.radar < 5 && e.radarState.hits >= 2)) status = 'firm';
      else if (this.t - s.radar < 5) status = 'tentative';
      else status = 'bearing';
      if (status === 'lost' && tr.status !== 'lost' && e.alive) this.log('warn', 'track_lost', `Track ${tr.id} lost — no sensor updates.`, { trackId: tr.id });
      tr.status = status;

      const v = tr.view;
      if (tr.est.hasPos) {
        const dtp = this.t - tr.est.lastT;
        const x = tr.est.x + tr.est.vx * dtp, y = tr.est.y + tr.est.vy * dtp;
        v.range = Math.hypot(x, y);
        v.bearing = bearingOf(x, y);
        v.alt = tr.est.z;
        v.speed = Math.hypot(tr.est.vx, tr.est.vy);
        v.heading = bearingOf(tr.est.vx, tr.est.vy);
        v.tti = this.ttiOf({ x, y }, { x: tr.est.vx, y: tr.est.vy });
        v.inRestricted = v.range < this.ctx.restrictedRadius;
        v.x = x; v.y = y;
        tr.est.bearing = v.bearing;
      } else {
        v.range = null; v.alt = null; v.speed = null; v.heading = null; v.tti = Infinity;
        v.bearing = tr.est.bearing;
        v.x = null; v.y = null;
      }

      // ATR aid.
      if (this.spec.aiAid?.enabled && e && !tr.ai && this.t >= tr.aiAt && (tr.est.hasPos || this.t - s.eo < 1)) {
        tr.ai = this.atrFor(e, false);
      } else if (tr.ai && !tr.aiRefined && this.t - s.eo < 0.5 && this.t - tr.aiAt > 2) {
        tr.aiRefined = true;
        tr.ai = this.atrFor(e, true);
      }

      // IFF interrogation completes.
      if (tr.op.iffPendingUntil !== null && this.t >= tr.op.iffPendingUntil) {
        tr.op.iffPendingUntil = null;
        let valid = e.alive && e.iffOk;
        if (valid && this.rng.iff.chance(this.EW.iffFail * 0.5)) valid = false;
        tr.op.iff = { t: this.t, valid, callsign: valid ? e.callsign : null };
        this.log(valid ? 'good' : 'info', 'iff', valid ? `IFF ${tr.id}: MODE-5 VALID — ${e.callsign}.` : `IFF ${tr.id}: NO RESPONSE.`, { trackId: tr.id });
      }

      // Close dead targets after a short BDA delay.
      if (!e.alive && e.deadAt !== null && this.t - e.deadAt > 1.5) {
        tr.closed = { t: this.t, status: e.status };
        if (this.eo.trackId === tr.id) this.eo.trackId = null;
      }
    }
  }

  atrFor(e, eo) {
    const r = new Rng(this.seed).fork(`atr:${e.id}:${eo ? 1 : 0}`);
    if (e.phantom) return { cls: r.chance(0.75) ? 'BIRD' : 'QUAD', conf: Math.round(r.range(0.5, 0.75) * 100) / 100, correct: true };
    return atrSuggest(r, e, {
      accuracy: this.spec.aiAid?.accuracy ?? 0.85,
      night: this.spec.env.time === 'night',
      weatherVisual: this.W.visual,
      ew: this.spec.env.ew || 0,
      difficultyOrder: this.D.order,
      eo,
    });
  }

  trackList() {
    const prio = (tr) => {
      if (tr.closed) return 1e9 + tr.closed.t;
      if (tr.op.dismissed) return 1e8;
      const unread = tr.op.ackAt === null ? -1e6 : 0;
      const tti = isFinite(tr.view.tti) ? tr.view.tti : 5000;
      return unread + tti;
    };
    return this.tracks.slice().sort((a, b) => prio(a) - prio(b));
  }

  // ------------------------------------------------------------------ operator commands
  command(cmd) {
    const res = this.execute(cmd) || { ok: true };
    this.commandLog.push({ tick: this.tick, t: Math.round(this.t * 100) / 100, ...cmd, ok: !!res.ok });
    return res;
  }

  execute(cmd) {
    if (this.finished) return { ok: false, reason: 'Mission ended' };
    if (cmd.type === 'warn') return this.warn();
    if (cmd.type === 'designate') return this.designate(cmd.entityId);
    if (cmd.type === 'eoUnlock') { this.eo.trackId = null; return { ok: true }; }
    if (cmd.type === 'jamMode') {
      this.effectors.RF_JAM.mode = cmd.mode === 'wide' ? 'wide' : 'narrow';
      this.log('info', 'jammode', `Jammer beam set to ${this.effectors.RF_JAM.mode.toUpperCase()} (${this.jamSector()}°, ${this.jamRange()} m).`, { op: true });
      return { ok: true };
    }
    const tr = this.trackById.get(cmd.trackId);
    if (!tr) return { ok: false, reason: 'Unknown track' };
    if (tr.closed && cmd.type !== 'ack') return { ok: false, reason: 'Track closed' };
    switch (cmd.type) {
      case 'ack': this.ack(tr); return { ok: true };
      case 'classify': {
        this.ack(tr);
        tr.op.cls = cmd.cls;
        tr.op.clsAt = this.t;
        tr.op.clsViaAI = !!cmd.viaAI;
        tr.op.aiAtCls = tr.ai ? { ...tr.ai } : null;
        if (cmd.cls === 'BIRD' && !tr.op.ident) { tr.op.ident = 'NON_UAS'; tr.op.identAt = this.t; }
        this.log('info', 'classify', `${tr.id} classified ${TYPES[cmd.cls].short}${cmd.viaAI ? ' (AI aid accepted)' : ''}.`, { trackId: tr.id, op: true });
        return { ok: true };
      }
      case 'identify':
        this.ack(tr);
        tr.op.ident = cmd.ident;
        tr.op.identAt = this.t;
        this.log('info', 'identify', `${tr.id} identified ${cmd.ident}.`, { trackId: tr.id, op: true });
        return { ok: true };
      case 'iff':
        this.ack(tr);
        if (tr.op.iffPendingUntil !== null) return { ok: false, reason: 'Interrogation in progress' };
        tr.op.iffPendingUntil = this.t + 1.5;
        tr.op.iffAsked = (tr.op.iffAsked || 0) + 1;
        this.log('info', 'iff', `Interrogating ${tr.id} (IFF Mode-5)…`, { trackId: tr.id, op: true });
        return { ok: true };
      case 'monitor':
        this.ack(tr);
        tr.op.monitored = true;
        tr.op.dismissed = false;
        tr.op.actions.push({ t: this.t, action: 'MONITOR' });
        this.captureDecision(tr, 'MONITOR');
        this.log('info', 'decision', `${tr.id}: monitor / hold fire.`, { trackId: tr.id, op: true });
        return { ok: true };
      case 'dismiss':
        this.ack(tr);
        tr.op.dismissed = true;
        tr.op.actions.push({ t: this.t, action: 'DISMISS' });
        this.captureDecision(tr, 'DISMISS');
        if (this.eo.trackId === tr.id) this.eo.trackId = null;
        this.log('info', 'decision', `${tr.id} dismissed as non-threat.`, { trackId: tr.id, op: true });
        return { ok: true };
      case 'eoLock': {
        const e = this.byId.get(tr.entityId);
        this.ack(tr);
        if (!this.eoVisible(e)) return { ok: false, reason: 'Target not visible to EO/IR at this range or in these conditions' };
        this.eo.trackId = tr.id;
        this.eo.lostFor = 0;
        return { ok: true };
      }
      case 'engage': return this.engage(tr, cmd.effector);
      default: return { ok: false, reason: `Unknown command ${cmd.type}` };
    }
  }

  ack(tr) {
    tr.unread = false;
    if (tr.op.ackAt === null) {
      tr.op.ackAt = this.t;
    }
  }

  warn() {
    this.asset.warnedUntil = this.t + 90;
    this.asset.warnings += 1;
    this.log('warn', 'warn', 'AIR SENTRY WARNING issued. Troops take cover (impact damage reduced for 90 s).', { op: true });
    return { ok: true };
  }

  designate(entityId) {
    const e = this.byId.get(entityId);
    if (!e || !this.eoVisible(e)) return { ok: false, reason: 'Nothing detectable there' };
    const existed = this.trackByEntity.has(e.id);
    const tr = this.ensureTrack(e, 'eo');
    if (!existed) tr.visualFirst = true;
    this.ack(tr);
    this.eo.trackId = tr.id;
    this.eo.lostFor = 0;
    tr.sources.eo = this.t;
    this.updateTrackPosition(tr, { ...e.pos }, 0.9);
    return { ok: true, trackId: tr.id };
  }

  canEngage(eff, tr) {
    const E = this.effectors[eff];
    const no = (reason) => ({ ok: false, reason });
    if (!E || !E.enabled) return no('Not fielded in this scenario');
    const hasPos = tr.est.hasPos;
    const range = tr.view.range;
    switch (eff) {
      case 'RF_JAM':
        if (this.t < E.cooldownUntil) return no('Jammer cooling down');
        if (hasPos && range > this.jamRange()) return no(`Out of range (> ${this.jamRange()} m, ${E.mode} beam)`);
        if (!hasPos && tr.view.bearing == null) return no('No bearing');
        return { ok: true };
      case 'GNSS_SPOOF':
        if (E.active) return { ok: true, note: 'Already radiating' };
        if (this.t < E.cooldownUntil) return no('Spoofer cooling down');
        if (hasPos && range > EFFECTORS.GNSS_SPOOF.range) return no(`Out of range (> ${EFFECTORS.GNSS_SPOOF.range} m)`);
        return { ok: true };
      case 'GUN':
        if (E.ammo <= 0) return no('Out of ammunition');
        if (!hasPos) return no('No fire-control solution (bearing-only track)');
        if (range > EFFECTORS.GUN.range) return no(`Out of range (> ${EFFECTORS.GUN.range} m)`);
        return { ok: true };
      case 'INTERCEPTOR':
        if (E.count <= 0) return no('No interceptors left');
        if (!hasPos) return no('No position for launch (bearing-only track)');
        if (range > EFFECTORS.INTERCEPTOR.range) return no(`Out of range (> ${EFFECTORS.INTERCEPTOR.range} m)`);
        return { ok: true };
      case 'LASER':
        if (E.engagement) return no('Laser engaged on another target');
        if (this.t < E.cooldownUntil) return no('Laser cooling');
        if (!hasPos) return no('No fire-control solution (bearing-only track)');
        if (range > this.laserRange()) return no(`Out of range (${Math.round(this.laserRange())} m in ${this.W.name.toLowerCase()})`);
        return { ok: true };
      default:
        return no('Unknown effector');
    }
  }

  availability(tr) {
    const out = { MONITOR: true, DISMISS: true };
    for (const k of Object.keys(EFFECTORS)) out[k] = this.canEngage(k, tr).ok;
    return out;
  }

  // The first decisive action is scored. A passive decision (monitor/dismiss) is
  // provisional: if an effector is employed later, the engagement is what counts.
  captureDecision(tr, action, implicit = false) {
    const prev = tr.op.decision;
    const passive = (a) => a === 'MONITOR' || a === 'DISMISS';
    if (prev && !(passive(prev.action) && !passive(action) && !implicit)) return;
    const e = this.byId.get(tr.entityId);
    const sit = this.situation(e);
    const base = { wcs: this.ctx.wcs, urban: this.urban, weather: this.W.key, tti: sit.tti, inRestricted: sit.inRestricted };
    const truth = evaluate(truthContext({
      entity: e, ...base, swarmCount: sit.swarmCount, friendlyInJamBeam: sit.friendlyInJamBeam, friendlyInSpoofRange: sit.friendlyInSpoofRange,
    }));
    const perceived = evaluate(perceivedContext({
      cls: tr.op.cls, ident: tr.op.ident, rfEvidence: this.t - tr.sources.rf < 6, ...base, swarmCount: sit.perceivedSwarm,
      friendlyInJamBeam: sit.perceivedFriendlyInJamBeam, friendlyInSpoofRange: sit.perceivedFriendlyInSpoofRange,
    }));
    tr.op.decision = {
      action, t: this.t, implicit, tti: sit.tti, inRestricted: sit.inRestricted,
      clsAtDecision: tr.op.cls, identAtDecision: tr.op.ident,
      available: implicit ? { ...this.availability(tr), [action]: true } : this.availability(tr),
      truth: { path: truth.path, leafId: truth.leafId, ratings: truth.ratings, modifiers: truth.modifiers },
      perceived: { path: perceived.path, leafId: perceived.leafId, ratings: perceived.ratings, modifiers: perceived.modifiers },
    };
    if (!implicit) tr.op.decision.available[action] = true;
    if (prev) tr.op.decision.prior = { action: prev.action, t: prev.t };
  }

  roeCheck(tr, eff) {
    const kind = EFFECTORS[eff].kind;
    const ident = tr.op.ident;
    const wcs = this.ctx.wcs;
    const tti = tr.view.tti;
    const v = [];
    if (ident === 'FRIEND') v.push('Engaged a track you had identified as FRIEND');
    else if (ident === 'NEUTRAL' && kind === 'hard') v.push('Hard-kill used against a NEUTRAL track');
    else if (wcs === 'TIGHT' && kind === 'hard' && ident !== 'HOSTILE') v.push('WEAPONS TIGHT: hard-kill without positive HOSTILE identification');
    else if (wcs === 'TIGHT' && kind === 'soft' && (!ident || ident === 'UNKNOWN')) v.push('WEAPONS TIGHT: effector employed before any identification');
    if (wcs === 'HOLD' && !(tti < 25)) v.push('WEAPONS HOLD: engaged without an imminent threat');
    for (const msg of v) {
      tr.op.roe.push({ t: this.t, msg, effector: eff });
      this.stats.roe += 1;
      this.log('bad', 'roe', `ROE VIOLATION (${tr.id}): ${msg}.`, { trackId: tr.id });
    }
  }

  engage(tr, eff) {
    const chk = this.canEngage(eff, tr);
    if (!chk.ok) return chk;
    const e = this.byId.get(tr.entityId);
    this.ack(tr);
    this.roeCheck(tr, eff);
    this.captureDecision(tr, eff);
    tr.op.actions.push({ t: this.t, action: eff });
    tr.op.monitored = false;
    tr.op.dismissed = false;
    const E = this.effectors[eff];
    const bearing = tr.view.bearing ?? bearingOf(e.pos.x, e.pos.y);
    switch (eff) {
      case 'RF_JAM':
        if (E.active) {
          E.active.trackId = tr.id;
          E.active.bearing = bearing;
          E.active.until = this.t + EFFECTORS.RF_JAM.duration;
        } else {
          E.activations += 1;
          E.active = { id: E.activations, trackId: tr.id, bearing, start: this.t, until: this.t + EFFECTORS.RF_JAM.duration };
        }
        break;
      case 'GNSS_SPOOF':
        if (!E.active) {
          E.activations += 1;
          E.active = { id: E.activations, start: this.t, until: this.t + EFFECTORS.GNSS_SPOOF.duration };
        }
        break;
      case 'GUN':
        E.engagement = { entityId: e.id, trackId: tr.id, bursts: EFFECTORS.GUN.burstsPerEngagement, next: this.t + 0.5 };
        break;
      case 'INTERCEPTOR':
        E.count -= 1;
        this.interceptors.push({
          id: `I${this.nextInterceptorId++}`, pos: { x: 0, y: 0, z: 18 }, vel: { x: 0, y: 0, z: 20 },
          targetId: e.id, trackId: tr.id, t0: this.t, alive: true, misses: 0, cooldown: 0,
        });
        if (e.type === 'BIRD' || e.type === 'DECOY' || e.phantom) this.stats.wasted += e.type === 'DECOY' ? 0.5 : 1;
        break;
      case 'LASER':
        E.engagement = { entityId: e.id, trackId: tr.id, dwell: 0, needed: EFFECTORS.LASER.dwell * e.def.hardness, lost: 0 };
        break;
      default: break;
    }
    this.log('info', 'engage', `${tr.id}: ${EFFECTORS[eff].name} engaged.`, { trackId: tr.id, effector: eff, op: true });
    return { ok: true };
  }

  updateEffectors(dt) {
    const rng = this.rng.effect;
    // RF jammer — directional beam that follows its track. Exposure builds while a
    // drone sits inside the beam and decays when it leaves, so re-pointing the beam
    // between targets of a swarm still works.
    const J = this.effectors.RF_JAM;
    if (J.active && this.t > J.active.until) {
      J.active = null;
      J.cooldownUntil = this.t + EFFECTORS.RF_JAM.cooldown;
    }
    if (J.active) {
      const tr = this.trackById.get(J.active.trackId);
      if (tr && !tr.closed && tr.view.bearing != null) J.active.bearing = tr.view.bearing;
    }
    const jr = this.jamRange(), half = this.jamSector() / 2;
    for (const e of this.entities) {
      if (!e.alive || !e.airborne || e.phantom || !e.rfEmitting || e.status !== 'active') continue;
      const inBeam = J.active && Math.hypot(e.pos.x, e.pos.y) <= jr && Math.abs(angleDiff(bearingOf(e.pos.x, e.pos.y), J.active.bearing)) <= half;
      if (inBeam) {
        e.jam.exposure += dt;
        if (!e.jam.resolved && e.jam.exposure >= EFFECTORS.RF_JAM.activation) {
          e.jam.resolved = true;
          this.resolveJam(e, rng);
        }
      } else if (e.jam.exposure > 0) {
        e.jam.exposure = Math.max(0, e.jam.exposure - dt * 0.5);
        if (e.jam.exposure === 0) e.jam.resolved = false;
      }
    }
    // GNSS spoofer — omni-directional.
    const S = this.effectors.GNSS_SPOOF;
    if (S.active) {
      if (this.t > S.active.until) {
        S.active = null;
        S.cooldownUntil = this.t + EFFECTORS.GNSS_SPOOF.cooldown;
      } else {
        for (const e of this.entities) {
          if (!e.alive || !e.airborne || e.phantom || !e.def.gnss || e.status !== 'active') continue;
          if (Math.hypot(e.pos.x, e.pos.y) > EFFECTORS.GNSS_SPOOF.range) continue;
          if (e.spoof.act !== S.active.id) e.spoof = { act: S.active.id, exposure: 0, resolved: false };
          e.spoof.exposure += dt;
          if (!e.spoof.resolved && e.spoof.exposure >= EFFECTORS.GNSS_SPOOF.activation) {
            e.spoof.resolved = true;
            if (rng.chance(e.def.vuln.GNSS_SPOOF)) {
              const mode = e.def.family === 'multirotor' && rng.chance(0.5) ? 'landing' : 'diverted';
              this.softKill(e, 'GNSS_SPOOF', mode);
            } else if (this.trackByEntity.get(e.id)?.op.actions.some((a) => a.action === 'GNSS_SPOOF')) {
              this.log('warn', 'noeffect', `GNSS spoof: no observable effect on ${this.trackByEntity.get(e.id).id}.`, { trackId: this.trackByEntity.get(e.id).id });
            }
          }
        }
      }
    }
    // Gun.
    const G = this.effectors.GUN;
    if (G.engagement) {
      const eng = G.engagement;
      const e = this.byId.get(eng.entityId);
      if (!e || !e.alive || e.status === 'downed' || eng.bursts <= 0 || G.ammo <= 0) {
        if (e && e.alive && e.status !== 'downed' && eng.bursts <= 0) this.log('warn', 'miss', `GUN: ${eng.trackId} not destroyed. Re-engage or switch effector.`, { trackId: eng.trackId });
        G.engagement = null;
      } else if (this.t >= eng.next) {
        const r = dist3(this.mast, e.pos);
        eng.next = this.t + EFFECTORS.GUN.burstInterval;
        if (r > EFFECTORS.GUN.range + 100) {
          this.log('warn', 'miss', `GUN: ${eng.trackId} out of range. Engagement ceased.`, { trackId: eng.trackId });
          G.engagement = null;
        } else {
          G.ammo -= 1;
          eng.bursts -= 1;
          const spd = len3(e.vel);
          const size = clamp(e.def.size / 0.8, 0.5, 1.5);
          const speedF = clamp(1.25 - spd / 55, 0.35, 1.15);
          const rangeF = clamp(1 - Math.pow(r / 2000, 2) * 0.7, 0.2, 1);
          const visF = Math.max(this.TM.visual * this.W.visual, 0.65);
          const pk = clamp(0.7 * size * speedF * rangeF * visF * e.def.vuln.GUN, 0.04, 0.85);
          this.addFx({ kind: 'tracer', x: e.pos.x + rng.gauss(0, 6), y: e.pos.y + rng.gauss(0, 6), z: e.pos.z + rng.gauss(0, 4), ttl: 0.6 });
          if (this.urban && e.pos.z < 150 && rng.chance(0.05 * this.civilianDensity) && !eng.collateral) {
            eng.collateral = true;
            this.stats.collateral += 1;
            this.log('bad', 'collateral', `Stray rounds landed in a built-up area while engaging ${eng.trackId}.`, { trackId: eng.trackId });
          }
          if (rng.chance(pk)) {
            this.destroy(e, 'GUN');
            G.engagement = null;
          }
        }
      }
    }
    // Laser.
    const L = this.effectors.LASER;
    if (L.engagement) {
      const eng = L.engagement;
      const e = this.byId.get(eng.entityId);
      if (!e || !e.alive || e.status === 'downed') {
        L.engagement = null;
        L.cooldownUntil = this.t + 1;
      } else {
        const r = dist3(this.mast, e.pos);
        const ok = r <= this.laserRange() && this.terrain.lineOfSight(e.pos.x, e.pos.y, Math.max(1, e.pos.z));
        if (ok) {
          eng.dwell += dt * (0.6 + 0.4 * this.W.laser);
          eng.lost = 0;
          if (this.tick % 2 === 0) this.addFx({ kind: 'laser', x: e.pos.x, y: e.pos.y, z: e.pos.z, ttl: 0.12 });
          if (eng.dwell >= eng.needed) {
            if (rng.chance(e.def.vuln.LASER)) this.destroy(e, 'LASER');
            else this.log('warn', 'miss', `LASER: ${eng.trackId} survived the dwell (hardened airframe).`, { trackId: eng.trackId });
            L.engagement = null;
            L.cooldownUntil = this.t + EFFECTORS.LASER.cooldown;
          }
        } else {
          eng.lost += dt;
          if (eng.lost > 1.5) {
            this.log('warn', 'miss', `LASER: lost ${eng.trackId} (out of range or line of sight).`, { trackId: eng.trackId });
            L.engagement = null;
            L.cooldownUntil = this.t + 2;
          }
        }
      }
    }
  }

  resolveJam(e, rng) {
    const tr = this.trackByEntity.get(e.id);
    if (e.swarmId && rng.chance(0.1 + 0.08 * this.D.order)) {
      e.rfEmitting = false;
      this.log('warn', 'autonomy', `${tr ? tr.id : 'A swarm element'} switched to autonomous mode. RF link no longer present.`, { trackId: tr?.id });
      return;
    }
    if (!rng.chance(e.def.vuln.RF_JAM)) {
      if (tr && tr.op.actions.some((a) => a.action === 'RF_JAM')) this.log('warn', 'noeffect', `JAM: no observable effect on ${tr.id}.`, { trackId: tr.id });
      return;
    }
    const mode = { QUAD: rng.chance(0.6) ? 'rth' : 'landing', HEXA: 'rth', FPV: 'crash', FIXED_WING: 'denied', TACTICAL_UAV: 'rth' }[e.type];
    if (mode) this.softKill(e, 'RF_JAM', mode);
  }

  updateInterceptors(dt) {
    const I = this.effectors.INTERCEPTOR;
    for (const ic of this.interceptors) {
      if (!ic.alive) continue;
      const tgt = this.byId.get(ic.targetId);
      const tr = this.trackById.get(ic.trackId);
      if (!tgt || !tgt.alive || tgt.status === 'downed' || this.isDefeated(tgt)) {
        ic.alive = false;
        I.count += 1;
        this.log('info', 'interceptor', `Interceptor ${ic.id} recovered (target ${tr?.id || ''} no longer valid).`, { trackId: tr?.id });
        continue;
      }
      if (this.t - ic.t0 > EFFECTORS.INTERCEPTOR.endurance) {
        ic.alive = false;
        this.log('warn', 'interceptor', `Interceptor ${ic.id} endurance exhausted. ${tr?.id} not intercepted.`, { trackId: tr?.id });
        continue;
      }
      const rel = { x: tgt.pos.x - ic.pos.x, y: tgt.pos.y - ic.pos.y, z: tgt.pos.z - ic.pos.z };
      const d = len3(rel);
      const tgo = d / EFFECTORS.INTERCEPTOR.speed;
      const aim = { x: rel.x + tgt.vel.x * tgo * 0.9, y: rel.y + tgt.vel.y * tgo * 0.9, z: rel.z + tgt.vel.z * tgo * 0.5 };
      const al = len3(aim) || 1;
      const sp = EFFECTORS.INTERCEPTOR.speed;
      const acc = 45 * dt;
      ic.vel.x += clamp((aim.x / al) * sp - ic.vel.x, -acc, acc);
      ic.vel.y += clamp((aim.y / al) * sp - ic.vel.y, -acc, acc);
      ic.vel.z += clamp((aim.z / al) * sp - ic.vel.z, -acc, acc);
      ic.pos.x += ic.vel.x * dt; ic.pos.y += ic.vel.y * dt; ic.pos.z = Math.max(2, ic.pos.z + ic.vel.z * dt);
      ic.cooldown = Math.max(0, ic.cooldown - dt);
      if (d < 9 && ic.cooldown <= 0) {
        if (this.rng.effect.chance(EFFECTORS.INTERCEPTOR.pk * tgt.def.vuln.INTERCEPTOR)) {
          ic.alive = false;
          this.destroy(tgt, 'INTERCEPTOR');
        } else {
          ic.misses += 1;
          ic.cooldown = 2.5;
          this.log('warn', 'miss', `Interceptor ${ic.id} missed ${tr?.id}. Re-attacking.`, { trackId: tr?.id });
        }
      }
    }
  }

  // ------------------------------------------------------------------ AI director (live)
  updateDirector() {
    if (this.t < this.director.nextCheck) return;
    this.director.nextCheck += 5;
    const open = this.entities.filter((e) => this.isThreatActive(e)).length;
    const nextSpawn = this.spawnQueue.length ? this.spawnQueue[0].t - this.t : Infinity;
    const rng = this.rng.director;
    if (this.director.popUpsLeft > 0 && this.t > 45 && this.t < this.duration - 75 && open === 0 && nextSpawn > 25) {
      const type = rng.weighted({ FPV: 3, QUAD: 2, FPV_FIBER: this.D.fiberChance * 5, HEXA: this.spec.env.time === 'night' ? 2 : 0.4 });
      const def = SPAWN_DEFAULTS[type];
      const range = Math.max(1400, def.range[0] * 0.8);
      this.spawnQueue.unshift({ t: this.t, type, identity: 'HOSTILE', profile: def.profile, bearing: rng.range(0, 360), range, waypoints: [], speedFactor: 1 });
      this.director.popUpsLeft -= 1;
      this.log('info', 'director', 'AI Director: pop-up threat injected (spare operator capacity detected).');
    } else if ((open >= 6 || this.asset.health < 45) && this.t - this.director.lastEase > 40 && nextSpawn < 20) {
      this.director.lastEase = this.t;
      for (const o of this.spawnQueue) o.t += 15;
      this.log('info', 'director', 'AI Director: easing pressure. Next wave delayed 15 s.');
    }
  }

  // ------------------------------------------------------------------ recording & end
  recordFrame() {
    const r = (v) => Math.round(v);
    this.replay.frames.push({
      t: Math.round(this.t),
      e: this.entities.filter((e) => e.alive || (e.deadAt !== null && this.t - e.deadAt < 1.1))
        .map((e) => [e.id, r(e.pos.x), r(e.pos.y), r(e.pos.z), STATUS_CODES[e.status] ?? 0]),
      tr: this.tracks.filter((t) => !t.closed || this.t - t.closed.t < 1.1)
        .map((t) => [t.id, t.entityId, t.op.cls || '', t.op.ident || '', t.closed ? 2 : t.status === 'lost' ? 1 : 0]),
      i: this.interceptors.filter((i) => i.alive).map((i) => [r(i.pos.x), r(i.pos.y)]),
      h: Math.round(this.asset.health),
      j: this.effectors.RF_JAM.active ? [Math.round(this.effectors.RF_JAM.active.bearing), this.jamSector(), this.jamRange()] : null,
      s: this.effectors.GNSS_SPOOF.active ? 1 : 0,
    });
  }

  checkEnd() {
    if (this.asset.health <= 0) return this.end('Vital area destroyed');
    if (this.t >= this.duration) return this.end('Time limit reached');
    if (this.t > 30 && !this.spawnQueue.length) {
      const busy = this.entities.some((e) => !e.phantom && e.identity === 'HOSTILE' && e.alive && (e.status === 'active' || e.status === 'downed'))
        || this.interceptors.some((i) => i.alive);
      if (!busy) {
        this.quietFor = (this.quietFor || 0) + SIM_DT;
        if (this.quietFor > 6) return this.end('All hostile threats resolved');
      } else {
        this.quietFor = 0;
      }
    }
    return null;
  }

  end(reason) {
    if (this.finished) return;
    this.finished = true;
    this.endReason = reason;
    for (const e of this.entities) {
      if (e.outcome) continue;
      if (e.dropped) e.outcome = { result: 'LEAKED', t: this.t };
      else if (e.isrEvents > 0) e.outcome = { result: 'MISSION_COMPLETE', t: this.t };
      else if (e.alive) e.outcome = { result: 'ACTIVE', t: this.t };
      else e.outcome = { result: 'EXITED', t: this.t };
    }
    this.recordFrame();
    this.log(this.asset.health > 0 ? 'info' : 'bad', 'end', `ENDEX: ${reason}. Vital area integrity ${Math.round(this.asset.health)}%.`);
  }
}

