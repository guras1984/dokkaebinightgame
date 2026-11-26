import * as THREE from 'three';
import { rules, tune } from './config.js';
import { Input } from './input.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Monsters } from './monsters.js';
import { DayNight } from './daynight.js';
import { QuarterCamera } from './camera.js';
import { Effects } from './effects.js';
import { Hud, buildTunePanel } from './hud.js';

const params = new URLSearchParams(location.search);
const SPEED = parseFloat(params.get('speed') || '1');   // ?speed=6 → time runs 6x (for testing)
const $ = (id) => document.getElementById(id);

// ---------- renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();

const input = new Input();
const camera = new QuarterCamera();
const world = new World(scene);
const effects = new Effects(scene);
const player = new Player(scene);
const monsters = new Monsters(scene, effects);
const daynight = new DayNight(scene, renderer);
const hud = new Hud();

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.resize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// ---------- game state ----------
let state = 'title';      // title | playing | paused | over
let announced = {};
const wish = new THREE.Vector3();
const tmp = new THREE.Vector3();

function startGame() {
  player.reset();
  monsters.reset();
  world.fire.fuel = rules.fireStart;
  daynight.time = parseFloat(params.get('t') || '0');   // ?t=150 → start near dusk
  announced = {};
  state = 'playing';
  input.clear();
  $('title-screen').hidden = true;
  $('result-screen').hidden = true;
  $('pause-screen').hidden = true;
  hud.show(true);
  showControls(true);
  camera.snap(player.pos);
  hud.toast('낮 동안 나무를 베어 장작을 모으자', 3);
}

function showControls(on) {
  const touch = Input.isTouchDevice();
  $('touch').hidden = !(on && touch);
  $('keys-hint').hidden = !(on && !touch);
}

function setPaused(p) {
  if (state === 'over' || state === 'title') return;
  state = p ? 'paused' : 'playing';
  $('pause-screen').hidden = !p;
  input.clear();
}

function endGame(won) {
  state = 'over';
  showControls(false);
  hud.show(false);
  $('result-eyebrow').textContent = '첫째 밤';
  $('result-title').textContent = won ? '살아남았다!' : '쓰러졌다…';
  $('result-desc').textContent = won
    ? '닭이 울자 도깨비들이 사라졌다. 다음 밤은 더 길다.'
    : '어둠 속에서 도깨비 방망이에 맞았다. 불빛 가까이 머물러 보자.';
  const st = player.stats;
  $('result-stats').innerHTML = [
    ['벤 나무', st.trees], ['물리친 도깨비', st.kills], ['넣은 장작', st.fed], ['남은 체력', Math.ceil(player.hp)],
  ].map(([k, v]) => `<li>${k}<b>${v}</b></li>`).join('');
  setTimeout(() => { $('result-screen').hidden = false; }, won ? 900 : 1400);
}

$('start-btn').onclick = startGame;
$('again-btn').onclick = startGame;
$('pause-btn').onclick = () => setPaused(true);
$('resume-btn').onclick = () => setPaused(false);
$('quit-btn').onclick = () => {
  state = 'title';
  $('pause-screen').hidden = true;
  $('title-screen').hidden = false;
  hud.show(false);
  showControls(false);
};
if (params.get('nopause') !== '1') {
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') setPaused(true); });
}
if (params.get('tune') === '1') buildTunePanel();

// ---------- gameplay helpers ----------
const nearFire = () => Math.hypot(player.pos.x - world.fire.x, player.pos.z - world.fire.z) < 2.3;

/** nearest thing worth swinging at, within reach */
function findTarget(maxDist) {
  let best = null, bestD = maxDist;
  for (const m of monsters.alive) {
    const d = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z) - 0.3; // monsters take priority
    if (d < bestD) { bestD = d; best = { kind: 'monster', obj: m, x: m.pos.x, z: m.pos.z }; }
  }
  if (best) return best;
  for (const t of world.trees) {
    if (!t.alive) continue;
    const d = Math.hypot(t.x - player.pos.x, t.z - player.pos.z) - t.r;
    if (d < bestD) { bestD = d; best = { kind: 'tree', obj: t, x: t.x, z: t.z }; }
  }
  return best;
}

function tryAction() {
  if (nearFire() && player.wood > 0 && !player.attacking && !player.rolling) {
    if (world.fire.fuel >= rules.fireMax - 1) { hud.toast('불이 충분히 크다', 1.2); return; }
    player.wood -= 1;
    player.stats.fed += 1;
    const was = world.fire.fuel;
    world.fire.fuel = Math.min(rules.fireMax, world.fire.fuel + rules.fuelPerWood);
    effects.spawn(world.fire.x, 1, world.fire.z, 0xffc25a, { n: 12, speed: 1.5, up: 5, life: 0.7, size: 0.12, grav: 2 });
    hud.popup(was <= 0 ? '불이 다시 붙었다!' : '+불', { x: world.fire.x, y: 2.2, z: world.fire.z }, camera.cam, 'fire');
    player.attackT = -1;
    return;
  }
  // auto-aim when standing still (helps a lot on touch)
  const target = findTarget(2.6);
  let aim = null;
  if (target && wish.lengthSq() < 0.04) aim = Math.atan2(target.x - player.pos.x, target.z - player.pos.z);
  else if (target) {
    // gentle assist: snap if the target is roughly ahead
    const a = Math.atan2(target.x - player.pos.x, target.z - player.pos.z);
    if (Math.abs(Math.atan2(Math.sin(a - player.facing), Math.cos(a - player.facing))) < 1.0) aim = a;
  }
  player.startAttack(aim);
}

function resolveStrike() {
  const fx = Math.sin(player.facing), fz = Math.cos(player.facing);
  const reach = tune.attackRange;
  let hitSomething = false;
  for (const m of monsters.alive) {
    const dx = m.pos.x - player.pos.x, dz = m.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d > reach + m.radius) continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.2) continue;
    hitSomething = true;
    const killed = m.hit(player.pos.x, player.pos.z);
    effects.spawn(m.pos.x, 1.1, m.pos.z, 0xfff2a8, { n: 6, speed: 4, up: 3, life: 0.35, size: 0.1 });
    camera.shake = Math.max(camera.shake, 0.6);
    if (killed) { player.stats.kills += 1; hud.popup('물리쳤다!', { x: m.pos.x, y: 2.4, z: m.pos.z }, camera.cam, 'fire'); }
  }
  if (hitSomething) return;
  for (const t of world.trees) {
    if (!t.alive) continue;
    const dx = t.x - player.pos.x, dz = t.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d > reach + t.r) continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.3) continue;
    const got = world.chopTree(t, player.pos.x, player.pos.z);
    effects.spawn(t.x - fx * 0.3, 0.8, t.z - fz * 0.3, 0xd9a066, { n: 7, speed: 3, up: 3, life: 0.5, size: 0.11 });
    camera.shake = Math.max(camera.shake, 0.25);
    if (got) {
      player.wood += got; player.stats.wood += got; player.stats.trees += 1;
      hud.popup(`+${got} 장작`, { x: t.x, y: 2.6, z: t.z }, camera.cam, 'wood');
    }
    break; // one tree per swing
  }
}

// ---------- main loop ----------
let last = performance.now();
let clock = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
}

function tick(dt) {
  clock += dt;
  const nowS = clock;
  input.update();

  if (input.consume('pause')) setPaused(state === 'playing');
  if (state !== 'playing') {
    input.pressed.delete('action'); input.pressed.delete('roll');
    if (state === 'title' || state === 'over') {
      // idle showcase: slow orbit of daylight
      daynight.update(0, player.pos);
      world.updateFire(dt, nowS, daynight.darkness());
      camera.update(dt, player.pos, tmp.set(0, 0, 0));
      if (state === 'over') { player.update(dt, tmp.set(0, 0, 0), world); monsters.update(dt, ctx(), -1); effects.update(dt); }
    }
    renderer.render(scene, camera.cam);
    return;
  }

  const gdt = dt * SPEED;
  camera.toWorld(input.move.x, input.move.y, wish);

  if (input.consume('roll')) player.startRoll(wish.clone());
  if (input.consume('action') || (input.actionHeld && !player.attacking && !player.rolling && !nearFire())) tryAction();

  const ev = player.update(dt, wish, world);
  if (ev === 'strike') resolveStrike();

  const phase = daynight.phase();
  const { darkness } = daynight.update(gdt, player.pos);
  world.water.material.color.copy(daynight.col.water);

  // fire burns down
  const burn = phase === 'night' ? rules.burnNight : phase === 'dusk' ? (rules.burnDay + rules.burnNight) / 2 : rules.burnDay;
  if (world.fire.fuel > 0) {
    world.fire.fuel = Math.max(0, world.fire.fuel - burn * gdt);
    if (world.fire.fuel === 0) hud.toast('모닥불이 꺼졌다! 장작을 넣어!', 3);
  }
  world.updateFire(dt, nowS, darkness);
  world.updateTrees(dt);
  world.updateOcclusion(dt, player.pos.x, player.pos.z, camera.back);
  const fireR = world.fireRadius();

  // healing in the firelight
  const inLight = fireR > 0 && Math.hypot(player.pos.x - world.fire.x, player.pos.z - world.fire.z) < fireR;
  if (inLight && player.hurtT > 3 && player.hp < rules.playerHp) player.hp = Math.min(rules.playerHp, player.hp + rules.regenInLight * dt);

  const nightP = phase === 'night' ? daynight.progress() : -1;
  const events = monsters.update(dt, ctx(), nightP);
  for (const e of events) {
    if (e.type === 'hitPlayer' && player.hurt(rules.monsterDamage, e.m.pos.x, e.m.pos.z)) {
      camera.shake = 1;
      hud.popup(`-${rules.monsterDamage}`, { x: player.pos.x, y: 2.4, z: player.pos.z }, camera.cam, 'hurt');
    }
  }
  effects.update(dt);

  // story beats
  const beat = (key, text, secs) => { if (!announced[key]) { announced[key] = true; hud.toast(text, secs); } };
  if (phase === 'day' && daynight.remaining() < 30) beat('late', '곧 해가 진다. 모닥불에 장작을 넣자', 3);
  if (phase === 'dusk') beat('dusk', '해가 진다…', 2.5);
  if (phase === 'night') beat('night', '도깨비가 나타났다! 불빛 안은 안전하다', 3.2);
  if (phase === 'night' && daynight.remaining() < 20) beat('almost', '조금만 더! 곧 새벽이다', 2.5);

  if (player.dead) { endGame(false); }
  else if (phase === 'dawn') {
    monsters.banishAll();
    hud.toast('꼬끼오! 새벽이 왔다', 2.5);
    endGame(true);
  }

  const lead = tmp.set(player.vel.x, 0, player.vel.z).multiplyScalar(1 / Math.max(1, tune.moveSpeed));
  camera.update(dt, player.pos, lead);

  hud.update({
    dt, hp: player.hp, hpMax: rules.playerHp, wood: player.wood, fuel: world.fire.fuel,
    phase, progress: daynight.progress(), remain: daynight.remaining(),
    canFeed: nearFire() && player.wood > 0, rollCool: player.rollCool > 0 || player.rolling,
  });
  renderer.render(scene, camera.cam);
}

function ctx() {
  return { player, world, fireR: world.fireRadius(), effects };
}

camera.snap(player.pos);
requestAnimationFrame(frame);

// debug handle for automated checks
window.__game = {
  get state() { return state; }, player, world, monsters, daynight, camera, input, tune, rules,
  start: startGame, setTime: (t) => { daynight.time = t; },
  /** advance the game n frames without waiting for the browser (used by automated checks) */
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); return window.__game.info(); },
  key: (k, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k })),
  info: () => ({
    state, phase: daynight.phase(), time: +daynight.time.toFixed(1), hp: +player.hp.toFixed(1), wood: player.wood,
    fuel: +world.fire.fuel.toFixed(1), fireR: +world.fireRadius().toFixed(2), monsters: monsters.alive.length,
    pos: [+player.pos.x.toFixed(2), +player.pos.z.toFixed(2)], trees: world.trees.filter((t) => t.alive).length,
  }),
};
