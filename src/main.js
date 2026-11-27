import * as THREE from 'three';
import { rules, tune } from './config.js';
import { Input } from './input.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Monsters } from './monsters.js';
import { DayNight } from './daynight.js';
import { QuarterCamera } from './camera.js';
import { Effects } from './effects.js';
import { Camp, STRUCT } from './camp.js';
import { Critters } from './critters.js';
import { Eyes } from './spooky.js';
import { Village } from './villagers.js';
import { PROLOGUE, campLine } from './story.js';
import { WEAPONS, WEAPON_ORDER, CRIT_CHANCE, CRIT_MUL, weaponDmg, weaponChop } from './weapons.js';
import { sfx, unlock, ambience, music, isMuted, setMuted, audioState } from './sound.js';
import { Hud, buildTunePanel } from './hud.js';
import { RECIPES, USE_ORDER, ITEMS, PLACEABLE, canAfford, pay, rollLoot } from './items.js';

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
const eyes = new Eyes(scene);
const village = new Village(scene, world, effects);
// the torch: one light that follows the player (created up front so shaders don't recompile)
const torchLight = new THREE.PointLight(0xffb050, 0, 9, 1.5);
scene.add(torchLight);
let torchFlame = null;
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

// ---------- difficulty: 쉬움 is for kids and first-timers ----------
// default is 보통 now (kid feedback: too easy). Players who were moved to 쉬움 by the old default get 보통 once.
if (!store.get('dokkaebi.modeV2')) { store.set('dokkaebi.modeV2', '1'); store.set('dokkaebi.mode', 'normal'); }
let mode = store.get('dokkaebi.mode') || 'normal';
const EASY = () => mode === 'easy';
const M = () => (EASY()
  ? { dmg: 0.55, need: 0.55, burn: 0.75, dread: 0.45, keepSave: true }
  : { dmg: 1, need: 1, burn: 1, dread: 1, keepSave: false });
function showMode() {
  document.querySelectorAll('.mode-pick button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('mode-desc').textContent = EASY()
    ? '도깨비가 약하게 때리고, 배고픔이 천천히. 쓰러져도 그날 아침부터 다시'
    : '원래 세기. 쓰러지면 처음부터';
}
document.querySelectorAll('.mode-pick button').forEach((b) => {
  b.onclick = () => { mode = b.dataset.mode; store.set('dokkaebi.mode', mode); showMode(); };
});
showMode();

// ---------- save: written every dawn, removed when you fall ----------
const SAVE_KEY = 'dokkaebi.save';
function readSave() {
  try { const d = JSON.parse(store.get(SAVE_KEY) || 'null'); return d && d.v === 1 ? d : null; } catch { return null; }
}
function saveGame() {
  store.set(SAVE_KEY, JSON.stringify({
    v: 1, day, mode, inv: player.inv, ironAxe: player.ironAxe, axeLevel: player.axeLevel, armor: player.armor, hp: Math.round(player.hp),
    villagers: village.inCamp.map((p) => p.def.id), weapons: player.weapons, weapon: player.weapon, sandals: !!player.sandals, rod: !!player.rod,
    water: Math.round(player.water), food: Math.round(player.food),
    fireLv: world.fire.level, fuel: Math.round(world.fire.fuel), stats: player.stats, camp: camp.serialize(),
  }));
  showContinue();
}
function showContinue() {
  const d = readSave();
  const b = $('continue-btn');
  b.hidden = !d;
  if (d) b.textContent = `이어하기 · ${d.day}일째 아침`;
  $('start-btn').textContent = d ? '처음부터' : '첫째 날 시작';
  $('start-btn').className = d ? 'ghost' : 'primary';
}
showContinue();

function startGame(save = null) {
  if (save instanceof Event) save = null;
  unlock();
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
  eyes.clear();
  village.reset();
  state = 'playing';
  input.clear();
  $('title-screen').hidden = true;
  $('result-screen').hidden = true;
  $('pause-screen').hidden = true;
  hud.show(true);
  showControls(true);
  camera.snap(player.pos);
  spawnDayChests(true);
  if (save) {
    day = save.day;
    if (save.mode) { mode = save.mode; showMode(); }
    Object.assign(player.inv, save.inv);
    player.setAxe(save.axeLevel ?? (save.ironAxe ? 1 : 0));
    player.setArmor(!!save.armor);
    if (save.weapons) { player.weapons = [...save.weapons]; player.setWeapon(save.weapon || 'axe'); }
    player.sandals = !!save.sandals; player.rod = !!save.rod;
    village.restore(save.villagers || [], world.fire);
    player.hp = save.hp; player.water = save.water; player.food = save.food;
    Object.assign(player.stats, save.stats);
    world.setFireLevel(save.fireLv);
    world.fire.fuel = save.fuel;
    camp.restore(save.camp);
    hud.banner(`${day}일째 아침`, '이어서 버텨라', 2.6);
    return;
  }
  saveGame(); // morning of day 1 is a checkpoint too
  const intro = () => {
    hud.banner('1일째 아침', '백 일 밤을 버텨라', 2.6);
  };
  if (!store.get('dokkaebi.prologue') && params.get('skipstory') !== '1') {
    store.set('dokkaebi.prologue', '1');
    talk(PROLOGUE, intro);
  } else intro();
}

/** show dialogue lines; the world waits while you read */
function talk(lines, done) {
  state = 'talk';
  input.clear();
  hud.say(lines, () => { state = 'playing'; input.clear(); if (done) done(); });
}
$('dialog').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); unlock(); hud.dialogNext(); });

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
  if (state === 'over' || state === 'title' || state === 'talk') return;
  state = p ? 'paused' : 'playing';
  $('pause-screen').hidden = !p;
  input.clear();
}

function endGame(won) {
  state = 'over';
  sfx(won ? 'dawn' : 'lose');
  if (!M().keepSave || won) { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }
  const sv = readSave();
  $('retry-btn').hidden = won || !sv;
  if (sv && !won) $('retry-btn').textContent = `${sv.day}일째 아침부터 다시`;
  $('again-btn').textContent = sv && !won ? '처음부터' : '다시 하기';
  $('again-btn').className = sv && !won ? 'ghost' : 'primary';
  showContinue();
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
    ['버틴 밤', survived], ['물리친 도깨비', st.kills], ['구한 사람', village.inCamp.length], ['지은 것', st.built],
  ].map(([k, v]) => `<li>${k}<b>${v}</b></li>`).join('');
  setTimeout(() => { $('result-screen').hidden = false; }, won ? 900 : 1400);
}

/** dawn: the night is over, roll into the next day */
function newDay() {
  const survived = day;
  monsters.banishAll();
  eyes.clear();
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
  for (const l of village.lairs) if (l.state === 'guarded') { l.state = 'open'; l.guards = []; }
  morningGifts();
  sfx('dawn');
  saveGame();
  hud.banner(`${survived}일째 밤을 버텼다!`, `꼬끼오! ${day}일째 아침`, 3);
  effects.spawn(player.pos.x, 1.2, player.pos.z, 0xffe27a, { n: 18, speed: 3, up: 5, life: 1, size: 0.14, grav: 3 });
}

/** villagers at the camp bring things each morning */
function morningGifts() {
  const names = [];
  for (const v of village.inCamp) {
    const at = { x: v.pos.x, y: 1.4, z: v.pos.z };
    if (v.def.id === 'bong') {
      rollLoot('day', day).slice(0, 2).forEach((it, i) => gain(it.kind, Math.min(it.n, 3), at, 1200 + i * 200));
      names.push(v.def.name);
    } else if (v.def.id === 'samwol') {
      gain('herb', 1, at, 1400); gain('berry', 3, at, 1600);
      names.push(v.def.name);
    }
  }
  if (names.length) setTimeout(() => hud.toast(`${names.join(', ')}이(가) 아침 선물을 가져왔다`, 2.6), 3200);
}

$('start-btn').onclick = () => startGame();
$('continue-btn').onclick = () => startGame(readSave());
$('again-btn').onclick = () => startGame();
$('retry-btn').onclick = () => startGame(readSave());
$('pause-btn').onclick = () => setPaused(true);
const muteBtn = $('mute-btn');
const showMute = () => { muteBtn.textContent = isMuted() ? '소리 켜기' : '소리 끄기'; };
showMute();
muteBtn.onclick = () => { unlock(); setMuted(!isMuted()); showMute(); };
$('resume-btn').onclick = () => setPaused(false);
$('quit-btn').onclick = () => {
  state = 'title';
  $('pause-screen').hidden = true;
  $('title-screen').hidden = false;
  showContinue();
  hud.show(false);
  showControls(false);
};
if (params.get('nopause') !== '1') {
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') setPaused(true); });
}
if (params.get('tune') === '1') buildTunePanel();

// how scary a night is: gentle at first, full horror from night 3, max on chief nights
const dreadFor = (n) => (n % rules.bossEvery === 0 ? 1 : n < 3 ? 0.12 * n : Math.min(0.95, 0.45 + (n - 3) * 0.07));
const OMENS = [
  '어둠 속에서 누군가 웃고 있다…',
  '불을 꺼뜨리지 마라',
  '도깨비들이 배가 고프다',
  '오늘 밤은 길 것이다',
  '등 뒤를 조심해라',
  '숲이 너무 조용하다…',
  '저 눈들은 다 무엇이냐',
  '방망이 소리가 가까워진다',
];

// ---------- gameplay helpers ----------
const fireDist = () => Math.hypot(player.pos.x - world.fire.x, player.pos.z - world.fire.z);
const nearFire = () => fireDist() < 2.3 + world.fire.level * 0.3;

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
const rescuable = () => { const l = village.lairNear(player.pos.x, player.pos.z, 2.8); return l && l.state === 'cleared' ? l : null; };
const canFish = () => player.rod && !(player.fishT > 0) && world.atShore(player.pos.x, player.pos.z) && player.water >= 60;
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
  sfx('chest');
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
  const lair = rescuable();
  if (lair) {
    const v = village.free(lair);
    sfx('chest');
    player.stats.rescued = (player.stats.rescued || 0) + 1;
    talk(v.def.rescue.map((text) => ({ who: v.def.name, role: v.def.role, text })));
    return;
  }
  const npc = village.talkable(player.pos.x, player.pos.z);
  if (npc && !nearFire()) {
    npc.facing = Math.atan2(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z);
    const lines = npc.def.idle;
    npc.lastLine = ((npc.lastLine ?? Math.floor(Math.random() * lines.length)) + 1) % lines.length;
    talk([{ who: npc.def.name, role: npc.def.role, text: lines[npc.lastLine] }]);
    return;
  }
  const broken = camp.repairable(player.pos.x, player.pos.z);
  if (broken && !nearFire()) {
    const cost = STRUCT[broken.kind].repair;
    if (!canAfford(player.inv, cost)) { hud.toast(`고치려면 ${Object.entries(cost).map(([k, v]) => `${ITEMS[k].name} ${v}`).join(', ')}`, 1.8); sfx('deny'); return; }
    pay(player.inv, cost);
    camp.repair(broken);
    sfx('build');
    effects.spawn(broken.x, 0.8, broken.z, 0x9fe08a, { n: 12, speed: 2, up: 4, life: 0.7, size: 0.1, grav: 2 });
    hud.popup('고쳤다!', { x: broken.x, y: 2.2, z: broken.z }, camera.cam, 'heal big');
    player.facing = Math.atan2(broken.x - player.pos.x, broken.z - player.pos.z);
    return;
  }
  if (canFish()) {
    player.fishT = 1.1 + Math.random() * 1.4;
    player.attackT = -1;
    player.facing = Math.atan2(player.pos.x, player.pos.z); // face the sea
    hud.popup('낚시 중…', { x: player.pos.x, y: 2.5, z: player.pos.z }, camera.cam, 'water big');
    sfx('swing');
    return;
  }
  if (canDrink()) {
    player.water = Math.min(100, player.water + rules.drinkAmount);
    sfx('drink');
    tmp.set(Math.sin(player.facing), 0, Math.cos(player.facing));
    effects.spawn(player.pos.x + tmp.x * 0.8, 0.3, player.pos.z + tmp.z * 0.8, 0x7fd3ff, { n: 12, speed: 2, up: 3, life: 0.6, size: 0.1 });
    hud.popup('꿀꺽꿀꺽', { x: player.pos.x, y: 2.4, z: player.pos.z }, camera.cam, 'water big');
    player.attackT = -1;
    return;
  }
  const b = bushNear();
  if (b) {
    const n = world.pickBush(b);
    sfx('eat');
    effects.spawn(b.x, 0.6, b.z, 0xe8344e, { n: 8, speed: 2, up: 3, life: 0.5, size: 0.09 });
    gain('berry', n, { x: b.x, y: 0.7, z: b.z });
    hud.popup(`+${n} 산딸기`, { x: b.x, y: 1.8, z: b.z }, camera.cam, 'wood big');
    return;
  }
  if (nearFire() && player.wood > 0) {
    const max = world.fire.max;
    if (world.fire.fuel >= max - 1) { hud.toast('불이 충분히 크다', 1.2); sfx('deny'); return; }
    sfx('feed');
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
  if (player.startAttack(aim)) sfx('swing');
}

/** every hit on a monster goes through here: crits, damage numbers, kill rewards */
function damageMonster(m, base, { fromX = player.pos.x, fromZ = player.pos.z, kb = 1, canCrit = true, by = null } = {}) {
  let dmg = base, crit = false;
  if (canCrit && Math.random() < CRIT_CHANCE) { dmg = Math.round(dmg * CRIT_MUL); crit = true; }
  const killed = m.hit(dmg, fromX, fromZ, kb);
  const y = (m.type === 'wisp' ? 1.6 : 2.0 * (m.T.scale || 1));
  hud.popup(crit ? `${dmg} 치명타!` : `${dmg}`, { x: m.pos.x + (Math.random() - 0.5) * 0.6, y, z: m.pos.z }, camera.cam, crit ? 'dmg crit' : 'dmg');
  sfx(killed ? 'kill' : 'hitMonster');
  effects.spawn(m.pos.x, 1.1, m.pos.z, crit ? 0xffe27a : 0xfff2a8, { n: crit ? 14 : 8, speed: 4.5, up: 3, life: 0.35, size: 0.11 });
  if (killed) onMonsterKilled(m, by);
  return { killed, crit, dmg };
}

function onMonsterKilled(m, by) {
  player.stats.kills += 1;
  hud.popup(by ? `${by}!` : m.type === 'elite' ? '큰 도깨비를 물리쳤다!' : '물리쳤다!', { x: m.pos.x, y: 2.6, z: m.pos.z }, camera.cam, 'fire big');
  if (m.type === 'boss') {
    hud.banner('도깨비 대장을 물리쳤다!', player.weapons.includes('club') ? '도깨비들이 겁을 먹었다' : '도깨비 금방망이를 얻었다!', 3);
    sfx('dawn'); camera.shake = 1.4; hitStop = 0.25;
    player.stats.bosses = (player.stats.bosses || 0) + 1;
    if (!player.weapons.includes('club')) { player.weapons.push('club'); player.setWeapon('club'); }
    gain('charm', 2, { x: m.pos.x, y: 1.5, z: m.pos.z }, 500);
    gain('herb', 2, { x: m.pos.x, y: 1.5, z: m.pos.z }, 700);
    monsters.banishNear(m.pos.x, m.pos.z, 12); // the rest of the night is calmer
  }
  gain('bead', m.T.beads, { x: m.pos.x, y: 1.2, z: m.pos.z }, 200);
}

// player arrows (bow)
const arrowGeo = new THREE.BoxGeometry(0.05, 0.05, 0.75);
const arrowMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc0 });
let arrows = [];
function shootArrow() {
  if (!player.inv.arrow) { hud.toast('화살이 없다 (만들기에서 화살)', 1.6); sfx('deny'); return; }
  player.inv.arrow -= 1;
  const fx = Math.sin(player.facing), fz = Math.cos(player.facing);
  // aim at the closest monster roughly in front
  let target = null, bd = 13;
  for (const m of monsters.alive) {
    const dx = m.pos.x - player.pos.x, dz = m.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.55) { bd = d; target = m; }
  }
  const mesh = new THREE.Mesh(arrowGeo, arrowMat);
  mesh.position.set(player.pos.x + fx * 0.6, 1.3, player.pos.z + fz * 0.6);
  scene.add(mesh);
  const vel = new THREE.Vector3(fx, 0, fz).multiplyScalar(26);
  arrows.push({ mesh, vel, target, life: 0.6 });
  sfx('swing');
}
function updateArrows(dt) {
  for (const a of arrows) {
    if (a.target && a.target.alive) {
      const to = new THREE.Vector3(a.target.pos.x - a.mesh.position.x, 0, a.target.pos.z - a.mesh.position.z).normalize().multiplyScalar(26);
      a.vel.lerp(to, Math.min(1, dt * 12));
    }
    a.mesh.position.addScaledVector(a.vel, dt);
    a.mesh.lookAt(a.mesh.position.x + a.vel.x, 1.3, a.mesh.position.z + a.vel.z);
    a.life -= dt;
    for (const m of monsters.alive) {
      if (Math.hypot(m.pos.x - a.mesh.position.x, m.pos.z - a.mesh.position.z) < m.radius + 0.35) {
        damageMonster(m, WEAPONS.bow.dmg, { kb: 0.4 });
        a.life = 0;
        break;
      }
    }
    if (a.life <= 0) { scene.remove(a.mesh); a.done = true; }
  }
  arrows = arrows.filter((a) => !a.done);
}

function resolveStrike() {
  const id = player.weapon;
  const W = WEAPONS[id];
  if (W.ranged) { shootArrow(); return; }
  const fx = Math.sin(player.facing), fz = Math.cos(player.facing);
  const reach = W.reach + (id === 'axe' ? player.axeLevel * 0.2 : 0);
  const base = weaponDmg(id, player.axeLevel);
  let hitSomething = false;
  for (const m of monsters.alive) {
    const dx = m.pos.x - player.pos.x, dz = m.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d > reach + m.radius) continue;
    if ((dx * fx + dz * fz) / (d || 1) < (W.arc ?? 0.2)) continue;
    hitSomething = true;
    const big = m.type === 'elite' || m.type === 'boss';
    const { killed } = damageMonster(m, Math.round(base * (big && W.bigBonus ? W.bigBonus : 1)), { kb: W.knock || 1 });
    camera.shake = Math.max(camera.shake, id === 'mace' ? 0.9 : 0.6);
    hitStop = Math.max(hitStop, killed ? rules.killStop : id === 'mace' ? 0.08 : rules.hitStop);
    if (W.beadChance && Math.random() < W.beadChance) {
      hud.popup('뚝딱!', { x: m.pos.x, y: 2.8, z: m.pos.z }, camera.cam, 'fire big');
      gain('bead', 1, { x: m.pos.x, y: 1.2, z: m.pos.z });
    }
    if (!W.pierce && id !== 'mace') break; // spear runs through a line, the mace hits everything around
  }
  if (hitSomething) return;
  for (const r of critters.alive) {
    const dx = r.pos.x - player.pos.x, dz = r.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d > reach + r.radius + 0.2) continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.1) continue;
    if (r.hit()) {
      sfx('hitMonster');
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
    const chop = weaponChop(id, player.axeLevel);
    if (!chop) return;
    const got = world.chopTree(t, player.pos.x, player.pos.z, chop);
    sfx(got ? 'treeFall' : 'chop');
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
    const mine = weaponChop(id, player.axeLevel, true);
    if (!mine) return;
    const got = world.mineRock(r, mine);
    sfx(got ? 'rockBreak' : 'rock');
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
  const cs = craftState();
  if (!r || !r.show(cs) || (r.lock && r.lock(cs)) || !canAfford(player.inv, r.cost)) { sfx('deny'); return; }
  if (r.fire && !nearFire()) { hud.toast(`${r.name}은(는) 모닥불 옆에서`, 1.6); sfx('deny'); return; }
  pay(player.inv, r.cost);
  sfx('craft');
  for (const k of Object.keys(r.cost)) hud.spend(k, { x: player.pos.x, y: 1, z: player.pos.z }, camera.cam);
  const at = { x: player.pos.x, y: 1.4, z: player.pos.z };
  const show = (text, col = 0xffe27a) => {
    effects.spawn(player.pos.x, 1.4, player.pos.z, col, { n: 20, speed: 3, up: 5, life: 0.8, size: 0.12, grav: 4 });
    hud.popup(text, { x: player.pos.x, y: 2.8, z: player.pos.z }, camera.cam, 'fire big');
  };
  if (r.weapon) {
    player.weapons.push(r.weapon);
    player.setWeapon(r.weapon);
    show(`${r.name}!`, 0xeaf2ff);
    if (!announced.weaponTip) { announced.weaponTip = true; hud.toast('무기 버튼(Q)으로 무기를 바꿀 수 있다', 2.4); }
    return;
  }
  if (id === 'sandals') { player.sandals = true; show('짚신! 발이 가볍다', 0xd9b04a); return; }
  if (id === 'rod') { player.rod = true; show('낚싯대! 물가에서 낚시', 0x7fd3ff); return; }
  if (id === 'fire2' || id === 'fire3') {
    world.setFireLevel(id === 'fire2' ? 1 : 2);
    world.fire.fuel = Math.min(world.fire.max, world.fire.fuel + 25);
    effects.spawn(world.fire.x, 1, world.fire.z, 0xffb03a, { n: 30, speed: 4, up: 7, life: 1, size: 0.16, grav: 4 });
    camera.shake = 0.6;
    hud.popup('모닥불이 커졌다!', { x: player.pos.x, y: 2.8, z: player.pos.z }, camera.cam, 'fire big');
  } else if (id === 'steelaxe') {
    player.setAxe(2);
    effects.spawn(player.pos.x, 1.4, player.pos.z, 0x9fc4ff, { n: 24, speed: 3, up: 5, life: 0.8, size: 0.12, grav: 4 });
    hud.popup('강철 도끼!', { x: player.pos.x, y: 2.8, z: player.pos.z }, camera.cam, 'fire big');
  } else if (id === 'armor') {
    player.setArmor(true);
    effects.spawn(player.pos.x, 1.2, player.pos.z, 0xc98a4d, { n: 20, speed: 3, up: 4, life: 0.8, size: 0.12, grav: 4 });
    hud.popup('가죽 갑옷!', { x: player.pos.x, y: 2.8, z: player.pos.z }, camera.cam, 'fire big');
  } else if (id === 'axe') {
    player.setAxe(true);
    effects.spawn(player.pos.x, 1.4, player.pos.z, 0xeaf2ff, { n: 20, speed: 3, up: 5, life: 0.8, size: 0.12, grav: 4 });
    hud.popup('쇠도끼!', { x: player.pos.x, y: 2.8, z: player.pos.z }, camera.cam, 'fire big');
  } else if (r.gives) {
    const n = r.amount || 1;
    player.inv[r.gives] += n;
    hud.collect(r.gives, n, at, camera.cam, 250);
  }
}

const craftState = () => ({
  fireLevel: world.fire.level, ironAxe: player.ironAxe, axeLevel: player.axeLevel, armor: player.armor,
  musoe: village.has('musoe'), beomsu: village.has('beomsu'), sandals: !!player.sandals, rod: !!player.rod,
  nearFire: nearFire(), has: (w) => player.weapons.includes(w),
});

function useItem(id) {
  if (!player.inv[id] || player.dead) return;
  const fx = Math.sin(player.facing), fz = Math.cos(player.facing);
  if (['berry', 'meat', 'skewer', 'fish', 'fishc'].includes(id) || (id === 'rawmeat' && !nearFire())) {
    if (player.food >= 99) { hud.toast('배부르다', 1.2); sfx('deny'); return; }
    sfx('eat');
    const amt = { berry: rules.berryFood, meat: rules.meatFood, skewer: 60, fish: 18, fishc: 40, rawmeat: rules.rawMeatFood }[id];
    player.inv[id] -= 1;
    player.food = Math.min(100, player.food + amt);
    if (id === 'meat') player.hp = Math.min(rules.playerHp, player.hp + 8);
    if (id === 'skewer') player.hp = Math.min(rules.playerHp, player.hp + 15);
    if (id === 'fishc') player.water = Math.min(100, player.water + 10);
    effects.spawn(player.pos.x, 1.6, player.pos.z, id === 'berry' ? 0xe8344e : 0xd9783a, { n: 8, speed: 1.5, up: 2, life: 0.5, size: 0.08 });
    hud.popup(`냠냠 +${amt}`, { x: player.pos.x, y: 2.5, z: player.pos.z }, camera.cam, 'food big');
    if (id === 'rawmeat') hud.toast('구워 먹으면 훨씬 배부르다 (모닥불 옆)', 2);
  } else if (id === 'rawmeat') {
    // cook by the fire
    player.inv.rawmeat -= 1;
    sfx('cook');
    effects.spawn(world.fire.x, 1.2, world.fire.z, 0xffd08a, { n: 14, speed: 1.5, up: 4, life: 0.8, size: 0.12, grav: -1 });
    hud.popup('지글지글', { x: world.fire.x, y: 2.4, z: world.fire.z }, camera.cam, 'fire big');
    gain('meat', 1, { x: world.fire.x, y: 1, z: world.fire.z }, 300);
  } else if (id === 'torch') {
    if (player.torchT > 0) { hud.toast('이미 횃불을 들고 있다', 1.2); sfx('deny'); return; }
    player.inv.torch -= 1;
    player.torchT = 30;
    sfx('feed');
    hud.popup('횃불!', { x: player.pos.x, y: 2.6, z: player.pos.z }, camera.cam, 'fire big');
    if (!announced.torchTip) { announced.torchTip = true; hud.toast('횃불 빛 안으로는 도깨비가 못 들어온다 (30초)', 2.6); }
  } else if (id === 'herb') {
    if (player.hp >= rules.playerHp - 0.5) { hud.toast('체력이 가득하다', 1.2); sfx('deny'); return; }
    sfx('heal');
    player.inv.herb -= 1;
    player.hp = Math.min(rules.playerHp, player.hp + rules.herbHeal);
    effects.spawn(player.pos.x, 1.2, player.pos.z, 0x7be07a, { n: 16, speed: 1.5, up: 4, life: 0.9, size: 0.13, grav: -1 });
    hud.popup(`+${rules.herbHeal}`, { x: player.pos.x, y: 2.5, z: player.pos.z }, camera.cam, 'heal big');
  } else if (id === 'charm') {
    player.inv.charm -= 1;
    sfx('charm');
    const n = monsters.banishNear(player.pos.x, player.pos.z, rules.charmRadius);
    blastT = 0; blast.position.x = player.pos.x; blast.position.z = player.pos.z;
    effects.spawn(player.pos.x, 1, player.pos.z, 0xffd65a, { n: 30, speed: 7, up: 3, life: 0.7, size: 0.14, grav: 2 });
    camera.shake = 0.9;
    hitStop = 0.08;
    hud.popup(n ? `부적! 도깨비 ${n}마리를 쫓았다` : '부적!', { x: player.pos.x, y: 2.6, z: player.pos.z }, camera.cam, 'fire big');
  } else if (PLACEABLE.includes(id)) {
    const ahead = id === 'hut' ? 2.6 : id === 'trap' ? 1.2 : 1.5;
    const x = player.pos.x + fx * ahead, z = player.pos.z + fz * ahead;
    const why = camp.checkSpot(id, x, z);
    if (why) { hud.toast(why, 1.4); sfx('deny'); return; }
    sfx('build');
    player.inv[id] -= 1;
    camp.build(id, x, z, player.facing);
    player.stats.built += 1;
    effects.spawn(x, 0.4, z, ['fence', 'jangseung', 'hut', 'trap'].includes(id) ? 0xb07a45 : 0xd6d3cb, { n: 12, speed: 2.5, up: 3, life: 0.6, size: 0.13 });
    camera.shake = Math.max(camera.shake, 0.3);
    if (id === 'lantern' && !announced.lanternTip) { announced.lanternTip = true; hud.toast('석등은 해가 지면 켜진다', 2.2); }
  }
}

/** "지금 할 일": one short goal + where it is, so first-timers (and kids) always know what to do */
function currentGoal(phase, inLight, fireR) {
  const P = player.pos;
  const fire = { x: world.fire.x, z: world.fire.z };
  const near = (list, f = () => true) => {
    let best = null, bd = 1e9;
    for (const o of list) { if (!f(o)) continue; const x = o.x ?? o.pos.x, z = o.z ?? o.pos.z, d = Math.hypot(x - P.x, z - P.z); if (d < bd) { bd = d; best = { x, z }; } }
    return best;
  };
  const night = phase === 'night';
  if (night && !inLight) return { text: '불빛 안으로 돌아가!', target: fire, urgent: true };
  if (world.fire.fuel < 15 && player.wood > 0) return { text: '모닥불이 꺼져 간다! 장작 넣기', target: fire, urgent: true };
  const follower = village.people.find((v) => v.state === 'follow');
  if (follower) return { text: `${follower.def.name}을(를) 모닥불까지 데려가기`, target: fire };
  if (night) return { text: '불빛 안에서 새벽까지 버티기', target: null };
  if (player.water < 30) return { text: '물 마시기 (섬 가장자리 물가)', target: (() => { const d = Math.hypot(P.x, P.z) || 1; return { x: P.x / d * (rules.islandRadius - 0.6), z: P.z / d * (rules.islandRadius - 0.6) }; })(), urgent: player.water < 12 };
  if (player.food < 30) {
    if (player.inv.meat || player.inv.berry) return { text: '아이템 칸에서 먹을 것 누르기', target: null, urgent: player.food < 12 };
    return { text: '빨간 열매 덤불에서 산딸기 따기', target: near(world.bushes, (b) => b.ripe), urgent: player.food < 12 };
  }
  const late = phase === 'dusk' || (phase === 'day' && daynight.remaining() < 22);
  if (late && player.wood > 0 && world.fire.fuel < world.fire.max * 0.7) return { text: '해가 진다! 모닥불에 장작 넣기', target: fire, urgent: true };
  if (late) return { text: '곧 밤! 모닥불 옆으로', target: fire, urgent: phase === 'dusk' };
  const guarded = village.lairs.find((l) => l.state === 'guarded');
  if (guarded && Math.hypot(guarded.x - P.x, guarded.z - P.z) < 16) return { text: '소굴을 지키는 도깨비 물리치기', target: guarded };
  const cleared = village.lairs.find((l) => l.state === 'cleared');
  if (cleared) return { text: `우리에 갇힌 ${cleared.def.name} 구하기`, target: cleared };
  if (player.wood < 4) return { text: '나무를 베어 장작 모으기', target: near(world.trees, (t) => t.alive) };
  const open = village.lairs.find((l) => l.state === 'open');
  if (open) return { text: `노란 ! 를 찾아 ${open.def.name} 구하러 가기`, target: open };
  const chest = near(camp.chests, (c) => !c.opened && c.kind === 'day');
  if (chest) return { text: '숲속 궤짝 찾아 열기', target: chest };
  if (player.inv.stone < 5) return { text: '바위를 캐서 돌 모으기', target: near(world.rocks, (r) => r.alive) };
  return { text: '장작을 넉넉히 모아 밤 준비하기 (만들기도 해 보자)', target: null };
}

function updateTorch(time, darkness) {
  if (!torchFlame) {
    // flame on a stick in the free (left) hand
    torchFlame = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.6), new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
    stick.position.z = 0.25; torchFlame.add(stick);
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xffb03a }));
    fl.position.set(0, 0, 0.6); torchFlame.add(fl);
    const fl2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffef9a }));
    fl2.position.set(0, 0.06, 0.62); torchFlame.add(fl2);
    torchFlame.flames = [fl, fl2];
    torchFlame.position.set(0, -0.62, 0.02);
    player.rig.arms[1].add(torchFlame);
  }
  const on = player.torchT > 0 && state === 'playing';
  torchFlame.visible = on;
  const flick = 1 + Math.sin(time * 19) * 0.08 + Math.sin(time * 7.7) * 0.06;
  torchFlame.flames.forEach((f, i) => { f.scale.setScalar(flick * (1 - i * 0.1)); f.rotation.z += 0.2; });
  const fade = Math.min(1, player.torchT / 4); // gutters out at the end
  torchLight.intensity = on ? (2 + darkness * 16) * flick * fade : 0;
  torchLight.position.set(player.pos.x, 1.6, player.pos.z);
}

/** lairs (guards, rescue), villagers following and joining, the hunter's arrows */
function updateVillage(dt, c, darkness) {
  const fireR = c.fireR;
  let nearest = null, nd = fireR + 10;
  for (const m of monsters.alive) {
    const d = Math.hypot(m.pos.x - world.fire.x, m.pos.z - world.fire.z);
    if (d < nd) { nd = d; nearest = m; }
  }
  const evs = village.update(dt, { player, world, fire: world.fire, fireR, darkness, nearestMonster: nearest, day });
  for (const e of evs) {
    if (e.type === 'joined') {
      const v = e.v;
      sfx('craft'); sfx('dawn');
      effects.spawn(v.pos.x, 1.2, v.pos.z, 0xffe27a, { n: 20, speed: 2.5, up: 5, life: 1, size: 0.13, grav: 4 });
      hud.banner(`${v.def.name} 합류!`, v.def.perk, 3);
      setTimeout(() => {
        if (state === 'playing') talk(v.def.join.map((text) => ({ who: v.def.name, role: v.def.role, text })));
      }, 1200);
    } else if (e.type === 'shoot') {
      sfx('swing');
    } else if (e.type === 'arrowHit') {
      damageMonster(e.m, 10, { fromX: e.from.x, fromZ: e.from.z, kb: 0.5, by: '범수의 화살' });
    }
  }
  // lairs: guards wake when you come close; the cage opens once they're gone
  for (const l of village.lairs) {
    const d = Math.hypot(l.x - player.pos.x, l.z - player.pos.z);
    if (l.state === 'sealed' && d < 5) {
      const key = 'seal' + l.index;
      if (!announced[key]) { announced[key] = true; hud.toast(`도깨비 봉인이 단단하다. ${l.def.unlockDay}일째부터 풀린다`, 2.8); sfx('deny'); }
    } else if (l.state === 'open' && d < 9) {
      l.state = 'guarded';
      l.guards = monsters.spawnGuards(day, l.def.guards, l.x, l.z);
      sfx('drum'); sfx('laugh', 0.2, 1);
      hud.popup(l.def.cage, { x: l.x, y: 3.2, z: l.z }, camera.cam, 'fire big');
      camera.shake = 0.6;
    } else if (l.state === 'guarded' && l.guards.every((m) => !m.alive)) {
      l.state = 'cleared';
      sfx('chest');
    }
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
  if (state === 'talk') {
    // reading: the world holds still; action / tap moves the dialogue on
    if (input.consume('action')) hud.dialogNext();
    if (hud.dlg && hud.dlg.typing) hud.typeTick(dt);
    input.pressed.clear();
    camera.update(dt, player.pos, tmp.set(0, 0, 0));
    renderer.render(scene, camera.cam);
    return;
  }
  if (state !== 'playing') {
    input.pressed.clear();
    music.setMood(state === 'paused' ? 'off' : 'day');
    music.update();
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
  const canCraft = true; // crafting works anywhere (kid feedback); fire recipes check nearFire themselves
  if (input.consume('craft')) {
    if (hud.craftOpen) hud.setCraft(false);
    else if (canCraft) hud.setCraft(true);
    else hud.toast('만들기는 모닥불 옆에서', 1.4);
  }
  for (const p of [...input.pressed]) {
    if (p.startsWith('make:')) { input.pressed.delete(p); craft(p.slice(5)); }
    else if (p.startsWith('item:')) { input.pressed.delete(p); useItem(p.slice(5)); }
    else if (p.startsWith('slot')) { input.pressed.delete(p); const own = USE_ORDER.filter((k) => player.inv[k] > 0); const k = own[parseInt(p.slice(4), 10) - 1]; if (k) useItem(k); }
  }

  if (input.consume('roll') && player.startRoll(wish.clone())) sfx('roll');
  if (input.consume('weapon') && player.weapons.length > 1 && !player.attacking) {
    const own = WEAPON_ORDER.filter((w) => player.weapons.includes(w));
    player.setWeapon(own[(own.indexOf(player.weapon) + 1) % own.length]);
    sfx('build');
    hud.popup(WEAPONS[player.weapon].name, { x: player.pos.x, y: 2.7, z: player.pos.z }, camera.cam, 'wood big');
  }
  const autoOk = !player.attacking && !player.rolling && !nearFire() && !chestNear() && !bushNear() && !rescuable() && !village.talkable(player.pos.x, player.pos.z) && !camp.repairable(player.pos.x, player.pos.z);
  if (input.consume('action') || (input.actionHeld && autoOk)) tryAction();

  if (player.fishT > 0) {
    if (wish.lengthSq() > 0.05) { player.fishT = 0; hud.popup('놓쳤다', { x: player.pos.x, y: 2.4, z: player.pos.z }, camera.cam, 'hurt big'); }
    else if ((player.fishT -= dt) <= 0) {
      const big = Math.random() < 0.2;
      sfx('drink'); sfx('pickup', 2);
      tmp.set(Math.sin(player.facing), 0, Math.cos(player.facing));
      effects.spawn(player.pos.x + tmp.x * 1.5, 0.2, player.pos.z + tmp.z * 1.5, 0x7fd3ff, { n: 14, speed: 2.5, up: 4, life: 0.6, size: 0.1 });
      hud.popup(big ? '월척이다!' : '잡았다!', { x: player.pos.x, y: 2.6, z: player.pos.z }, camera.cam, 'fire big');
      gain('fish', big ? 2 : 1, { x: player.pos.x + tmp.x * 1.5, y: 0.5, z: player.pos.z + tmp.z * 1.5 });
    }
  }
  const ev = player.update(dt, wish, world);
  if (ev === 'strike') resolveStrike();

  const phase = daynight.phase();
  const { darkness } = daynight.update(gdt, player.pos);
  world.water.material.color.copy(daynight.col.water);

  // fire burns down
  const burn = (phase === 'night' ? rules.burnNight : phase === 'dusk' ? (rules.burnDay + rules.burnNight) / 2 : rules.burnDay) * M().burn;
  if (world.fire.fuel > 0) {
    world.fire.fuel = Math.max(0, world.fire.fuel - burn * gdt);
    if (world.fire.fuel === 0) { hud.toast('모닥불이 꺼졌다! 장작을 넣어!', 3); camera.shake = 0.5; sfx('fireOut'); }
  }
  world.updateFire(dt, nowS, darkness);
  world.updateTrees(dt);
  world.updateRocks(dt);
  world.updateOcclusion(dt, player.pos.x, player.pos.z, camera.back);
  camp.update(dt, nowS, darkness, camera.cam, player.pos);

  // torch: a small moving light that also keeps monsters back
  if (player.torchT > 0) {
    player.torchT = Math.max(0, player.torchT - gdt);
    if (player.torchT === 0) { hud.toast('횃불이 다 탔다', 1.6); sfx('fireOut'); }
  }
  updateTorch(nowS, darkness);
  const c = ctx();

  const beat = (key, text, secs) => { if (!announced[key]) { announced[key] = true; hud.toast(text, secs); } };
  // healing in any light
  const inLight = c.zones.some((z) => Math.hypot(player.pos.x - z.x, player.pos.z - z.z) < z.r);
  const regen = rules.regenInLight * (village.has('samwol') ? 2 : 1);
  if (inLight && player.hurtT > 3 && player.hp < rules.playerHp) player.hp = Math.min(rules.playerHp, player.hp + regen * dt);

  // thirst and hunger
  player.water = Math.max(0, player.water - rules.waterDrain * M().need * gdt);
  player.food = Math.max(0, player.food - rules.foodDrain * M().need * gdt);
  if ((player.water <= 0 || player.food <= 0) && !player.dead) {
    player.hp = Math.max(0, player.hp - rules.needDamage * gdt * ((player.water <= 0) + (player.food <= 0)));
    if (player.hp <= 0) player.dead = true;
  }

  const nightP = phase === 'night' ? daynight.progress() : -1;
  const events = monsters.update(dt, c, nightP, day);
  updateVillage(dt, c, darkness);
  for (const h of camp.springTraps(monsters.alive)) {
    effects.spawn(h.trap.x, 0.4, h.trap.z, 0xe8dcc0, { n: 10, speed: 3, up: 3, life: 0.4, size: 0.1 });
    damageMonster(h.m, 20, { fromX: h.trap.x, fromZ: h.trap.z, kb: 0.3, canCrit: false, by: '가시 덫' });
    if (h.trap.hp <= 0) hud.toast('가시 덫이 부서졌다', 1.6);
  }
  for (const e of events) {
    const near = Math.hypot(e.m.pos.x - player.pos.x, e.m.pos.z - player.pos.z) < 14;
    if (e.type === 'windup' && near) sfx('windup');
    else if (e.type === 'wispCharge' && near) sfx('wispCharge');
    else if (e.type === 'wispDash' && near) sfx('wispDash');
    if (e.type === 'stomp' && near) sfx('stomp');
    if (e.type === 'fireSlam') {
      sfx('stomp');
      camera.shake = 1;
      world.fire.fuel = Math.max(0, world.fire.fuel - rules.bossSlamFuel);
      for (const st of camp.targets()) if (Math.hypot(st.x - e.m.pos.x, st.z - e.m.pos.z) < 7) camp.damage(st, 20);
      effects.spawn(world.fire.x, 1, world.fire.z, 0xff7a3a, { n: 16, speed: 4, up: 3, life: 0.6, size: 0.14 });
      hud.popup(`불 -${rules.bossSlamFuel}`, { x: world.fire.x, y: 2.4, z: world.fire.z }, camera.cam, 'hurt big');
      beat('slamTip', '대장이 땅을 치자 불이 흔들린다! 나가서 싸우자', 3.2);
    }
    if (e.type === 'hitStruct' && e.m.hitTarget) {
      const st = e.m.hitTarget;
      const broke = camp.damage(st, Math.round(e.m.damage * (e.m.type === 'boss' ? 2 : 1)));
      if (near) sfx(broke ? 'rockBreak' : 'chop');
      effects.spawn(st.x, 0.8, st.z, 0xc98a4d, { n: broke ? 22 : 6, speed: broke ? 5 : 3, up: 4, life: 0.7, size: broke ? 0.18 : 0.1 });
      if (broke) {
        hud.toast(`${STRUCT[st.kind].name}이(가) 부서졌다!`, 2);
        camera.shake = Math.max(camera.shake, near ? 0.6 : 0.2);
      }
    }
    if (e.type === 'summon') { monsters.summon(c, day, e.m.pos.x, e.m.pos.z); if (near) sfx('drum'); }
    if (e.type === 'hitPlayer' && player.hurt(Math.max(1, Math.round(e.m.damage * M().dmg)), e.m.pos.x, e.m.pos.z)) {
      sfx('hurt');
      camera.shake = 1;
      hitStop = 0.07;
      hud.popup(`-${player.lastDamage}`, { x: player.pos.x, y: 2.4, z: player.pos.z }, camera.cam, 'hurt big');
    } else if (e.type === 'stomp') {
      const d = Math.hypot(e.m.pos.x - player.pos.x, e.m.pos.z - player.pos.z);
      camera.shake = Math.max(camera.shake, Math.max(0, 1 - d / 12));
    }
  }
  effects.update(dt);
  updateArrows(dt);
  critters.update(dt, player, world, darkness > 0.5);
  daynight.dread = dreadFor(day) * M().dread;
  if (eyes.update(dt, { darkness, dread: daynight.dread, look: player.pos, zones: c.zones, camera: camera.cam }) === 'eyes' && !EASY() && Math.random() < 0.5) sfx(Math.random() < 0.5 ? 'whisper' : 'laugh', 0, 0.8 + Math.random() * 0.5);
  hud.setNightGloom(darkness * (0.35 + daynight.dread * 0.55));
  world.updateBushes(dt);
  if (blastT >= 0) {
    blastT += dt;
    const k = blastT / 0.45;
    blast.scale.setScalar(0.5 + k * rules.charmRadius);
    blast.material.opacity = Math.max(0, 1 - k) * 0.9;
    if (k >= 1) blastT = -1;
  }

  // story beats
  const bossNight = day % rules.bossEvery === 0;
  if (phase === 'night' && !announced.nightIntro) {
    announced.nightIntro = true;
    const dr = dreadFor(day) * M().dread;
    const fr = world.fireRadius();
    eyes.ring(world.fire.x, world.fire.z, fr + 0.8, fr + 3.2, Math.round(5 + dr * 10), dr > 0.5);
    if (day >= 3 || bossNight) {
      // the scary card: black flash, flickering red title, an omen, a cackle in the dark
      const omen = bossNight ? '대장이 깨어났다. 오늘 밤은 다르다' : OMENS[(day * 7) % OMENS.length];
      hud.nightIntro(bossNight ? '대장의 밤' : '밤이 왔다', `${day}일째 밤 · ${omen}`, bossNight, EASY());
      if (EASY()) sfx('gong');
      else { sfx('dread'); sfx('laugh', 0.9, 0.85); sfx('laugh', 1.6, 1.15); }
      camera.shake = Math.max(camera.shake, 0.5);
    } else {
      sfx('laugh', 0.4, 1.1);
    }
  }
  if (phase === 'dusk' && !announced.dusk) {
    announced.dusk = true; sfx('gong');
    if (day < 3 && !bossNight) hud.banner(`${day}일째 밤이 온다`, day === 1 ? '도깨비는 불빛 안으로 못 들어온다' : '어제보다 더 많이 온다', 2.6);
  }
  if (phase === 'night') {
    if (day === 2 && nightP > 0.07) beat('wispTip', '도깨비불은 번쩍이면 돌진한다. 구르기로 피하자', 3);
    if (nightP > rules.nightChestAt && !announced.nightChest) {
      announced.nightChest = true;
      if (camp.spawnChest('night', 15, 26)) hud.toast('멀리서 도깨비 보물 궤짝이 빛난다!', 3);
    }
    if (bossNight && nightP > rules.bossAt && !announced.boss) {
      announced.boss = true;
      monsters.spawnBoss(c, day);
      sfx('raid'); sfx('gong');
      hud.banner('도깨비 대장이 나타났다!', '불빛에 숨어 있으면 대장이 불을 흔든다', 3, 'raid');
      camera.shake = 1.2;
    }
    if (!bossNight && nightP > rules.raidAt && !announced.raid) {
      announced.raid = true;
      monsters.raid(c, day);
      sfx('raid');
      hud.banner('도깨비 습격!', '둥둥둥… 북소리가 들린다', 2.8, 'raid');
      camera.shake = 1;
    }
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

  ambience.update(dt, { darkness, fireNear: Math.max(0, 1 - fireDist() / 9), lowHp, playing: true, time: nowS });
  const fighting = (monsters.boss && monsters.boss.alive) || (phase === 'night' && announced.raid && monsters.alive.length >= 5) || village.lairs.some((l) => l.state === 'guarded' && Math.hypot(l.x - player.pos.x, l.z - player.pos.z) < 14);
  music.setMood(fighting ? 'battle' : darkness > 0.5 ? 'night' : 'day');
  music.update();
  hud.setGoal(currentGoal(phase, inLight, c.fireR), player.pos, camera.cam);
  const chest = chestNear();
  hud.update({
    dt, time: nowS, hp: player.hp, hpMax: rules.playerHp, inv: player.inv, fuel: world.fire.fuel, fuelMax: world.fire.max,
    day, phase, progress: daynight.progress(), remain: daynight.remaining(),
    torch: player.torchT,
    weapon: player.weapon, weaponCount: player.weapons.length, arrows: player.inv.arrow || 0,
    weaponName: player.weapon === 'axe' ? ['돌도끼', '쇠도끼', '강철도끼'][player.axeLevel] : WEAPONS[player.weapon].name,
    actionLabel: player.fishT > 0 ? '낚시 중' : chest ? '열기' : rescuable() ? '구하기' : (village.talkable(player.pos.x, player.pos.z) && !nearFire()) ? '말 걸기' : (camp.repairable(player.pos.x, player.pos.z) && !nearFire()) ? '고치기' : canFish() ? '낚시' : canDrink() ? '물 마시기' : bushNear() ? '따기' : nearFire() && player.wood > 0 ? '장작 넣기' : '베기',
    water: player.water, food: player.food,
    boss: monsters.boss && monsters.boss.alive ? monsters.boss : null,
    rollCool: player.rollCool > 0 || player.rolling, canCraft,
    ...craftState(), danger, lowHp,
  });
  renderer.render(scene, camera.cam);
}

function ctx() {
  const fireR = world.fireRadius();
  const zones = camp.safeZones(fireR);
  if (player.torchT > 0 && state === 'playing') zones.push({ x: player.pos.x, z: player.pos.z, r: 2.4, torch: true });
  return { player, world, fireR, zones, effects, darkness: daynight.darkness(), camera: camera.cam, structs: camp.targets(), slowZones: camp.slowZones() };
}

camera.snap(player.pos);
requestAnimationFrame(frame);

// debug handle for automated checks
window.__game = {
  get state() { return state; }, get day() { return day; }, critters, eyes, village, player, world, monsters, daynight, camera, input, tune, rules, camp, hud,
  start: startGame, setTime: (t) => { daynight.time = t; },
  /** advance the game n frames without waiting for the browser (used by automated checks) */
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); return window.__game.info(); },
  key: (k, down, code) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k, code })),
  give: (k, n) => { player.inv[k] += n; },
  audio: () => audioState(), sfx,
  press: (name) => input.pressed.add(name),
  info: () => ({
    state, day, phase: daynight.phase(), water: +player.water.toFixed(1), food: +player.food.toFixed(1), rabbits: critters.alive.length, time: +daynight.time.toFixed(1), hp: +player.hp.toFixed(1), inv: { ...player.inv },
    fuel: +world.fire.fuel.toFixed(1), fireR: +world.fireRadius().toFixed(2), fireLv: world.fire.level, monsters: monsters.alive.length,
    types: monsters.alive.map((m) => m.type).join(','), chests: camp.chests.filter((c) => !c.opened).map((c) => c.kind).join(','),
    pos: [+player.pos.x.toFixed(2), +player.pos.z.toFixed(2)], trees: world.trees.filter((t) => t.alive).length, rocks: world.rocks.filter((r) => r.alive).length,
  }),
};
