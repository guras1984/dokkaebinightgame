import * as THREE from 'three';
import { buildCharacter, animateCharacter } from './character.js';
import { EMOTES } from './net.js';

// Friends in the same room: blocky characters that glide to their latest position, name tags, emote bubbles.
// together: everyone in a room gets their own colour (the server hands out a free slot), shown on the jeogori and the name
export const TEAM = [
  { shirt: 0x3d8bff, tag: '#7cc0ff', name: '파랑' },
  { shirt: 0xff7a2e, tag: '#ffb07a', name: '주황' },
  { shirt: 0x8f5bff, tag: '#c3a6ff', name: '보라' },
  { shirt: 0x3fbf5f, tag: '#8fe08a', name: '초록' },
  { shirt: 0xff4f8b, tag: '#ff9fc0', name: '분홍' },
  { shirt: 0xf2c230, tag: '#ffe27a', name: '노랑' },
];
export const team = (c) => TEAM[(c | 0) % TEAM.length];

export class Friends {
  constructor(scene, layer) {
    this.scene = scene;
    this.layer = layer;           // DOM layer for name tags
    this.map = new Map();
    this.v = new THREE.Vector3();
  }

  get list() { return [...this.map.values()]; }
  get count() { return this.map.size; }

  add(p) {
    if (this.map.has(p.id)) { this.update(p); return; }
    const tm = team(p.c ?? this.map.size + 1);
    const color = tm.tag;
    const rig = buildCharacter({ kind: 'hero', skin: 0xffd9b0, top: tm.shirt, pants: 0x34406e, hair: 0x2a1f1a });
    rig.root.position.set(p.x || 0, 0, p.z || 0);
    this.scene.add(rig.root);
    const tag = document.createElement('div');
    tag.className = 'name-tag';
    tag.style.setProperty('--c', color);
    tag.innerHTML = `<b>${p.name}</b><span class="hpbar"><i></i></span>`;
    this.layer.appendChild(tag);
    this.map.set(p.id, { id: p.id, name: p.name, color, rig, tag, pos: rig.root.position, to: new THREE.Vector3(p.x || 0, 0, p.z || 0), f: p.f || 0, s: 0, a: 0, hp: p.hp ?? 100, time: Math.random() * 5, bubble: null });
  }

  update(p) {
    const fr = this.map.get(p.id);
    if (!fr) return;
    fr.to.set(p.x, 0, p.z);
    fr.f = p.f; fr.s = p.s; fr.hp = p.hp;
    if ((p.a & 1) && !(fr.a & 1)) fr.attackT = 0;   // swing started
    if ((p.a & 2) && !(fr.a & 2)) fr.rollT = 0;     // roll started
    fr.a = p.a;
  }

  remove(id) {
    const fr = this.map.get(id);
    if (!fr) return;
    this.scene.remove(fr.rig.root);
    fr.tag.remove();
    if (fr.bubble) fr.bubble.remove();
    this.map.delete(id);
  }

  clear() { for (const id of [...this.map.keys()]) this.remove(id); this.setSelf(null); }

  /** a small name tag over my own head in my colour (null removes it) */
  setSelf(root, name, c) {
    if (this.self) { this.self.tag.remove(); this.self = null; }
    if (!root) return;
    const tag = document.createElement('div');
    tag.className = 'name-tag me';
    tag.style.setProperty('--c', team(c).tag);
    tag.innerHTML = `<b>${name} (나)</b>`;
    this.layer.appendChild(tag);
    this.self = { root, tag };
  }

  emote(id, k) {
    const fr = this.map.get(id);
    const e = EMOTES.find((q) => q.k === k);
    if (!fr || !e) return null;
    if (fr.bubble) fr.bubble.remove();
    const b = document.createElement('div');
    b.className = 'emote-bubble';
    b.textContent = `${e.icon} ${e.text}`;
    this.layer.appendChild(b);
    fr.bubble = b; fr.bubbleT = 2.8;
    return fr;
  }

  frame(dt, camera) {
    if (this.self) {
      const p = this.self.root.position;
      this.v.set(p.x, 2.35, p.z).project(camera);
      this.self.tag.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * innerWidth}px, ${(-this.v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
    }
    for (const fr of this.map.values()) {
      fr.time += dt;
      const before = fr.pos.clone();
      // glide toward the last known spot (hides the 8-per-second updates)
      const d = fr.pos.distanceTo(fr.to);
      if (d > 8) fr.pos.copy(fr.to); else fr.pos.lerp(fr.to, Math.min(1, dt * 10));
      let df = fr.f - fr.rig.root.rotation.y;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      fr.rig.root.rotation.y += df * Math.min(1, dt * 12);
      let attack = -1, roll = -1;
      if (fr.attackT !== undefined && fr.attackT >= 0) { fr.attackT += dt / 0.38; attack = fr.attackT; if (fr.attackT >= 1) fr.attackT = -1; }
      if (fr.rollT !== undefined && fr.rollT >= 0) { fr.rollT += dt / 0.5; roll = fr.rollT; if (fr.rollT >= 1) fr.rollT = -1; }
      animateCharacter(fr.rig, { dist: before.distanceTo(fr.pos), speedRatio: fr.s, attack, roll, windup: 0, time: fr.time }, dt);
      fr.rig.spin.rotation.z = fr.a & 4 ? Math.PI / 2 : fr.rig.spin.rotation.z; // fallen
      // name tag + health
      this.v.set(fr.pos.x, 2.35, fr.pos.z).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * innerWidth, y = (-this.v.y * 0.5 + 0.5) * innerHeight;
      const on = this.v.z < 1;
      fr.tag.style.display = on ? '' : 'none';
      fr.tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      fr.tag.querySelector('i').style.width = `${Math.max(0, Math.min(100, fr.hp))}%`;
      if (fr.bubble) {
        fr.bubbleT -= dt;
        fr.bubble.style.transform = `translate(${x}px, ${y - 26}px) translate(-50%, -100%)`;
        if (fr.bubbleT <= 0) { fr.bubble.remove(); fr.bubble = null; }
      }
    }
  }
}
