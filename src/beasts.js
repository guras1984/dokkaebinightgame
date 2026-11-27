import * as THREE from 'three';
import { rules } from './config.js';
import { glowTex } from './character.js';

// New folklore monsters: 구미호, 왕지네, 불가사리, 어둑시니. Same interface as Dokkaebi/Wisp in monsters.js.
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...extra });
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

export const BEAST_TYPES = {
  fox:       { name: '구미호', hp: 60, damage: 16, speed: 5.6, radius: 0.45, beads: 3, scale: 1 },
  centipede: { name: '왕지네', hp: 70, damage: 14, speed: 3.0, radius: 0.55, beads: 3, scale: 1 },
  bulgasari: { name: '불가사리', hp: 140, damage: 22, speed: 2.2, radius: 0.8, beads: 4, scale: 1.3 },
  shadow:    { name: '어둑시니', hp: 40, damage: 8, speed: 1.8, radius: 0.5, beads: 2, scale: 1 },
};

function zoneAt(zones, p, inset = 0.2) {
  for (const z of zones) if (Math.hypot(p.x - z.x, p.z - z.z) < z.r - inset) return z;
  return null;
}
function pushOut(zones, p, pad) {
  for (const z of zones) {
    const dx = p.x - z.x, dz = p.z - z.z, d = Math.hypot(dx, dz) || 1, edge = z.r + pad;
    if (d < edge) { p.x = z.x + (dx / d) * edge; p.z = z.z + (dz / d) * edge; }
  }
}

class Beast {
  constructor(scene, type, x, z, diff) {
    this.scene = scene;
    this.type = type;
    this.T = BEAST_TYPES[type];
    this.root = new THREE.Group();
    this.root.position.set(x, 0, z);
    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.hp = Math.round(this.T.hp * diff.hpMul);
    this.maxHp = this.hp;
    this.damage = this.T.damage;
    this.radius = this.T.radius;
    this.speedMul = diff.speedMul;
    this.state = 'spawn';
    this.t = 0;
    this.time = Math.random() * 10;
    this.facing = Math.atan2(-x, -z);
    this.flashT = 0;
    this.mats = [];
    scene.add(this.root);
    this.root.scale.setScalar(0.01);
  }
  get alive() { return this.state !== 'dying' && this.state !== 'gone'; }
  M(c, extra) { const m = lam(c, extra); this.mats.push(m); return m; }
  box(w, h, d, mat, x, y, z, parent = this.root) { const m = new THREE.Mesh(B(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; }
  hit(dmg, fromX, fromZ, kbMul = 1) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.hurtShow = 3;
    this.flashT = 1;
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
    const kb = (this.type === 'bulgasari' ? 2 : 6) * kbMul;
    this.knock.set((dx / d) * kb, 0, (dz / d) * kb);
    if (this.hp <= 0) { this.state = 'dying'; this.t = 0; return true; }
    return false;
  }
  banish() { if (this.alive) { this.state = 'dying'; this.t = 0; } }
  dispose() { this.scene.remove(this.root); if (this.bar) this.scene.remove(this.bar); if (this.extra) this.extra.forEach((o) => this.scene.remove(o)); }
  /** spawn pop / death shrink shared by all; returns true while busy */
  lifecycle(dt, effects, color) {
    if (this.state === 'spawn') {
      const s = Math.min(1, this.t / 0.5);
      this.root.scale.setScalar(s * this.T.scale);
      if (this.t > 0.5) { this.state = 'chase'; this.t = 0; }
      return true;
    }
    if (this.state === 'dying') {
      this.root.scale.setScalar(Math.max(0, 1 - this.t / 0.35) * this.T.scale);
      this.root.rotation.y += dt * 14;
      if (this.t > 0.35) {
        effects.spawn(this.pos.x, 1, this.pos.z, color, { n: 18, speed: 3, up: 4, life: 0.8, size: 0.18, grav: -2 });
        this.state = 'gone';
        this.dispose();
      }
      return true;
    }
    return false;
  }
  flashUpdate(dt) {
    this.flashT = Math.max(0, this.flashT - dt * 4);
    for (const m of this.mats) if (m.emissive) m.emissive.setRGB(this.flashT * 0.9, this.flashT * 0.15, this.flashT * 0.1);
  }
  move(dt, goal, speed, ctx, ignoreZones = false) {
    if (goal) {
      const gx = goal.x - this.pos.x, gz = goal.z - this.pos.z, gd = Math.hypot(gx, gz);
      const slow = (this.slowT = Math.max(0, (this.slowT || 0) - dt)) > 0 || (ctx.slowZones && ctx.slowZones.some((z) => Math.hypot(this.pos.x - z.x, this.pos.z - z.z) < z.r)) ? 0.55 : 1;
      const sp = gd < 0.3 ? 0 : speed * this.speedMul * slow;
      this.vel.lerp(new THREE.Vector3((gx / (gd || 1)) * sp, 0, (gz / (gd || 1)) * sp), Math.min(1, dt * 6));
      if (gd > 0.3) this.facing += angDiff(this.facing, Math.atan2(gx, gz)) * Math.min(1, dt * 8);
    } else this.vel.multiplyScalar(Math.pow(0.01, dt));
    this.pos.addScaledVector(this.vel, dt);
    this.pos.addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.pow(0.003, dt));
    if (!ignoreZones) pushOut(ctx.zones, this.pos, 0.4 + this.radius * 0.5);
    ctx.world.resolve(this.pos, this.radius);
    this.root.rotation.y = this.facing;
  }
  /** wait at the edge of the light the player hides in */
  edgeGoal(safe, player) {
    const a = Math.atan2(player.pos.x - safe.x, player.pos.z - safe.z) + Math.sin(this.time * 0.6) * 0.5;
    const r = safe.r + 1.2 + this.radius;
    return new THREE.Vector3(safe.x + Math.sin(a) * r, 0, safe.z + Math.cos(a) * r);
  }
}

// 구미호: fast nine-tailed fox; throws out illusion copies, then darts in to bite
export class Fox extends Beast {
  constructor(scene, x, z, diff, illusion = false) {
    super(scene, 'fox', x, z, diff);
    this.illusion = illusion;
    const fur = this.M(0xf0a050), white = this.M(0xfff4e4), dark = this.M(0x2a1a10);
    if (illusion) { [fur, white].forEach((m) => { m.transparent = true; m.opacity = 0.55; }); this.hp = 1; this.maxHp = 1; this.damage = 0; this.life = 6; }
    this.body = new THREE.Group(); this.root.add(this.body);
    this.box(0.5, 0.45, 1.0, fur, 0, 0.6, 0, this.body);
    this.box(0.46, 0.44, 0.46, fur, 0, 0.92, 0.55, this.body);
    this.box(0.26, 0.2, 0.3, white, 0, 0.82, 0.86, this.body);
    for (const s of [-1, 1]) {
      this.box(0.12, 0.26, 0.1, fur, s * 0.15, 1.24, 0.55, this.body);
      const eye = this.box(0.1, 0.05, 0.03, this.M(0xffe066), s * 0.12, 0.98, 0.79, this.body); eye.rotation.z = s * 0.4;
    }
    this.legs = [];
    for (const [lx, lz] of [[-0.18, 0.35], [0.18, 0.35], [-0.18, -0.35], [0.18, -0.35]]) {
      const g = new THREE.Group(); g.position.set(lx, 0.45, lz); this.body.add(g);
      this.box(0.13, 0.45, 0.13, dark, 0, -0.22, 0, g);
      this.legs.push(g);
    }
    this.tails = [];
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group(); g.position.set(0, 0.75, -0.5); this.body.add(g);
      const a = (i - 4) * 0.22;
      g.rotation.set(-0.9, a, 0);
      this.box(0.14, 0.14, 0.8, i % 2 ? fur : white, 0, 0, -0.4, g);
      this.box(0.16, 0.16, 0.2, white, 0, 0, -0.85, g);
      this.tails.push(g);
    }
    this.cloneCD = 3 + Math.random() * 2;
  }
  update(dt, ctx) {
    this.time += dt; this.t += dt;
    if (this.lifecycle(dt, ctx.effects, this.illusion ? 0xffd0a0 : 0xffa050)) return null;
    if (this.illusion && (this.life -= dt) <= 0) { this.banish(); return null; }
    const { player, zones } = ctx;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    const safe = zoneAt(zones, player.pos);
    let event = null, goal = null, speed = this.T.speed;
    this.cloneCD -= dt;
    if (this.state === 'chase') {
      goal = safe ? this.edgeGoal(safe, player) : player.pos;
      if (!safe && !this.illusion && dist < 7 && this.cloneCD <= 0) { this.cloneCD = 9; event = 'foxClones'; }
      if (!safe && dist < 1.4 && !player.dead) { this.state = 'windup'; this.t = 0; event = event || 'windup'; }
    } else if (this.state === 'windup') {
      this.facing += angDiff(this.facing, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
      this.body.rotation.x = -0.25 * Math.min(1, this.t / 0.35);
      if (this.t > 0.35) {
        this.state = 'recover'; this.t = 0; this.body.rotation.x = 0.2;
        if (dist < 1.9 && !this.illusion) event = 'hitPlayer';
        if (this.illusion) this.banish();
      }
    } else if (this.state === 'recover') {
      this.body.rotation.x *= 0.9;
      if (this.t > 0.6) { this.state = 'chase'; this.t = 0; }
    }
    this.move(dt, goal, speed, ctx);
    const sp = this.vel.length();
    const ph = this.time * 14;
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + (i % 2 ? Math.PI : 0) + (i > 1 ? 0.6 : 0)) * 0.7 * Math.min(1, sp / 3); });
    this.tails.forEach((t, i) => { t.rotation.y = (i - 4) * 0.22 + Math.sin(this.time * 4 + i) * 0.12; });
    this.body.position.y = Math.abs(Math.sin(ph)) * 0.08 * Math.min(1, sp / 3);
    this.flashUpdate(dt);
    return event;
  }
}

// 왕지네: a long segmented centipede; rears up, then charges in a straight line (roll over it!)
export class Centipede extends Beast {
  constructor(scene, x, z, diff) {
    super(scene, 'centipede', x, z, diff);
    const head = this.M(0x8a1a1a), seg = this.M(0x5a2a1a), leg = this.M(0xd9a040);
    this.headMesh = new THREE.Group(); this.root.add(this.headMesh);
    this.box(0.6, 0.35, 0.6, head, 0, 0.3, 0, this.headMesh);
    for (const s of [-1, 1]) {
      const p = this.box(0.08, 0.08, 0.4, leg, s * 0.2, 0.25, 0.4, this.headMesh); p.rotation.y = -s * 0.4; // pincers
      this.box(0.08, 0.06, 0.03, this.M(0xff3b2a), s * 0.14, 0.42, 0.31, this.headMesh);
    }
    this.segs = [];
    this.trail = [];
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      this.box(0.55 - i * 0.02, 0.26, 0.42, seg, 0, 0.2, 0, g);
      for (const s of [-1, 1]) { const l = this.box(0.42, 0.06, 0.06, leg, s * 0.38, 0.1, 0, g); l.rotation.z = s * 0.35; }
      g.position.copy(this.pos);
      scene.add(g);
      this.segs.push(g);
    }
    this.extra = this.segs;
    this.dashCD = 2;
    this.dash = new THREE.Vector3();
  }
  update(dt, ctx) {
    this.time += dt; this.t += dt;
    const busy = this.lifecycle(dt, ctx.effects, 0xd9a040);
    this.segs.forEach((s) => s.scale.setScalar(this.root.scale.x));
    if (busy) return null;
    const { player, zones } = ctx;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    const safe = zoneAt(zones, player.pos);
    let event = null, goal = null;
    this.dashCD -= dt;
    if (this.state === 'chase') {
      goal = safe ? this.edgeGoal(safe, player) : player.pos;
      if (!safe && dist < 7 && this.dashCD <= 0 && !player.dead) { this.state = 'windup'; this.t = 0; event = 'windup'; }
      this.move(dt, goal, this.T.speed, ctx);
    } else if (this.state === 'windup') {
      // rear up, aim
      this.facing += angDiff(this.facing, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
      this.root.rotation.y = this.facing;
      this.headMesh.position.y = Math.min(1, this.t / 0.6) * 0.5;
      this.vel.multiplyScalar(0.8);
      if (this.t > 0.6) { this.state = 'dash'; this.t = 0; this.dash.set(Math.sin(this.facing), 0, Math.cos(this.facing)).multiplyScalar(11); this.headMesh.position.y = 0; this.hitDone = false; }
    } else if (this.state === 'dash') {
      this.vel.copy(this.dash);
      this.pos.addScaledVector(this.vel, dt);
      pushOut(zones, this.pos, 0.4);
      ctx.world.resolve(this.pos, this.radius);
      if (!this.hitDone && dist < 1.0 && !player.rolling) { this.hitDone = true; event = 'hitPlayer'; }
      if (this.t > 0.7) { this.state = 'chase'; this.t = 0; this.dashCD = 3 + Math.random() * 2; }
    }
    // body follows the head's trail
    this.trail.unshift({ x: this.pos.x, z: this.pos.z });
    if (this.trail.length > 120) this.trail.pop();
    let acc = 0, ti = 0;
    const gap = 0.48;
    for (let i = 0; i < this.segs.length; i++) {
      const want = gap * (i + 1);
      while (ti < this.trail.length - 1 && acc < want) { acc += Math.hypot(this.trail[ti + 1].x - this.trail[ti].x, this.trail[ti + 1].z - this.trail[ti].z); ti++; }
      const p = this.trail[Math.min(ti, this.trail.length - 1)];
      const s = this.segs[i];
      const prev = i === 0 ? this.pos : this.segs[i - 1].position;
      s.position.set(p.x, Math.abs(Math.sin(this.time * 12 + i)) * 0.03, p.z);
      s.rotation.y = Math.atan2(prev.x - s.position.x, prev.z - s.position.z);
      s.children.slice(1).forEach((l, j) => { l.rotation.y = Math.sin(this.time * 18 + i + j) * 0.4; });
    }
    this.flashUpdate(dt);
    return event;
  }
}

// 불가사리: an iron-eating beast. Goes for your buildings first and heals by eating them.
export class Bulgasari extends Beast {
  constructor(scene, x, z, diff) {
    super(scene, 'bulgasari', x, z, diff);
    const iron = this.M(0x4a4e58), dark = this.M(0x2a2c33), spike = this.M(0x9aa2b0);
    this.body = new THREE.Group(); this.root.add(this.body);
    this.box(1.1, 0.8, 1.4, iron, 0, 0.85, 0, this.body);
    this.box(0.8, 0.7, 0.7, iron, 0, 1.0, 0.85, this.body);
    this.box(0.6, 0.3, 0.3, dark, 0, 0.8, 1.25, this.body);
    for (const s of [-1, 1]) {
      this.box(0.14, 0.08, 0.04, this.M(0xffd23a), s * 0.2, 1.16, 1.21, this.body);
      this.box(0.18, 0.22, 0.18, dark, s * 0.32, 1.42, 0.85, this.body); // ears
    }
    for (let i = 0; i < 5; i++) { const sp = this.box(0.16, 0.36, 0.16, spike, 0, 1.4, 0.5 - i * 0.3, this.body); sp.rotation.x = -0.3; }
    this.legs = [];
    for (const [lx, lz] of [[-0.42, 0.45], [0.42, 0.45], [-0.42, -0.45], [0.42, -0.45]]) {
      const g = new THREE.Group(); g.position.set(lx, 0.55, lz); this.body.add(g);
      this.box(0.32, 0.55, 0.32, dark, 0, -0.27, 0, g);
      this.legs.push(g);
    }
  }
  update(dt, ctx) {
    this.time += dt; this.t += dt;
    if (this.lifecycle(dt, ctx.effects, 0x9aa2b0)) return null;
    const { player, zones, structs } = ctx;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    let event = null, goal = null;
    // nearest building to eat
    let food = null, fd = 40;
    for (const st of structs || []) { const d = Math.hypot(st.x - this.pos.x, st.z - this.pos.z); if (d < fd) { fd = d; food = st; } }
    if (this.state === 'chase') {
      if (dist < 2.2 && !player.dead) { this.state = 'windup'; this.t = 0; this.target = null; event = 'windup'; }
      else if (food) {
        goal = food;
        if (fd < food.colR + this.radius + 0.8) { this.state = 'windup'; this.t = 0; this.target = food; event = 'windup'; }
      } else {
        const safe = zoneAt(zones, player.pos);
        goal = safe ? this.edgeGoal(safe, player) : player.pos;
      }
    } else if (this.state === 'windup') {
      const aim = this.target || player.pos;
      this.facing += angDiff(this.facing, Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z)) * Math.min(1, dt * 4);
      this.body.rotation.x = -0.2 * Math.min(1, this.t / 0.9);
      if (this.t > 0.9) {
        this.state = 'recover'; this.t = 0; this.body.rotation.x = 0.15;
        if (this.target) { event = 'hitStruct'; this.hitTarget = this.target; this.hp = Math.min(this.maxHp, this.hp + 12); this.dmgStruct = 40; }
        else if (dist < 2.6) event = 'hitPlayer';
        else event = 'stomp';
      }
    } else if (this.state === 'recover') {
      this.body.rotation.x *= 0.9;
      if (this.t > 0.8) { this.state = 'chase'; this.t = 0; }
    }
    // the light doesn't scare it off a meal: it only respects the campfire itself
    this.move(dt, goal, this.T.speed, ctx, true);
    pushOut(zones.slice(0, 1), this.pos, 0.6);
    const sp = this.vel.length();
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.time * 7 + (i % 2 ? Math.PI : 0)) * 0.5 * Math.min(1, sp / 1.5); });
    this.flashUpdate(dt);
    return event;
  }
}

// 어둑시니: a shadow that grows the closer it gets. Light (fire, lanterns, torch) melts it.
export class Shadow extends Beast {
  constructor(scene, x, z, diff) {
    super(scene, 'shadow', x, z, diff);
    const mat = new THREE.MeshBasicMaterial({ color: 0x07060c, transparent: true, opacity: 0.85, depthWrite: false });
    this.mat = mat;
    this.box(0.8, 1.5, 0.5, mat, 0, 0.9, 0);
    this.box(0.6, 0.6, 0.5, mat, 0, 1.9, 0);
    for (const s of [-1, 1]) this.box(0.26, 1.2, 0.26, mat, s * 0.55, 1.0, 0).rotation.z = s * 0.25;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.3), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.set(0, 1.95, 0.27);
    this.root.add(glow);
    this.size = 0.6;
    this.touchT = 0;
  }
  hit(dmg, fromX, fromZ, kb) { return super.hit(Math.ceil(dmg * 0.5), fromX, fromZ, kb * 0.3); }
  update(dt, ctx) {
    this.time += dt; this.t += dt;
    if (this.state === 'spawn') { this.state = 'chase'; }
    if (this.state === 'dying') {
      this.mat.opacity = Math.max(0, 0.85 - this.t * 2.5);
      this.root.scale.setScalar(this.size * (1 + this.t));
      if (this.t > 0.4) { this.state = 'gone'; this.dispose(); }
      return null;
    }
    const { player, zones } = ctx;
    const dist = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    // light melts it
    if (zoneAt(zones, this.pos, -0.5) || ctx.darkness < 0.4) { this.size -= dt * 1.5; if (this.size < 0.3) { this.banish(); return 'melt'; } }
    else this.size += ((Math.max(0.6, Math.min(2.6, 1 + (9 - dist) / 3))) - this.size) * Math.min(1, dt * 1.2);
    this.root.scale.setScalar(this.size);
    this.root.position.y = Math.sin(this.time * 2) * 0.1;
    const safe = zoneAt(zones, player.pos);
    const goal = safe ? this.edgeGoal(safe, player) : player.pos;
    this.move(dt, goal, this.T.speed * (1 + this.size * 0.2), ctx, true);
    this.mat.opacity = 0.55 + this.size * 0.12;
    let event = null;
    this.touchT -= dt;
    if (!safe && dist < 0.6 + this.size * 0.45 && this.touchT <= 0 && !player.dead) { this.touchT = 1; event = 'hitPlayer'; }
    this.damage = Math.round(this.T.damage * (0.6 + this.size * 0.4));
    return event;
  }
}

export function makeBeast(scene, type, x, z, diff) {
  if (type === 'fox') return new Fox(scene, x, z, diff);
  if (type === 'centipede') return new Centipede(scene, x, z, diff);
  if (type === 'bulgasari') return new Bulgasari(scene, x, z, diff);
  return new Shadow(scene, x, z, diff);
}
