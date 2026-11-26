import * as THREE from 'three';
import { tune, rules } from './config.js';
import { buildCharacter, animateCharacter, flash } from './character.js';
import { emptyInventory } from './items.js';

const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class Player {
  constructor(scene) {
    this.rig = buildCharacter({ kind: 'hero', skin: 0xffd9b0, top: 0xf6f1e4, pants: 0x34406e, hair: 0x2a1f1a });
    scene.add(this.rig.root);
    this.pos = this.rig.root.position;
    this.vel = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.pos.set(0, 0, 2.4);
    this.vel.set(0, 0, 0);
    this.facing = Math.PI / 4;  // face the camera at the start
    this.hp = rules.playerHp;
    this.inv = emptyInventory();
    this.water = 100;
    this.food = 100;
    this.setAxe(false);
    this.attackT = -1;          // 0..1 while swinging
    this.attackHit = false;
    this.rollT = -1;
    this.rollCool = 0;
    this.rollChain = 0;         // how many rolls in the current chain
    this.rollQueued = false;    // roll pressed again mid-roll → chain into another
    this.rollDir = new THREE.Vector3();
    this.hurtT = 0;             // time since last hurt
    this.invuln = 0;
    this.knock = new THREE.Vector3();
    this.dead = false;
    this.time = 0;
    this.stats = { trees: 0, kills: 0, wood: 0, fed: 0, chests: 0, built: 0, rocks: 0 };
    this.rig.root.rotation.y = this.facing;
    this.rig.root.visible = true;
  }

  /** stone axe at the start, shiny bigger iron axe once crafted */
  setAxe(iron) {
    this.ironAxe = iron;
    const [, blade, edge] = this.rig.weapon.children;
    blade.material.color.setHex(iron ? 0xc7cdd6 : 0x8b8478);
    edge.material.color.setHex(iron ? 0xf6faff : 0xa69f92);
    const k = iron ? 1.3 : 1;
    blade.scale.set(1, k, k); edge.scale.set(1, k, 1);
  }

  get wood() { return this.inv.wood; }
  set wood(v) { this.inv.wood = v; }

  get rolling() { return this.rollT >= 0; }
  get attacking() { return this.attackT >= 0; }

  startAttack(aimAngle) {
    if (this.attacking || this.rolling || this.dead) return false;
    this.attackT = 0;
    this.attackHit = false;
    if (aimAngle !== null && aimAngle !== undefined) this.facing = aimAngle;
    return true;
  }

  startRoll(dir) {
    if (this.dead) return false;
    if (this.rolling) {
      // buffer the press; the next roll starts the moment this one lands
      if (this.rollT > 0.25 && this.rollChain < tune.rollChain) this.rollQueued = true;
      return false;
    }
    if (this.rollCool > 0) return false;
    this.rollChain = 1;
    this.beginRoll(dir);
    return true;
  }

  beginRoll(dir) {
    this.attackT = -1;
    this.rollT = 0;
    this.rollQueued = false;
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.rollDir.copy(dir).normalize();
    this.facing = Math.atan2(this.rollDir.x, this.rollDir.z);
    return true;
  }

  hurt(amount, fromX, fromZ) {
    if (this.invuln > 0 || this.rolling || this.dead) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.hurtT = 0;
    this.invuln = rules.hurtGrace;
    flash(this.rig, 1);
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
    this.knock.set((dx / d) * 7, 0, (dz / d) * 7);
    this.attackT = -1;
    if (this.hp <= 0) this.dead = true;
    return true;
  }

  /**
   * @param wish world-space move vector (length 0..1)
   * returns 'strike' on the frame the axe lands
   */
  update(dt, wish, world) {
    this.time += dt;
    this.hurtT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.rollCool = Math.max(0, this.rollCool - dt);
    let event = null;
    const before = this.pos.clone();

    if (this.dead) {
      this.vel.multiplyScalar(0.85);
      this.rig.spin.rotation.z = Math.min(Math.PI / 2, this.rig.spin.rotation.z + dt * 4);
      return null;
    }

    if (this.rolling) {
      this.rollT += dt / tune.rollTime;
      const s = tune.rollSpeed * (1 - this.rollT * 0.55);
      this.vel.set(this.rollDir.x * s, 0, this.rollDir.z * s);
      if (this.rollT >= 1) {
        if (this.rollQueued) {
          // chain: roll again toward wherever the stick points now
          this.rollChain += 1;
          this.beginRoll(wish.clone());
        } else {
          this.rollT = -1; this.rollChain = 0;
          this.rollCool = tune.rollCooldown; this.vel.multiplyScalar(0.45);
        }
      }
    } else {
      // slower while swinging so the chop feels planted
      const slow = this.attacking ? 0.35 : 1;
      const target = new THREE.Vector3(wish.x, 0, wish.z).multiplyScalar(tune.moveSpeed * slow);
      const rate = target.lengthSq() > this.vel.lengthSq() ? tune.accel : tune.decel;
      const diff = target.sub(this.vel);
      const step = rate * dt;
      if (diff.length() <= step) this.vel.add(diff); else this.vel.addScaledVector(diff.normalize(), step);
      if (!this.attacking && wish.lengthSq() > 0.0004) {
        const want = Math.atan2(wish.x, wish.z);
        this.facing += angDiff(this.facing, want) * Math.min(1, dt * tune.turnSpeed);
      }
    }

    if (this.attacking) {
      const prev = this.attackT;
      this.attackT += dt / tune.attackTime;
      if (prev < 0.45 && this.attackT >= 0.45 && !this.attackHit) { this.attackHit = true; event = 'strike'; }
      if (this.attackT >= 1) this.attackT = -1;
    }

    // knockback decays
    this.pos.addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.pow(0.002, dt));

    this.pos.addScaledVector(this.vel, dt);
    world.resolve(this.pos, rules.playerRadius);
    this.rig.root.rotation.y = this.facing;

    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    animateCharacter(this.rig, {
      dist: this.rolling ? 0 : moved,
      speedRatio: this.rolling ? 0 : Math.min(1, Math.hypot(this.vel.x, this.vel.z) / tune.moveSpeed),
      attack: this.attackT,
      roll: this.rollT,
      windup: 0,
      time: this.time,
    }, dt);
    // blink while invulnerable after a hit
    this.rig.root.visible = this.invuln <= 0 || Math.floor(this.invuln * 20) % 2 === 0;
    return event;
  }
}
