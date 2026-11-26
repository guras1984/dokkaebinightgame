import * as THREE from 'three';
import { rules, tune } from './config.js';
import { Input } from './input.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Monsters } from './monsters.js';
import { DayNight } from './daynight.js';
import { QuarterCamera } from './camera.js';
import { Effects } from './effects.js';
import { Camp } from './camp.js';
import { Critters } from './critters.js';
import { Hud, buildTunePanel } from './hud.js';
import { RECIPES, USE_ORDER, ITEMS, canAfford, pay, rollLoot } from './items.js';

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
const effects = new Effects(scene, 160);
const camp = new Camp(scene, world);
const player = new Player(scene);
const critters = new Critters(scene);
const monsters = new Monsters(scene, effects);
const daynight = new DayNight(scene, renderer);
const hud = new Hud(input);

// expanding gold ring for the talisman blast
const blast = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0, depthWrite: false }));
blast.rotation.x = -Math.PI / 2; blast.position.y = 0.06;
scene.add(blast);
let blastT = -1;

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.resize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// ---------- game state ----------
let state = 'title';      // title | playing | paused | over
let day = 1;
let announced = {};
let hitStop = 0;
const wish = new THREE.Vector3();
const tmp = new THREE.Vector3();

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
function showBest() {
  const b = parseInt(store.get('dokkaebi.best') || '0', 10);
  $('best').textContent = b > 0 ? `최고 기록: ${b}일 밤` : '';
}
showBest();

function startGame() {
  player.reset();
  monsters.reset();
  camp.reset();
  world.regrow(1, 999, 999);
  world.refillBushes();
  critters.reset();
  critters.repopulate(world, player.pos.x, player.pos.z);
  world.setFireLevel(0);
  world.fire.fuel = rules.fireStart;
  day = parseInt(params.get('day') || '1', 10);
  daynight.time = parseFloat(params.get('t') || '0');   // ?t=150 → start near dusk
  announced = {};
  hitStop = 0;
  state = 'playing';
  input.clear();
  $('title-screen').hidden = true;
  $('result-screen').hidden = true;
  $('pause-screen').hidden = true;
  hud.show(true);
  showControls(true);
  camera.snap(player.pos);
  spawnDayChests(true);
  hud.banner('1일째 아침', '백 일 밤을 버텨라', 2.6);
  setTimeout(() => { if (state === 'playing' && day === 1) hud.toast('나무를 베고 바위를 캐고, 궤짝을 찾아보자', 3.2); }, 2400);
}

function spawnDayChests(first) {
  // the first morning puts one chest close by so the player finds it
  if (first) camp.spawnChest('day', 6, 11);
  for (let i = first ? 1 : 0; i < rules.dayChests; i++) camp.spawnChest('day', 10, 25);
}

function showControls(on) {
  const touch = Input.isTouchDevice();
  // on-screen stick + buttons work with mouse too, so show them everywhere
  $('touch').hidden = !on;
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
  const survived = won ? rules.totalNights : day - 1;
  const best = Math.max(survived, parseInt(store.get('dokkaebi.best') || '0', 10));
  store.set('dokkaebi.best', String(best));
  showBest();
  $('result-eyebrow').textContent = won ? '백 일 밤' : `${day}일째 밤`;
  $('result-title').textContent = won ? '백 일을 버텼다!' : '쓰러졌다…';
  $('result-desc').textContent = won
    ? '백 번째 새벽, 도깨비들이 절을 하고 물러났다.'
    : survived > 0 ? `${survived}일 밤을 버텼다. 최고 기록 ${best}일.` : '불빛 가까이 머물고, 밤이 오기 전에 장작을 넉넉히 모아 두자.';
  const st = player.stats;
  $('result-stats').innerHTML = [
    ['버틴 밤', survived], ['물리친 도깨비', st.kills], ['연 궤짝', st.chests], ['지은 것', st.built],
  ].map(([k, v]) => `<li>${k}<b>${v}</b></li>`).join('');
  setTimeout(() => { $('result-screen').hidden = false; }, won ? 900 : 1400);
}

/** dawn: the night is over, roll into the next day */
function newDay() {
  const survived = day;
  monsters.banishAll();
  camp.clearChests('night');
  if (survived >= rules.totalNights) { endGame(true); return; }
  day += 1;
  daynight.time = 0;
  announced = {};
  world.regrow(rules.regrowShare, player.pos.x, player.pos.z);
  player.hp = Math.min(rules.playerHp, player.hp + rules.dawnHeal);
  spawnDayChests(false);
  world.refillBushes();
  critters.repopulate(world, player.pos.x, player.pos.z);
  hud.banner(`${survived}일째 밤을 버텼다!`, `꼬끼오! ${day}일째 아침`, 3);
  effects.spawn(player.pos.x, 1.2, player.pos.z, 0xffe27a, { n: 18, speed: 3, up: 5, life: 1, size: 0.14, grav: 3 });
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
const fireDist = () => Math.hypot(player.pos.x - world.fire.x, player.pos.z - world.fire.z);
const nearFire = () => fireDist() < 2.3 + world.fire.level * 0.3;
const axeDmg = () => (player.ironAxe ? 2 : 1);

/** nearest thing worth swinging at, within reach */
function findTarget(maxDist) {
  let best = null, bestD = maxDist;
  for (const m of monsters.alive) {
    const d = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z) - 0.3; // monsters take priority
    if (d < bestD) { bestD = d; best = { kind: 'monster', obj: m, x: m.pos.x, z: m.pos.z }; }
  }
  if (best) return best;
  for (const r of critters.alive) {
    const d = Math.hypot(r.pos.x - player.pos.x, r.pos.z - player.pos.z);
    if (d < bestD) { bestD = d; best = { kind: 'rabbit', obj: r, x: r.pos.x, z: r.pos.z }; }
  }
  if (best) return best;
  for (const t of [...world.trees, ...world.rocks]) {
    if (!t.alive) continue;
    const d = Math.hypot(t.x - player.pos.x, t.z - player.pos.z) - t.r;
    if (d < bestD) { bestD = d; best = { kind: 'thing', obj: t, x: t.x, z: t.z }; }
  }
  return best;
}

const chestNear = () => camp.nearestChest(player.pos.x, player.pos.z, 1.9);
const canDrink = () => player.water < 97 && (world.atShore(player.pos.x, player.pos.z) || camp.nearWell(player.pos.x, player.pos.z));
const bushNear = () => world.bushes.find((b) => b.ripe && Math.hypot(b.x - player.pos.x, b.z - player.pos.z) < b.r + 1.3);

/** first time you get something, say what it is for */
const FIRST_HINT = {
  stone: '돌: 석등·우물·모닥불 키우기 재료',
  bead: '도깨비 구슬: 쇠도끼·부적·약초 재료',
  rawmeat: '날고기: 모닥불 옆에서 누르면 구워진다',
  berry: '산딸기: 누르면 먹는다 (배고픔 회복)',
  herb: '약초: 누르면 체력 회복',
  charm: '부적: 누르면 주변 도깨비를 쫓아낸다',
};
function gain(kind, n, pos, delay = 0) {
  player.inv[kind] += n;
  hud.collect(kind, n, pos, camera.cam, delay);
  const key = 'first-' + kind;
  if (FIRST_HINT[kind] && !store.get('dokkaebi.' + key) && !announced[key]) {
    announced[key] = true;
    store.set('dokkaebi.' + key, '1');
    setTimeout(() => hud.toast(FIRST_HINT[kind], 3), 900 + delay);
  }
}

function openChest(c) {
  camp.open(c);
  player.stats.chests += 1;
  player.attackT = -1;
  player.facing = Math.atan2(c.x - player.pos.x, c.z - player.pos.z);
  const loot = rollLoot(c.kind, day);
  const night = c.kind === 'night';
  effects.spawn(c.x, 0.8, c.z, night ? 0x7fd3ff : 0xffe27a, { n: 20, speed: 3, up: 6, life: 0.9, size: 0.14, grav: 6 });
  camera.shake = Math.max(camera.shake, 0.35);
  hud.popup(night ? '도깨비 보물!' : '궤짝을 열었다!', { x: c.x, y: 2.2, z: c.z }, camera.cam, night ? 'fire big' : 'wood big');
  loot.forEach((it, i) => gain(it.kind, it.n, { x: c.x, y: 0.9, z: c.z }, 150 + i * 180));
}

function tryAction() {
  if (player.attacking || player.rolling) return;
  const c = chestNear();
  if (c) { openChest(c); return; }
  if (canDrink()) {
    player.water = Math.min(100, player.water + rules.drinkAmount);
    tmp.set(Math.sin(player.facing), 0, Math.cos(player.facing));
    effects.spawn(player.pos.x + tmp.x * 0.8, 0.3, player.pos.z + tmp.z * 0.8, 0x7fd3ff, { n: 12, speed: 2, up: 3, life: 0.6, size: 0.1 });
    hud.popup('꿀꺽꿀꺽', { x: player.pos.x, y: 2.4, z: player.pos.z }, camera.cam, 'water big');
    player.attackT = -1;
    return;
  }
  const b = bushNear();
  if (b) {
    const n = world.pickBush(b);
    effects.spawn(b.x, 0.6, b.z, 0xe8344e, { n: 8, speed: 2, up: 3, life: 0.5, size: 0.09 });
    gain('berry', n, { x: b.x, y: 0.7, z: b.z });
    hud.popup(`+${n} 산딸기`, { x: b.x, y: 1.8, z: b.z }, camera.cam, 'wood big');
    return;
  }
  if (nearFire() && player.wood > 0) {
    const max = world.fire.max;
    if (world.fire.fuel >= max - 1) { hud.toast('불이 충분히 크다', 1.2); return; }
    player.wood -= 1;
    player.stats.fed += 1;
    const was = world.fire.fuel;
    world.fire.fuel = Math.min(max, world.fire.fuel + rules.fuelPerWood);
    hud.spend('wood', { x: world.fire.x, y: 0.8, z: world.fire.z }, camera.cam);
    effects.spawn(world.fire.x, 1, world.fire.z, 0xffc25a, { n: 12, speed: 1.5, up: 5, life: 0.7, size: 0.12, grav: 2 });
    hud.popup(was <= 0 ? '불이 다시 붙었다!' : '+불', { x: world.fire.x, y: 2.2, z: world.fire.z }, camera.cam, 'fire');
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
  const reach = tune.attackRange + (player.ironAxe ? 0.2 : 0);
  const dmg = axeDmg();
  let hitSomething = false;
  for (const m of monsters.alive) {
    const dx = m.pos.x - player.pos.x, dz = m.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d > reach + m.radius) continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.2) continue;
    hitSomething = true;
    const killed = m.hit(dmg, player.pos.x, player.pos.z);
    effects.spawn(m.pos.x, 1.1, m.pos.z, 0xfff2a8, { n: 8, speed: 4.5, up: 3, life: 0.35, size: 0.11 });
    camera.shake = Math.max(camera.shake, 0.6);
    hitStop = Math.max(hitStop, killed ? rules.killStop : rules.hitStop);
    if (killed) {
      player.stats.kills += 1;
      hud.popup(m.type === 'elite' ? '큰 도깨비를 물리쳤다!' : '물리쳤다!', { x: m.pos.x, y: 2.4, z: m.pos.z }, camera.cam, 'fire big');
      gain('bead', m.T.beads, { x: m.pos.x, y: 1.2, z: m.pos.z }, 200);
    }
  }
  if (hitSomething) return;
  for (const r of critters.alive) {
    const dx = r.pos.x - player.pos.x, dz = r.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d > reach + r.radius + 0.2) continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.1) continue;
    if (r.hit()) {
      effects.spawn(r.pos.x, 0.5, r.pos.z, 0xf2ede4, { n: 10, speed: 3, up: 3, life: 0.5, size: 0.1 });
      hitStop = Math.max(hitStop, rules.hitStop);
      hud.popup('+1 날고기', { x: r.pos.x, y: 1.8, z: r.pos.z }, camera.cam, 'wood big');
      gain('rawmeat', 1, { x: r.pos.x, y: 0.6, z: r.pos.z });
      return;
    }
  }
  for (const t of world.trees) {
    if (!t.alive) continue;
    const dx = t.x - player.pos.x, dz = t.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d > reach + t.r) continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.3) continue;
    const got = world.chopTree(t, player.pos.x, player.pos.z, dmg);
    effects.spawn(t.x - fx * 0.3, 0.8, t.z - fz * 0.3, 0xd9a066, { n: 7, speed: 3, up: 3, life: 0.5, size: 0.11 });
    camera.shake = Math.max(camera.shake, 0.25);
    if (got) {
      player.wood += got; player.stats.wood += got; player.stats.trees += 1;
      hud.popup(`+${got} 장작`, { x: t.x, y: 2.6, z: t.z }, camera.cam, 'wood big');
      hud.collect('wood', got, { x: t.x, y: 1.0, z: t.z }, camera.cam);
      // chunky burst of wood bits + a firmer thump when the tree goes down
      effects.spawn(t.x, 1.2, t.z, 0xb9783f, { n: 14, speed: 4.5, up: 5, life: 0.8, size: 0.18 });
      effects.spawn(t.x, 2.2, t.z, 0x6fae4a, { n: 10, speed: 3, up: 2, life: 0.9, size: 0.14 });
      camera.shake = Math.max(camera.shake, 0.55);
    }
    return; // one thing per swing
  }
  for (const r of world.rocks) {
    if (!r.alive) continue;
    const dx = r.x - player.pos.x, dz = r.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d > reach + r.r) continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.3) continue;
    const got = world.mineRock(r, dmg);
    effects.spawn(r.x - fx * 0.4, 0.6, r.z - fz * 0.4, 0xffffff, { n: 5, speed: 4, up: 3, life: 0.25, size: 0.07 });
    effects.spawn(r.x - fx * 0.4, 0.6, r.z - fz * 0.4, 0xa7a9b2, { n: 6, speed: 3, up: 3, life: 0.5, size: 0.12 });
    camera.shake = Math.max(camera.shake, 0.3);
    hitStop = Math.max(hitStop, 0.03);
    if (got) {
      player.stats.rocks += 1;
      hud.popup(`+${got} 돌`, { x: r.x, y: 2.0, z: r.z }, camera.cam, 'wood big');
      gain('stone', got, { x: r.x, y: 0.8, z: r.z });
      effects.spawn(r.x, 0.8, r.z, 0x9a9ca6, { n: 16, speed: 4.5, up: 5, life: 0.8, size: 0.18 });
      camera.shake = Math.max(camera.shake, 0.55);
    }
    return;
  }
}

// ---------- crafting & items ----------
function craft(id) {
  const r = RECIPES.find((x) => x.id === id);
  if (!r || !r.show(craftState()) || !canAfford(player.inv, r.cost)) return;
  pay(player.inv, r.cost);
  for (const k of Object.keys(r.cost)) hud.spend(k, { x: world.fire.x, y: 1, z: world.fire.z }, camera.cam);
  const at = { x: world.fire.x, y: 1.2, z: world.fire.z };
  if (id === 'fire2' || id === 'fire3') {
    world.setFireLevel(id === 'fire2' ? 1 : 2);
    world.fire.fuel = Math.min(world.fire.max, world.fire.fuel + 25);
    effects.spawn(world.fire.x, 1, world.fire.z, 0xffb03a, { n: 30, speed: 4, up: 7, life: 1, size: 0.16, grav: 4 });
    camera.shake = 0.6;
    hud.banner('모닥불이 커졌다!', `불빛이 더 멀리 닿는다 (Lv.${world.fire.level + 1})`, 2.2);
  } else if (id === 'axe') {
    player.setAxe(true);
    effects.spawn(player.pos.x, 1.4, player.pos.z, 0xeaf2ff, { n: 20, speed: 3, up: 5, life: 0.8, size: 0.12, grav: 4 });
    hud.banner('쇠도끼!', '두 배로 세게 벤다', 2.2);
  } else if (r.gives) {
    const n = r.amount || 1;
    player.inv[r.gives] += n;
    hud.collect(r.gives, n, at, camera.cam, 250);
    hud.toast(`${ITEMS[r.gives].name}을(를) 만들었다`, 1.4);
  }
}

const craftState = () => ({ fireLevel: world.fire.level, ironAxe: player.ironAxe });

function useItem(id) {
  if (!player.inv[id] || player.dead) return;
  const fx = Math.sin(player.facing), fz = Math.cos(player.facing);
  if (id === 'berry' || id === 'meat' || (id === 'rawmeat' && !nearFire())) {
    if (player.food >= 99) { hud.toast('배부르다', 1.2); return; }
    const amt = id === 'berry' ? rules.berryFood : id === 'meat' ? rules.meatFood : rules.rawMeatFood;
    player.inv[id] -= 1;
    player.food = Math.min(100, player.food + amt);
    if (id === 'meat') player.hp = Math.min(rules.playerHp, player.hp + 8);
    effects.spawn(player.pos.x, 1.6, player.pos.z, id === 'berry' ? 0xe8344e : 0xd9783a, { n: 8, speed: 1.5, up: 2, life: 0.5, size: 0.08 });
    hud.popup(`냠냠 +${amt}`, { x: player.pos.x, y: 2.5, z: player.pos.z }, camera.cam, 'food big');
    if (id === 'rawmeat') hud.toast('구워 먹으면 훨씬 배부르다 (모닥불 옆)', 2);
  } else if (id === 'rawmeat') {
    // cook by the fire
    player.inv.rawmeat -= 1;
    effects.spawn(world.fire.x, 1.2, world.fire.z, 0xffd08a, { n: 14, speed: 1.5, up: 4, life: 0.8, size: 0.12, grav: -1 });
    hud.popup('지글지글', { x: world.fire.x, y: 2.4, z: world.fire.z }, camera.cam, 'fire big');
    gain('meat', 1, { x: world.fire.x, y: 1, z: world.fire.z }, 300);
  } else if (id === 'herb') {
    if (player.hp >= rules.playerHp - 0.5) { hud.toast('체력이 가득하다', 1.2); return; }
    player.inv.herb -= 1;
    player.hp = Math.min(rules.playerHp, player.hp + rules.herbHeal);
    effects.spawn(player.pos.x, 1.2, player.pos.z, 0x7be07a, { n: 16, speed: 1.5, up: 4, life: 0.9, size: 0.13, grav: -1 });
    hud.popup(`+${rules.herbHeal}`, { x: player.pos.x, y: 2.5, z: player.pos.z }, camera.cam, 'heal big');
  } else if (id === 'charm') {
    player.inv.charm -= 1;
    const n = monsters.banishNear(player.pos.x, player.pos.z, rules.charmRadius);
    blastT = 0; blast.position.x = player.pos.x; blast.position.z = player.pos.z;
    effects.spawn(player.pos.x, 1, player.pos.z, 0xffd65a, { n: 30, speed: 7, up: 3, life: 0.7, size: 0.14, grav: 2 });
    camera.shake = 0.9;
    hitStop = 0.08;
    hud.popup(n ? `부적! 도깨비 ${n}마리를 쫓았다` : '부적!', { x: player.pos.x, y: 2.6, z: player.pos.z }, camera.cam, 'fire big');
  } else if (id === 'lantern' || id === 'fence' || id === 'well') {
    const x = player.pos.x + fx * 1.5, z = player.pos.z + fz * 1.5;
    const why = camp.checkSpot(id, x, z);
    if (why) { hud.toast(why, 1.4); return; }
    player.inv[id] -= 1;
    camp.build(id, x, z, player.facing);
    player.stats.built += 1;
    effects.spawn(x, 0.4, z, id === 'fence' ? 0xb07a45 : 0xd6d3cb, { n: 12, speed: 2.5, up: 3, life: 0.6, size: 0.13 });
    camera.shake = Math.max(camera.shake, 0.3);
    if (id === 'lantern' && !announced.lanternTip) { announced.lanternTip = true; hud.toast('석등은 해가 지면 켜진다', 2.2); }
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
    input.pressed.clear();
    if (state === 'title' || state === 'over') {
      daynight.update(0, player.pos);
      world.updateFire(dt, nowS, daynight.darkness());
      camera.update(dt, player.pos, tmp.set(0, 0, 0));
      if (state === 'over') { player.update(dt, tmp.set(0, 0, 0), world); monsters.update(dt, ctx(), -1, day); effects.update(dt); }
    }
    renderer.render(scene, camera.cam);
    return;
  }

  // hit-stop: freeze the world for a few frames so hits land with weight
  if (hitStop > 0) {
    hitStop -= dt;
    camera.update(dt, player.pos, tmp.set(0, 0, 0));
    renderer.render(scene, camera.cam);
    return;
  }

  const gdt = dt * SPEED;
  camera.toWorld(input.move.x, input.move.y, wish);

  // crafting panel (only by the fire)
  const canCraft = fireDist() < 3.6 + world.fire.level * 0.3;
  if (input.consume('craft')) {
    if (hud.craftOpen) hud.setCraft(false);
    else if (canCraft) hud.setCraft(true);
    else hud.toast('만들기는 모닥불 옆에서', 1.4);
  }
  if (hud.craftOpen && !canCraft) hud.setCraft(false);
  for (const p of [...input.pressed]) {
    if (p.startsWith('make:')) { input.pressed.delete(p); craft(p.slice(5)); }
    else if (p.startsWith('item:')) { input.pressed.delete(p); useItem(p.slice(5)); }
    else if (p.startsWith('slot')) { input.pressed.delete(p); useItem(USE_ORDER[parseInt(p.slice(4), 10) - 1]); }
  }

  if (input.consume('roll')) player.startRoll(wish.clone());
  const autoOk = !player.attacking && !player.rolling && !nearFire() && !chestNear() && !bushNear();
  if (input.consume('action') || (input.actionHeld && autoOk)) tryAction();

  const ev = player.update(dt, wish, world);
  if (ev === 'strike') resolveStrike();

  const phase = daynight.phase();
  const { darkness } = daynight.update(gdt, player.pos);
  world.water.material.color.copy(daynight.col.water);

  // fire burns down
  const burn = phase === 'night' ? rules.burnNight : phase === 'dusk' ? (rules.burnDay + rules.burnNight) / 2 : rules.burnDay;
  if (world.fire.fuel > 0) {
    world.fire.fuel = Math.max(0, world.fire.fuel - burn * gdt);
    if (world.fire.fuel === 0) { hud.toast('모닥불이 꺼졌다! 장작을 넣어!', 3); camera.shake = 0.5; }
  }
  world.updateFire(dt, nowS, darkness);
  world.updateTrees(dt);
  world.updateRocks(dt);
  world.updateOcclusion(dt, player.pos.x, player.pos.z, camera.back);
  camp.update(dt, nowS, darkness);
  const c = ctx();

  const beat = (key, text, secs) => { if (!announced[key]) { announced[key] = true; hud.toast(text, secs); } };
  // healing in any light
  const inLight = c.zones.some((z) => Math.hypot(player.pos.x - z.x, player.pos.z - z.z) < z.r);
  if (inLight && player.hurtT > 3 && player.hp < rules.playerHp) player.hp = Math.min(rules.playerHp, player.hp + rules.regenInLight * dt);

  // thirst and hunger
  player.water = Math.max(0, player.water - rules.waterDrain * gdt);
  player.food = Math.max(0, player.food - rules.foodDrain * gdt);
  if ((player.water <= 0 || player.food <= 0) && !player.dead) {
    player.hp = Math.max(0, player.hp - rules.needDamage * gdt * ((player.water <= 0) + (player.food <= 0)));
    if (player.hp <= 0) player.dead = true;
  }
  if (player.water < 25) beat('thirst', '목이 마르다! 물가나 우물에서 물을 마시자', 3);
  if (player.food < 25) beat('hunger', '배가 고프다! 산딸기나 고기를 먹자', 3);

  const nightP = phase === 'night' ? daynight.progress() : -1;
  const events = monsters.update(dt, c, nightP, day);
  for (const e of events) {
    if (e.type === 'hitPlayer' && player.hurt(e.m.damage, e.m.pos.x, e.m.pos.z)) {
      camera.shake = 1;
      hitStop = 0.07;
      hud.popup(`-${e.m.damage}`, { x: player.pos.x, y: 2.4, z: player.pos.z }, camera.cam, 'hurt big');
    } else if (e.type === 'stomp') {
      const d = Math.hypot(e.m.pos.x - player.pos.x, e.m.pos.z - player.pos.z);
      camera.shake = Math.max(camera.shake, Math.max(0, 1 - d / 12));
    }
  }
  effects.update(dt);
  critters.update(dt, player, world, darkness > 0.5);
  world.updateBushes(dt);
  if (blastT >= 0) {
    blastT += dt;
    const k = blastT / 0.45;
    blast.scale.setScalar(0.5 + k * rules.charmRadius);
    blast.material.opacity = Math.max(0, 1 - k) * 0.9;
    if (k >= 1) blastT = -1;
  }

  // story beats
  if (phase === 'day' && daynight.remaining() < 30) beat('late', '곧 해가 진다. 모닥불에 장작을 넣자', 3);
  if (phase === 'dusk' && !announced.dusk) { announced.dusk = true; hud.banner(`${day}일째 밤이 온다`, day === 1 ? '도깨비는 불빛 안으로 못 들어온다' : '어제보다 더 많이 온다', 2.6); }
  if (phase === 'night') {
    if (day >= 2) beat('wispTip', day === 2 ? '도깨비불은 번쩍이면 돌진한다. 구르기로 피하자' : '도깨비가 몰려온다!', 3);
    if (nightP > rules.nightChestAt && !announced.nightChest) {
      announced.nightChest = true;
      if (camp.spawnChest('night', 15, 26)) hud.toast('멀리서 도깨비 보물 궤짝이 빛난다!', 3);
    }
    if (day >= 2 && nightP > rules.raidAt && !announced.raid) {
      announced.raid = true;
      monsters.raid(c, day);
      hud.banner('도깨비 습격!', '둥둥둥… 북소리가 들린다', 2.8, 'raid');
      camera.shake = 1;
    }
    if (daynight.remaining() < 20) beat('almost', '조금만 더! 곧 새벽이다', 2.5);
  }

  if (player.dead) { endGame(false); }
  else if (phase === 'dawn') newDay();

  const lead = tmp.set(player.vel.x, 0, player.vel.z).multiplyScalar(1 / Math.max(1, tune.moveSpeed));
  camera.update(dt, player.pos, lead);

  // danger: out of the light at night, worse when something is close
  let danger = 0;
  if (darkness > 0.4 && !inLight) {
    let nd = 99;
    for (const m of monsters.alive) nd = Math.min(nd, Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z));
    danger = (0.22 + Math.max(0, (9 - nd) / 9) * 0.65) * Math.min(1, (darkness - 0.4) * 3);
  }
  const lowHp = player.hp < 35 ? 0.35 + (1 - player.hp / 35) * 0.6 : 0;

  const chest = chestNear();
  hud.update({
    dt, time: nowS, hp: player.hp, hpMax: rules.playerHp, inv: player.inv, fuel: world.fire.fuel, fuelMax: world.fire.max,
    day, phase, progress: daynight.progress(), remain: daynight.remaining(),
    actionLabel: chest ? '열기' : canDrink() ? '물 마시기' : bushNear() ? '따기' : nearFire() && player.wood > 0 ? '장작 넣기' : '베기',
    water: player.water, food: player.food,
    rollCool: player.rollCool > 0 || player.rolling, canCraft,
    fireLevel: world.fire.level, ironAxe: player.ironAxe, danger, lowHp,
  });
  renderer.render(scene, camera.cam);
}

function ctx() {
  const fireR = world.fireRadius();
  return { player, world, fireR, zones: camp.safeZones(fireR), effects };
}

camera.snap(player.pos);
requestAnimationFrame(frame);

// debug handle for automated checks
window.__game = {
  get state() { return state; }, get day() { return day; }, critters, player, world, monsters, daynight, camera, input, tune, rules, camp, hud,
  start: startGame, setTime: (t) => { daynight.time = t; },
  /** advance the game n frames without waiting for the browser (used by automated checks) */
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); return window.__game.info(); },
  key: (k, down, code) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k, code })),
  give: (k, n) => { player.inv[k] += n; },
  press: (name) => input.pressed.add(name),
  info: () => ({
    state, day, phase: daynight.phase(), water: +player.water.toFixed(1), food: +player.food.toFixed(1), rabbits: critters.alive.length, time: +daynight.time.toFixed(1), hp: +player.hp.toFixed(1), inv: { ...player.inv },
    fuel: +world.fire.fuel.toFixed(1), fireR: +world.fireRadius().toFixed(2), fireLv: world.fire.level, monsters: monsters.alive.length,
    types: monsters.alive.map((m) => m.type).join(','), chests: camp.chests.filter((c) => !c.opened).map((c) => c.kind).join(','),
    pos: [+player.pos.x.toFixed(2), +player.pos.z.toFixed(2)], trees: world.trees.filter((t) => t.alive).length, rocks: world.rocks.filter((r) => r.alive).length,
  }),
};
