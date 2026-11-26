import * as THREE from 'three';
import { rules } from './config.js';

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

// small seeded RNG so the island is the same every run
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];   // static circles {x,z,r}
    this.trees = [];
    this.rocks = [];
    this.bushes = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    const rand = rng(1984);
    this.rand = rand;

    this.buildGround();
    this.buildFire();
    this.buildTrees(rand);
    this.buildRocks(rand);
    this.buildBushes(rand);
    this.buildDecor(rand);
  }

  buildGround() {
    const R = rules.islandRadius;
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.5, R + 1.2, 1, 56), lam(0x7cc35a));
    grass.position.y = -0.5;
    grass.receiveShadow = true;
    this.group.add(grass);
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(R + 3, R + 4, 1, 56), lam(0xf0d9a0));
    sand.position.y = -0.62;
    sand.receiveShadow = true;
    this.group.add(sand);
    const water = new THREE.Mesh(new THREE.CircleGeometry(160, 48), lam(0x3a9bd8, { transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.7;
    this.group.add(water);
    this.water = water;

    // grass patches for texture
    const patchGeo = new THREE.CircleGeometry(1, 7);
    const patchMat = lam(0x6db34c);
    for (let i = 0; i < 26; i++) {
      const a = i * 2.4, r = 3 + (i * 7.3) % (R - 4);
      const p = new THREE.Mesh(patchGeo, patchMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(Math.cos(a) * r, 0.01, Math.sin(a) * r);
      p.scale.setScalar(1.2 + (i % 4) * 0.6);
      p.receiveShadow = true;
      this.group.add(p);
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

  buildTrees(rand) {
    const trunkMat = lam(0x8a5a2b);
    const leafMats = [lam(0x3f9a4a), lam(0x4fae54), lam(0x2f8442)];
    const trunkGeo = new THREE.BoxGeometry(0.42, 1.2, 0.42);
    const R = rules.islandRadius - 2;
    let tries = 0;
    while (this.trees.length < 44 && tries++ < 2000) {
      const a = rand() * Math.PI * 2;
      const r = 6 + Math.sqrt(rand()) * (R - 6);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.6)) continue;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.rotation.y = rand() * Math.PI;
      const sc = 0.85 + rand() * 0.45;
      g.scale.setScalar(sc);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.6; trunk.castShadow = true; trunk.receiveShadow = true;
      g.add(trunk);
      const lm = leafMats[Math.floor(rand() * 3)].clone();
      lm.transparent = true;
      [[1.6, 0.9, 1.6], [1.25, 0.8, 1.25], [0.8, 0.7, 0.8]].forEach(([w, h, d], i) => {
        const l = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lm);
        l.position.y = 1.5 + i * 0.7;
        l.rotation.y = i * 0.4;
        l.castShadow = true; l.receiveShadow = true;
        g.add(l);
      });
      this.group.add(g);
      const col = { x, z, r: 0.42 * sc + 0.05 };
      this.colliders.push(col);
      this.trees.push({ group: g, x, z, r: col.r, col, hp: rules.treeHp, alive: true, shake: 0, fall: -1, fallDir: 0, leafMat: lm, fade: 1 });
    }
  }

  buildRocks(rand) {
    const mats = [lam(0x9a9ca6), lam(0x83868f)];
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      const r = 5 + rand() * (rules.islandRadius - 7);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1.6)) continue;
      const s = 0.6 + rand() * 0.7;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mats[i % 2]);
      m.position.set(x, s * 0.45, z);
      m.scale.y = 0.7;
      m.rotation.set(rand(), rand() * 3, rand());
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      const col = { x, z, r: s * 0.85 };
      this.colliders.push(col);
      this.rocks.push({ mesh: m, x, z, r: col.r, col, size: s, hp: rules.rockHp, alive: true, shake: 0, gone: -1, baseY: m.position.y });
    }
  }

  buildBushes(rand) {
    const leaf = [lam(0x3f8f3a), lam(0x4fa647)];
    const berryMat = lam(0xe8344e);
    const R = rules.islandRadius - 3;
    let tries = 0;
    while (this.bushes.length < rules.bushes && tries++ < 400) {
      const a = rand() * Math.PI * 2, r = 5 + rand() * (R - 5);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1.4)) continue;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      [[0, 0.32, 0, 0.8], [0.32, 0.26, 0.15, 0.55], [-0.28, 0.24, -0.12, 0.6]].forEach(([bx, by, bz, sz], i) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 0.8, sz), leaf[i % 2]);
        b.position.set(bx, by, bz); b.rotation.y = i; b.castShadow = true; g.add(b);
      });
      const berries = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const ang = k * 1.05 + rand();
        const be = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), berryMat);
        be.position.set(Math.cos(ang) * 0.38, 0.3 + rand() * 0.3, Math.sin(ang) * 0.38);
        berries.add(be);
      }
      g.add(berries);
      this.group.add(g);
      const col = { x, z, r: 0.45 };
      this.colliders.push(col);
      this.bushes.push({ x, z, r: col.r, group: g, berries, ripe: true, shake: 0 });
    }
  }

  /** pick berries: returns how many */
  pickBush(b) {
    if (!b.ripe) return 0;
    b.ripe = false;
    b.berries.visible = false;
    b.shake = 1;
    return 2 + (Math.random() < 0.4 ? 1 : 0);
  }

  updateBushes(dt) {
    for (const b of this.bushes) {
      if (b.shake > 0) {
        b.shake = Math.max(0, b.shake - dt * 4);
        b.group.scale.set(1 + Math.sin(b.shake * 20) * 0.08 * b.shake, 1 - Math.sin(b.shake * 20) * 0.06 * b.shake, 1);
      }
    }
  }

  refillBushes() { for (const b of this.bushes) { b.ripe = true; b.berries.visible = true; } }

  /** standing at the water's edge? */
  atShore(x, z) { return Math.hypot(x, z) > rules.islandRadius - 1.2; }

  /** Hit a rock. Returns stone gained (0 if not broken). */
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

  /** Each morning some felled trees and broken rocks come back (never on top of the player). */
  regrow(share, px, pz) {
    const clear = (x, z, r) => Math.hypot(x - px, z - pz) > r + 1.2;
    for (const t of this.trees) {
      if (t.alive || t.fall < 2 || Math.random() > share || !clear(t.x, t.z, t.r)) continue;
      t.alive = true; t.hp = rules.treeHp; t.fall = -1; t.shake = 0;
      t.group.visible = true; t.group.position.y = 0;
      t.group.rotation.set(0, t.group.rotation.y, 0);
      if (t.stump) { this.group.remove(t.stump); t.stump = null; }
      this.colliders.push(t.col);
    }
    for (const r of this.rocks) {
      if (r.alive || Math.random() > share || !clear(r.x, r.z, r.r)) continue;
      r.alive = true; r.hp = rules.rockHp; r.gone = -1;
      r.mesh.visible = true; r.mesh.scale.set(1, 0.7, 1);
      this.colliders.push(r.col);
    }
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
      this.group.add(g);
      this.colliders.push({ x, z, r: 0.4 });
    });
    // stone towers (doltap)
    const stone = lam(0xa7a9b2);
    [[10, 6], [-8, 12], [4, -13]].forEach(([x, z]) => {
      if (this.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1.2)) return;
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.7 - k * 0.13, 0.22, 0.6 - k * 0.11), stone);
        s.position.set(x, 0.11 + k * 0.22, z); s.rotation.y = k * 0.7; s.castShadow = true;
        this.group.add(s);
      }
      this.colliders.push({ x, z, r: 0.4 });
    });
    // flowers
    const flowerGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const fm = [lam(0xffe066), lam(0xff8fb1), lam(0xffffff)];
    for (let i = 0; i < 70; i++) {
      const a = rand() * Math.PI * 2, r = 3 + rand() * (rules.islandRadius - 4);
      const f = new THREE.Mesh(flowerGeo, fm[i % 3]);
      f.position.set(Math.cos(a) * r, 0.08, Math.sin(a) * r);
      this.group.add(f);
    }
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
          this.group.add(stump);
          t.stump = stump;
        }
      }
    }
  }

  /** Fade trees that stand between the camera and the player. back = unit vector from player toward camera (ground plane). */
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

  /** Push a circle out of static colliders and keep it on the island. */
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
}
