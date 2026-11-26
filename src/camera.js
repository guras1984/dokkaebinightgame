import * as THREE from 'three';
import { tune } from './config.js';

// Fixed-angle quarter-view camera (looking from +X/+Z toward -X/-Z) with smooth follow.
export class QuarterCamera {
  constructor() {
    this.cam = new THREE.PerspectiveCamera(32, 1, 0.5, 200);
    this.target = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    // screen-space → world basis on the ground plane
    this.forward = new THREE.Vector3(-1, 0, -1).normalize();
    this.right = new THREE.Vector3(1, 0, -1).normalize();
    this.back = this.forward.clone().negate();
  }

  resize(w, h) {
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  /** convert a screen-space stick (x right, y up) to a world direction */
  toWorld(mx, my, out) {
    return out.set(0, 0, 0).addScaledVector(this.right, mx).addScaledVector(this.forward, my);
  }

  snap(focus) {
    this.look.copy(focus);
    this.place(1);
  }

  update(dt, focus, lead) {
    // look slightly ahead of where the player is heading
    const goal = this.target.copy(focus).addScaledVector(lead, 0.35);
    this.look.lerp(goal, 1 - Math.exp(-dt * tune.camFollow));
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.place(dt);
  }

  place() {
    // portrait screens see less horizontally → pull back a bit
    const a = this.cam.aspect;
    const dist = tune.camDistance * (a < 1 ? Math.min(2.0, Math.pow(1 / a, 0.75)) : 1);
    const p = THREE.MathUtils.degToRad(tune.camPitch);
    const h = Math.sin(p) * dist, flat = Math.cos(p) * dist;
    const back = this.forward.clone().multiplyScalar(-flat);
    this.cam.position.set(this.look.x + back.x, this.look.y + h, this.look.z + back.z);
    const s = this.shake * 0.25;
    this.cam.position.x += (Math.random() - 0.5) * s;
    this.cam.position.y += (Math.random() - 0.5) * s;
    this.cam.lookAt(this.look.x, this.look.y + 0.6, this.look.z);
  }
}
