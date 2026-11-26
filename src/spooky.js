import * as THREE from 'three';
import { rules } from './config.js';

// Pairs of glowing eyes that open in the dark, blink, and close. Pure atmosphere: they never attack.
const eyeGeo = new THREE.PlaneGeometry(0.34, 0.19);
const glowGeo = new THREE.PlaneGeometry(1.6, 0.9);
// soft round glow (radial gradient), so the halo isn't a visible box
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let glowTex = null;

export class Eyes {
  constructor(scene, size = 16) {
    this.pool = [];
    glowTex = glowTex || glowTexture();
    for (let i = 0; i < size; i++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0, depthWrite: false, fog: false });
      for (const x of [-0.26, 0.26]) {
        const e = new THREE.Mesh(eyeGeo, mat);
        e.position.x = x;
        e.rotation.z = x > 0 ? 0.3 : -0.3; // inner corners down: angry
        g.add(e);
      }
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb020, map: glowTex, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.z = -0.01;
      g.add(glow);
      g.visible = false;
      scene.add(g);
      this.pool.push({ g, mat, glowMat, life: 0, max: 1, blink: 0, delay: 0 });
    }
    this.timer = 4;
  }

  /** open a pair at (x,z), looking at (lx,lz) */
  open(x, z, lx, lz, { delay = 0, life = 3, red = false } = {}) {
    const p = this.pool.find((q) => q.life <= 0 && q.delay <= 0);
    if (!p) return;
    p.g.position.set(x, 1.1 + Math.random() * 0.6, z);
    p.g.rotation.y = Math.atan2(lx - x, lz - z);
    p.mat.color.setHex(red ? 0xff3b2a : 0xffd23a);
    p.glowMat.color.setHex(red ? 0xff2010 : 0xffa020);
    p.life = p.max = life;
    p.delay = delay;
    p.blink = 1 + Math.random() * 1.5;
    p.g.visible = false;
  }

  /** a ring of eyes around the light, staggered */
  ring(cx, cz, r0, r1, n, red) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const r = r0 + Math.random() * (r1 - r0);
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (Math.hypot(x, z) > rules.islandRadius - 0.5) continue;
      this.open(x, z, cx, cz, { delay: 0.6 + i * 0.18 + Math.random() * 0.3, life: 3 + Math.random() * 2.5, red: red && i % 3 === 0 });
    }
  }

  clear() { for (const p of this.pool) { p.life = 0; p.delay = 0; p.g.visible = false; } }

  /**
   * dread 0..1: how often stray eyes appear in the dark during the night
   * look: point they stare at (the player)
   */
  update(dt, { darkness, dread, look, zones, camera }) {
    for (const p of this.pool) {
      if (p.delay > 0) { p.delay -= dt; if (p.delay <= 0) p.g.visible = true; else continue; }
      if (p.life <= 0) continue;
      p.life -= dt;
      const t = 1 - p.life / p.max;
      // fade in, hold, fade out; blink now and then
      let o = Math.min(1, t * 6) * Math.min(1, (p.life) * 2.5);
      p.blink -= dt;
      if (p.blink < 0) { o *= 0.05; if (p.blink < -0.12) p.blink = 1 + Math.random() * 2; }
      p.mat.opacity = o * darkness;
      p.glowMat.opacity = o * darkness * 0.55;
      p.g.scale.y = p.blink < 0 ? 0.15 : 1;
      p.g.quaternion.copy(camera.quaternion); // always face the viewer
      if (p.life <= 0) p.g.visible = false;
    }
    // stray pairs in the dark, more on harder nights
    if (darkness > 0.7 && dread > 0) {
      this.timer -= dt * (0.4 + dread);
      if (this.timer <= 0) {
        this.timer = 6 + Math.random() * 8;
        for (let k = 0; k < 8; k++) {
          const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 4;
          const x = look.x + Math.sin(a) * r, z = look.z + Math.cos(a) * r;
          if (Math.hypot(x, z) > rules.islandRadius - 0.5) continue;
          if (zones.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + 1)) continue;
          this.open(x, z, look.x, look.z, { life: 2 + Math.random() * 2, red: dread > 0.6 && Math.random() < 0.4 });
          return 'eyes';
        }
      }
    }
    return null;
  }
}
