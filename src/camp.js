import * as THREE from 'three';
import { rules } from './config.js';

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

// Chests (loot), and things the player builds. Buildings have health: monsters smash them, you repair them.
export const STRUCT = {
  lantern:   { name: '석등', hp: 90, max: 4, pad: 0.55, repair: { stone: 1 } },
  well:      { name: '우물', hp: 120, max: 2, pad: 0.85, repair: { stone: 1 } },
  fence:     { name: '울타리', hp: 60, max: 24, pad: 0.35, repair: { wood: 1 } },
  jangseung: { name: '장승', hp: 100, max: 4, pad: 0.5, repair: { wood: 1 } },
  trap:      { name: '가시 덫', hp: 3, max: 8, pad: 0.3, repair: { stone: 1 } },
  hut:       { name: '초가집', hp: 200, max: 2, pad: 1.5, repair: { wood: 2 } },
  tower:     { name: '돌탑', hp: 80, max: 8, pad: 0.4, repair: { stone: 1 } },
};
export class Camp {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chests = [];
    this.structs = [];
    this.grow = [];
    this.mats = {
      wood: lam(0x9a6234), woodDark: lam(0x6b3f1e), gold: lam(0xf1c24b),
      night: lam(0x27306a), nightBand: lam(0x7fd3ff),
      stone: lam(0xb9b6ae), stoneDark: lam(0x8f8c86),
      lampOff: lam(0x5a5650), lampOn: basic(0xffd07a),
      fence: lam(0xb07a45), jang: lam(0xb07a45), ink: lam(0x2a1a10), bone: lam(0xe8dcc0), red: lam(0xc9413a),
      clay: lam(0xd9b98a), straw: lam(0xd9b04a), strawDark: lam(0xa8822e),
      beam: basic(0x7fd3ff, { transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
    // a fixed pool of lantern lights, created up front (adding lights later makes three.js recompile shaders → hitch)
    this.lightPool = [];
    for (let i = 0; i < rules.lanternMax + 2; i++) {
      const l = new THREE.PointLight(0xffc46a, 0, 9, 1.6);
      l.position.set(0, -50, 0);
      scene.add(l);
      this.lightPool.push(l);
    }
  }

  reset() {
    for (const c of this.chests) this.removeChest(c);
    for (const st of [...this.structs]) this.destroy(st);
    this.chests = [];
    this.structs = [];
    for (const l of this.lightPool) { l.intensity = 0; l.position.y = -50; l.userData.used = false; }
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
  get lanterns() { return this.structs.filter((s) => s.kind === 'lantern'); }
  get wells() { return this.structs.filter((s) => s.kind === 'well'); }
  get fences() { return this.structs.filter((s) => s.kind === 'fence'); }
  get huts() { return this.structs.filter((s) => s.kind === 'hut'); }

  /** returns a reason string if the spot is not OK, else null */
  checkSpot(kind, x, z) {
    const R = rules.islandRadius - 0.8;
    const D = STRUCT[kind];
    if (Math.hypot(x, z) > R) return '바다 쪽에는 지을 수 없다';
    if (Math.hypot(x - this.world.fire.x, z - this.world.fire.z) < 1.8 + (kind === 'hut' ? 1.2 : 0)) return '모닥불과 너무 가깝다';
    if (this.world.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + D.pad)) return '자리가 막혀 있다';
    if (this.structs.filter((s) => s.kind === kind).length >= D.max) return `${D.name}은(는) ${D.max}개까지`;
    return null;
  }

  takeLight() {
    const l = this.lightPool.find((q) => !q.userData.used);
    if (l) l.userData.used = true;
    return l || null;
  }

  build(kind, x, z, facing = 0, hp = null) {
    const D = STRUCT[kind];
    const m = this.mats;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(0.01);
    const cols = [];
    const add = (geo, mat, px, py, pz) => { const o = new THREE.Mesh(geo, mat); o.position.set(px, py, pz); o.castShadow = true; g.add(o); return o; };
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const st = { kind, x, z, f: facing, group: g, cols, hp: hp ?? D.hp, maxHp: D.hp, shake: 0, lit: 0, hurtShow: 0 };
    if (kind === 'lantern') {
      add(B(0.7, 0.2, 0.7), m.stoneDark, 0, 0.1, 0);
      add(B(0.28, 0.7, 0.28), m.stone, 0, 0.55, 0);
      add(B(0.6, 0.12, 0.6), m.stoneDark, 0, 0.95, 0);
      st.lamp = add(B(0.4, 0.38, 0.4), m.lampOff, 0, 1.2, 0);
      add(B(0.78, 0.14, 0.78), m.stone, 0, 1.46, 0);
      add(B(0.4, 0.14, 0.4), m.stone, 0, 1.58, 0);
      st.zoneR = rules.lanternRadius;
      cols.push({ x, z, r: 0.4 });
    } else if (kind === 'well') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        add(B(0.42, 0.5, 0.3), i % 2 ? m.stone : m.stoneDark, Math.cos(a) * 0.58, 0.25, Math.sin(a) * 0.58).rotation.y = -a;
      }
      const water = new THREE.Mesh(new THREE.CircleGeometry(0.48, 16), basic(0x3a9bd8));
      water.rotation.x = -Math.PI / 2; water.position.y = 0.36; g.add(water);
      add(B(0.12, 1.4, 0.12), m.fence, -0.62, 0.7, 0);
      add(B(0.12, 1.4, 0.12), m.fence, 0.62, 0.7, 0);
      add(B(1.5, 0.1, 0.9), m.woodDark, 0, 1.45, 0);
      add(B(1.2, 0.08, 0.08), m.wood, 0, 1.2, 0);
      add(B(0.24, 0.22, 0.24), m.wood, 0.25, 0.85, 0);
      cols.push({ x, z, r: 0.75 });
    } else if (kind === 'fence') {
      g.rotation.y = facing;  // local x (the rails) ends up across the facing direction
      for (const px of [-0.6, 0, 0.6]) {
        add(B(0.16, 0.95, 0.16), m.fence, px, 0.47, 0);
        add(B(0.1, 0.12, 0.1), m.fence, px, 1.0, 0).rotation.y = Math.PI / 4;
      }
      for (const py of [0.35, 0.7]) add(B(1.45, 0.12, 0.08), m.fence, 0, py, 0);
      const ax = Math.cos(facing), az = -Math.sin(facing);
      for (const o of [-0.4, 0.4]) cols.push({ x: x + ax * o, z: z + az * o, r: 0.42 });
    } else if (kind === 'jangseung') {
      g.rotation.y = facing + Math.PI;
      add(B(0.5, 2.3, 0.5), m.jang, 0, 1.15, 0);
      add(B(0.66, 0.24, 0.66), m.woodDark, 0, 2.38, 0);
      add(B(0.8, 0.08, 0.8), m.woodDark, 0, 2.24, 0);
      for (const ex of [-0.12, 0.12]) add(B(0.12, 0.08, 0.04), m.ink, ex, 1.95, 0.26).rotation.z = ex > 0 ? -0.4 : 0.4; // glaring eyes
      add(B(0.3, 0.12, 0.04), m.ink, 0, 1.62, 0.26);
      for (const tx of [-0.1, 0.1]) add(B(0.06, 0.1, 0.04), m.bone, tx, 1.58, 0.28);
      add(B(0.08, 0.5, 0.04), m.red, 0, 1.15, 0.26);
      const aura = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 40), basic(0x9a5cff, { transparent: true, opacity: 0.0, depthWrite: false }));
      aura.rotation.x = -Math.PI / 2; aura.position.y = 0.04; aura.scale.setScalar(4.5);
      this.group.add(aura); aura.position.x = x; aura.position.z = z;
      st.ring = aura;
      st.slowR = 4.5;
      cols.push({ x, z, r: 0.4 });
    } else if (kind === 'trap') {
      add(B(1.0, 0.08, 1.0), m.woodDark, 0, 0.04, 0);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const sp = add(B(0.07, 0.3, 0.07), m.bone, i * 0.3, 0.2, j * 0.3);
        sp.rotation.set(j * 0.2, 0, -i * 0.2);
      }
      st.trap = true;
    } else if (kind === 'hut') {
      g.rotation.y = facing + Math.PI;
      add(B(2.2, 1.3, 1.8), m.clay, 0, 0.65, 0);
      add(B(2.3, 0.14, 1.9), m.woodDark, 0, 0.07, 0);
      const r1 = add(B(2.6, 0.18, 1.35), m.straw, 0, 1.6, 0.48); r1.rotation.x = 0.55;
      const r2 = add(B(2.6, 0.18, 1.35), m.straw, 0, 1.6, -0.48); r2.rotation.x = -0.55;
      add(B(2.7, 0.2, 0.3), m.strawDark, 0, 1.98, 0);
      add(B(0.5, 0.85, 0.05), m.ink, -0.45, 0.45, 0.92);
      st.lamp = add(B(0.4, 0.35, 0.05), m.lampOff, 0.5, 0.75, 0.92);
      st.zoneR = 2.8;
      cols.push({ x, z, r: 1.2 });
    } else if (kind === 'tower') {
      for (let k = 0; k < 5; k++) add(B(0.8 - k * 0.13, 0.24, 0.7 - k * 0.11), k % 2 ? m.stone : m.stoneDark, 0, 0.12 + k * 0.24, 0).rotation.y = k * 0.7 + facing;
      add(B(0.16, 0.16, 0.16), m.stone, 0, 1.32, 0);
      cols.push({ x, z, r: 0.4 });
    }
    if (st.zoneR) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 48), basic(0xffd07a, { transparent: true, opacity: 0, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.03, z);
      ring.scale.setScalar(st.zoneR);
      this.group.add(ring);
      st.ring = ring;
      st.light = this.takeLight();
      if (st.light) st.light.position.set(x, 1.4, z);
    }
    st.colR = cols.length ? Math.max(...cols.map((c) => c.r)) : 0.5;
    this.world.colliders.push(...cols);
    this.group.add(g);
    this.structs.push(st);
    this.grow.push({ g, t: 0 });
    return st;
  }

  /** a monster (or the chief) hits a building. returns true if it broke */
  damage(st, dmg) {
    if (st.hp <= 0) return false;
    st.hp -= st.trap ? 1 : dmg;
    st.shake = 1;
    st.hurtShow = 4;
    if (st.hp <= 0) { this.destroy(st); return true; }
    return false;
  }

  destroy(st) {
    st.hp = 0;
    this.group.remove(st.group);
    if (st.ring) this.group.remove(st.ring);
    if (st.bar) this.group.remove(st.bar);
    if (st.light) { st.light.intensity = 0; st.light.position.y = -50; st.light.userData.used = false; }
    this.dropCols(st.cols);
    this.structs = this.structs.filter((s) => s !== st);
  }

  /** a damaged building within reach of (x,z) */
  repairable(x, z) {
    let best = null, bd = 99;
    for (const s of this.structs) {
      if (s.hp >= s.maxHp) continue;
      const d = Math.hypot(s.x - x, s.z - z) - s.colR;
      if (d < 1.4 && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  repair(st) {
    st.hp = Math.min(st.maxHp, st.hp + Math.ceil(st.maxHp * (st.trap ? 1 : 0.5)));
    st.shake = 0.6;
    st.hurtShow = 2;
  }

  serialize() {
    return { structs: this.structs.map((s) => ({ k: s.kind, x: +s.x.toFixed(2), z: +s.z.toFixed(2), f: +(s.f || 0).toFixed(3), hp: Math.round(s.hp) })) };
  }

  restore(data) {
    if (data.structs) { for (const s of data.structs) this.build(s.k, s.x, s.z, s.f, s.hp); return; }
    // older saves
    for (const l of data.lanterns || []) this.build('lantern', l.x, l.z, 0);
    for (const w of data.wells || []) this.build('well', w.x, w.z, 0);
    for (const f of data.fences || []) this.build('fence', f.x, f.z, f.f);
  }

  nearWell(x, z, d = 1.8) { return this.wells.some((w) => Math.hypot(w.x - x, w.z - z) < d); }

  /** circles monsters cannot enter */
  safeZones(fireR) {
    const zones = [];
    if (fireR > 0) zones.push({ x: this.world.fire.x, z: this.world.fire.z, r: fireR });
    for (const s of this.structs) if (s.zoneR && s.lit > 0.5) zones.push({ x: s.x, z: s.z, r: s.zoneR });
    return zones;
  }

  /** things monsters can smash */
  targets() { return this.structs.filter((s) => !s.trap); }
  /** jangseung slow fields */
  slowZones() { return this.structs.filter((s) => s.slowR).map((s) => ({ x: s.x, z: s.z, r: s.slowR })); }
  /** spike traps: return the monsters that just stepped on one */
  springTraps(monsters) {
    const hits = [];
    for (const s of this.structs) {
      if (!s.trap) continue;
      for (const m of monsters) {
        if (!m.alive || m.type === 'wisp' || (m.trapCD || 0) > 0) continue;
        if (Math.hypot(m.pos.x - s.x, m.pos.z - s.z) < 0.75 + m.radius * 0.5) {
          m.trapCD = 1.2;
          m.slowT = 1.5;
          hits.push({ m, trap: s });
          this.damage(s, 1);
          if (s.hp <= 0) break;
        }
      }
    }
    return hits;
  }

  update(dt, time, darkness, camera, playerPos) {
    // pop-in for new buildings
    for (const b of this.grow) {
      b.t += dt * 4;
      const k = Math.min(1, b.t);
      b.g.scale.setScalar(k < 1 ? k * (1.25 - 0.25 * k) : 1);
    }
    this.grow = this.grow.filter((b) => b.t < 1);
    for (const c of this.chests) {
      if (!c.opened) {
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
    for (const s of this.structs) {
      // lights (lanterns, hut windows) come on at dusk
      if (s.zoneR) {
        const want = darkness > 0.15 ? 1 : 0;
        s.lit += (want - s.lit) * Math.min(1, dt * 2);
        const flick = 1 + Math.sin(time * 11 + s.x) * 0.05;
        if (s.light) s.light.intensity = s.lit * (3 + darkness * 14) * flick;
        s.lamp.material = s.lit > 0.5 ? this.mats.lampOn : this.mats.lampOff;
        s.ring.material.opacity = s.lit * (0.1 + darkness * 0.45);
      }
      if (s.slowR) s.ring.material.opacity = 0.08 + darkness * 0.25;
      // damage shows: shake when hit, lean more as it weakens
      const k = s.hp / s.maxHp;
      s.shake = Math.max(0, s.shake - dt * 4);
      if (!s.trap) s.group.rotation.z = (1 - k) * 0.14 + Math.sin(time * 50) * 0.05 * s.shake;
      s.hurtShow = Math.max(0, s.hurtShow - dt);
      const near = playerPos && Math.hypot(playerPos.x - s.x, playerPos.z - s.z) < 3.5;
      this.updateBar(s, (s.hurtShow > 0 || near) && k < 1, camera);
    }
  }

  updateBar(s, show, camera) {
    if (!show) { if (s.bar) s.bar.visible = false; return; }
    if (!s.bar) {
      const g = new THREE.Group();
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.13), basic(0x101010, { transparent: true, opacity: 0.8, depthTest: false }));
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.09), basic(0x7ad36a, { depthTest: false }));
      fill.position.z = 0.001; bg.renderOrder = 10; fill.renderOrder = 11;
      g.add(bg, fill); g.fill = fill;
      this.group.add(g);
      s.bar = g;
    }
    const k = Math.max(0, s.hp / s.maxHp);
    s.bar.visible = true;
    s.bar.fill.scale.x = Math.max(0.001, k);
    s.bar.fill.position.x = -(1.1 - 1.1 * k) / 2;
    s.bar.fill.material.color.setHex(k > 0.5 ? 0x7ad36a : k > 0.25 ? 0xffc04a : 0xff4a3a);
    s.bar.position.set(s.x, s.kind === 'hut' ? 2.6 : s.kind === 'trap' ? 0.8 : 2.0, s.z);
    if (camera) s.bar.quaternion.copy(camera.quaternion);
  }
}
