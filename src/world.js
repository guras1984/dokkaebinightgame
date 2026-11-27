import * as THREE from 'three';
import { rules } from './config.js';

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

// small seeded RNG: each run gets its own seed, so every island is different (and a save can rebuild it)
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const INNER = 24;   // the home forest; outside it the island is split into three fogged regions

/** regions of the island. the outer ring is cut into three slices whose order changes every run */
export const REGIONS = {
  home:   { name: '소나무 숲', unlock: 1, ground: 0x7cc35a },
  swamp:  { name: '안개 늪', unlock: 3, ground: 0x5f7a45 },
  rocks:  { name: '바위 언덕', unlock: 5, ground: 0x9a9a7a },
  bamboo: { name: '대숲', unlock: 7, ground: 0x8fd16a },
};

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];   // static circles {x,z,r}
    this.trees = [];
    this.rocks = [];
    this.bushes = [];
    this.springs = [];     // drinkable water {x,z,r}
    this.day = 1;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildGround();
    this.buildFire();
    this.fireCol = this.colliders[this.colliders.length - 1];
    this.generate(1984);
  }

  buildGround() {
    const R = rules.islandRadius;
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.5, R + 1.2, 1, 96), lam(0x7cc35a));
    grass.position.y = -0.5;
    grass.receiveShadow = true;
    this.group.add(grass);
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(R + 3, R + 4, 1, 96), lam(0xf0d9a0));
    sand.position.y = -0.62;
    sand.receiveShadow = true;
    this.group.add(sand);
    const water = new THREE.Mesh(new THREE.CircleGeometry(260, 64), lam(0x3a9bd8, { transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.7;
    this.group.add(water);
    this.water = water;
  }

  // ---------- regions ----------
  /** which region a point is in */
  regionAt(x, z) {
    if (Math.hypot(x, z) < INNER) return 'home';
    let a = Math.atan2(x, z) - this.a0;
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return this.order[Math.floor(a / (Math.PI * 2 / 3))];
  }
  isOpen(x, z) { return REGIONS[this.regionAt(x, z)].unlock <= this.day; }
  sector(id) {
    const i = this.order.indexOf(id), w = Math.PI * 2 / 3;
    return { a0: this.a0 + i * w, a1: this.a0 + (i + 1) * w, mid: this.a0 + (i + 0.5) * w };
  }

  /** keep the player out of fogged regions. returns the region id it bumped into (or null) */
  fogClamp(pos) {
    const d = Math.hypot(pos.x, pos.z);
    if (d < INNER - 0.6) return null;
    const id = this.regionAt(pos.x, pos.z);
    if (REGIONS[id].unlock <= this.day) return null;
    const k = (INNER - 0.6) / d;
    pos.x *= k; pos.z *= k;
    return id;
  }

  updateMist(time) {
    for (const m of this.mists) {
      const open = REGIONS[m.id].unlock <= this.day;
      m.mesh.visible = !open || m.fade > 0.01;
      m.fade += ((open ? 0 : 1) - m.fade) * 0.03;
      m.mesh.material.opacity = (0.34 + Math.sin(time * 0.8 + m.phase) * 0.05) * m.fade;
    }
  }

  /** build a fresh island from a seed (trees, rocks, bushes, springs, regions, lair spots) */
  generate(seed) {
    this.seed = seed;
    if (this.scatter) this.group.remove(this.scatter);
    this.scatter = new THREE.Group();
    this.group.add(this.scatter);
    this.colliders = [this.fireCol];
    this.trees = []; this.rocks = []; this.bushes = []; this.springs = [];
    const rand = rng(seed);
    this.rand = rand;
    this.a0 = rand() * Math.PI * 2;
    const ids = ['swamp', 'rocks', 'bamboo'];
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    this.order = ids;
    const R = rules.islandRadius;

    // region ground tints + fog walls
    this.mists = [];
    const w = Math.PI * 2 / 3;
    ids.forEach((id, i) => {
      const a0 = this.a0 + i * w;
      const ring = new THREE.Mesh(new THREE.RingGeometry(INNER, R + 0.4, 40, 1, a0 - Math.PI / 2, w), lam(REGIONS[id].ground));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; ring.receiveShadow = true;
      this.scatter.add(ring);
      // a locked region is buried under layers of fog (plus a wall at its edge)
      const mist = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xdcd8f0, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
      for (const y of [0.8, 1.9, 3.0]) {
        const layer = new THREE.Mesh(new THREE.RingGeometry(INNER, R + 2, 40, 1, a0 - Math.PI / 2, w), mat);
        layer.rotation.x = -Math.PI / 2; layer.position.y = y;
        mist.add(layer);
      }
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(INNER, INNER, 4, 40, 1, true, a0, w), mat);
      wall.position.y = 2; mist.add(wall);
      mist.material = mat;
      this.scatter.add(mist);
      this.mists.push({ id, mesh: mist, fade: 1, phase: i * 2 });
    });

    // helper: a free spot in a region
    const spot = (region, rMin, rMax, pad) => {
      for (let k = 0; k < 40; k++) {
        let a;
        if (region === 'home') a = rand() * Math.PI * 2;
        else { const sc = this.sector(region); a = sc.a0 + 0.08 + rand() * (w - 0.16); }
        const r = rMin + Math.sqrt(rand()) * (rMax - rMin);
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        if (Math.hypot(x, z) < 6) continue;
        if (this.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + pad)) continue;
        if (this.springs.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + pad)) continue;
        return { x, z };
      }
      return null;
    };
    this.spot = spot;

    // lair spots first so nothing grows on them: one in the home forest, one deep in each region
    this.lairSpots = {};
    const bong = spot('home', 14, 19, 4);
    this.lairSpots.home = bong;
    for (const id of ids) {
      const sc = this.sector(id), a = sc.mid + (rand() - 0.5) * 0.5, r = 36 + rand() * 6;
      this.lairSpots[id] = { x: Math.sin(a) * r, z: Math.cos(a) * r };
    }
    for (const sp of Object.values(this.lairSpots)) this.colliders.push({ x: sp.x, z: sp.z, r: 3.4, temp: true });

    // springs: a pond near camp (the only water before the regions open) and swamp puddles
    const pond = spot('home', 8, 13, 3);
    if (pond) this.addSpring(pond.x, pond.z, 1.5, true);
    for (let i = 0; i < 6; i++) { const p = spot('swamp', INNER + 3, R - 4, 2.5); if (p) this.addSpring(p.x, p.z, 1.1 + rand() * 0.6, false); }

    // vegetation per region
    for (let i = 0; i < 40; i++) { const p = spot('home', 6, INNER - 1.5, 2.4); if (p) this.addTree(p.x, p.z, 'pine', rand); }
    for (let i = 0; i < 12; i++) { const p = spot('home', 6, INNER - 1.5, 2); if (p) this.addRock(p.x, p.z, rand); }
    for (let i = 0; i < 10; i++) { const p = spot('home', 6, INNER - 2, 2); if (p) this.addBush(p.x, p.z, 'berry', rand); }
    for (let i = 0; i < 12; i++) { const p = spot('swamp', INNER + 2, R - 2, 2.4); if (p) this.addTree(p.x, p.z, 'dead', rand); }
    for (let i = 0; i < 10; i++) { const p = spot('swamp', INNER + 2, R - 3, 2); if (p) this.addBush(p.x, p.z, 'herb', rand); }
    for (let i = 0; i < 5; i++) { const p = spot('swamp', INNER + 2, R - 2, 2); if (p) this.addRock(p.x, p.z, rand); }
    for (let i = 0; i < 28; i++) { const p = spot('rocks', INNER + 2, R - 2, 1.8); if (p) this.addRock(p.x, p.z, rand, 1.3); }
    for (let i = 0; i < 6; i++) { const p = spot('rocks', INNER + 2, R - 2, 2.4); if (p) this.addTree(p.x, p.z, 'dead', rand); }
    for (let i = 0; i < 4; i++) { const p = spot('rocks', INNER + 2, R - 3, 2); if (p) this.addBush(p.x, p.z, 'berry', rand); }
    for (let i = 0; i < 40; i++) { const p = spot('bamboo', INNER + 2, R - 2, 2.0); if (p) this.addTree(p.x, p.z, 'bamboo', rand); }
    for (let i = 0; i < 7; i++) { const p = spot('bamboo', INNER + 2, R - 3, 2); if (p) this.addBush(p.x, p.z, 'berry', rand); }
    for (let i = 0; i < 4; i++) { const p = spot('bamboo', INNER + 2, R - 2, 2); if (p) this.addRock(p.x, p.z, rand); }

    this.colliders = this.colliders.filter((c) => !c.temp);
    this.buildDecor(rand);
  }

  addSpring(x, z, r, stones) {
    const water = new THREE.Mesh(new THREE.CircleGeometry(r, 18), lam(0x3a9bd8, { transparent: true, opacity: 0.9 }));
    water.rotation.x = -Math.PI / 2; water.position.set(x, 0.03, z);
    this.scatter.add(water);
    if (stones) {
      const sm = lam(0x8d8f99);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.3), sm);
        s.position.set(x + Math.sin(a) * (r + 0.15), 0.1, z + Math.cos(a) * (r + 0.15)); s.rotation.y = a;
        s.castShadow = true; this.scatter.add(s);
      }
    }
    this.springs.push({ x, z, r, mesh: water });
  }

  /** standing next to a spring or puddle? */
  nearSpring(x, z) { return this.springs.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 1.3); }

  addTree(x, z, kind, rand) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rand() * Math.PI;
    const sc = 0.85 + rand() * 0.45;
    g.scale.setScalar(sc);
    const leaf = kind === 'bamboo' ? [0x5fbf4a, 0x7ad35a][Math.floor(rand() * 2)] : [0x3f9a4a, 0x4fae54, 0x2f8442][Math.floor(rand() * 3)];
    const lm = lam(leaf, { transparent: true });
    const add = (w, h, d, mat, px, py, pz, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(px, py, pz); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    if (kind === 'pine') {
      add(0.42, 1.2, 0.42, TRUNK, 0, 0.6, 0);
      [[1.6, 0.9, 1.6], [1.25, 0.8, 1.25], [0.8, 0.7, 0.8]].forEach(([w, h, d], i) => add(w, h, d, lm, 0, 1.5 + i * 0.7, 0, i * 0.4));
    } else if (kind === 'bamboo') {
      for (const [ox, oz, h] of [[-0.18, 0, 3.4], [0.2, 0.12, 2.8]]) {
        add(0.16, h, 0.16, BAMBOO, ox, h / 2, oz);
        add(0.7, 0.35, 0.7, lm, ox, h - 0.1, oz, 0.5);
      }
    } else {
      // dead tree: bare trunk with two crooked branches (leafMat kept for fading)
      add(0.38, 1.9, 0.38, DEAD, 0, 0.95, 0);
      const b1 = add(0.16, 0.9, 0.16, DEAD, 0.35, 1.7, 0); b1.rotation.z = -0.8;
      const b2 = add(0.14, 0.7, 0.14, DEAD, -0.3, 1.45, 0.1); b2.rotation.z = 0.9;
      lm.opacity = 1;
    }
    this.scatter.add(g);
    const col = { x, z, r: (kind === 'bamboo' ? 0.35 : 0.42) * sc + 0.05 };
    this.colliders.push(col);
    this.trees.push({ group: g, x, z, r: col.r, col, kind, hp: kind === 'bamboo' ? 2 : rules.treeHp, alive: true, shake: 0, fall: -1, fallDir: 0, leafMat: lm, fade: 1 });
  }

  addRock(x, z, rand, big = 1) {
    const s = (0.6 + rand() * 0.7) * big;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), ROCKS[Math.floor(rand() * 2)]);
    m.position.set(x, s * 0.45, z);
    m.scale.y = 0.7;
    m.rotation.set(rand(), rand() * 3, rand());
    m.castShadow = true; m.receiveShadow = true;
    this.scatter.add(m);
    const col = { x, z, r: s * 0.85 };
    this.colliders.push(col);
    this.rocks.push({ mesh: m, x, z, r: col.r, col, size: s, hp: rules.rockHp, alive: true, shake: 0, gone: -1, baseY: m.position.y });
  }

  addBush(x, z, kind, rand) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const leaf = kind === 'herb' ? [lam(0x4f8a3a), lam(0x6aa84a)] : [lam(0x3f8f3a), lam(0x4fa647)];
    [[0, 0.32, 0, 0.8], [0.32, 0.26, 0.15, 0.55], [-0.28, 0.24, -0.12, 0.6]].forEach(([bx, by, bz, sz], i) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 0.8, sz), leaf[i % 2]);
      b.position.set(bx, by, bz); b.rotation.y = i; b.castShadow = true; g.add(b);
    });
    const berries = new THREE.Group();
    const bm = kind === 'herb' ? lam(0xf0f0f0) : lam(0xe8344e);
    for (let k = 0; k < 4; k++) {
      const ang = k * 1.6 + rand();
      const be = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), bm);
      be.position.set(Math.cos(ang) * 0.38, 0.35 + rand() * 0.3, Math.sin(ang) * 0.38);
      berries.add(be);
    }
    g.add(berries);
    this.scatter.add(g);
    const col = { x, z, r: 0.45 };
    this.colliders.push(col);
    this.bushes.push({ x, z, r: col.r, col, kind, group: g, berries, ripe: true, shake: 0 });
  }

  buildDecor(rand) {
    // jangseung (village guardian posts) beside the fire
    const wood = lam(0xb07a45), face = lam(0x5b3416), red = lam(0xc9413a);
    [[-2.6, -1.4, 0.5], [2.4, -2.0, -0.4]].forEach(([x, z, ry], i) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z); g.rotation.y = ry + Math.PI / 4;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.5), wood);
      post.position.y = 1.1; post.castShadow = true; g.add(post);
      const hat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.62), i ? red : face);
      hat.position.y = 2.25; hat.castShadow = true; g.add(hat);
      [-0.1, 0.1].forEach((ex) => { const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.04), face); e.position.set(ex, 1.85, 0.26); g.add(e); });
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.04), face); mouth.position.set(0, 1.6, 0.26); g.add(mouth);
      this.scatter.add(g);
      this.colliders.push({ x, z, r: 0.4 });
    });
    // flowers (one instanced mesh per colour) and swamp reeds
    const R = rules.islandRadius;
    const geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    [0xffe066, 0xff8fb1, 0xffffff].forEach((c) => {
      const inst = new THREE.InstancedMesh(geo, lam(c), 60);
      const mtx = new THREE.Matrix4();
      for (let i = 0; i < 60; i++) {
        const a = rand() * Math.PI * 2, r = 3 + rand() * (R - 4);
        mtx.makeTranslation(Math.sin(a) * r, 0.08, Math.cos(a) * r);
        inst.setMatrixAt(i, mtx);
      }
      this.scatter.add(inst);
    });
    const reedGeo = new THREE.BoxGeometry(0.06, 0.9, 0.06);
    const reeds = new THREE.InstancedMesh(reedGeo, lam(0x9a8a4a), 90);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 90; i++) {
      const sp = this.spot('swamp', INNER + 1, R - 1, 0.2) || { x: 0, z: -999 };
      e.set((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4); q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(sp.x, 0.45, sp.z), q, one);
      reeds.setMatrixAt(i, mtx);
    }
    this.scatter.add(reeds);
  }

  /** Hit a tree. Returns wood gained (0 if not felled). */
  chopTree(tree, fromX, fromZ, dmg = 1) {
    tree.hp -= dmg;
    tree.shake = 1;
    if (tree.hp > 0) return 0;
    tree.alive = false;
    tree.fall = 0;
    tree.fallDir = Math.atan2(tree.x - fromX, tree.z - fromZ);
    this.colliders.splice(this.colliders.indexOf(tree.col), 1);
    return rules.woodPerTree;
  }

  updateTrees(dt) {
    for (const t of this.trees) {
      if (t.shake > 0) {
        t.shake = Math.max(0, t.shake - dt * 5);
        t.group.rotation.z = Math.sin(t.shake * 30) * 0.06 * t.shake;
      }
      if (t.fall >= 0 && t.fall < 2) {
        t.fall += dt;
        const p = Math.min(1, t.fall / 0.7);
        // tip over away from the player
        const ang = p * p * (Math.PI / 2 - 0.1);
        t.group.rotation.set(Math.cos(t.fallDir) * ang, t.group.rotation.y, -Math.sin(t.fallDir) * ang, 'YXZ');
        if (t.fall > 1.1) t.group.position.y = -(t.fall - 1.1) * 2.5;
        if (t.fall >= 2) {
          t.group.visible = false;
          // leave a stump
          const stump = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.46), lam(0x8a5a2b));
          stump.position.set(t.x, 0.11, t.z);
          stump.castShadow = true;
          this.scatter.add(stump);
          t.stump = stump;
        }
      }
    }
  }

  pickBush(b) {
    if (!b.ripe) return 0;
    b.ripe = false;
    b.berries.visible = false;
    b.shake = 1;
    return b.kind === 'herb' ? 1 : 2 + (Math.random() < 0.4 ? 1 : 0);
  }

  updateBushes(dt) {
    for (const b of this.bushes) {
      if (b.shake > 0) {
        b.shake = Math.max(0, b.shake - dt * 4);
        b.group.scale.set(1 + Math.sin(b.shake * 20) * 0.08 * b.shake, 1 - Math.sin(b.shake * 20) * 0.06 * b.shake, 1);
      }
    }
  }

  mineRock(rock, dmg = 1) {
    rock.hp -= dmg;
    rock.shake = 1;
    if (rock.hp > 0) return 0;
    rock.alive = false;
    rock.gone = 0;
    this.colliders.splice(this.colliders.indexOf(rock.col), 1);
    return rules.stonePerRock + (rock.size > 1.0 ? 1 : 0);
  }

  updateRocks(dt) {
    for (const r of this.rocks) {
      if (r.shake > 0) {
        r.shake = Math.max(0, r.shake - dt * 6);
        r.mesh.position.x = r.x + Math.sin(r.shake * 40) * 0.06 * r.shake;
      }
      if (r.gone >= 0 && r.gone < 1) {
        r.gone += dt * 3;
        const k = Math.max(0, 1 - r.gone);
        r.mesh.scale.set(k, 0.7 * k, k);
        if (r.gone >= 1) r.mesh.visible = false;
      }
    }
  }

  regrow(share, px, pz) {
    const clear = (x, z, r) => Math.hypot(x - px, z - pz) > r + 1.2;
    for (const t of this.trees) {
      if (t.blocked || t.alive || t.fall < 2 || Math.random() > share || !clear(t.x, t.z, t.r)) continue;
      t.alive = true; t.hp = rules.treeHp; t.fall = -1; t.shake = 0;
      t.group.visible = true; t.group.position.y = 0;
      t.group.rotation.set(0, t.group.rotation.y, 0);
      if (t.stump) { this.scatter.remove(t.stump); t.stump = null; }
      this.colliders.push(t.col);
    }
    for (const r of this.rocks) {
      if (r.blocked || r.alive || Math.random() > share || !clear(r.x, r.z, r.r)) continue;
      r.alive = true; r.hp = rules.rockHp; r.gone = -1;
      r.mesh.visible = true; r.mesh.scale.set(1, 0.7, 1);
      this.colliders.push(r.col);
    }
  }

  buildFire() {
    const g = new THREE.Group();
    this.group.add(g);
    // stone ring
    const stoneMat = lam(0x8d8f99);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.3), stoneMat);
      s.position.set(Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75);
      s.rotation.y = -a;
      s.castShadow = true; s.receiveShadow = true;
      g.add(s);
    }
    const logMat = lam(0x7a4a24);
    for (let i = 0; i < 3; i++) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.0), logMat);
      l.position.y = 0.14;
      l.rotation.y = (i / 3) * Math.PI;
      l.rotation.x = 0.15;
      l.castShadow = true;
      g.add(l);
    }
    // flames (stacked emissive boxes)
    const flames = new THREE.Group();
    flames.position.y = 0.2;
    g.add(flames);
    const fColors = [0xff5a1a, 0xff9a2a, 0xffe07a];
    this.flameParts = fColors.map((c, i) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.6 - i * 0.16, 0.7 - i * 0.12, 0.6 - i * 0.16), new THREE.MeshBasicMaterial({ color: c }));
      f.position.y = 0.3 + i * 0.12;
      f.rotation.y = i * 0.6;
      flames.add(f);
      return f;
    });
    this.flames = flames;

    this.fireLight = new THREE.PointLight(0xff9a3c, 0, 30, 1.4);
    this.fireLight.position.set(0, 1.4, 0);
    g.add(this.fireLight);

    // safe-zone ring on the ground
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffb257, transparent: true, opacity: 0.0, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    g.add(this.ring);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(1, 48), glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.02;
    g.add(this.glow);

    this.fire = { x: 0, z: 0, group: g, fuel: rules.fireStart, level: 0, max: rules.fireLevels[0] };
    this.fireStones = g.children.slice(0, 9);
    this.colliders.push({ x: 0, z: 0, r: 0.95 });
  }

  setFireLevel(level) {
    const f = this.fire;
    f.level = level;
    f.max = rules.fireLevels[level];
    const k = 1 + level * 0.25;
    this.fireStones.forEach((st, i) => {
      const a = (i / 9) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.75 * k, 0.12 * k, Math.sin(a) * 0.75 * k);
      st.scale.setScalar(k);
    });
    // nicer stones once upgraded
    const c = [0x8d8f99, 0xb7a58a, 0xe2c56a][level];
    this.fireStones[0].material.color.setHex(c);
  }

  fireRadius() {
    const f = this.fire.fuel;
    if (f <= 0) return 0;
    // levels mostly mean "burns longer"; the light itself only grows a little per level
    return rules.fireMinRadius + Math.min(f, 100) * rules.fireRadiusPerFuel + this.fire.level * 0.8;
  }

  updateFire(dt, time, darkness) {
    const r = this.fireRadius();
    const alive = this.fire.fuel > 0;
    const k = alive ? 0.55 + Math.min(this.fire.fuel, 100) / 160 + this.fire.level * 0.08 : 0;
    this.flames.visible = alive;
    const flick = 1 + Math.sin(time * 17) * 0.06 + Math.sin(time * 9.3) * 0.05;
    this.flames.scale.set(k, k * flick, k);
    this.flameParts.forEach((f, i) => { f.rotation.y += dt * (1 + i); });
    // light: subtle in daylight, strong at night
    this.fireLight.intensity = alive ? (5 + darkness * 32) * flick : 0;
    this.fireLight.distance = r * 2.2 + 2;
    this.ring.scale.setScalar(Math.max(0.01, r));
    this.glow.scale.setScalar(Math.max(0.01, r));
    this.ring.material.opacity = alive ? 0.1 + darkness * 0.55 : 0;
    this.glow.material.opacity = alive ? darkness * 0.07 : 0;
  }

  updateOcclusion(dt, px, pz, back) {
    for (const t of this.trees) {
      if (t.fall >= 0 && t.fall >= 2) continue;
      const dx = t.x - px, dz = t.z - pz;
      const along = dx * back.x + dz * back.z;            // how far toward the camera
      const side = Math.abs(dx * back.z - dz * back.x);   // sideways distance from the sight line
      const hide = along > -0.5 && along < 5 && side < 1.9;
      const goal = hide ? 0.28 : 1;
      t.fade += (goal - t.fade) * Math.min(1, dt * 10);
      t.leafMat.opacity = t.fade;
      t.leafMat.depthWrite = t.fade > 0.95;
    }
  }

  resolve(pos, radius) {
    for (const c of this.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = c.x + (dx / d) * min;
        pos.z = c.z + (dz / d) * min;
      }
    }
    const R = rules.islandRadius;
    const d = Math.hypot(pos.x, pos.z);
    if (d > R) { pos.x *= R / d; pos.z *= R / d; }
  }

  refillBushes() { for (const b of this.bushes) if (!b.blocked) { b.ripe = true; b.berries.visible = true; } }

  /** remove trees/rocks/bushes from a spot for good (lairs sit there) */
  clearArea(x, z, r) {
    const drop = (col) => { const i = this.colliders.indexOf(col); if (i >= 0) this.colliders.splice(i, 1); };
    for (const t of this.trees) if (Math.hypot(t.x - x, t.z - z) < r) { t.blocked = true; t.alive = false; t.group.visible = false; drop(t.col); }
    for (const k of this.rocks) if (Math.hypot(k.x - x, k.z - z) < r) { k.blocked = true; k.alive = false; k.mesh.visible = false; drop(k.col); }
    for (const b of this.bushes) if (Math.hypot(b.x - x, b.z - z) < r) { b.blocked = true; b.ripe = false; b.group.visible = false; drop(b.col); }
  }

  /** standing at the water's edge? */
  atShore(x, z) { return Math.hypot(x, z) > rules.islandRadius - 1.2; }
}

const TRUNK = lam(0x8a5a2b);
const BAMBOO = lam(0x9ac45a);
const DEAD = lam(0x6a5a4a);
const ROCKS = [lam(0x9a9ca6), lam(0x83868f)];
