import * as THREE from 'three';

// Tiny particle pool: wood chips, sparks, blue ghost-fire bursts.
export class Effects {
  constructor(scene, size = 90) {
    this.pool = [];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < size; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      m.visible = false;
      scene.add(m);
      this.pool.push({ m, v: new THREE.Vector3(), life: 0, max: 1, grav: 0, size: 0.1 });
    }
    this.i = 0;
  }

  spawn(x, y, z, color, { n = 8, speed = 3, up = 3, life = 0.6, size = 0.12, grav = 9 } = {}) {
    for (let k = 0; k < n; k++) {
      const p = this.pool[this.i++ % this.pool.length];
      p.m.visible = true;
      p.m.position.set(x, y, z);
      p.m.material.color.set(color);
      p.m.material.opacity = 1;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      p.v.set(Math.cos(a) * s, up * (0.5 + Math.random() * 0.7), Math.sin(a) * s);
      p.life = p.max = life * (0.7 + Math.random() * 0.5);
      p.grav = grav;
      p.size = size * (0.7 + Math.random() * 0.6);
      p.m.scale.setScalar(p.size);
      p.m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    }
  }

  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      p.v.y -= p.grav * dt;
      p.m.position.addScaledVector(p.v, dt);
      if (p.m.position.y < 0.05 && p.grav > 0) { p.m.position.y = 0.05; p.v.multiplyScalar(0.5); p.v.y = 0; }
      const t = p.life / p.max;
      p.m.material.opacity = Math.min(1, t * 2);
      p.m.scale.setScalar(p.size * (0.5 + t * 0.5));
      p.m.rotation.x += dt * 6;
    }
  }
}
