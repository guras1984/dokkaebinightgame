import * as THREE from 'three';
import { tune, rules } from './config.js';
import { buildCharacter, animateCharacter, flash } from './character.js';
import { emptyInventory } from './items.js';
import { WEAPONS } from './weapons.js';

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
    this.weapons = ['axe'];
    this.sandals = false;
    this.rod = false;
    this.fishT = 0;
    this.setWeapon('axe');
    this.setAxe(0);
    this.setArmor(false);
    this.torchT = 0;
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
  setAxe(level) {
    // 0 stone, 1 iron, 2 steel (blue-white, bigger)
    level = level === true ? 1 : level === false ? 0 : level;
    this.axeLevel = level;
    const [, blade, edge] = this.rig.weapon.children;
    blade.material.color.setHex([0x8b8478, 0xc7cdd6, 0x9fc4ff][level]);
    edge.material.color.setHex([0xa69f92, 0xf6faff, 0xffffff][level]);
    const k = [1, 1.3, 1.55][level];
    blade.scale.set(1, k, k); edge.scale.set(1, k, 1);
  }
  get ironAxe() { return this.axeLevel >= 1; }

  /** show the right weapon in hand (meshes are built once, then toggled) */
  setWeapon(id) {
    this.weapon = id;
    const W = this.rig.weapon;
    if (!this.wMeshes) {
      const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
      const box = (w, h, d, c, x, y, z, g) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(c)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
      const mk = () => { const g = new THREE.Group(); W.add(g); return g; };
      this.axeParts = W.children.slice(0, 3);
      const spear = mk();
      box(0.06, 0.06, 1.7, 0x8a5a2b, 0, 0, 0.6, spear);
      box(0.1, 0.05, 0.3, 0xd6dde6, 0, 0, 1.55, spear);
      box(0.14, 0.06, 0.06, 0xc9413a, 0, 0, 1.35, spear);
      const sword = mk();
      box(0.08, 0.08, 0.22, 0x3a2a22, 0, 0, 0.05, sword);
      box(0.24, 0.06, 0.06, 0xd9b04a, 0, 0, 0.18, sword);
      box(0.05, 0.12, 0.85, 0xe6ecf2, 0, 0, 0.62, sword);
      const mace = mk();
      box(0.08, 0.08, 0.8, 0x5a3a22, 0, 0, 0.35, mace);
      box(0.34, 0.34, 0.34, 0x6c7480, 0, 0, 0.85, mace);
      for (const [x, y] of [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) box(0.1, 0.1, 0.1, 0xb0b8c4, x, y, 0.85, mace);
      const bow = mk();
      for (let i = -3; i <= 3; i++) box(0.06, 0.18, 0.06, 0x8a5a2b, 0, i * 0.15, 0.2 - Math.abs(i) * Math.abs(i) * 0.025, bow);
      box(0.015, 1.05, 0.015, 0xf2ede4, 0, 0, 0.0, bow);
      bow.rotation.x = -Math.PI / 2;
      const club = mk();
      box(0.12, 0.12, 0.55, 0x8a5a2b, 0, 0, 0.28, club);
      box(0.3, 0.3, 0.55, 0xf1c24b, 0, 0, 0.8, club);
      for (let i = 0; i < 3; i++) box(0.36, 0.06, 0.06, 0xfff0a0, 0, 0, 0.64 + i * 0.15, club);
      this.wMeshes = { spear, sword, mace, bow, club };
    }
    this.axeParts.forEach((m) => { m.visible = id === 'axe'; });
    for (const [k, g] of Object.entries(this.wMeshes)) g.visible = k === id;
  }

  /** leather armour: shoulder pads + belt, takes less damage */
  setArmor(on) {
    this.armor = on;
    if (!this.armorParts) {
      const m = new THREE.MeshLambertMaterial({ color: 0x8a5a2b, flatShading: true });
      const t = this.rig.torso;
      this.armorParts = [
        new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.5), m),
        new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.5), m),
        new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.12, 0.48), m),
        new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.06), m),
      ];
      const [l, r, belt, plate] = this.armorParts;
      l.position.set(-0.36, 0.33, 0); r.position.set(0.36, 0.33, 0);
      belt.position.set(0, -0.3, 0); plate.position.set(0, 0.02, 0.24);
      this.armorParts.forEach((p) => { p.castShadow = true; t.add(p); });
    }
    this.armorParts.forEach((p) => { p.visible = on; });
  }

  get wood() { return this.inv.wood; }
  set wood(v) { this.inv.wood = v; }

  get rolling() { return this.rollT >= 0; }
  get attacking() { return this.attackT >= 0; }

  startAttack(aimAngle) {
    if (this.attacking || this.rolling || this.dead) return false;
    this.attackT = 0;
    this.atkTime = this.weapon === 'axe' ? tune.attackTime : WEAPONS[this.weapon].time;
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
    if (this.armor) amount = Math.round(amount * 0.65);
    this.lastDamage = amount;
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
      const target = new THREE.Vector3(wish.x, 0, wish.z).multiplyScalar(tune.moveSpeed * slow * (this.sandals ? 1.15 : 1));
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
      this.attackT += dt / (this.atkTime || tune.attackTime);
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
