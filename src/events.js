import * as THREE from 'three';
import { rules } from './config.js';
import { INNER } from './world.js';

// What kind of night it is: normal, a random event (blood moon / fog / rain), the chief, or the 백귀야행.
export const NIGHTS = {
  normal:    { name: '', desc: '' },
  bloodmoon: { name: '붉은 달', desc: '도깨비가 세지고, 구슬은 두 배' },
  fog:       { name: '안개 밤', desc: '한 치 앞도 안 보인다' },
  rain:      { name: '비 오는 밤', desc: '모닥불이 빨리 꺼진다' },
  boss:      { name: '대장의 밤', desc: '도깨비 대장이 온다' },
  horde:     { name: '백귀야행', desc: '온갖 요괴가 줄지어 모닥불로 몰려온다' },
};

export function pickNight(day, rand = Math.random) {
  if (day % rules.bossEvery === 0) return 'boss';
  if (day % 3 === 0) return 'horde';
  if (day >= 2 && rand() < 0.55) return ['bloodmoon', 'fog', 'rain'][Math.floor(rand() * 3)];
  return 'normal';
}

/** 백귀야행: three waves, monsters keep coming without a break, they go for the campfire */
export class Horde {
  constructor() { this.reset(); }
  reset() { this.active = false; this.wave = 0; this.waves = 3; this.t = 0; this.spawnT = 0; this.phase = 'idle'; this.done = false; }

  start() { this.active = true; this.wave = 1; this.phase = 'wave'; this.t = 0; this.spawnT = 0; this.dirs = this.pickDirs(); }

  pickDirs() {
    const a = Math.random() * Math.PI * 2;
    return [a, a + 2.1 + Math.random() * 0.6];
  }

  /** returns an event string when something happens: 'waveEnd', 'nextWave', 'won' */
  update(dt, { monsters, ctx, day }) {
    if (!this.active) return null;
    this.t += dt;
    if (this.phase === 'wave') {
      const dur = 15 + this.wave * 2;   // 17, 19, 21 s: all three fit in one night
      this.spawnT -= dt;
      const alive = monsters.alive.filter((m) => m.horde).length;
      if (this.t < dur && this.spawnT <= 0 && alive < 12 + this.wave * 3) {
        this.spawnT = Math.max(0.35, 0.8 - this.wave * 0.12 - day * 0.01);
        const a = this.dirs[Math.floor(Math.random() * this.dirs.length)] + (Math.random() - 0.5) * 0.6;
        const r = INNER + 1 + Math.random() * 4;
        const roll = Math.random();
        const type = this.wave >= 2 && roll < 0.12 ? 'elite' : roll < 0.3 ? 'wisp'
          : this.wave >= 2 && day >= 4 && roll < 0.42 ? (Math.random() < 0.5 ? 'fox' : 'centipede') : 'dokkaebi';
        monsters.spawnAt(ctx, day, type, Math.sin(a) * r, Math.cos(a) * r, { horde: type !== 'wisp', hpMul: 0.8 });
      }
      if (this.t >= dur && alive === 0) {
        if (this.wave >= this.waves) { this.active = false; this.phase = 'idle'; this.done = true; return 'won'; }
        this.phase = 'break'; this.t = 0;
        return 'waveEnd';
      }
    } else if (this.phase === 'break' && this.t > 4) {
      this.wave += 1; this.phase = 'wave'; this.t = 0; this.dirs = this.pickDirs();
      return 'nextWave';
    }
    return null;
  }
}

/** falling rain around the camera on rainy nights */
export class Rain {
  constructor(scene) {
    this.n = 260;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.7, 0.03), new THREE.MeshBasicMaterial({ color: 0x9fb8e8, transparent: true, opacity: 0.45, depthWrite: false }), this.n);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.drops = Array.from({ length: this.n }, () => ({ x: (Math.random() - 0.5) * 36, y: Math.random() * 14, z: (Math.random() - 0.5) * 36 }));
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0, 0.15));
    this.s = new THREE.Vector3(1, 1, 1);
    this.v = new THREE.Vector3();
  }
  update(dt, on, center) {
    this.mesh.visible = on;
    if (!on) return;
    for (let i = 0; i < this.n; i++) {
      const d = this.drops[i];
      d.y -= dt * 22; d.z += dt * 5; d.x += dt * 3;
      if (d.y < 0) { d.y = 12 + Math.random() * 3; d.x = (Math.random() - 0.5) * 36; d.z = (Math.random() - 0.5) * 36; }
      this.m.compose(this.v.set(center.x + d.x, d.y, center.z + d.z), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
