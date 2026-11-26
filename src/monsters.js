import * as THREE from 'three';
import { rules } from './config.js';
import { buildCharacter, animateCharacter, flash } from './character.js';

const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const SKINS = [0x5b8cff, 0xe0524f, 0x6fcf7a];

class Dokkaebi {
  constructor(scene, x, z, variant) {
    this.rig = buildCharacter({ kind: 'dokkaebi', skin: SKINS[variant % 3], top: SKINS[variant % 3], pants: 0xf2b632, hair: 0x1d1b2e });
    this.rig.root.scale.setScalar(0.01);
    scene.add(this.rig.root);
    this.scene = scene;
    this.pos = this.rig.root.position;
    this.pos.set(x, 0, z);
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.hp = rules.monsterHp;
    this.state = 'spawn';
    this.t = 0;
    this.time = Math.random() * 10;
    this.facing = Math.atan2(-x, -z);
    this.radius = 0.5;
    this.speedMul = 0.9 + Math.random() * 0.25;
  }

  get alive() { return this.state !== 'dying' && this.state !== 'gone'; }

  hit(fromX, fromZ) {
    if (!this.alive) return false;
    this.hp -= 1;
    flash(this.rig, 1);
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
    this.knock.set((dx / d) * 9, 0, (dz / d) * 9);
    if (this.state === 'windup') { this.state = 'recover'; this.t = 0; } // interrupt
    if (this.hp <= 0) { this.state = 'dying'; this.t = 0; return true; }
    return false;
  }

  banish() { if (this.alive) { this.state = 'dying'; this.t = 0; } }

  update(dt, ctx) {
    this.time += dt;
    this.t += dt;
    const { player, world, fireR, effects } = ctx;
    const before = this.pos.clone();
    let windup = 0, speedRatio = 0;
    let event = null;

    if (this.state === 'spawn') {
      const s = Math.min(1, this.t / 0.5);
      this.rig.root.scale.setScalar(s * (1.15 - 0.15 * s) * 1.0);
      if (this.t > 0.5) { this.rig.root.scale.setScalar(1); this.state = 'chase'; this.t = 0; }
    } else if (this.state === 'dying') {
      const s = Math.max(0, 1 - this.t / 0.35);
      this.rig.root.scale.setScalar(s);
      this.rig.root.rotation.y += dt * 20;
      if (this.t > 0.35) {
        effects.spawn(this.pos.x, 1, this.pos.z, 0x6fb8ff, { n: 14, speed: 2.5, up: 4, life: 0.8, size: 0.2, grav: -2 });
        this.state = 'gone';
        this.scene.remove(this.rig.root);
      }
      return null;
    } else {
      const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      const pf = Math.hypot(player.pos.x - world.fire.x, player.pos.z - world.fire.z);
      const playerSafe = fireR > 0 && pf < fireR - 0.2;
      let goal = null;

      if (this.state === 'chase') {
        if (playerSafe) {
          // wait just outside the light, on the player's side
          const a = Math.atan2(player.pos.x - world.fire.x, player.pos.z - world.fire.z);
          const jitter = Math.sin(this.time * 0.7 + this.speedMul * 9) * 0.5;
          goal = new THREE.Vector3(Math.sin(a + jitter) * (fireR + 1.1), 0, Math.cos(a + jitter) * (fireR + 1.1));
        } else {
          goal = player.pos;
          if (dist < 1.45 && !player.dead) { this.state = 'windup'; this.t = 0; }
        }
      } else if (this.state === 'windup') {
        windup = this.t / rules.monsterWindup;
        this.facing += angDiff(this.facing, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
        if (this.t >= rules.monsterWindup) {
          this.state = 'recover'; this.t = 0;
          this.lunge = 1;
          const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
          const ahead = (dx * fx + dz * fz) / (dist || 1);
          if (dist < 1.9 && ahead > 0.3) event = 'hitPlayer';
          effects.spawn(this.pos.x + fx * 1.1, 0.1, this.pos.z + fz * 1.1, 0xd9c7a0, { n: 6, speed: 2, up: 2, life: 0.4, size: 0.1 });
        }
      } else if (this.state === 'recover') {
        windup = Math.max(0, 1 - this.t / 0.12) * 0.6;
        if (this.t > 0.7) { this.state = 'chase'; this.t = 0; }
      }

      if (goal) {
        const gx = goal.x - this.pos.x, gz = goal.z - this.pos.z, gd = Math.hypot(gx, gz);
        const sp = rules.monsterSpeed * this.speedMul * (gd < 0.4 ? 0 : 1);
        this.vel.lerp(new THREE.Vector3((gx / (gd || 1)) * sp, 0, (gz / (gd || 1)) * sp), Math.min(1, dt * 6));
        if (gd > 0.3) this.facing += angDiff(this.facing, Math.atan2(gx, gz)) * Math.min(1, dt * 8);
        else this.facing += angDiff(this.facing, Math.atan2(dx, dz)) * Math.min(1, dt * 4);
      } else {
        this.vel.multiplyScalar(Math.pow(0.001, dt));
      }

      this.pos.addScaledVector(this.vel, dt);
      this.pos.addScaledVector(this.knock, dt);
      this.knock.multiplyScalar(Math.pow(0.003, dt));

      // the firelight burns: push out of the safe circle
      if (fireR > 0) {
        const fx = this.pos.x - world.fire.x, fz = this.pos.z - world.fire.z, fd = Math.hypot(fx, fz) || 1;
        const edge = fireR + 0.4;
        if (fd < edge) { this.pos.x = (fx / fd) * edge; this.pos.z = (fz / fd) * edge; }
      }
      world.resolve(this.pos, this.radius);
      speedRatio = Math.min(1, Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / dt / 4);
    }

    this.rig.root.rotation.y = this.facing;
    animateCharacter(this.rig, {
      dist: Math.hypot(this.pos.x - before.x, this.pos.z - before.z),
      speedRatio, attack: -1, roll: -1, windup, time: this.time,
    }, dt);
    // taunting hop while waiting at the edge of the light
    if (this.state === 'chase' && speedRatio < 0.1) {
      this.rig.body.position.y += Math.abs(Math.sin(this.time * 6)) * 0.12;
    }
    return event;
  }
}

export class Monsters {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.list = [];
    this.spawnTimer = 2;
    this.count = 0;
  }

  reset() {
    for (const m of this.list) this.scene.remove(m.rig.root);
    this.list = [];
    this.spawnTimer = 2;
    this.count = 0;
  }

  get alive() { return this.list.filter((m) => m.alive); }

  update(dt, ctx, nightProgress) {
    if (nightProgress >= 0) {
      const interval = rules.spawnStart + (rules.spawnEnd - rules.spawnStart) * nightProgress;
      const cap = Math.round(rules.capStart + (rules.capEnd - rules.capStart) * nightProgress);
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.alive.length < cap) {
        this.spawnTimer = interval;
        this.spawn(ctx);
      }
    }
    const events = [];
    for (const m of this.list) {
      const e = m.update(dt, ctx);
      if (e) events.push({ type: e, m });
    }
    // keep monsters from stacking
    const al = this.alive;
    for (let i = 0; i < al.length; i++) for (let j = i + 1; j < al.length; j++) {
      const a = al[i].pos, b = al[j].pos;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = 1.0;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2;
        a.x -= (dx / d) * push; a.z -= (dz / d) * push;
        b.x += (dx / d) * push; b.z += (dz / d) * push;
      }
    }
    this.list = this.list.filter((m) => m.state !== 'gone');
    return events;
  }

  spawn(ctx) {
    // appear in the dark, away from the player
    const { player } = ctx;
    let x = 0, z = 0;
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 14 + Math.random() * 11;
      x = player.pos.x + Math.cos(a) * r; z = player.pos.z + Math.sin(a) * r;
      const d = Math.hypot(x, z);
      if (d > 27) { x *= 26 / d; z *= 26 / d; }
      if (Math.hypot(x - player.pos.x, z - player.pos.z) > 11 && Math.hypot(x, z) > ctx.fireR + 2) break;
    }
    const m = new Dokkaebi(this.scene, x, z, this.count++);
    this.effects.spawn(x, 0.6, z, 0x6fb8ff, { n: 10, speed: 1.5, up: 3, life: 0.7, size: 0.18, grav: -1 });
    this.list.push(m);
  }

  banishAll() { for (const m of this.list) m.banish(); }
}
