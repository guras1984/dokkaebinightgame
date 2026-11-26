import * as THREE from 'three';
import { tune, tuneRanges } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), hp: $('hp-fill'), wood: $('wood'), fire: $('fire-fill'),
      clock: $('clock'), clockIcon: $('clock-icon'), clockText: $('clock-text'), clockFill: $('clock-fill'),
      toast: $('toast'), popups: $('popups'), action: $('btn-action'), actionLabel: $('action-label'), roll: $('btn-roll'),
    };
    this.toastTimer = 0;
    this.v = new THREE.Vector3();
    this.lastAction = '';
    this.woodPending = 0;   // logs still flying toward the counter
    this.woodRes = this.el.wood.closest('.res');
  }

  show(on) { this.el.hud.hidden = !on; }

  update(s) {
    const e = this.el;
    e.hp.style.width = `${(s.hp / s.hpMax) * 100}%`;
    const shown = Math.max(0, s.wood - this.woodPending);
    if (e.wood.textContent !== String(shown)) e.wood.textContent = shown;
    e.fire.style.width = `${s.fuel}%`;
    const names = { day: '낮', dusk: '해질녘', night: '밤', dawn: '새벽' };
    const icons = { day: '☀', dusk: '☀', night: '☾', dawn: '☀' };
    const mm = Math.floor(s.remain / 60), ss = Math.floor(s.remain % 60).toString().padStart(2, '0');
    e.clockIcon.textContent = icons[s.phase];
    e.clockText.textContent = s.phase === 'night' ? `밤 · 새벽까지 ${mm}:${ss}` : s.phase === 'day' ? `낮 · ${mm}:${ss}` : names[s.phase];
    e.clockFill.style.width = `${s.progress * 100}%`;
    e.clock.classList.toggle('night', s.phase === 'night');

    const label = s.canFeed ? '장작 넣기' : '베기';
    if (label !== this.lastAction) {
      e.actionLabel.textContent = label;
      e.action.classList.toggle('feed', s.canFeed);
      this.lastAction = label;
    }
    e.roll.classList.toggle('cool', s.rollCool);

    if (this.toastTimer > 0) {
      this.toastTimer -= s.dt;
      if (this.toastTimer <= 0) e.toast.classList.remove('show');
    }
  }

  toast(text, secs = 2.4) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastTimer = secs;
  }

  /** project a world point to screen pixels */
  screen(pos, camera) {
    this.v.set(pos.x, pos.y ?? 2, pos.z).project(camera);
    return { x: (this.v.x * 0.5 + 0.5) * innerWidth, y: (-this.v.y * 0.5 + 0.5) * innerHeight };
  }

  bump(el, cls = 'bump') {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }

  /** logs pop out of the fallen tree, arc up, then fly into the HUD counter one by one */
  collectWood(n, pos, camera) {
    const from = this.screen(pos, camera);
    const r = this.woodRes.getBoundingClientRect();
    const to = { x: r.left + 20, y: r.top + r.height / 2 };
    this.woodPending += n;
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'fly-wood';
      this.el.popups.appendChild(d);
      const side = (i - (n - 1) / 2) * 64;
      const peak = { x: from.x + side, y: from.y - 34 - Math.random() * 14 };
      const delay = 120 + i * 140;
      const spin = (Math.random() < 0.5 ? -1 : 1) * (300 + Math.random() * 200);
      const anim = d.animate([
        { transform: `translate(${from.x}px, ${from.y}px) translate(-50%,-50%) scale(.3) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${peak.x}px, ${peak.y}px) translate(-50%,-50%) scale(1.5) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.3, easing: 'cubic-bezier(.5,0,.9,.6)' },
        { transform: `translate(${peak.x}px, ${peak.y - 6}px) translate(-50%,-50%) scale(1.35) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.42, easing: 'cubic-bezier(.6,0,.9,.4)' },
        { transform: `translate(${to.x}px, ${to.y}px) translate(-50%,-50%) scale(.8) rotate(${spin}deg)`, opacity: 1 },
      ], { duration: 720, delay, fill: 'both' });
      const land = () => {
        d.remove();
        this.woodPending = Math.max(0, this.woodPending - 1);
        this.bump(this.woodRes);
        this.ring(to);
      };
      anim.onfinish = land;
      anim.oncancel = land;
    }
  }

  /** small burst ring where something lands on the HUD */
  ring(at) {
    const d = document.createElement('div');
    d.className = 'hud-ring';
    d.style.left = `${at.x}px`; d.style.top = `${at.y}px`;
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 450);
  }

  /** a log leaves the counter and drops into the fire */
  spendWood(toPos, camera) {
    const r = this.woodRes.getBoundingClientRect();
    const from = { x: r.left + 20, y: r.top + r.height / 2 };
    const to = this.screen(toPos, camera);
    this.bump(this.woodRes, 'spend');
    const d = document.createElement('div');
    d.className = 'fly-wood';
    this.el.popups.appendChild(d);
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 40 };
    const a = d.animate([
      { transform: `translate(${from.x}px, ${from.y}px) translate(-50%,-50%) scale(1) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%,-50%) scale(1.2) rotate(200deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${to.x}px, ${to.y}px) translate(-50%,-50%) scale(.6) rotate(400deg)`, opacity: 0.2 },
    ], { duration: 380, easing: 'ease-in', fill: 'both' });
    a.onfinish = () => d.remove();
  }

  popup(text, pos, camera, cls = 'wood') {
    this.v.set(pos.x, pos.y ?? 2, pos.z).project(camera);
    const x = (this.v.x * 0.5 + 0.5) * innerWidth;
    const y = (-this.v.y * 0.5 + 0.5) * innerHeight;
    const d = document.createElement('div');
    d.className = `popup ${cls}`;
    d.textContent = text;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 950);
  }
}

/** ?tune=1 → live sliders for every number in config.tune */
export function buildTunePanel() {
  const panel = $('tune');
  panel.hidden = false;
  const labels = {
    moveSpeed: '이동 속도', accel: '가속', decel: '감속', turnSpeed: '회전 속도',
    rollSpeed: '구르기 속도', rollTime: '구르기 시간', rollCooldown: '구르기 대기',
    attackTime: '도끼질 시간', attackRange: '도끼 사거리',
    stride: '보폭(발 맞춤)', swing: '팔다리 흔들기', bob: '통통 튐', lean: '앞으로 기울기',
    camDistance: '카메라 거리', camPitch: '카메라 각도', camFollow: '카메라 따라오기',
  };
  const head = document.createElement('div');
  head.className = 'tune-head';
  head.innerHTML = '<span>손맛 조절</span>';
  const hide = document.createElement('button');
  hide.textContent = '접기';
  head.appendChild(hide);
  panel.appendChild(head);
  const body = document.createElement('div');
  panel.appendChild(body);
  hide.onclick = () => { body.hidden = !body.hidden; hide.textContent = body.hidden ? '펴기' : '접기'; };
  const out = document.createElement('textarea');
  const dump = () => { out.value = JSON.stringify(tune); };
  for (const [k, [min, max, step]] of Object.entries(tuneRanges)) {
    const l = document.createElement('label');
    const name = document.createElement('span'); name.textContent = labels[k] || k;
    const val = document.createElement('b'); val.textContent = tune[k];
    const r = document.createElement('input');
    Object.assign(r, { type: 'range', min, max, step, value: tune[k] });
    r.oninput = () => { tune[k] = parseFloat(r.value); val.textContent = r.value; dump(); };
    l.append(name, val, r);
    body.appendChild(l);
  }
  dump();
  body.appendChild(out);
}
