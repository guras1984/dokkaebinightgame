import * as THREE from 'three';
import { rules } from './config.js';

const lam = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const M = { fur: lam(0xf2ede4), ear: lam(0xf3b6c0), eye: lam(0x1d1b2e), tail: lam(0xffffff) };
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// Rabbits: hop around by day, run from the player, one axe hit = raw meat. They hide at night.
class Rabbit {
  constructor(scene, x, z) {
    this.scene = scene;
    const g = new THREE.Group();
    const add = (w, h, d, mat, px, py, pz, parent = g) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(px, py, pz); m.castShadow = true; parent.add(m); return m;
    };
    this.body = new THREE.Group();
    g.add(this.body);
    add(0.36, 0.3, 0.5, M.fur, 0, 0.22, 0, this.body);
    add(0.3, 0.28, 0.28, M.fur, 0, 0.42, 0.24, this.body);
    for (const sx of [-0.08, 0.08]) {
      add(0.07, 0.28, 0.06, M.fur, sx, 0.68, 0.2, this.body);
      add(0.04, 0.2, 0.065, M.ear, sx, 0.68, 0.205, this.body);
      add(0.05, 0.05, 0.02, M.eye, sx * 1.3, 0.46, 0.385, this.body);
    }
    add(0.12, 0.12, 0.1, M.tail, 0, 0.28, -0.28, this.body);
    scene.add(g);
    this.root = g;
    this.pos = g.position;
    this.pos.set(x, 0, z);
    this.facing = Math.random() * Math.PI * 2;
    this.vel = new THREE.Vector3();
    this.hop = 0;
    this.state = 'idle';
    this.t = Math.random() * 2;
    this.radius = 0.3;
    this.alive = true;
  }

  hit() {
    if (!this.alive) return false;
    this.alive = false;
    this.state = 'dying';
    this.t = 0;
    return true;
  }

  dispose() { this.scene.remove(this.root); }

  update(dt, player, world, hidden) {
    this.t += dt;
    if (this.state === 'dying') {
      const k = Math.max(0, 1 - this.t / 0.3);
      this.root.scale.setScalar(k);
      this.root.rotation.z += dt * 12;
      return this.t > 0.3;
    }
    // fade out at night (they go to their burrows)
    const vis = hidden ? Math.max(0, this.root.scale.x - dt * 2) : Math.min(1, this.root.scale.x + dt * 2);
    this.root.scale.setScalar(vis);
    this.root.visible = vis > 0.01;
    if (vis < 0.01) return false;

    const dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    let goal = null, speed = 0;
    if (d < 4.2 && !player.dead) {
      this.state = 'flee'; this.t = 0;
      goal = Math.atan2(dx, dz) + Math.sin(performance.now() / 300 + this.pos.x) * 0.5;
      speed = 4.3;
    } else if (this.state === 'flee' && this.t < 1.2) {
      goal = this.facing; speed = 4.3;
    } else {
      if (this.state !== 'idle' && this.state !== 'wander') { this.state = 'idle'; this.t = 0; }
      if (this.state === 'idle' && this.t > 1.5 + Math.random()) { this.state = 'wander'; this.t = 0; this.wanderDir = this.facing + (Math.random() - 0.5) * 2.5; }
      if (this.state === 'wander') { goal = this.wanderDir; speed = 1.6; if (this.t > 1.4) { this.state = 'idle'; this.t = 0; } }
    }
    if (goal !== null) {
      this.facing += angDiff(this.facing, goal) * Math.min(1, dt * 10);
      this.vel.set(Math.sin(this.facing) * speed, 0, Math.cos(this.facing) * speed);
      this.hop += dt * (speed > 3 ? 14 : 9);
    } else {
      this.vel.multiplyScalar(Math.pow(0.001, dt));
      this.hop = 0;
    }
    this.pos.addScaledVector(this.vel, dt);
    const before = { x: this.pos.x, z: this.pos.z };
    world.resolve(this.pos, this.radius);
    // bumped into something or the shore: turn around
    if (Math.hypot(this.pos.x - before.x, this.pos.z - before.z) > 0.001 || Math.hypot(this.pos.x, this.pos.z) > rules.islandRadius - 0.5) {
      this.facing += Math.PI * 0.6;
    }
    this.root.rotation.y = this.facing;
    this.body.position.y = Math.abs(Math.sin(this.hop)) * 0.22;
    this.body.rotation.x = goal !== null ? -Math.sin(this.hop) * 0.25 : 0;
    return false;
  }
}

export class Critters {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }

  reset() {
    for (const r of this.list) r.dispose();
    this.list = [];
  }

  /** morning: top the island back up with rabbits, away from the player */
  repopulate(world, px, pz) {
    let tries = 0;
    while (this.list.filter((r) => r.alive).length < rules.rabbits && tries++ < 200) {
      const a = Math.random() * Math.PI * 2, rr = 8 + Math.random() * (rules.islandRadius - 10);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (Math.hypot(x - px, z - pz) < 8) continue;
      if (world.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.8)) continue;
      this.list.push(new Rabbit(this.scene, x, z));
    }
  }

  get alive() { return this.list.filter((r) => r.alive && r.root.visible); }

  update(dt, player, world, night) {
    for (const r of this.list) {
      if (r.update(dt, player, world, night)) { r.dispose(); r.gone = true; }
    }
    this.list = this.list.filter((r) => !r.gone);
  }
}
