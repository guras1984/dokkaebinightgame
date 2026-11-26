import * as THREE from 'three';
import { rules } from './config.js';

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

// Chests (loot), and things the player builds: stone lanterns and fences.
export class Camp {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chests = [];
    this.lanterns = [];
    this.fences = [];
    this.wells = [];
    this.mats = {
      wood: lam(0x9a6234), woodDark: lam(0x6b3f1e), gold: lam(0xf1c24b),
      night: lam(0x27306a), nightBand: lam(0x7fd3ff),
      stone: lam(0xb9b6ae), stoneDark: lam(0x8f8c86),
      lampOff: lam(0x5a5650), lampOn: basic(0xffd07a),
      fence: lam(0xb07a45),
      beam: basic(0x7fd3ff, { transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
    // a fixed pool of lantern lights, created up front (adding lights later makes three.js recompile shaders → hitch)
    this.lightPool = [];
    for (let i = 0; i < rules.lanternMax; i++) {
      const l = new THREE.PointLight(0xffc46a, 0, 9, 1.6);
      l.position.set(0, -50, 0);
      scene.add(l);
      this.lightPool.push(l);
    }
  }

  reset() {
    for (const c of this.chests) this.removeChest(c);
    for (const l of this.lanterns) { this.group.remove(l.group); this.dropCols(l.cols); }
    for (const f of [...this.fences, ...this.wells]) { this.group.remove(f.group); this.dropCols(f.cols); }
    this.chests = []; this.lanterns = []; this.fences = []; this.wells = [];
    for (const l of this.lightPool) { l.intensity = 0; l.position.y = -50; }
  }

  dropCols(cols) {
    for (const c of cols) { const i = this.world.colliders.indexOf(c); if (i >= 0) this.world.colliders.splice(i, 1); }
  }

  // ---------- chests ----------
  /** find a free spot at distance [rMin, rMax] from the fire */
  freeSpot(rMin, rMax, pad = 1.4) {
    const R = rules.islandRadius - 1.5;
    for (let k = 0; k < 60; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.min(R, rMin + Math.random() * (rMax - rMin));
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.world.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + pad)) continue;
      if (this.chests.some((c) => Math.hypot(c.x - x, c.z - z) < 4)) continue;
      return { x, z };
    }
    return null;
  }

  spawnChest(kind, rMin, rMax) {
    const spot = this.freeSpot(rMin, rMax);
    if (!spot) return null;
    const night = kind === 'night';
    const g = new THREE.Group();
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = Math.atan2(-spot.x, -spot.z) + (Math.random() - 0.5) * 0.6; // roughly faces the camp
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 0.62), night ? this.mats.night : this.mats.wood);
    body.position.y = 0.25; body.castShadow = true; g.add(body);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.99, 0.1, 0.66), night ? this.mats.nightBand : this.mats.gold);
    band.position.y = 0.38; g.add(band);
    const lid = new THREE.Group();
    lid.position.set(0, 0.5, -0.31); // hinge at the back
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.2, 0.62), night ? this.mats.night : this.mats.woodDark);
    lidMesh.position.set(0, 0.1, 0.31); lidMesh.castShadow = true; lid.add(lidMesh);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.06), night ? this.mats.nightBand : this.mats.gold);
    lock.position.set(0, 0.02, 0.63); lid.add(lock);
    g.add(lid);
    let beam = null;
    if (night) {
      // tall ghost-light beam so it can be seen from the camp
      beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 9, 12, 1, true), this.mats.beam);
      beam.position.y = 4.5; g.add(beam);
    }
    this.group.add(g);
    const col = { x: spot.x, z: spot.z, r: 0.5 };
    this.world.colliders.push(col);
    const c = { kind, x: spot.x, z: spot.z, group: g, lid, beam, col, opened: false, t: 0, bob: Math.random() * 6 };
    this.chests.push(c);
    return c;
  }

  removeChest(c) {
    this.group.remove(c.group);
    this.dropCols([c.col]);
  }

  nearestChest(x, z, maxD) {
    let best = null, bd = maxD;
    for (const c of this.chests) {
      if (c.opened) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  open(c) {
    c.opened = true;
    c.t = 0;
  }

  /** remove unopened chests of one kind (night chests vanish at dawn) */
  clearChests(kind) {
    for (const c of this.chests) if (c.kind === kind && !c.opened) { c.opened = true; c.t = 1.2; }
  }

  // ---------- building ----------
  /** returns a reason string if the spot is not OK, else null */
  checkSpot(kind, x, z) {
    const R = rules.islandRadius - 0.8;
    if (Math.hypot(x, z) > R) return '바다 쪽에는 지을 수 없다';
    if (Math.hypot(x - this.world.fire.x, z - this.world.fire.z) < 1.8) return '모닥불과 너무 가깝다';
    const pad = kind === 'lantern' ? 0.55 : kind === 'well' ? 0.85 : 0.35;
    if (this.world.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + pad)) return '자리가 막혀 있다';
    if (kind === 'lantern' && this.lanterns.length >= rules.lanternMax) return `석등은 ${rules.lanternMax}개까지`;
    if (kind === 'well' && this.wells.length >= rules.wellMax) return `우물은 ${rules.wellMax}개까지`;
    if (kind === 'fence' && this.fences.length >= rules.fenceMax) return `울타리는 ${rules.fenceMax}개까지`;
    return null;
  }

  build(kind, x, z, facing) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(0.01);
    const cols = [];
    if (kind === 'lantern') {
      const m = this.mats;
      const add = (geo, mat, y) => { const o = new THREE.Mesh(geo, mat); o.position.y = y; o.castShadow = true; g.add(o); return o; };
      add(new THREE.BoxGeometry(0.7, 0.2, 0.7), m.stoneDark, 0.1);
      add(new THREE.BoxGeometry(0.28, 0.7, 0.28), m.stone, 0.55);
      add(new THREE.BoxGeometry(0.6, 0.12, 0.6), m.stoneDark, 0.95);
      const lamp = add(new THREE.BoxGeometry(0.4, 0.38, 0.4), m.lampOff, 1.2);
      add(new THREE.BoxGeometry(0.78, 0.14, 0.78), m.stone, 1.46);
      add(new THREE.BoxGeometry(0.4, 0.14, 0.4), m.stone, 1.58);
      const ringMat = basic(0xffd07a, { transparent: true, opacity: 0, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 48), ringMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
      ring.scale.setScalar(rules.lanternRadius);
      this.group.add(ring); ring.position.x = x; ring.position.z = z;
      const col = { x, z, r: 0.4 };
      cols.push(col);
      const light = this.lightPool[this.lanterns.length];
      light.position.set(x, 1.4, z);
      this.lanterns.push({ x, z, group: g, lamp, ring, light, cols, lit: 0 });
    } else if (kind === 'well') {
      const m = this.mats;
      const add = (geo, mat, px, py, pz) => { const o = new THREE.Mesh(geo, mat); o.position.set(px, py, pz); o.castShadow = true; g.add(o); return o; };
      // stone ring
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const st = add(new THREE.BoxGeometry(0.42, 0.5, 0.3), i % 2 ? m.stone : m.stoneDark, Math.cos(a) * 0.58, 0.25, Math.sin(a) * 0.58);
        st.rotation.y = -a;
      }
      const water = new THREE.Mesh(new THREE.CircleGeometry(0.48, 16), basic(0x3a9bd8));
      water.rotation.x = -Math.PI / 2; water.position.y = 0.36; g.add(water);
      // posts, roof and bucket
      add(new THREE.BoxGeometry(0.12, 1.4, 0.12), m.fence, -0.62, 0.7, 0);
      add(new THREE.BoxGeometry(0.12, 1.4, 0.12), m.fence, 0.62, 0.7, 0);
      add(new THREE.BoxGeometry(1.5, 0.1, 0.9), m.woodDark, 0, 1.45, 0).rotation.z = 0.0;
      add(new THREE.BoxGeometry(1.2, 0.08, 0.08), m.wood, 0, 1.2, 0);
      add(new THREE.BoxGeometry(0.24, 0.22, 0.24), m.wood, 0.25, 0.85, 0);
      const col = { x, z, r: 0.75 };
      cols.push(col);
      this.wells.push({ x, z, group: g, cols });
    } else {
      // fence segment perpendicular to where the player faces
      g.rotation.y = facing;  // local x (the rails) ends up across the facing direction
      const m = this.mats.fence;
      for (const px of [-0.6, 0, 0.6]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, 0.16), m);
        post.position.set(px, 0.47, 0); post.castShadow = true; g.add(post);
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), m);
        tip.position.set(px, 1.0, 0); tip.rotation.y = Math.PI / 4; g.add(tip);
      }
      for (const py of [0.35, 0.7]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.12, 0.08), m);
        rail.position.set(0, py, 0); rail.castShadow = true; g.add(rail);
      }
      const ax = Math.cos(facing), az = -Math.sin(facing); // local x axis after rotation
      for (const o of [-0.4, 0.4]) cols.push({ x: x + ax * o, z: z + az * o, r: 0.42 });
      this.fences.push({ x, z, group: g, cols });
    }
    this.world.colliders.push(...cols);
    this.group.add(g);
    this.grow = this.grow || [];
    this.grow.push({ g, t: 0 });
  }

  nearWell(x, z, d = 1.8) { return this.wells.some((w) => Math.hypot(w.x - x, w.z - z) < d); }

  /** circles monsters cannot enter */
  safeZones(fireR) {
    const zones = [];
    if (fireR > 0) zones.push({ x: this.world.fire.x, z: this.world.fire.z, r: fireR });
    for (const l of this.lanterns) if (l.lit > 0.5) zones.push({ x: l.x, z: l.z, r: rules.lanternRadius });
    return zones;
  }

  update(dt, time, darkness) {
    // pop-in for new buildings
    if (this.grow) {
      for (const b of this.grow) {
        b.t += dt * 4;
        const k = Math.min(1, b.t);
        b.g.scale.setScalar(k < 1 ? k * (1.25 - 0.25 * k) : 1);
      }
      this.grow = this.grow.filter((b) => b.t < 1);
    }
    for (const c of this.chests) {
      if (!c.opened) {
        // idle wiggle so chests catch the eye
        c.lid.rotation.x = -Math.max(0, Math.sin(time * 3 + c.bob)) * 0.08;
        if (c.beam) c.beam.material.opacity = 0.22 + Math.sin(time * 4) * 0.1;
      } else {
        c.t += dt;
        c.lid.rotation.x = -Math.min(1, c.t * 5) * 1.9;
        if (c.t > 1.2) {
          const k = Math.max(0, 1 - (c.t - 1.2) * 2.5);
          c.group.scale.setScalar(k);
          if (k === 0 && !c.removed) { c.removed = true; this.removeChest(c); }
        }
      }
    }
    this.chests = this.chests.filter((c) => !c.removed);
    // lanterns light up at dusk
    for (const l of this.lanterns) {
      const want = darkness > 0.15 ? 1 : 0;
      l.lit += (want - l.lit) * Math.min(1, dt * 2);
      const flick = 1 + Math.sin(time * 11 + l.x) * 0.05;
      l.light.intensity = l.lit * (3 + darkness * 14) * flick;
      l.lamp.material = l.lit > 0.5 ? this.mats.lampOn : this.mats.lampOff;
      l.ring.material.opacity = l.lit * (0.1 + darkness * 0.45);
    }
  }
}
