import * as THREE from 'three';
import { rules } from './config.js';

// Day → dusk → night → dawn(win). Drives lights, fog and background.
const C = (h) => new THREE.Color(h);
const palette = {
  day:   { sky: C(0x9fdcff), hemiSky: C(0xdff1ff), hemiGround: C(0x6f9a4c), hemi: 1.35, sun: C(0xfff1d6), sunI: 2.1, water: C(0x3a9bd8) },
  dusk:  { sky: C(0xf4a37a), hemiSky: C(0xffc49a), hemiGround: C(0x6a5a4a), hemi: 0.8,  sun: C(0xff9a5a), sunI: 1.3, water: C(0x5a6aa8) },
  night: { sky: C(0x0b1230), hemiSky: C(0x34407a), hemiGround: C(0x0c1020), hemi: 0.32, sun: C(0x9fb4ff), sunI: 0.32, water: C(0x14234a) },
};

const DREAD_SKY = C(0x2a0a24);
const BLOOD_SKY = C(0x4a0808);
const BLOOD_HEMI = C(0xb03030);
const DREAD_HEMI = C(0x6a2a52);

export class DayNight {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 0;
    this.dread = 0;          // 0..1, set per night by the game
    this.blood = 0;          // 1 on a blood-moon night
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const s = this.sun.shadow.camera;
    s.left = -20; s.right = 20; s.top = 20; s.bottom = -20; s.near = 1; s.far = 80;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.fog = new THREE.Fog(0x9fdcff, 40, 95);
    this.col = { sky: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), sun: new THREE.Color(), water: new THREE.Color() };
  }

  get dayEnd() { return rules.dayLength; }
  get nightStart() { return rules.dayLength + rules.duskLength; }
  get nightEnd() { return this.nightStart + rules.nightLength; }

  phase() {
    const t = this.time;
    if (t < this.dayEnd) return 'day';
    if (t < this.nightStart) return 'dusk';
    if (t < this.nightEnd) return 'night';
    return 'dawn';
  }

  /** 0 in daylight, 1 at full night */
  darkness() {
    const t = this.time;
    if (t < this.dayEnd - 10) return 0;
    if (t < this.nightStart) return Math.min(1, (t - (this.dayEnd - 10)) / (rules.duskLength + 10));
    if (t < this.nightEnd - 8) return 1;
    return Math.max(0, (this.nightEnd - t) / 8);
  }

  /** progress 0..1 within the current phase, for the HUD */
  progress() {
    const t = this.time, p = this.phase();
    if (p === 'day') return t / this.dayEnd;
    if (p === 'dusk') return (t - this.dayEnd) / rules.duskLength;
    if (p === 'night') return (t - this.nightStart) / rules.nightLength;
    return 1;
  }

  remaining() {
    const t = this.time, p = this.phase();
    if (p === 'day') return this.dayEnd - t;
    if (p === 'dusk') return this.nightStart - t;
    if (p === 'night') return this.nightEnd - t;
    return 0;
  }

  update(dt, focus) {
    this.time += dt;
    const d = this.darkness();
    // blend day→dusk→night through the middle
    const a = d < 0.5 ? palette.day : palette.dusk;
    const b = d < 0.5 ? palette.dusk : palette.night;
    const k = d < 0.5 ? d * 2 : (d - 0.5) * 2;
    const c = this.col;
    c.sky.copy(a.sky).lerp(b.sky, k);
    c.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, k);
    c.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, k);
    c.sun.copy(a.sun).lerp(b.sun, k);
    c.water.copy(a.water).lerp(b.water, k);
    // blood moon: everything goes red
    if (this.blood > 0 && d > 0.3) {
      const kb = this.blood * (d - 0.3) / 0.7;
      c.sky.lerp(BLOOD_SKY, kb * 0.75);
      c.hemiSky.lerp(BLOOD_HEMI, kb * 0.6);
    }
    // harder nights: the sky and fog bleed toward a sick red-violet
    if (this.dread > 0 && d > 0.5) {
      const kd = this.dread * (d - 0.5) * 2;
      c.sky.lerp(DREAD_SKY, kd * 0.6);
      c.hemiSky.lerp(DREAD_HEMI, kd * 0.5);
    }
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = a.hemi + (b.hemi - a.hemi) * k;
    this.sun.color.copy(c.sun);
    this.sun.intensity = a.sunI + (b.sunI - a.sunI) * k;
    this.renderer.setClearColor(c.sky);
    this.scene.fog.color.copy(c.sky);
    this.scene.fog.near = 40 - d * 22;
    this.scene.fog.far = 95 - d * 50;

    // sun swings across the sky; shadow box follows the player
    const ang = 0.6 + (this.time / this.nightEnd) * 2.2;
    this.sun.position.set(focus.x + Math.cos(ang) * 20, 26, focus.z + Math.sin(ang) * 12 + 10);
    this.sun.target.position.set(focus.x, 0, focus.z);
    return { darkness: d, water: c.water };
  }
}
