import * as THREE from 'three';
import { tune, tuneRanges } from './config.js';
import { ITEMS, USE_ORDER, RECIPES, canAfford } from './items.js';
import { sfx } from './sound.js';

const $ = (id) => document.getElementById(id);
const RES_KINDS = ['wood', 'stone', 'bead'];
const costIcon = (k) => (RES_KINDS.includes(k) ? `<span class="res-icon ${k}"></span>` : `<span class="item-icon ${k} mini"></span>`);

export class Hud {
  constructor(input) {
    this.input = input;
    this.el = {
      hud: $('hud'), hp: $('hp-fill'), fire: $('fire-fill'),
      clock: $('clock'), clockIcon: $('clock-icon'), clockText: $('clock-text'), clockFill: $('clock-fill'),
      toast: $('toast'), popups: $('popups'), action: $('btn-action'), actionLabel: $('action-label'), roll: $('btn-roll'),
      items: $('item-bar'), craftBtn: $('btn-craft'), craft: $('craft'), craftList: $('craft-list'),
      danger: $('danger'), banner: $('banner'), bannerText: $('banner-text'), bannerSub: $('banner-sub'),
    };
    this.toastTimer = 0;
    this.bannerTimer = 0;
    this.v = new THREE.Vector3();
    this.lastAction = '';
    this.pending = {};      // items still flying toward their HUD slot
    this.shown = {};
    this.resEl = {};
    for (const el of document.querySelectorAll('.res[data-kind]')) this.resEl[el.dataset.kind] = el;

    // item bar buttons (built once, hidden while you have none)
    this.itemBtns = {};
    USE_ORDER.forEach((id, i) => {
      const b = document.createElement('button');
      b.className = 'item-btn';
      b.dataset.kind = id;
      b.innerHTML = `<span class="item-icon ${id}"></span><b>0</b><small>${ITEMS[id].name}</small><kbd>${i + 1}</kbd>`;
      b.hidden = true;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.input.pressed.add('item:' + id); this.bump(b); });
      this.el.items.appendChild(b);
      this.itemBtns[id] = b;
      this.resEl[id] = b;
    });
    this.el.craftBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.input.pressed.add('craft'); });
    $('craft-close').addEventListener('pointerdown', (e) => { e.preventDefault(); this.input.pressed.add('craft'); });
    this.craftOpen = false;
    this.craftSig = '';
  }

  show(on) { this.el.hud.hidden = !on; if (!on) this.setCraft(false); }

  /** amount to display = real amount minus whatever is still flying in */
  shownCount(kind, real) { return Math.max(0, real - (this.pending[kind] || 0)); }

  update(s) {
    const e = this.el;
    e.hp.style.width = `${(s.hp / s.hpMax) * 100}%`;
    $('water-fill').style.width = `${s.water}%`;
    $('food-fill').style.width = `${s.food}%`;
    $('need-water').classList.toggle('low', s.water < 25);
    $('need-food').classList.toggle('low', s.food < 25);
    const tc = $('need-torch');
    if (tc.hidden === s.torch > 0) tc.hidden = !(s.torch > 0);
    if (s.torch > 0) $('torch-time').textContent = Math.ceil(s.torch);
    if (this.dlg && this.dlg.typing) this.typeTick(s.dt);
    for (const kind of ['wood', 'stone', 'bead']) {
      const n = this.shownCount(kind, s.inv[kind]);
      if (this.shown[kind] !== n) { this.shown[kind] = n; $('res-' + kind).textContent = n; }
    }
    for (const id of USE_ORDER) {
      const b = this.itemBtns[id];
      const n = this.shownCount(id, s.inv[id]);
      const have = s.inv[id] > 0;
      if (b.hidden === have) b.hidden = !have;
      if (this.shown[id] !== n) { this.shown[id] = n; b.querySelector('b').textContent = n; }
    }
    e.fire.style.width = `${(s.fuel / s.fuelMax) * 100}%`;
    const icons = { day: '☀', dusk: '☀', night: '☾', dawn: '☀' };
    const mm = Math.floor(s.remain / 60), ss = Math.floor(s.remain % 60).toString().padStart(2, '0');
    e.clockIcon.textContent = icons[s.phase];
    const d = `${s.day}일째`;
    e.clockText.textContent = s.phase === 'night' ? `${d} 밤 · ${mm}:${ss}` : s.phase === 'day' ? `${d} 낮 · ${mm}:${ss}` : s.phase === 'dusk' ? `${d} 해질녘` : `${d} 새벽`;
    e.clockFill.style.width = `${s.progress * 100}%`;
    e.clock.classList.toggle('night', s.phase === 'night');
    const bb = $('boss-bar');
    if (bb.hidden === !!s.boss) bb.hidden = !s.boss;
    if (s.boss) $('boss-fill').style.width = `${Math.max(0, s.boss.hp / s.boss.maxHp) * 100}%`;

    if (s.actionLabel !== this.lastAction) {
      e.actionLabel.textContent = s.actionLabel;
      e.action.classList.toggle('feed', s.actionLabel === '장작 넣기');
      e.action.classList.toggle('open', s.actionLabel === '열기' || s.actionLabel === '따기');
      e.action.classList.toggle('drink', s.actionLabel === '물 마시기');
      e.action.classList.toggle('talk', s.actionLabel === '말 걸기');
      e.action.classList.toggle('rescue', s.actionLabel === '구하기');
      this.lastAction = s.actionLabel;
    }
    e.roll.classList.toggle('cool', s.rollCool);
    if (e.craftBtn.hidden === s.canCraft) e.craftBtn.hidden = !s.canCraft;
    if (this.craftOpen) this.renderCraft(s);

    // danger: red edges in the dark, heartbeat when low on health
    const beat = s.lowHp > 0 ? (0.5 + 0.5 * Math.pow(Math.abs(Math.sin(s.time * 3.2)), 6)) * s.lowHp : 0;
    const dz = Math.max(s.danger * (0.75 + 0.25 * Math.sin(s.time * 5)), beat);
    e.danger.style.opacity = dz.toFixed(3);

    if (this.toastTimer > 0) {
      this.toastTimer -= s.dt;
      if (this.toastTimer <= 0) e.toast.classList.remove('show');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= s.dt;
      if (this.bannerTimer <= 0) e.banner.classList.remove('show');
    }
  }

  toast(text, secs = 2.4) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastTimer = secs;
  }

  /** big centre text for day changes and raids */
  banner(text, sub = '', secs = 2.6, cls = '') {
    const e = this.el;
    e.bannerText.textContent = text;
    e.bannerSub.textContent = sub;
    e.banner.className = cls;
    void e.banner.offsetWidth;
    e.banner.classList.add('show');
    this.bannerTimer = secs;
  }

  /** spooky night-start card: black flash, flickering red title, an ominous line */
  nightIntro(title, sub, boss = false) {
    const el = $('night-intro');
    this.el.banner.classList.remove('show'); this.bannerTimer = 0;
    this.el.toast.classList.remove('show'); this.toastTimer = 0;
    $('ni-title').textContent = title;
    $('ni-sub').textContent = sub;
    el.className = boss ? 'boss' : '';
    el.hidden = true;
    void el.offsetWidth;
    el.hidden = false;
    clearTimeout(this.niTimer);
    this.niTimer = setTimeout(() => { el.hidden = true; }, 3700);
  }

  // ---------- dialogue ----------
  /** lines: [{who, role, text}] — calls done() after the last one */
  say(lines, done) {
    this.dlg = { lines, i: -1, done, typing: false, shown: 0 };
    $('dialog').hidden = false;
    this.dialogNext();
  }

  get talking() { return !!this.dlg; }

  dialogNext() {
    const d = this.dlg;
    if (!d) return;
    if (d.typing) { d.typing = false; $('dlg-text').textContent = d.lines[d.i].text; return; } // finish the line first
    d.i += 1;
    if (d.i >= d.lines.length) {
      $('dialog').hidden = true;
      this.dlg = null;
      if (d.done) d.done();
      return;
    }
    const L = d.lines[d.i];
    $('dlg-name').textContent = L.who;
    $('dlg-role').textContent = L.role || '';
    $('dialog').className = L.who === '이야기' ? 'narrator' : '';
    $('dlg-text').textContent = '';
    d.typing = true; d.shown = 0;
  }

  typeTick(dt) {
    const d = this.dlg;
    const text = d.lines[d.i].text;
    d.shown = Math.min(text.length, d.shown + dt * 38);
    $('dlg-text').textContent = text.slice(0, Math.floor(d.shown));
    if (d.shown >= text.length) d.typing = false;
  }

  setNightGloom(v) { $('night-vignette').style.opacity = v.toFixed(3); }

  // ---------- crafting panel ----------
  setCraft(open) {
    this.craftOpen = open;
    this.el.craft.hidden = !open;
    this.craftSig = '';
  }

  renderCraft(s) {
    const list = RECIPES.filter((r) => r.show(s));
    const sig = list.map((r) => r.id + canAfford(s.inv, r.cost)).join() + JSON.stringify(s.inv);
    if (sig === this.craftSig) return;
    this.craftSig = sig;
    this.el.craftList.innerHTML = '';
    for (const r of list) {
      const ok = canAfford(s.inv, r.cost);
      const row = document.createElement('div');
      row.className = 'recipe' + (ok ? '' : ' no');
      const cost = Object.entries(r.cost).map(([k, v]) =>
        `<span class="cost ${(s.inv[k] || 0) >= v ? '' : 'short'}">${costIcon(k)}${v}</span>`).join('');
      row.innerHTML = `<div class="r-text"><b>${r.name}</b><small>${r.desc}</small><div class="costs">${cost}</div></div>`;
      const btn = document.createElement('button');
      btn.className = 'r-btn';
      btn.textContent = ok ? '만들기' : '부족';
      btn.disabled = !ok;
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (ok) this.input.pressed.add('make:' + r.id); });
      row.appendChild(btn);
      this.el.craftList.appendChild(row);
    }
  }

  // ---------- flying pickups ----------
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

  slotPoint(kind) {
    const el = this.resEl[kind];
    // item buttons are hidden until the first one lands: aim at the bar instead
    const target = el && !el.hidden ? el : this.el.items;
    const r = target.getBoundingClientRect();
    if (!r.width) return { x: innerWidth - 60, y: innerHeight - 160 };
    return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 };
  }

  /** things pop out at a world spot, arc up, then fly into their HUD slot one by one */
  collect(kind, n, pos, camera, startDelay = 0) {
    const from = this.screen(pos, camera);
    this.pending[kind] = (this.pending[kind] || 0) + n;
    const shown = Math.min(n, 6); // don't spam: big stacks fly as a few icons
    for (let i = 0; i < shown; i++) {
      const per = i === shown - 1 ? n - (shown - 1) : 1;
      const d = document.createElement('div');
      d.className = `fly fly-${kind}`;
      this.el.popups.appendChild(d);
      const side = (i - (shown - 1) / 2) * 52 + (Math.random() - 0.5) * 16;
      const peak = { x: from.x + side, y: from.y - 34 - Math.random() * 18 };
      const delay = startDelay + 120 + i * 120;
      const spin = (Math.random() < 0.5 ? -1 : 1) * (300 + Math.random() * 200);
      let to = null;
      const anim = d.animate([
        { transform: `translate(${from.x}px, ${from.y}px) translate(-50%,-50%) scale(.3) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${peak.x}px, ${peak.y}px) translate(-50%,-50%) scale(1.5) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.3, easing: 'cubic-bezier(.5,0,.9,.6)' },
        { transform: `translate(${peak.x}px, ${peak.y - 6}px) translate(-50%,-50%) scale(1.35) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.42 },
        { transform: `translate(${peak.x}px, ${peak.y - 6}px) translate(-50%,-50%) scale(1.35) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.43 },
      ], { duration: 310, delay, fill: 'forwards' });
      // second leg is computed when it starts, so it lands on the slot even if the bar just appeared
      anim.onfinish = () => {
        to = this.slotPoint(kind);
        const b = d.animate([
          { transform: `translate(${peak.x}px, ${peak.y - 6}px) translate(-50%,-50%) scale(1.35) rotate(${spin * 0.5}deg)` },
          { transform: `translate(${to.x}px, ${to.y}px) translate(-50%,-50%) scale(.8) rotate(${spin}deg)` },
        ], { duration: 420, easing: 'cubic-bezier(.6,0,.9,.5)', fill: 'forwards' });
        b.onfinish = b.oncancel = land;
      };
      const land = () => {
        d.remove();
        this.pending[kind] = Math.max(0, (this.pending[kind] || 0) - per);
        const el = this.resEl[kind];
        if (el && !el.hidden) this.bump(el);
        if (to) this.ring(to);
        if (kind === 'bead') sfx('bead'); else sfx('pickup', i);
      };
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

  /** something leaves its slot and drops into the world (wood into the fire) */
  spend(kind, toPos, camera) {
    const from = this.slotPoint(kind);
    const to = this.screen(toPos, camera);
    const el = this.resEl[kind];
    if (el) this.bump(el, 'spend');
    const d = document.createElement('div');
    d.className = `fly fly-${kind}`;
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
    const p = this.screen(pos, camera);
    const d = document.createElement('div');
    d.className = `popup ${cls}`;
    d.textContent = text;
    d.style.left = `${p.x}px`;
    d.style.top = `${p.y}px`;
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }
}

/** ?tune=1 → live sliders for every number in config.tune */
export function buildTunePanel() {
  const panel = $('tune');
  panel.hidden = false;
  const labels = {
    moveSpeed: '이동 속도', accel: '가속', decel: '감속', turnSpeed: '회전 속도',
    rollSpeed: '구르기 속도', rollTime: '구르기 시간', rollCooldown: '구르기 대기', rollChain: '연속 구르기 횟수',
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
