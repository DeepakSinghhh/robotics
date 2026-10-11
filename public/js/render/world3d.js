// Three.js world: terrain, scenery, the defended asset, drones, effects, weather,
// day/night/thermal palettes and an optional WebXR (VR) observation post.
// Sim coordinates (x east, y north, z up) map to three as (x, z, -y).

import * as THREE from 'three';
import { VRButton } from '../../vendor/three/VRButton.js';
import { buildDrone, animateDrone, setThermal } from './models.js';
import { SIM_DT } from '../sim/engine.js';
import { DEG, RAD, clamp, wrap360, bearingOf } from '../core/math.js';
import { fbm } from '../sim/terrain.js';

const SKY = {
  day: { top: 0x4f86c9, horizon: 0xbcd4e8, fog: 0xc3d6e6, sun: 1.0, sunColor: 0xfff4e0, hemi: 1.4, elev: 48 },
  dusk: { top: 0x1f2a50, horizon: 0xe28c5c, fog: 0x9b7a74, sun: 0.65, sunColor: 0xffb070, hemi: 0.8, elev: 6 },
  night: { top: 0x030509, horizon: 0x0c121c, fog: 0x0a0e14, sun: 0.07, sunColor: 0x8fa8ff, hemi: 0.12, elev: 35 },
};
const FOG = { clear: 0.000045, fog: 0.00085, rain: 0.00034, dust: 0.0006 };
const lin = (v) => Math.pow(Math.max(0, v), 2.2); // sRGB-ish value -> linear

export class World3D {
  constructor(container, sim, { onPick, onVrAction, vr = true } = {}) {
    this.container = container;
    this.sim = sim;
    this.onPick = onPick;
    this.onVrAction = onVrAction;
    this.thermal = !!sim.TM.thermalDefault;
    this.yaw = sim.ctx.threatAxis ?? 0;
    this.pitch = 2;
    this.fov = 50;
    this.targetYaw = null;
    this.targetPitch = null;
    this.time = 0;
    this.objects = new Map();
    this.interceptorObjs = new Map();
    this.fxSeen = new WeakSet();
    this.fxObjs = [];

    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    container.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.3, 40000);
    this.camera.rotation.order = 'YXZ';
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.rig.add(this.camera);
    const mastY = sim.terrain.sensorZ;
    this.rig.position.set(0, mastY, 0);

    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildScenery();
    this.buildAsset();
    this.buildWeather();
    this.applyPalette();
    if (vr) this.setupXR();
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  // ------------------------------------------------------------------ build
  toThree(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, this.sim.terrain.heightAt(x, y) + z, -y);
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(30000, 32, 16);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.skyMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.skyMesh.renderOrder = -10;
    this.scene.add(this.skyMesh);
    if (this.sim.spec.env.time === 'night') {
      const n = 1400, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, e = Math.acos(Math.random() * 0.95);
        pos.set([Math.sin(e) * Math.cos(a) * 25000, Math.cos(e) * 25000, Math.sin(e) * Math.sin(a) * 25000], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.3, sizeAttenuation: false, fog: false }));
      this.scene.add(this.stars);
    }
  }

  paintSky(top, horizon) {
    const pos = this.skyMesh.geometry.attributes.position;
    const col = this.skyMesh.geometry.attributes.color;
    const ct = new THREE.Color(top), ch = new THREE.Color(horizon), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 30000;
      c.copy(ch).lerp(ct, clamp(Math.pow(Math.max(0, y), 0.55), 0, 1));
      if (y < 0) c.copy(ch).multiplyScalar(0.8);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  buildLights() {
    const sky = SKY[this.sim.spec.env.time] || SKY.day;
    this.hemi = new THREE.HemisphereLight(sky.horizon, 0x3a3a2a, sky.hemi);
    this.sun = new THREE.DirectionalLight(sky.sunColor, sky.sun * 2.4);
    const az = ((this.sim.seed % 360) + 120) * DEG;
    this.sun.position.set(Math.sin(az) * 1000, Math.sin(sky.elev * DEG) * 1000, -Math.cos(az) * 1000);
    this.scene.add(this.hemi, this.sun);
  }

  buildTerrain() {
    const T = this.sim.terrain;
    const size = 16000, seg = 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const day = new Float32Array(pos.count * 3);
    const ir = new Float32Array(pos.count * 3);
    const kind = T.kind;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = -pos.getZ(i);
      const hgt = T.heightAt(x, y);
      pos.setY(i, hgt);
      const n = fbm(x / 420, y / 420, T.seed + 3, 3);
      const patch = Math.floor((fbm(x / 260, y / 260, T.seed + 11, 2) + 1) * 2.5);
      const S = THREE.SRGBColorSpace;
      if (kind === 'urban') {
        const r = Math.hypot(x, y);
        c.setRGB(0.4 + n * 0.05, 0.39 + n * 0.05, 0.36 + n * 0.04, S);
        if (r > 2900) c.setRGB(0.3 + n * 0.05, 0.36 + n * 0.06, 0.22, S);
        if (r < 160) c.setRGB(0.32, 0.42, 0.24, S);
      } else if (kind === 'mountain') {
        const t = clamp(hgt / 240, 0, 1);
        c.setRGB(0.26 + t * 0.22 + n * 0.04, 0.33 + t * 0.06 + n * 0.04, 0.2 + t * 0.12, S);
        if (hgt > 230) c.lerp(new THREE.Color().setRGB(0.86, 0.88, 0.9, S), clamp((hgt - 230) / 40, 0, 1));
      } else {
        const fields = [[0.3, 0.42, 0.2], [0.52, 0.48, 0.27], [0.36, 0.45, 0.22], [0.42, 0.35, 0.23], [0.27, 0.38, 0.19]];
        const f = fields[patch % fields.length];
        c.setRGB(f[0] + n * 0.04, f[1] + n * 0.04, f[2] + n * 0.03, S);
      }
      if (this.sim.spec.env.weather === 'dust') c.lerp(new THREE.Color().setRGB(0.55, 0.46, 0.33, S), 0.35);
      day.set([c.r, c.g, c.b], i * 3);
      // Thermal: cool ground, slightly warmer built-up areas (values are linear).
      const v = lin(0.2 + (n + 1) * 0.05 + (kind === 'urban' ? 0.06 : 0) + (patch % 2) * 0.03);
      ir.set([v, v, v], i * 3);
    }
    geo.computeVertexNormals();
    this.terrainColors = { day, ir };
    geo.setAttribute('color', new THREE.BufferAttribute(day.slice(), 3));
    this.terrainDayMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.terrainIrMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.terrain = new THREE.Mesh(geo, this.terrainDayMat);
    this.scene.add(this.terrain);
    const far = new THREE.Mesh(new THREE.RingGeometry(7900, 30000, 48), new THREE.MeshLambertMaterial({ color: 0x3a4a30 }));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -2;
    this.farRing = far;
    this.scene.add(far);
  }

  buildScenery() {
    const { buildings, trees } = this.sim.terrain.features();
    const T = this.sim.terrain;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    this.bDay = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.bIr = new THREE.MeshBasicMaterial({ color: 0xffffff });
    if (buildings.length) {
      const im = new THREE.InstancedMesh(box, this.bDay, buildings.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      const dayC = new Float32Array(buildings.length * 3), irC = new Float32Array(buildings.length * 3);
      const urban = T.kind === 'urban';
      buildings.forEach((b, i) => {
        p.set(b.x, T.heightAt(b.x, b.y) - 0.5, -b.y);
        s.set(b.w, b.h, b.d);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), urban ? 0 : (b.x * 7 + b.y) % 3);
        m.compose(p, q, s);
        im.setMatrixAt(i, m);
        const sh = b.shade;
        const base = urban ? [0.62 * sh, 0.6 * sh, 0.56 * sh] : [0.66 * sh, 0.55 * sh, 0.42 * sh];
        dayC.set(base.map(lin), i * 3);
        const v = lin(0.3 + 0.12 * sh);
        irC.set([v, v, v], i * 3);
      });
      im.instanceColor = new THREE.InstancedBufferAttribute(dayC.slice(), 3);
      im.userData.colors = { day: dayC, ir: irC };
      this.buildings = im;
      this.scene.add(im);
    }
    if (trees.length) {
      const cone = new THREE.ConeGeometry(1, 1, 6);
      cone.translate(0, 0.5, 0);
      this.tDay = new THREE.MeshLambertMaterial({ color: this.sim.spec.env.terrain === 'mountain' ? 0x24402a : 0x2f4d24 });
      this.tIr = new THREE.MeshBasicMaterial({ color: 0x3c3c3c });
      const im = new THREE.InstancedMesh(cone, this.tDay, trees.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      trees.forEach((t, i) => {
        p.set(t.x, T.heightAt(t.x, t.y) - 0.5, -t.y);
        s.set(t.h * 0.32 * t.s, t.h, t.h * 0.32 * t.s);
        m.compose(p, q, s);
        im.setMatrixAt(i, m);
      });
      this.trees = im;
      this.scene.add(im);
    }
  }

  buildAsset() {
    const g = new THREE.Group();
    const T = this.sim.terrain;
    const y0 = T.originHeight;
    const add = (geo, color, x, y, z, heat = 0.35, rotY = 0) => {
      const msh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
      msh.position.set(x, y0 + y, -z);
      msh.rotation.y = rotY;
      msh.userData.heat = heat;
      g.add(msh);
      return msh;
    };
    const type = this.sim.ctx.assetType;
    // Perimeter (HESCO-style).
    if (type !== 'VIP') {
      const L = 150;
      for (const [x, z, w, d] of [[0, L / 2, L, 2], [0, -L / 2, L, 2], [L / 2, 0, 2, L], [-L / 2, 0, 2, L]]) add(new THREE.BoxGeometry(w, 2.2, d), 0x8a7a5c, x, 1.1, z, 0.3);
    }
    // Sensor mast and C-UAS kit.
    add(new THREE.CylinderGeometry(0.35, 0.5, 14, 8), 0x667066, 0, 7, 0, 0.4);
    const radar = add(new THREE.BoxGeometry(2.4, 1.2, 0.3), 0x4a524a, -18, 9, 12, 0.6);
    add(new THREE.CylinderGeometry(0.25, 0.3, 8.4, 6), 0x5a625a, -18, 4.2, 12, 0.3);
    this.radarHead = radar;
    add(new THREE.BoxGeometry(6, 2.4, 2.5), 0x4f5a3e, 24, 1.2, -22, 0.45);
    const gun = add(new THREE.CylinderGeometry(1.2, 1.4, 1.2, 10), 0x515a46, 25, 2.9, -25, 0.5);
    for (const s of [-0.35, 0.35]) {
      const barrel = add(new THREE.CylinderGeometry(0.09, 0.09, 4.2, 6), 0x2a2a2a, 25 + s, 4, -25, 0.55);
      barrel.rotation.x = Math.PI / 2 - 0.5;
    }
    this.gunPos = gun.position.clone().setY(y0 + 4.2); // three.js coordinates
    add(new THREE.BoxGeometry(5.5, 2.6, 2.3), 0x3f4a3a, -30, 1.3, -20, 0.45);
    add(new THREE.CylinderGeometry(0.6, 0.6, 1.2, 12), 0x8c8c8c, -30, 3.2, -20, 0.6);
    this.laserPos = new THREE.Vector3(-30, y0 + 3.6, 20); // three.js coordinates (sim x -30, y -20)
    // Asset-specific structures.
    if (type === 'AIRBASE') {
      const rw = new THREE.Mesh(new THREE.PlaneGeometry(1600, 32), new THREE.MeshLambertMaterial({ color: 0x3a3a3a }));
      rw.rotation.x = -Math.PI / 2;
      rw.position.set(0, y0 + 0.08, 220);
      rw.userData.heat = 0.42;
      g.add(rw);
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(22, 8, 18), 0x6c6f62, -60 + i * 30, 4, -170, 0.4);
    } else if (type === 'VIP') {
      const stand = new THREE.Mesh(new THREE.TorusGeometry(80, 9, 6, 40), new THREE.MeshLambertMaterial({ color: 0x7e7a72 }));
      stand.rotation.x = -Math.PI / 2;
      stand.position.set(0, y0 + 5, 0);
      stand.scale.set(1.3, 1, 1);
      stand.userData.heat = 0.35;
      g.add(stand);
      const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1.7, 0.6), new THREE.MeshLambertMaterial({ color: 0xffffff }), 1600);
      const m = new THREE.Matrix4(), col = new THREE.Color();
      for (let i = 0; i < 1600; i++) {
        const a = Math.random() * Math.PI * 2, rr = 55 + Math.random() * 20;
        m.makeTranslation(Math.cos(a) * rr * 1.3, y0 + 1, Math.sin(a) * rr);
        crowd.setMatrixAt(i, m);
        crowd.setColorAt(i, col.setHSL(Math.random(), 0.5, 0.5));
      }
      crowd.userData.heat = 0.8;
      g.add(crowd);
      this.crowd = crowd;
    } else if (type === 'POWER') {
      for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(6, 5, 4), 0x707a80, -40 + (i % 3) * 25, 2.5, -30 + Math.floor(i / 3) * 25, 0.75);
      for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(0.3, 0.6, 28, 4), 0x8a8a8a, 80 + i * 60, 14, 0, 0.3);
    } else if (type === 'ARTY') {
      for (let i = 0; i < 4; i++) {
        add(new THREE.BoxGeometry(3, 1.6, 6), 0x4a5438, -45 + i * 30, 0.8, 40, 0.5);
        const b = add(new THREE.CylinderGeometry(0.14, 0.18, 7, 6), 0x2a2a2a, -45 + i * 30, 2.4, 44, 0.45);
        b.rotation.x = Math.PI / 2 - 0.6;
      }
    } else {
      for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(8, 3.2, 5), 0x5d6450, -45 + (i % 3) * 30, 1.6, 35 - Math.floor(i / 3) * 18, 0.45);
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(12, 2.6, 2.4), 0x6a5a3c, 40, 1.3, -40 + i * 8, 0.4);
    }
    add(new THREE.BoxGeometry(2.2, 1.4, 0.05), 0xff9933, 8, 10, 6, 0.3);
    add(new THREE.CylinderGeometry(0.06, 0.06, 10, 4), 0xdddddd, 6.9, 5, 6, 0.3);
    this.asset = g;
    this.scene.add(g);
  }

  buildWeather() {
    const w = this.sim.spec.env.weather;
    if (w === 'rain') {
      const n = 2200, pos = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const x = (Math.random() - 0.5) * 120, y = Math.random() * 60 - 20, z = (Math.random() - 0.5) * 120;
        pos.set([x, y, z, x + 0.2, y - 1.6, z], i * 6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.35 }));
      this.rig.add(this.rain);
    } else if (w === 'dust') {
      const n = 3000, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 160, Math.random() * 50 - 25, (Math.random() - 0.5) * 160], i * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xb59a6a, size: 0.25, transparent: true, opacity: 0.6 }));
      this.rig.add(this.dust);
    }
  }

  applyPalette() {
    const env = this.sim.spec.env;
    const sky = SKY[env.time] || SKY.day;
    const ir = this.thermal;
    const fogDensity = (FOG[env.weather] ?? FOG.clear) * (ir ? 0.55 : 1) * (env.time === 'night' && !ir ? 1.6 : 1);
    let fogColor = env.weather === 'dust' ? 0x9c8460 : sky.fog;
    if (ir) {
      this.paintSky(0x2c2c2c, 0x4a4a4a);
      fogColor = 0x444444;
      this.terrain.material = this.terrainIrMat;
      this.terrain.geometry.attributes.color.array.set(this.terrainColors.ir);
      this.farRing.material.color.setRGB(0.2, 0.2, 0.2);
    } else {
      this.paintSky(env.weather === 'clear' ? sky.top : fogColor, env.weather === 'clear' ? sky.horizon : fogColor);
      this.terrain.material = this.terrainDayMat;
      this.terrain.geometry.attributes.color.array.set(this.terrainColors.day);
      this.farRing.material.color.set(env.time === 'night' ? 0x080a08 : 0x3a4a30);
    }
    this.terrain.geometry.attributes.color.needsUpdate = true;
    this.scene.fog = new THREE.FogExp2(fogColor, fogDensity);
    if (this.buildings) {
      this.buildings.material = ir ? this.bIr : this.bDay;
      this.buildings.instanceColor.array.set(ir ? this.buildings.userData.colors.ir : this.buildings.userData.colors.day);
      this.buildings.instanceColor.needsUpdate = true;
    }
    if (this.trees) this.trees.material = ir ? this.tIr : this.tDay;
    if (this.stars) this.stars.visible = !ir;
    setThermal(this.asset, ir);
    for (const o of this.objects.values()) setThermal(o, ir);
    for (const o of this.interceptorObjs.values()) setThermal(o, ir);
    this.hemi.intensity = sky.hemi;
  }

  setThermal(on) {
    this.thermal = on;
    this.applyPalette();
  }

  // ------------------------------------------------------------------ XR
  setupXR() {
    const note = document.createElement('div');
    note.className = 'vr-note';
    note.textContent = 'WebXR ready · no VR headset detected';
    this.container.appendChild(note);
    this.vrButton = note;
    if (!('xr' in navigator)) return;
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      if (!ok) return;
      note.remove();
      const btn = VRButton.createButton(this.renderer);
      btn.classList.add('vr-btn');
      this.container.appendChild(btn);
      this.vrButton = btn;
    }).catch(() => {});
    this.renderer.xr.enabled = true;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.controllers = [0, 1].map((i) => {
      const c = this.renderer.xr.getController(i);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x3ddc84 }));
      line.scale.z = 3000;
      c.add(line);
      c.addEventListener('selectstart', () => this.onXrSelect(c));
      this.rig.add(c);
      return c;
    });
    // Floating action panel (canvas texture) in front of the observer.
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    this.vrCanvas = canvas;
    this.vrTex = new THREE.CanvasTexture(canvas);
    this.vrPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshBasicMaterial({ map: this.vrTex, transparent: true, fog: false }));
    this.vrPanel.position.set(0, -0.55, -1.1);
    this.vrPanel.rotation.x = -0.5;
    this.vrPanel.visible = false;
    this.rig.add(this.vrPanel);
    this.vrButtons = [
      ['NEXT', 'next'], ['ACCEPT AI', 'ai'], ['HOSTILE', 'hostile'], ['FRIEND', 'friend'], ['MONITOR', 'monitor'],
      ['RF JAM', 'RF_JAM'], ['GUN', 'GUN'], ['INTCP', 'INTERCEPTOR'], ['LASER', 'LASER'], ['WARN', 'warn'],
    ];
    this.renderer.xr.addEventListener('sessionstart', () => { this.vrPanel.visible = true; });
    this.renderer.xr.addEventListener('sessionend', () => { this.vrPanel.visible = false; });
  }

  drawVrPanel(info) {
    if (!this.vrCanvas || !this.renderer.xr.isPresenting) return;
    const c = this.vrCanvas.getContext('2d');
    c.fillStyle = 'rgba(8,14,13,0.92)';
    c.fillRect(0, 0, 1024, 512);
    c.strokeStyle = '#3ddc84';
    c.lineWidth = 4;
    c.strokeRect(2, 2, 1020, 508);
    c.fillStyle = '#e6ece9';
    c.font = 'bold 40px monospace';
    c.fillText(info.title || 'NO TRACK SELECTED', 24, 56);
    c.font = '28px monospace';
    c.fillStyle = '#a9b6b1';
    (info.lines || []).forEach((l, i) => c.fillText(l, 24, 100 + i * 34));
    this.vrButtons.forEach(([label], i) => {
      const x = 24 + (i % 5) * 198, y = 300 + Math.floor(i / 5) * 100;
      c.fillStyle = '#13201d';
      c.fillRect(x, y, 186, 86);
      c.strokeStyle = '#2f4d3f';
      c.strokeRect(x, y, 186, 86);
      c.fillStyle = '#e6ece9';
      c.font = 'bold 26px monospace';
      c.fillText(label, x + 14, y + 52);
    });
    this.vrTex.needsUpdate = true;
  }

  onXrSelect(controller) {
    const ray = new THREE.Raycaster();
    const m = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
    ray.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    ray.ray.direction.set(0, 0, -1).applyMatrix4(m);
    const hit = this.vrPanel.visible && ray.intersectObject(this.vrPanel)[0];
    if (hit && hit.uv) {
      const px = hit.uv.x * 1024, py = (1 - hit.uv.y) * 512;
      const idx = this.vrButtons.findIndex((_, i) => {
        const x = 24 + (i % 5) * 198, y = 300 + Math.floor(i / 5) * 100;
        return px >= x && px <= x + 186 && py >= y && py <= y + 86;
      });
      if (idx >= 0) this.onVrAction?.(this.vrButtons[idx][1]);
      return;
    }
    let best = null, bestAng = 1.6 * DEG;
    const v = new THREE.Vector3();
    for (const e of this.sim.entities) {
      if (!e.alive || e.phantom) continue;
      this.toThree(e.pos.x, e.pos.y, e.pos.z, v).sub(ray.ray.origin);
      const ang = v.angleTo(ray.ray.direction);
      if (ang < bestAng) { bestAng = ang; best = e; }
    }
    if (best) this.onPick?.(best.id);
  }

  // ------------------------------------------------------------------ camera
  resize() {
    const w = this.container.clientWidth || 800, hgt = this.container.clientHeight || 450;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
    this.width = w;
    this.height = hgt;
  }

  slew(dYaw, dPitch) {
    this.yaw = wrap360(this.yaw + dYaw);
    this.pitch = clamp(this.pitch + dPitch, -30, 80);
    this.targetYaw = null;
  }

  slewTo(bearing, elev = null) {
    this.targetYaw = bearing;
    this.targetPitch = elev;
  }

  zoom(factor) {
    this.fov = clamp(this.fov * factor, 0.6, 60);
  }

  // ------------------------------------------------------------------ frame update
  update(dt, alpha) {
    this.time += dt;
    const sim = this.sim;
    // Camera follows the EO lock.
    const lockTr = sim.eo.trackId && sim.track(sim.eo.trackId);
    if (lockTr) {
      const e = sim.entity(lockTr.entityId);
      if (e) {
        const b = bearingOf(e.pos.x, e.pos.y);
        const d = Math.hypot(e.pos.x, e.pos.y);
        const el = Math.atan2(sim.terrain.heightAt(e.pos.x, e.pos.y) + e.pos.z - sim.terrain.sensorZ, d) * RAD;
        this.targetYaw = b;
        this.targetPitch = el;
      }
    }
    if (this.targetYaw !== null) {
      const dy = ((this.targetYaw - this.yaw + 540) % 360) - 180;
      this.yaw = wrap360(this.yaw + dy * Math.min(1, dt * 6));
      if (this.targetPitch !== null) this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 6);
      if (Math.abs(dy) < 0.02 && !lockTr) this.targetYaw = null;
    }
    this.camera.rotation.set(this.pitch * DEG, -this.yaw * DEG, 0, 'YXZ');
    if (this.camera.fov !== this.fov) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.radarHead) this.radarHead.rotation.y = -sim.radar.angle * DEG;

    this.syncEntities(dt, alpha);
    this.syncInterceptors(alpha);
    this.syncFx(dt);
    if (this.rain) {
      const p = this.rain.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 2) {
        let y = p.getY(i) - dt * 22;
        if (y < -20) y += 60;
        p.setY(i, y); p.setY(i + 1, y - 1.6);
      }
      p.needsUpdate = true;
    }
    if (this.dust) this.dust.rotation.y += dt * 0.05;
    this.renderer.render(this.scene, this.camera);
  }

  syncEntities(dt, alpha) {
    const sim = this.sim;
    const seen = new Set();
    const v = new THREE.Vector3();
    for (const e of sim.entities) {
      if (e.phantom) continue;
      const keep = e.alive || (e.deadAt !== null && sim.t - e.deadAt < 2.5 && e.status !== 'impacted' && e.status !== 'exited');
      if (!keep) continue;
      seen.add(e.id);
      let o = this.objects.get(e.id);
      if (!o) {
        o = buildDrone(e.type, { flock: e.flock });
        if (this.thermal) setThermal(o, true);
        this.objects.set(e.id, o);
        this.scene.add(o);
      }
      const f = e.alive ? alpha * SIM_DT : 0;
      this.toThree(e.pos.x + e.vel.x * f, e.pos.y + e.vel.y * f, Math.max(0.2, e.pos.z + e.vel.z * f), v);
      o.position.copy(v);
      const hs = Math.hypot(e.vel.x, e.vel.y);
      let pitch = Math.atan2(e.vel.z, Math.max(hs, 0.1));
      if (e.def.family === 'multirotor' || e.def.family === 'fpv') pitch = -Math.min(hs / 45, 0.45);
      if (e.status === 'downed') {
        o.rotation.z += dt * 4;
        pitch = -1;
      }
      o.rotation.set(pitch, -(e.heading || 0) * DEG, o.rotation.z, 'YXZ');
      animateDrone(o, this.time, e.alive && e.status !== 'downed' ? dt : 0);
    }
    for (const [id, o] of this.objects) {
      if (!seen.has(id)) {
        this.scene.remove(o);
        this.objects.delete(id);
      }
    }
  }

  syncInterceptors(alpha) {
    const seen = new Set();
    for (const ic of this.sim.interceptors) {
      if (!ic.alive) continue;
      seen.add(ic.id);
      let o = this.interceptorObjs.get(ic.id);
      if (!o) {
        o = buildDrone('INTERCEPTOR');
        if (this.thermal) setThermal(o, true);
        this.interceptorObjs.set(ic.id, o);
        this.scene.add(o);
      }
      const f = alpha * SIM_DT;
      this.toThree(ic.pos.x + ic.vel.x * f, ic.pos.y + ic.vel.y * f, ic.pos.z, o.position);
      o.rotation.set(-0.4, -bearingOf(ic.vel.x, ic.vel.y) * DEG, 0, 'YXZ');
      animateDrone(o, this.time, 0.016);
    }
    for (const [id, o] of this.interceptorObjs) {
      if (!seen.has(id)) { this.scene.remove(o); this.interceptorObjs.delete(id); }
    }
  }

  flashTexture() {
    if (this._flashTex) return this._flashTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,230,1)');
    grd.addColorStop(0.3, 'rgba(255,190,90,0.9)');
    grd.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this._flashTex = new THREE.CanvasTexture(c);
    return this._flashTex;
  }

  syncFx(dt) {
    const sim = this.sim;
    const v = new THREE.Vector3();
    for (const f of sim.fx) {
      if (this.fxSeen.has(f)) continue;
      this.fxSeen.add(f);
      if (f.kind === 'burst' || f.kind === 'blast') {
        const mat = new THREE.SpriteMaterial({ map: this.flashTexture(), color: this.thermal ? 0xffffff : 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
        const sp = new THREE.Sprite(mat);
        this.toThree(f.x, f.y, f.z, sp.position);
        sp.userData = { life: 0, ttl: f.kind === 'blast' ? 1.6 : 0.9, size: f.size * (f.kind === 'blast' ? 4 : 3) };
        this.scene.add(sp);
        this.fxObjs.push(sp);
        const smoke = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: this.thermal ? 0x9a9a9a : 0x3a3530, transparent: true, opacity: 0.55, depthWrite: false }));
        smoke.position.copy(sp.position);
        smoke.userData = { life: 0, ttl: f.kind === 'blast' ? 6 : 3, size: f.size * 1.6, smoke: true, rise: f.kind === 'blast' ? 4 : 1 };
        this.scene.add(smoke);
        this.fxObjs.push(smoke);
      } else if (f.kind === 'tracer' || f.kind === 'laser') {
        const from = (f.kind === 'tracer' ? this.gunPos : this.laserPos).clone();
        this.toThree(f.x, f.y, f.z, v);
        const geo = new THREE.BufferGeometry().setFromPoints([from, v.clone()]);
        const color = f.kind === 'laser' ? (this.thermal ? 0xffffff : 0x66ff99) : (this.thermal ? 0xffffff : 0xffd27a);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, fog: false }));
        line.userData = { life: 0, ttl: f.kind === 'laser' ? 0.15 : 0.35, line: true };
        this.scene.add(line);
        this.fxObjs.push(line);
      }
    }
    this.fxObjs = this.fxObjs.filter((o) => {
      o.userData.life += dt;
      const k = o.userData.life / o.userData.ttl;
      if (k >= 1) {
        this.scene.remove(o);
        o.geometry?.dispose?.();
        o.material?.dispose?.();
        return false;
      }
      if (o.isSprite) {
        o.scale.setScalar(o.userData.size * (0.4 + k));
        o.material.opacity = 1 - k;
      } else if (o.userData.smoke) {
        o.scale.setScalar(o.userData.size * (0.5 + k * 1.5));
        o.position.y += dt * o.userData.rise;
        o.material.opacity = 0.55 * (1 - k);
      } else if (o.userData.line) {
        o.material.opacity = 0.9 * (1 - k);
      }
      return true;
    });
  }

  // ------------------------------------------------------------------ projection & picking
  project(x, y, z) {
    const v = this.toThree(x, y, z);
    v.project(this.camera);
    const behind = v.z > 1;
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height, visible: !behind && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05 };
  }

  pixelsPerMetreAt(range) {
    return this.height / (2 * Math.tan((this.fov * DEG) / 2) * Math.max(range, 1));
  }

  pickAt(px, py) {
    let best = null, bestD = Infinity;
    for (const e of this.sim.entities) {
      if (!e.alive || e.phantom || !e.airborne) continue;
      const p = this.project(e.pos.x, e.pos.y, e.pos.z);
      if (!p.visible) continue;
      const range = Math.hypot(e.pos.x, e.pos.y, e.pos.z);
      const apparent = e.def.size * this.pixelsPerMetreAt(range);
      if (apparent < 1.2 && !this.thermal) continue;
      if (apparent < 0.8) continue;
      const d = Math.hypot(p.x - px, p.y - py);
      const tol = Math.max(16, apparent);
      if (d < tol && d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.vrButton?.remove();
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material && !Array.isArray(o.material)) o.material.dispose?.();
    });
  }
}
