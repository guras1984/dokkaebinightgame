import * as THREE from 'three';
import { rules, difficulty, MONSTER_TYPES } from './config.js';
import { buildCharacter, animateCharacter, flash, setMonsterEyes } from './character.js';

const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const SKINS = [0x3d5a9a, 0x8a2a2a, 0x3f6b3a]; // ash blue, dark red, moss green

/** the safe circle containing p, if any */
function zoneAt(zones, p, inset = 0.2) {
  for (const z of zones) if (Math.hypot(p.x - z.x, p.z - z.z) < z.r - inset) return z;
  return null;
}
/** keep p outside every safe circle */
function pushOut(zones, p, pad) {
  for (const z of zones) {
    const dx = p.x - z.x, dz = p.z - z.z, d = Math.hypot(dx, dz) || 1, edge = z.r + pad;
    if (d < edge) { p.x = z.x + (dx / d) * edge; p.z = z.z + (dz / d) * edge; }
  }
}

const ringGeo = new THREE.RingGeometry(0.7, 1, 32);

class Dokkaebi {
  constructor(scene, x, z, variant, type, diff) {
    const T = MONSTER_TYPES[type];
    this.type = type;
    this.T = T;
    const boss = type === 'boss';
    const skin = boss ? 0x7a1414 : type === 'elite' ? 0x4a2a6a : SKINS[variant % 3];
    this.rig = buildCharacter({ kind: 'dokkaebi', skin, top: boss ? 0x2a1f3d : skin, pants: type === 'elite' ? 0xe0524f : boss ? 0xf1c24b : 0xf2b632, hair: boss ? 0xf1c24b : 0x1d1b2e });
    this.rig.root.scale.setScalar(0.01);
    scene.add(this.rig.root);
    this.scene = scene;
    this.pos = this.rig.root.position;
    this.pos.set(x, 0, z);
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.hp = boss ? Math.round(T.hp + diff.n * 14) : Math.round(T.hp * diff.hpMul);
    this.slamT = 0;
    this.summonT = 8;
    this.maxHp = this.hp;
    this.damage = T.damage;
    this.state = 'spawn';
    this.t = 0;
    this.time = Math.random() * 10;
    this.facing = Math.atan2(-x, -z);
    this.radius = T.radius;
    this.speedMul = (0.9 + Math.random() * 0.25) * diff.speedMul;
    // red warning circle on the ground before the club comes down
    this.warn = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0, depthWrite: false }));
    this.warn.rotation.x = -Math.PI / 2;
    this.warn.position.y = 0.04;
    scene.add(this.warn);
  }

  get alive() { return this.state !== 'dying' && this.state !== 'gone'; }

  hit(dmg, fromX, fromZ, kbMul = 1) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.hurtShow = 3;
    flash(this.rig, 1);
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
    const kb = (this.type === 'boss' ? 0.8 : this.type === 'elite' ? 4 : 9) * kbMul;
    this.knock.set((dx / d) * kb, 0, (dz / d) * kb);
    // big ones shrug off the interrupt unless the hit is strong
    if (this.state === 'windup' && this.type !== 'boss' && (this.type !== 'elite' || dmg >= 25)) { this.state = 'recover'; this.t = 0; }
    if (this.hp <= 0) { this.state = 'dying'; this.t = 0; return true; }
    return false;
  }

  banish(fromX, fromZ) {
    if (!this.alive) return;
    if (fromX !== undefined) {
      const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
      this.knock.set((dx / d) * 14, 0, (dz / d) * 14);
    }
    this.state = 'dying'; this.t = 0;
  }

  dispose() { this.scene.remove(this.rig.root); this.scene.remove(this.warn); if (this.bar) this.scene.remove(this.bar); }

  update(dt, ctx) {
    this.time += dt;
    this.t += dt;
    const { player, world, zones, effects } = ctx;
    const T = this.T;
    const before = this.pos.clone();
    let windup = 0, speedRatio = 0;
    let event = null;
    this.warn.material.opacity = 0;

    if (this.state === 'spawn') {
      const s = Math.min(1, this.t / 0.5);
      this.rig.root.scale.setScalar(s * (1.15 - 0.15 * s) * T.scale);
      if (this.t > 0.5) { this.rig.root.scale.setScalar(T.scale); this.state = 'chase'; this.t = 0; }
    } else if (this.state === 'dying') {
      const s = Math.max(0, 1 - this.t / 0.35);
      this.rig.root.scale.setScalar(s * T.scale);
      this.rig.root.rotation.y += dt * 20;
      this.pos.addScaledVector(this.knock, dt);
      this.knock.multiplyScalar(Math.pow(0.003, dt));
      if (this.t > 0.35) {
        effects.spawn(this.pos.x, 1, this.pos.z, 0x6fb8ff, { n: this.type === 'boss' ? 60 : this.type === 'elite' ? 24 : 14, speed: 2.5, up: 4, life: 0.8, size: 0.2, grav: -2 });
        this.state = 'gone';
        this.dispose();
      }
      return null;
    } else {
      const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      const safe = zoneAt(zones, player.pos);
      let goal = null;

      const leashed = this.home && Math.hypot(player.pos.x - this.home.x, player.pos.z - this.home.z) > this.home.r;
      this.breakCD = Math.max(0, (this.breakCD || 0) - dt);
      if (this.state === 'chase' && !leashed && dist > T.reach && this.breakCD <= 0 && ctx.structs) {
        // a building in the way (or the one it is waiting next to) gets smashed
        for (const st of ctx.structs) {
          const reachS = (st.zoneR ? st.zoneR + 0.6 : st.colR + 0.9) + this.radius;
          if (Math.hypot(st.x - this.pos.x, st.z - this.pos.z) < reachS) {
            this.state = 'windup'; this.t = 0; this.targetStruct = st; event = 'windup';
            this.facing = Math.atan2(st.x - this.pos.x, st.z - this.pos.z);
            break;
          }
        }
      }
      if (this.state === 'chase' && this.horde) {
        // 백귀야행: march on the campfire; fight the player only if they stand in the way
        const fdx = ctx.world.fire.x - this.pos.x, fdz = ctx.world.fire.z - this.pos.z, fd = Math.hypot(fdx, fdz);
        if (dist < 3.5 && !player.dead) {
          goal = player.pos;
          if (dist < T.reach) { this.state = 'windup'; this.t = 0; event = 'windup'; }
        } else {
          goal = ctx.world.fire;
          if (fd < 1.9 + this.radius) { this.state = 'windup'; this.t = 0; this.hitFire = true; event = 'windup'; }
        }
      } else if (this.state === 'chase') {
        if (leashed) {
          // lair guards don't chase you across the island
          goal = new THREE.Vector3(this.home.x + Math.sin(this.time * 0.5 + this.speedMul * 7) * 2, 0, this.home.z + Math.cos(this.time * 0.5 + this.speedMul * 7) * 2);
        } else if (safe) {
          // wait just outside the light, on the player's side
          const a = Math.atan2(player.pos.x - safe.x, player.pos.z - safe.z);
          const jitter = Math.sin(this.time * 0.7 + this.speedMul * 9) * 0.5;
          const rr = safe.r + 1.1 + this.radius;
          goal = new THREE.Vector3(safe.x + Math.sin(a + jitter) * rr, 0, safe.z + Math.cos(a + jitter) * rr);
          // the chief pounds the ground and shakes the fire while you hide
          if (this.type === 'boss' && (this.slamT += dt) > rules.bossSlam) { this.slamT = 0; this.state = 'windup'; this.t = 0; this.slamming = true; event = 'windup'; }
        } else {
          goal = player.pos;
          if (dist < T.reach && !player.dead) { this.state = 'windup'; this.t = 0; event = 'windup'; }
        }
      } else if (this.state === 'windup') {
        windup = this.t / T.windup;
        const ts = this.targetStruct;
        const aimA = ts ? Math.atan2(ts.x - this.pos.x, ts.z - this.pos.z) : Math.atan2(dx, dz);
        this.facing += angDiff(this.facing, aimA) * Math.min(1, dt * (this.type === 'elite' ? 3 : 6));
        const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
        const wr = T.hitReach * 0.55;
        this.warn.position.x = this.pos.x + fx * wr;
        this.warn.position.z = this.pos.z + fz * wr;
        this.warn.scale.setScalar(wr * (0.6 + windup * 0.45));
        this.warn.material.opacity = 0.25 + windup * 0.5;
        if (this.t >= T.windup) {
          this.state = 'recover'; this.t = 0;
          const ahead = (dx * fx + dz * fz) / (dist || 1);
          if (this.hitFire) { event = 'hitFire'; this.hitFire = false; }
          else if (dist < T.hitReach && (ahead > 0.3 || this.type === 'boss')) event = 'hitPlayer';
          else if (this.targetStruct) { event = 'hitStruct'; this.hitTarget = this.targetStruct; this.breakCD = 0.6; }
          this.targetStruct = null;
          if (this.type === 'boss') { event = event || (this.slamming ? 'fireSlam' : 'stomp'); this.slamming = false; }
          effects.spawn(this.pos.x + fx * 1.1 * T.scale, 0.1, this.pos.z + fz * 1.1 * T.scale, 0xd9c7a0, { n: this.type === 'elite' ? 14 : 6, speed: 2.5, up: 2, life: 0.4, size: 0.12 });
          if (this.type === 'elite') event = event || 'stomp';
        }
        if (this.type === 'boss') {
          // the boss's warning circle sits around itself: area slam
          this.warn.position.x = this.pos.x; this.warn.position.z = this.pos.z;
          this.warn.scale.setScalar(T.hitReach * (0.7 + windup * 0.3));
        }
      } else if (this.state === 'recover') {
        windup = Math.max(0, 1 - this.t / 0.12) * 0.6;
        if (this.t > (this.type === 'elite' ? 0.9 : 0.7)) { this.state = 'chase'; this.t = 0; }
      }

      // the chief calls helpers now and then
      if (this.type === 'boss' && this.state === 'chase' && (this.summonT -= dt) <= 0) { this.summonT = 18; event = event || 'summon'; }

      if (goal) {
        const gx = goal.x - this.pos.x, gz = goal.z - this.pos.z, gd = Math.hypot(gx, gz);
        this.slowT = Math.max(0, (this.slowT || 0) - dt);
        const inSlow = ctx.slowZones && ctx.slowZones.some((z) => Math.hypot(this.pos.x - z.x, this.pos.z - z.z) < z.r);
        const sp = T.speed * this.speedMul * (gd < 0.4 ? 0 : 1) * (inSlow || this.slowT > 0 ? 0.55 : 1);
        this.vel.lerp(new THREE.Vector3((gx / (gd || 1)) * sp, 0, (gz / (gd || 1)) * sp), Math.min(1, dt * 6));
        if (gd > 0.3) this.facing += angDiff(this.facing, Math.atan2(gx, gz)) * Math.min(1, dt * 8);
        else this.facing += angDiff(this.facing, Math.atan2(dx, dz)) * Math.min(1, dt * 4);
      } else {
        this.vel.multiplyScalar(Math.pow(0.001, dt));
      }

      this.pos.addScaledVector(this.vel, dt);
      this.pos.addScaledVector(this.knock, dt);
      this.knock.multiplyScalar(Math.pow(0.003, dt));

      // the light burns: push out of every safe circle (the 백귀야행 pushes straight through)
      if (!this.horde) pushOut(zones, this.pos, 0.4 + this.radius * 0.5);
      world.resolve(this.pos, this.radius);
      speedRatio = Math.min(1, Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / dt / 4);
    }

    this.rig.root.rotation.y = this.facing;
    setMonsterEyes(this.rig, ctx.darkness ?? 0, this.state === 'windup' ? windup : 0);
    animateCharacter(this.rig, {
      dist: Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / T.scale,
      speedRatio, attack: -1, roll: -1, windup, time: this.time,
    }, dt);
    // taunting hop while waiting at the edge of the light
    if (this.state === 'chase' && speedRatio < 0.1 && this.type !== 'boss') {
      this.rig.body.position.y += Math.abs(Math.sin(this.time * 6)) * 0.12;
    }
    return event;
  }
}

// 도깨비불: a floating ghost-fire that circles, flashes, then dashes into you.
const wispCore = new THREE.IcosahedronGeometry(0.22, 0);
const wispShell = new THREE.IcosahedronGeometry(0.42, 0);
class Wisp {
  constructor(scene, x, z, diff) {
    this.type = 'wisp';
    this.T = MONSTER_TYPES.wisp;
    this.scene = scene;
    this.root = new THREE.Group();
    this.core = new THREE.Mesh(wispCore, new THREE.MeshBasicMaterial({ color: 0xeaf8ff }));
    this.shell = new THREE.Mesh(wispShell, new THREE.MeshBasicMaterial({ color: 0x4fa8ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.root.add(this.core, this.shell);
    this.root.scale.setScalar(0.01);
    scene.add(this.root);
    this.pos = this.root.position;
    this.pos.set(x, 1.1, z);
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
    this.orbitA = Math.random() * Math.PI * 2;
    this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    this.next = 1.6 + Math.random();
    this.dash = new THREE.Vector3();
  }

  get alive() { return this.state !== 'dying' && this.state !== 'gone'; }

  hit(dmg = 999) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.hurtShow = 3;
    if (this.hp > 0) { this.state = 'orbit'; this.t = 0; this.next = 1.2; return false; }
    this.state = 'dying'; this.t = 0;
    return true;
  }

  banish() { if (this.alive) { this.state = 'dying'; this.t = 0; } }

  dispose() { this.scene.remove(this.root); if (this.bar) this.scene.remove(this.bar); }

  update(dt, ctx) {
    this.time += dt;
    this.t += dt;
    const { player, zones, effects } = ctx;
    let event = null;
    const pulse = 1 + Math.sin(this.time * 9) * 0.08;

    if (this.state === 'spawn') {
      this.root.scale.setScalar(Math.min(1, this.t / 0.4) * pulse);
      if (this.t > 0.4) { this.state = 'orbit'; this.t = 0; }
    } else if (this.state === 'dying') {
      this.root.scale.setScalar(Math.max(0, 1 - this.t / 0.2) * 1.6);
      if (this.t > 0.2) {
        effects.spawn(this.pos.x, this.pos.y, this.pos.z, 0x7fc8ff, { n: 12, speed: 3.5, up: 2, life: 0.6, size: 0.16, grav: -1 });
        this.state = 'gone'; this.dispose();
      }
      return null;
    } else {
      const leashed = this.home && Math.hypot(player.pos.x - this.home.x, player.pos.z - this.home.z) > this.home.r;
      const safe = leashed ? this.home : zoneAt(zones, player.pos);
      const cx = safe ? safe.x : player.pos.x, cz = safe ? safe.z : player.pos.z;
      const orbitR = leashed ? 2.5 : safe ? safe.r + 1.4 : 4.6;
      if (this.state === 'orbit') {
        this.orbitA += this.orbitDir * dt * (safe ? 0.35 : 1.1);
        const gx = cx + Math.sin(this.orbitA) * orbitR, gz = cz + Math.cos(this.orbitA) * orbitR;
        this.vel.lerp(new THREE.Vector3(gx - this.pos.x, 0, gz - this.pos.z).multiplyScalar(2.2), Math.min(1, dt * 3));
        this.root.scale.setScalar(pulse);
        if (!safe && this.t > this.next && !player.dead) { this.state = 'aim'; this.t = 0; event = 'wispCharge'; }
      } else if (this.state === 'aim') {
        // tell: shiver and flash white before the dash
        this.vel.multiplyScalar(Math.pow(0.01, dt));
        this.root.scale.setScalar(1.25 + Math.sin(this.time * 50) * 0.12);
        this.shell.material.color.setHex(Math.floor(this.t * 14) % 2 ? 0xffffff : 0x4fa8ff);
        if (this.t > 0.45) {
          this.state = 'dash'; this.t = 0;
          this.dash.set(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z).normalize().multiplyScalar(this.T.speed * 2.3 * this.speedMul);
          this.shell.material.color.setHex(0x4fa8ff);
          event = 'wispDash';
        }
      } else if (this.state === 'dash') {
        this.vel.copy(this.dash);
        if (Math.random() < 0.5) effects.spawn(this.pos.x, this.pos.y, this.pos.z, 0x4fa8ff, { n: 1, speed: 0.3, up: 0.5, life: 0.35, size: 0.18, grav: 0 });
        const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
        if (d < 0.85 && !player.rolling) {
          event = 'hitPlayer';
          this.state = 'dying'; this.t = 0;
        } else if (this.t > 0.6) {
          this.state = 'orbit'; this.t = 0; this.next = 1.4 + Math.random() * 1.6;
          this.orbitA = Math.atan2(this.pos.x - cx, this.pos.z - cz);
        }
      }
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      pushOut(zones, this.pos, 0.5);
      const R = rules.islandRadius;
      const dd = Math.hypot(this.pos.x, this.pos.z);
      if (dd > R) { this.pos.x *= R / dd; this.pos.z *= R / dd; }
    }
    this.pos.y = 1.1 + Math.sin(this.time * 3) * 0.18;
    this.core.rotation.y += dt * 3; this.shell.rotation.x += dt * 2;
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
    this.boss = null;
    for (const m of this.list) m.dispose();
    this.list = [];
    this.spawnTimer = 2;
    this.count = 0;
  }

  get alive() { return this.list.filter((m) => m.alive); }

  update(dt, ctx, nightProgress, night) {
    if (nightProgress >= 0) {
      const d = difficulty(night);
      const interval = (rules.spawnStart + (rules.spawnEnd - rules.spawnStart) * nightProgress) * d.spawnMul;
      const cap = Math.round(d.capStart + (d.capEnd - d.capStart) * nightProgress);
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.alive.length < cap) {
        this.spawnTimer = interval;
        const r = Math.random();
        const m = this.spawn(ctx, d, r < d.elite ? 'elite' : r < d.elite + d.wisp ? 'wisp' : 'dokkaebi');
        if (this.mod) { m.hp = Math.round(m.hp * this.mod.hpMul); m.maxHp = m.hp; m.damage = Math.round(m.damage * this.mod.dmgMul); m.beadMul = this.mod.beadMul; }
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
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = al[i].radius + al[j].radius;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2;
        a.x -= (dx / d) * push; a.z -= (dz / d) * push;
        b.x += (dx / d) * push; b.z += (dz / d) * push;
      }
    }
    for (const m of this.list) m.trapCD = Math.max(0, (m.trapCD || 0) - dt);
    this.list = this.list.filter((m) => m.state !== 'gone');
    this.updateBars(dt, ctx.camera);
    return events;
  }

  /** small health bar over a monster for a few seconds after it gets hit (the chief uses the HUD bar) */
  updateBars(dt, camera) {
    for (const m of this.list) {
      const show = m.alive && m.type !== 'boss' && (m.hurtShow || 0) > 0;
      m.hurtShow = Math.max(0, (m.hurtShow || 0) - dt);
      if (!show) { if (m.bar) m.bar.visible = false; continue; }
      if (!m.bar) {
        const g = new THREE.Group();
        const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.13), new THREE.MeshBasicMaterial({ color: 0x1a0a0a, transparent: true, opacity: 0.8, depthTest: false }));
        const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.09), new THREE.MeshBasicMaterial({ color: 0xff4a3a, depthTest: false }));
        fill.position.z = 0.001;
        bg.renderOrder = 10; fill.renderOrder = 11;
        g.add(bg, fill);
        g.fill = fill;
        this.scene.add(g);
        m.bar = g;
      }
      const k = Math.max(0, m.hp / m.maxHp);
      m.bar.visible = true;
      m.bar.fill.scale.x = Math.max(0.001, k);
      m.bar.fill.position.x = -(1 - k) / 2;
      const h = m.type === 'wisp' ? 1.9 : 2.5 * (m.T.scale || 1);
      m.bar.position.set(m.pos.x, h, m.pos.z);
      if (camera) m.bar.quaternion.copy(camera.quaternion);
      m.bar.scale.setScalar(m.type === 'elite' ? 1.3 : 0.9);
    }
  }

  /** place a monster in the dark, away from the player (or around angle `dir` for a raid) */
  spawn(ctx, diff, type, dir) {
    const { player, zones } = ctx;
    let x = 0, z = 0;
    for (let k = 0; k < 12; k++) {
      if (dir !== undefined) {
        const a = dir + (Math.random() - 0.5) * 0.9, r = 19 + Math.random() * 6;
        x = Math.sin(a) * r; z = Math.cos(a) * r;
      } else {
        const a = Math.random() * Math.PI * 2;
        const r = 14 + Math.random() * 11;
        x = player.pos.x + Math.cos(a) * r; z = player.pos.z + Math.sin(a) * r;
      }
      const d = Math.hypot(x, z);
      const RR = rules.islandRadius - 1;
      if (d > RR) { x *= RR / d; z *= RR / d; }
      const farFromPlayer = Math.hypot(x - player.pos.x, z - player.pos.z) > 9;
      if (farFromPlayer && !zones.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + 2)) break;
    }
    const m = type === 'wisp' ? new Wisp(this.scene, x, z, diff) : new Dokkaebi(this.scene, x, z, this.count, type, diff);
    this.count++;
    this.effects.spawn(x, 0.6, z, type === 'elite' ? 0xb07aff : 0x6fb8ff, { n: 10, speed: 1.5, up: 3, life: 0.7, size: 0.18, grav: -1 });
    this.list.push(m);
    return m;
  }

  spawnBoss(ctx, night) {
    const m = this.spawn(ctx, difficulty(night), 'boss');
    this.boss = m;
    return m;
  }

  /** spawn one monster at (x,z): used by the 백귀야행 waves */
  spawnAt(ctx, night, type, x, z, opts = {}) {
    const d = difficulty(Math.max(1, night));
    const m = type === 'wisp' ? new Wisp(this.scene, x, z, d) : new Dokkaebi(this.scene, x, z, this.count, type, d);
    this.count++;
    Object.assign(m, opts);
    if (opts.hpMul) { m.hp = Math.round(m.hp * opts.hpMul); m.maxHp = m.hp; }
    if (opts.dmgMul) m.damage = Math.round(m.damage * opts.dmgMul);
    this.effects.spawn(x, 0.6, z, 0xff4a3a, { n: 8, speed: 1.5, up: 3, life: 0.6, size: 0.16, grav: -1 });
    this.list.push(m);
    return m;
  }

  /** lair guards: stay near home (x,z) and only fight you there */
  spawnGuards(night, types, x, z) {
    const d = difficulty(Math.max(1, night));
    return types.map((type, i) => {
      const a = (i / types.length) * Math.PI * 2;
      const gx = x + Math.sin(a) * 2.6, gz = z + Math.cos(a) * 2.6;
      const m = type === 'wisp' ? new Wisp(this.scene, gx, gz, d) : new Dokkaebi(this.scene, gx, gz, this.count, type, d);
      this.count++;
      m.home = { x, z, r: 11 };
      this.effects.spawn(gx, 0.6, gz, 0xff6a4a, { n: 10, speed: 1.5, up: 3, life: 0.7, size: 0.18, grav: -1 });
      this.list.push(m);
      return m;
    });
  }

  /** two helpers pop out right next to (x,z) */
  summon(ctx, night, x, z) {
    const d = difficulty(night);
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const m = new Dokkaebi(this.scene, x + Math.sin(a) * 2.2, z + Math.cos(a) * 2.2, this.count++, 'dokkaebi', d);
      this.effects.spawn(m.pos.x, 0.6, m.pos.z, 0xff6a4a, { n: 10, speed: 1.5, up: 3, life: 0.7, size: 0.18, grav: -1 });
      this.list.push(m);
    }
  }

  /** a pack from one side of the island. returns the angle they come from */
  raid(ctx, night) {
    const d = difficulty(night);
    const dir = Math.random() * Math.PI * 2;
    for (let i = 0; i < d.raid; i++) {
      const r = Math.random();
      const type = i === 0 && night >= 3 ? 'elite' : r < d.wisp * 0.6 ? 'wisp' : 'dokkaebi';
      this.spawn(ctx, d, type, dir);
    }
    return dir;
  }

  /** talisman / dawn: send everything in range away */
  banishNear(x, z, r) {
    let n = 0;
    for (const m of this.list) {
      if (!m.alive || Math.hypot(m.pos.x - x, m.pos.z - z) >= r) continue;
      if (m.type === 'boss') { m.hit(30, x, z); m.knock.multiplyScalar(6); continue; } // the chief only staggers
      m.banish(x, z); n++;
    }
    return n;
  }

  banishAll() { for (const m of this.list) m.banish(); }
}
