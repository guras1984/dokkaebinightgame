import * as THREE from 'three';
import { rules } from './config.js';
import { buildCharacter, animateCharacter } from './character.js';
import { VILLAGERS } from './story.js';

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const LAIR_ANGLES = [0.75, 2.45, 3.95, 5.4];
const LAIR_R = 20.5;

/** one villager: caged in a lair → follows the player → lives at the camp */
class Villager {
  constructor(scene, def, index) {
    this.def = def;
    this.index = index;
    const L = def.look;
    this.rig = buildCharacter({ kind: 'hero', skin: L.skin, top: L.top, pants: L.pants, hair: L.hair });
    this.rig.weapon.visible = false;
    const s = L.scale || 1;
    this.scale = s;
    this.rig.root.scale.setScalar(s);
    if (L.hat) {
      // gat: wide black horsehair hat
      const hm = lam(0x15151c, { transparent: true, opacity: 0.92 });
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 16), hm);
      brim.position.y = 0.34; this.rig.head.add(brim);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.34, 12), hm);
      crown.position.y = 0.52; this.rig.head.add(crown);
    }
    if (def.id === 'samwol') {
      const bun = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.22), lam(0xe8e8e8));
      bun.position.set(0, 0.2, -0.3); this.rig.head.add(bun);
    }
    scene.add(this.rig.root);
    this.scene = scene;
    this.pos = this.rig.root.position;
    this.facing = 0;
    this.vel = new THREE.Vector3();
    this.state = 'caged';
    this.time = Math.random() * 10;
    this.wanderT = 0;
    this.goal = new THREE.Vector3();
    this.shootT = 0;
  }

  update(dt, { player, world, fire, fireR, darkness, nearestMonster }) {
    this.time += dt;
    const before = this.pos.clone();
    let target = null, speed = 0, face = null;
    if (this.state === 'caged') {
      face = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    } else if (this.state === 'follow') {
      const back = 1.5 + this.index * 0.5;
      target = new THREE.Vector3(player.pos.x - Math.sin(player.facing) * back, 0, player.pos.z - Math.cos(player.facing) * back);
      const d = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
      speed = d < 0.5 ? 0 : Math.min(7.5, 2 + d * 1.6);
      if (d > 16) this.pos.set(target.x, 0, target.z); // lost: catch up
    } else if (this.state === 'camp') {
      const hunterOnWatch = this.def.id === 'beomsu' && darkness > 0.5 && fireR > 0;
      if (hunterOnWatch) {
        // stand just inside the light, on the side of the closest monster
        const m = nearestMonster;
        const a = m ? Math.atan2(m.pos.x - fire.x, m.pos.z - fire.z) : this.index * 1.6;
        const r = Math.max(1.6, fireR - 0.8);
        target = new THREE.Vector3(fire.x + Math.sin(a) * r, 0, fire.z + Math.cos(a) * r);
        speed = 4;
        if (m) face = Math.atan2(m.pos.x - this.pos.x, m.pos.z - this.pos.z);
      } else {
        // idle around the fire, wander a little now and then
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 4 + Math.random() * 5;
          const a = this.index * 1.57 + 0.6 + (Math.random() - 0.5) * 0.7;
          const r = 2.6 + Math.random() * 1.2;
          this.goal.set(fire.x + Math.sin(a) * r, 0, fire.z + Math.cos(a) * r);
        }
        target = this.goal;
        speed = 1.8;
        if (Math.hypot(target.x - this.pos.x, target.z - this.pos.z) < 0.3) face = Math.atan2(fire.x - this.pos.x, fire.z - this.pos.z);
      }
    }
    if (target && speed > 0) {
      const dx = target.x - this.pos.x, dz = target.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.25) {
        const want = new THREE.Vector3(dx / d * speed, 0, dz / d * speed);
        this.vel.lerp(want, Math.min(1, dt * 8));
        if (face === null) face = Math.atan2(dx, dz);
      } else this.vel.multiplyScalar(Math.pow(0.001, dt));
    } else this.vel.multiplyScalar(Math.pow(0.001, dt));
    if (this.state !== 'caged') {
      this.pos.addScaledVector(this.vel, dt);
      world.resolve(this.pos, 0.35);
    }
    if (face !== null) this.facing += angDiff(this.facing, face) * Math.min(1, dt * 8);
    this.rig.root.rotation.y = this.facing;
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    animateCharacter(this.rig, {
      dist: moved / this.scale, speedRatio: Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 5),
      attack: -1, roll: -1, windup: 0, time: this.time,
    }, dt);
    if (this.state === 'caged') {
      // wave for help
      const w = Math.sin(this.time * 9) * 0.5;
      this.rig.arms[0].rotation.x = -2.6 + w; this.rig.arms[0].rotation.z = 0.3;
    }
  }
}

/** a dokkaebi lair: dark rocks, a red flag, a cage with someone inside, a seal until its day comes */
class Lair {
  constructor(scene, world, def, index) {
    this.def = def;
    this.index = index;
    const a = LAIR_ANGLES[index];
    this.x = Math.sin(a) * LAIR_R; this.z = Math.cos(a) * LAIR_R;
    this.state = 'sealed';   // sealed | open | guarded | cleared | empty
    this.guards = [];
    const g = new THREE.Group();
    g.position.set(this.x, 0, this.z);
    g.rotation.y = Math.atan2(-this.x, -this.z); // cage door faces the camp
    this.group = g;
    // clear the ground around the lair
    world.clearArea(this.x, this.z, 3.6);
    const dark = lam(0x3b3646), darker = lam(0x2a2633);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20), lam(0x4a3f3a));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0.02; ground.receiveShadow = true; g.add(ground);
    [[-2.1, -1.2, 1.0], [2.0, -1.4, 0.9], [-0.4, -2.3, 1.3], [1.1, -2.2, 0.8]].forEach(([x, z, s], i) => {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), i % 2 ? dark : darker);
      r.position.set(x, s * 0.5, z); r.scale.y = 0.8; r.castShadow = true; g.add(r);
    });
    // red flag
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 0.1), lam(0x5a3a22));
    pole.position.set(1.9, 1.5, 0.6); pole.castShadow = true; g.add(pole);
    this.flag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.04), lam(0xc9413a));
    this.flag.position.set(2.35, 2.65, 0.6); g.add(this.flag);
    // cage
    const bar = lam(0x5a3a22);
    this.cage = new THREE.Group();
    const N = 10;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.9, 0.09), bar);
      b.position.set(Math.sin(ang) * 0.75, 0.95, Math.cos(ang) * 0.75); b.castShadow = true;
      this.cage.add(b);
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.14, 10), bar);
    top.position.y = 1.95; top.castShadow = true; this.cage.add(top);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 10), bar);
    base.position.y = 0.05; this.cage.add(base);
    g.add(this.cage);
    // seal: purple glow pillar
    this.seal = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 3, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x9a5cff, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.seal.position.y = 1.5; g.add(this.seal);
    // "!" marker when it can be rescued
    this.mark = new THREE.Group();
    const mm = new THREE.MeshBasicMaterial({ color: 0xffd23a });
    const m1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18), mm); m1.position.y = 0.35; this.mark.add(m1);
    const m2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), mm); this.mark.add(m2);
    this.mark.position.y = 3.0; g.add(this.mark);
    scene.add(g);
    this.col = { x: this.x, z: this.z, r: 0.95 };
    world.colliders.push(this.col);
    this.time = Math.random() * 5;
  }

  update(dt, day) {
    this.time += dt;
    if (this.state === 'sealed' && day >= this.def.unlockDay) this.state = 'open';
    this.seal.visible = this.state === 'sealed';
    this.seal.material.opacity = 0.18 + Math.sin(this.time * 2) * 0.06;
    this.mark.visible = this.state === 'open' || this.state === 'cleared';
    this.mark.position.y = 3.0 + Math.sin(this.time * 3) * 0.15;
    this.mark.rotation.y += dt * 2;
    this.flag.rotation.y = Math.sin(this.time * 2.3) * 0.25;
    if (this.cageOpen !== undefined && this.cageOpen < 1) {
      this.cageOpen = Math.min(1, this.cageOpen + dt * 2);
      this.cage.position.y = this.cageOpen * 3;
      this.cage.scale.setScalar(1 - this.cageOpen * 0.5);
      if (this.cageOpen >= 1) this.cage.visible = false;
    }
  }
}

export class Village {
  constructor(scene, world, effects) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.lairs = VILLAGERS.map((def, i) => new Lair(scene, world, def, i));
    this.people = VILLAGERS.map((def, i) => new Villager(scene, def, i));
    this.arrows = [];
    const arrowGeo = new THREE.BoxGeometry(0.05, 0.05, 0.7);
    this.arrowMat = lam(0xe8dcc0);
    this.arrowGeo = arrowGeo;
    this.reset();
  }

  reset() {
    this.lairs.forEach((l, i) => {
      l.state = 'sealed'; l.guards = []; l.cageOpen = undefined;
      l.cage.visible = true; l.cage.position.y = 0; l.cage.scale.setScalar(1);
      const v = this.people[i];
      v.state = 'caged';
      v.pos.set(l.x, 0, l.z);
      v.rig.root.visible = true;
    });
    for (const a of this.arrows) this.scene.remove(a.mesh);
    this.arrows = [];
  }

  /** restore from a save: ids already living at the camp */
  restore(ids, fire) {
    ids.forEach((id) => {
      const i = this.people.findIndex((p) => p.def.id === id);
      if (i < 0) return;
      const v = this.people[i], l = this.lairs[i];
      v.state = 'camp';
      v.pos.set(fire.x + Math.sin(i * 1.57 + 0.6) * 3, 0, fire.z + Math.cos(i * 1.57 + 0.6) * 3);
      l.state = 'empty'; l.cage.visible = false;
    });
  }

  get inCamp() { return this.people.filter((p) => p.state === 'camp'); }
  has(id) { return this.people.some((p) => p.def.id === id && p.state === 'camp'); }

  /** lair the player is standing at (for guards and the rescue button) */
  lairNear(x, z, d) { return this.lairs.find((l) => Math.hypot(l.x - x, l.z - z) < d); }

  /** villager the player can talk to */
  talkable(x, z) { return this.inCamp.find((p) => Math.hypot(p.pos.x - x, p.pos.z - z) < 1.7); }

  /** open the cage: the villager starts following */
  free(lair) {
    lair.state = 'empty';
    lair.cageOpen = 0;
    const v = this.people[lair.index];
    v.state = 'follow';
    this.effects.spawn(lair.x, 1.2, lair.z, 0xffe27a, { n: 24, speed: 3, up: 6, life: 1, size: 0.14, grav: 5 });
    return v;
  }

  update(dt, ctx) {
    const events = [];
    for (const l of this.lairs) l.update(dt, ctx.day);
    for (const v of this.people) {
      v.update(dt, ctx);
      if (v.state === 'follow') {
        const d = Math.hypot(v.pos.x - ctx.fire.x, v.pos.z - ctx.fire.z);
        if (d < Math.max(4.2, ctx.fireR * 0.9)) { v.state = 'camp'; v.wanderT = 0; events.push({ type: 'joined', v }); }
      }
      // the hunter shoots at night
      if (v.state === 'camp' && v.def.id === 'beomsu' && ctx.darkness > 0.5 && ctx.nearestMonster) {
        v.shootT -= dt;
        const m = ctx.nearestMonster;
        if (v.shootT <= 0 && Math.hypot(m.pos.x - v.pos.x, m.pos.z - v.pos.z) < 10) {
          v.shootT = 1.3;
          const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
          mesh.position.set(v.pos.x, 1.3, v.pos.z);
          this.scene.add(mesh);
          this.arrows.push({ mesh, from: v.pos.clone(), m, t: 0 });
          v.rig.arms[0].rotation.x = -1.5;
          events.push({ type: 'shoot', v });
        }
      }
    }
    for (const a of this.arrows) {
      a.t += dt / 0.22;
      const to = a.m.pos;
      const k = Math.min(1, a.t);
      a.mesh.position.set(a.from.x + (to.x - a.from.x) * k, 1.3 + Math.sin(k * Math.PI) * 0.6, a.from.z + (to.z - a.from.z) * k);
      a.mesh.lookAt(to.x, 1.1, to.z);
      if (a.t >= 1) {
        this.scene.remove(a.mesh);
        a.done = true;
        if (a.m.alive) events.push({ type: 'arrowHit', m: a.m, from: a.from });
      }
    }
    this.arrows = this.arrows.filter((a) => !a.done);
    return events;
  }
}
