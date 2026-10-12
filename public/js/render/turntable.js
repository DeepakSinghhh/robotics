// Single-model 3D viewer for the Threat Library and the Recognition Drill.
// It emulates a zoomed EO/IR camera: the target is drawn at a chosen apparent size
// under day, dusk, night (thermal) or fog conditions.

import * as THREE from 'three';
import { buildDrone, animateDrone, setThermal } from './models.js';
import { TYPES } from '../sim/catalog.js';

const BG = { day: 0x9fc0de, dusk: 0xc98a6a, night: 0x05070b };

export class Turntable {
  constructor(container, { spin = true } = {}) {
    this.container = container;
    this.spin = spin;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(2, 16 / 9, 1, 20000);
    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x4a4a3a, 1.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.set(300, 500, 200);
    this.scene.add(this.hemi, this.sun);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.model = null;
    this.t = 0;
    this.yaw = 0;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    let last = performance.now();
    this.renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.t += dt;
      if (this.model) {
        if (this.spin) this.pivot.rotation.y += dt * 0.5;
        animateDrone(this.model, this.t, dt);
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  resize() {
    const w = this.container.clientWidth || 640, h = this.container.clientHeight || 360;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.h = h;
  }

  // opts: { time, thermal, fog (0..1), apparentPx, yaw, pitch }
  show(type, opts = {}) {
    const { time = 'day', thermal = time === 'night', fog = 0, apparentPx = 160, yaw = 0.6, pitch = 0.15 } = opts;
    if (this.model) this.pivot.remove(this.model);
    const m = buildDrone(type, { flock: type === 'BIRD' ? 4 : 1 });
    setThermal(m, thermal);
    this.model = m;
    this.pivot.add(m);
    this.pivot.rotation.set(0, yaw, 0);
    m.rotation.x = 0;
    const size = TYPES[type]?.size || 1;
    const span = type === 'BIRD' ? size * 4 : size;
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const dist = (span * this.h) / (apparentPx * 2 * Math.tan(fovRad / 2));
    this.camera.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = Math.max(0.1, dist * 0.5);
    this.camera.far = dist * 3;
    this.camera.updateProjectionMatrix();
    const bg = thermal ? 0x3a3a3a : BG[time] ?? BG.day;
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = fog > 0 ? new THREE.Fog(thermal ? 0x555555 : 0xb8c4cc, dist * (1 - fog * 0.6), dist * (1.6 - fog * 0.5)) : null;
    this.hemi.intensity = time === 'night' ? 0.15 : time === 'dusk' ? 0.8 : 1.6;
    this.sun.intensity = time === 'night' ? 0.1 : time === 'dusk' ? 1.2 : 2.2;
    this.sun.color.set(time === 'dusk' ? 0xffb070 : 0xffffff);
  }

  dispose() {
    this.ro.disconnect();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
