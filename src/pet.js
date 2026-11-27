import * as THREE from 'three';

// 진돗개 "백구": a stray on day 2+. Feed it meat or fish to tame it; then it follows you, bites monsters
// that come close, barks when they sneak up, and brings a rabbit back each morning. It never dies (it just rests).
const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class Dog {
  constructor(scene) {
    this.scene = scene;
    const fur = lam(0xf4efe4), shade = lam(0xe0d6c4), dark = lam(0x1d1b22), pink = lam(0xf08a9a);
    const g = new THREE.Group();
    const add = (w, h, d, m, x, y, z, parent = g) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
    this.body = new THREE.Group(); g.add(this.body);
    add(0.42, 0.38, 0.85, fur, 0, 0.55, 0, this.body);
    this.head = new THREE.Group(); this.head.position.set(0, 0.85, 0.48); this.body.add(this.head);
    add(0.4, 0.36, 0.38, fur, 0, 0, 0, this.head);
    add(0.22, 0.18, 0.22, shade, 0, -0.06, 0.25, this.head);
    add(0.08, 0.07, 0.04, dark, 0, -0.02, 0.37, this.head); // nose
    for (const s of [-1, 1]) {
      add(0.1, 0.18, 0.06, fur, s * 0.13, 0.25, -0.04, this.head);          // pointy ears
      add(0.05, 0.05, 0.02, dark, s * 0.1, 0.06, 0.2, this.head);           // eyes
    }
    this.tongue = add(0.08, 0.03, 0.1, pink, 0, -0.17, 0.3, this.head);
    this.tail = new THREE.Group(); this.tail.position.set(0, 0.72, -0.42); this.body.add(this.tail);
    add(0.1, 0.32, 0.1, fur, 0, 0.14, 0, this.tail);
    this.tail.rotation.x = -0.6;
    this.legs = [];
    for (const [x, z] of [[-0.13, 0.28], [0.13, 0.28], [-0.13, -0.28], [0.13, -0.28]]) {
      const l = new THREE.Group(); l.position.set(x, 0.38, z); this.body.add(l);
      add(0.11, 0.38, 0.11, fur, 0, -0.19, 0, l);
      this.legs.push(l);
    }
    // little red scarf once tamed
    this.scarf = add(0.46, 0.08, 0.44, lam(0xc9413a), 0, 0.7, 0.32, this.body);
    scene.add(g);
    this.root = g;
    this.pos = g.position;
    this.vel = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.state = 'gone';   // gone | stray | follow | fight | rest
    this.root.visible = false;
    this.time = 0; this.biteT = 0; this.restT = 0; this.bites = 0; this.barked = new WeakSet();
    this.facing = 0; this.target = null;
  }

  /** a stray shows up somewhere in the home forest */
  appear(x, z) { this.state = 'stray'; this.pos.set(x, 0, z); this.root.visible = true; this.scarf.visible = false; }
  tame() { this.state = 'follow'; this.scarf.visible = true; }
  get tamed() { return ['follow', 'fight', 'rest'].includes(this.state); }

  update(dt, { player, world, monsters, darkness }) {
    if (this.state === 'gone') return [];
    this.time += dt;
    const events = [];
    const before = this.pos.clone();
    let goal = null, speed = 0;
    const toP = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    if (this.state === 'stray') {
      // wander a little, look at the player when near
      if (!this.wander || this.time > this.wander.t) this.wander = { x: this.pos.x + (Math.random() - 0.5) * 4, z: this.pos.z + (Math.random() - 0.5) * 4, t: this.time + 3 };
      goal = toP < 4 ? null : this.wander; speed = 1.5;
      if (toP < 4) this.facing += angDiff(this.facing, Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z)) * Math.min(1, dt * 5);
    } else {
      if (this.state === 'rest') { this.restT -= dt; if (this.restT <= 0) this.state = 'follow'; }
      // nearest threat close to the player
      let threat = null, td = 6.5;
      for (const m of monsters) {
        if (!m.alive || m.illusion) continue;
        const d = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z);
        if (d < 11 && !this.barked.has(m)) { this.barked.add(m); events.push({ type: 'bark' }); }
        if (d < td) { td = d; threat = m; }
      }
      if (threat && this.state !== 'rest') {
        this.state = 'fight';
        goal = threat.pos; speed = 6.5;
        const d = Math.hypot(threat.pos.x - this.pos.x, threat.pos.z - this.pos.z);
        this.biteT -= dt;
        if (d < threat.radius + 0.9 && this.biteT <= 0) {
          this.biteT = 0.9;
          this.bites += 1;
          events.push({ type: 'bite', m: threat });
          this.head.rotation.x = 0.5;
          if (this.bites >= 8) { this.state = 'rest'; this.restT = 5; this.bites = 0; events.push({ type: 'tired' }); }
        }
      } else {
        if (this.state === 'fight') this.state = 'follow';
        // trot behind the player
        const side = Math.sin(this.time * 0.3) > 0 ? 1 : -1;
        const back = 1.6;
        goal = { x: player.pos.x - Math.sin(player.facing) * back + Math.cos(player.facing) * side * 0.9, z: player.pos.z - Math.cos(player.facing) * back - Math.sin(player.facing) * side * 0.9 };
        const gd = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
        speed = this.state === 'rest' ? 2 : Math.min(7, 1 + gd * 1.8);
        if (gd < 0.4) goal = null;
        if (toP > 18) this.pos.set(player.pos.x - Math.sin(player.facing) * 2, 0, player.pos.z - Math.cos(player.facing) * 2);
      }
    }
    if (goal && speed > 0) {
      const gx = goal.x - this.pos.x, gz = goal.z - this.pos.z, gd = Math.hypot(gx, gz) || 1;
      this.vel.lerp(new THREE.Vector3(gx / gd * speed, 0, gz / gd * speed), Math.min(1, dt * 8));
      this.facing += angDiff(this.facing, Math.atan2(gx, gz)) * Math.min(1, dt * 10);
    } else this.vel.multiplyScalar(Math.pow(0.01, dt));
    this.pos.addScaledVector(this.vel, dt);
    world.resolve(this.pos, 0.3);
    this.root.rotation.y = this.facing;
    const sp = Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / Math.max(dt, 1e-4);
    const ph = this.time * (sp > 3 ? 16 : 10);
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + (i % 2 ? Math.PI : 0) + (i > 1 ? 0.5 : 0)) * 0.6 * Math.min(1, sp / 2); });
    this.tail.rotation.z = Math.sin(this.time * (this.tamed ? 14 : 5)) * 0.5;
    this.head.rotation.x *= 0.85;
    this.body.position.y = this.state === 'rest' ? -0.15 : Math.abs(Math.sin(ph)) * 0.05 * Math.min(1, sp / 2);
    this.tongue.visible = this.tamed && (sp > 2 || this.state === 'rest');
    return events;
  }
}
