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
  }

  show(on) { this.el.hud.hidden = !on; }

  update(s) {
    const e = this.el;
    e.hp.style.width = `${(s.hp / s.hpMax) * 100}%`;
    e.wood.textContent = s.wood;
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
