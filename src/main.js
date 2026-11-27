import * as THREE from 'three';
import { rules, tune } from './config.js';
import { Input } from './input.js';
import { World, REGIONS } from './world.js';
import { Player } from './player.js';
import { Monsters } from './monsters.js';
import { DayNight } from './daynight.js';
import { QuarterCamera } from './camera.js';
import { Effects } from './effects.js';
import { Camp, STRUCT, TIERS } from './camp.js';
import { Critters } from './critters.js';
import { Eyes } from './spooky.js';
import { Village } from './villagers.js';
import { Minimap } from './minimap.js';
import { NIGHTS, pickNight, Horde, Rain } from './events.js';
import { XP, xpNeed, rollPerks, PERKS } from './perks.js';
import { Meta, MONSTER_INFO, ACHIEVEMENTS, GIFTS, OUTFITS, UPGRADES, upgradeCost, runCoins } from './meta.js';
import { Dog } from './pet.js';
import { setupInstall } from './install.js';
import { Net, listRooms, createRoom, myNick, setNick, randomNick, EMOTES, SERVER as SERVER_URL, roomName } from './net.js';
import { Friends } from './together.js';
import { Fox } from './beasts.js';
import { difficulty } from './config.js';
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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// graphics: 'normal' or 'low' (low = sharper on old phones: fewer pixels, no shadows)
let gfx = (() => { try { return localStorage.getItem('dokkaebi.gfx') || 'normal'; } catch { return 'normal'; } })();
function applyGfx() {
  renderer.setPixelRatio(gfx === 'low' ? Math.min(devicePixelRatio, 1) * 0.85 : Math.min(devicePixelRatio, 2));
  if (typeof daynight !== 'undefined') daynight.sun.castShadow = gfx !== 'low';
  renderer.setSize(innerWidth, innerHeight);
  const b = document.getElementById('gfx-btn');
  if (b) b.textContent = `그래픽: ${gfx === 'low' ? '낮음 (빠르게)' : '보통'}`;
}
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
village.relayout();
const minimap = new Minimap();
const horde = new Horde();
const dog = new Dog(scene);
const rain = new Rain(scene);
let tonight = 'normal';
// the torch: one light that follows the player (created up front so shaders don't recompile)
const torchLight = new THREE.PointLight(0xffb050, 0, 9, 1.5);
scene.add(torchLight);
let torchFlame = null;
// 여의주 that orbits the player after beating the 이무기
const pearl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshBasicMaterial({ color: 0xe8f6ff }));
pearl.visible = false;
scene.add(pearl);
const monsters = new Monsters(scene, effects);
const daynight = new DayNight(scene, renderer);
const hud = new Hud(input);

// expanding gold ring for the talisman blast
const blast = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffd65a, transparent: true, opacity: 0, depthWrite: false }));
blast.rotation.x = -Math.PI / 2; blast.position.y = 0.06;
scene.add(blast);
let blastT = -1;

applyGfx();
document.getElementById('gfx-btn').onclick = () => {
  gfx = gfx === 'low' ? 'normal' : 'low';
  try { localStorage.setItem('dokkaebi.gfx', gfx); } catch { /* ignore */ }
  applyGfx();
};
// slow phone? if the game runs under ~28 fps for a while, switch to low graphics once
let slowT = 0, autoLowered = false;
function watchFps(dt) {
  if (gfx === 'low' || autoLowered || state !== 'playing') return;
  slowT = dt > 1 / 28 ? slowT + dt : Math.max(0, slowT - dt * 0.5);
  if (slowT > 4) { autoLowered = true; gfx = 'low'; try { localStorage.setItem('dokkaebi.gfx', gfx); } catch { /* ignore */ } applyGfx(); hud.toast('폰이 힘들어해서 그래픽을 낮췄다 (일시정지에서 바꿀 수 있음)', 3); }
}

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
const meta = new Meta();
let mp = null; // 같이 하기: { net, code, pw, seed, startDay, start, room }
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

// ---------- save: kept on the phone, written often (dawn, pause, leaving the app, every 45 s) ----------
// Rule for updates: new fields must have defaults when loading, so an old save keeps working after an update.
const SAVE_KEY = 'dokkaebi.save';
function readSave() {
  try { const d = JSON.parse(store.get(SAVE_KEY) || 'null'); return d && d.v >= 1 ? d : null; } catch { return null; }
}
function saveGame() {
  store.set(mp ? 'dokkaebi.mp.' + mp.code : SAVE_KEY, JSON.stringify({
    v: 1, day, mode, t: +daynight.time.toFixed(1), pos: [+player.pos.x.toFixed(2), +player.pos.z.toFixed(2)], seed: world.seed, explored: minimap.serialize(), inv: player.inv, ironAxe: player.ironAxe, axeLevel: player.axeLevel, armor: player.armor, hp: Math.round(player.hp),
    villagers: village.inCamp.map((p) => p.def.id), level: player.level, xp: player.xp, perks: player.perks || [], pearls: player.pearls || 0, dog: dog.tamed, weapons: player.weapons, weapon: player.weapon, sandals: !!player.sandals, rod: !!player.rod,
    water: Math.round(player.water), food: Math.round(player.food),
    fireLv: world.fire.level, fuel: Math.round(world.fire.fuel), stats: player.stats, camp: camp.serialize(),
  }));
  if (!mp) showContinue();
}
function showContinue() {
  const d = readSave();
  const b = $('continue-btn');
  b.hidden = !d;
  if (d) {
    const t = d.t || 0;
    const when = t < rules.dayLength ? '낮' : t < rules.dayLength + rules.duskLength ? '해질녘' : '밤';
    b.textContent = `이어하기 · ${d.day}일째 ${when}`;
  }
  $('start-btn').textContent = d ? '처음부터' : '첫째 날 시작';
  $('start-btn').className = d ? 'ghost' : 'primary';
}
showContinue();
setupInstall();

// ---------- 같이 하기 (rooms) ----------
const friends = new Friends(scene, $('tags'));
const CYCLE = () => rules.dayLength + rules.duskLength + rules.nightLength;
/** the room's shared clock → day and time of day */
function mpClock() {
  const el = Math.max(0, (mp.net.now() - mp.start) / 1000);
  return { day: mp.startDay + Math.floor(el / CYCLE()), time: el % CYCLE() };
}
function readMpSave(code) { try { const d = JSON.parse(store.get('dokkaebi.mp.' + code) || 'null'); return d && d.v >= 1 ? d : null; } catch { return null; } }

// ---- the room's shared world (monsters, fire, buildings) comes from the server ----
const bySid = new Map();
const STATE_NAMES = ['spawn', 'chase', 'windup', 'recover', 'dying', 'gone', 'orbit', 'aim', 'dash', 'dive', 'under', 'burst', 'breath'];
const SHOWN_STATES = new Set(['windup', 'dive', 'under', 'burst', 'breath', 'aim', 'dash']);
function serverMonster(sm) {
  if (bySid.has(sm.sid)) return bySid.get(sm.sid);
  const d = difficulty(Math.max(1, day));
  const m = sm.il ? new Fox(scene, sm.x, sm.z, d, true) : monsters.create(sm.type, sm.x, sm.z, d);
  m.sid = sm.sid; m.hp = sm.hp; m.maxHp = sm.max || sm.hp; m.horde = !!sm.ho; m.facing = sm.f || 0;
  m.lastSeen = performance.now();
  monsters.list.push(m);
  bySid.set(sm.sid, m);
  return m;
}
function serverStruct(sm) {
  let st = camp.structs.find((q) => q.sid === sm.sid);
  if (!st) { st = camp.build(sm.k, sm.x, sm.z, sm.f, null); st.sid = sm.sid; }
  if ((sm.t || 0) !== (st.tier || 0)) camp.setTier(st, sm.t || 0);
  if (sm.hp < st.hp) { st.shake = 1; st.hurtShow = 4; }
  st.hp = Math.min(st.maxHp, sm.hp);
  return st;
}
function onServer(msg) {
  if (!mp) return;
  if (state !== 'playing' && state !== 'paused' && state !== 'talk' && state !== 'levelup' && state !== 'summary') { (mp.pending = mp.pending || []).push(msg); return; }
  const near = (x, z, r = 14) => Math.hypot(x - player.pos.x, z - player.pos.z) < r;
  switch (msg.t) {
    case 'b': for (const m of msg.l) onServer(m); break;
    case 'world':
      camp.reset();
      for (const sm of msg.structs) serverStruct(sm);
      world.fire.fuel = msg.fuel;
      if (msg.lv !== world.fire.level) world.setFireLevel(msg.lv);
      tonight = msg.tonight;
      for (const sm of msg.monsters) serverMonster(sm);
      break;
    case 'spawn': serverMonster(msg.m); break;
    case 's': {
      const now = performance.now();
      const seenSids = new Set();
      for (const [sid, x, z, , st, hp] of msg.m) {
        seenSids.add(sid);
        const m = bySid.get(sid);
        if (!m || !m.alive) continue;
        const dx = x - m.pos.x, dz = z - m.pos.z;
        if (Math.hypot(dx, dz) > 3) { m.pos.x = x; m.pos.z = z; } else { m.pos.x += dx * 0.35; m.pos.z += dz * 0.35; }
        m.hp = hp;
        const name = STATE_NAMES[st];
        if (SHOWN_STATES.has(name) && name !== m.state) { m.state = name; m.t = 0; }
        m.lastSeen = now;
      }
      for (const [sid, m] of bySid) if (!seenSids.has(sid) && now - m.lastSeen > 1500) { if (m.alive) m.banish(); bySid.delete(sid); }
      world.fire.fuel = msg.fuel;
      if (msg.lv > world.fire.level) world.setFireLevel(msg.lv);
      if (msg.tn) tonight = msg.tn;
      horde.active = msg.hw > 0; if (msg.hw) horde.wave = msg.hw; horde.phase = horde.active ? 'wave' : 'idle';
      monsters.boss = msg.boss ? bySid.get(msg.boss) || null : null;
      break;
    }
    case 'die': {
      const m = bySid.get(msg.sid);
      bySid.delete(msg.sid);
      if (!m) break;
      if (m.state !== 'dying' && m.state !== 'gone') { m.state = 'dying'; m.t = 0; }
      if (msg.illusion) { hud.popup('환영이었다!', { x: m.pos.x, y: 2.2, z: m.pos.z }, camera.cam, 'water big'); break; }
      m.beadMul = (msg.beads || 1) / (m.T.beads || 1);
      if (msg.by === mp.net.you) onMonsterKilled(m);
      else if (msg.by === 'trap' || msg.by === 'tower') { gain('bead', msg.beads || 1, { x: m.pos.x, y: 1.2, z: m.pos.z }, 200); gainXp(4); }
      else { const f = friends.map.get(msg.by); if (f && near(m.pos.x, m.pos.z)) hud.popup(`${f.name}!`, { x: m.pos.x, y: 2.6, z: m.pos.z }, camera.cam, 'water big'); gainXp(3); }
      break;
    }
    case 'hurt':
      if (player.hurt(Math.max(1, Math.round(msg.dmg * M().dmg)), msg.x, msg.z)) {
        sfx('hurt'); nightStats.hurt += player.lastDamage || 0; camera.shake = 1; hitStop = 0.07;
        hud.popup(`-${player.lastDamage}`, { x: player.pos.x, y: 2.4, z: player.pos.z }, camera.cam, 'hurt big');
      }
      break;
    case 'sadd': {
      const st = serverStruct(msg.s);
      if (near(st.x, st.z)) { sfx('build'); effects.spawn(st.x, 0.4, st.z, 0xd6d3cb, { n: 12, speed: 2.5, up: 3, life: 0.6, size: 0.13 }); }
      if (msg.by === mp.net.you) player.stats.built += 1;
      break;
    }
    case 'supd': serverStruct(msg.s); break;
    case 'sdel': {
      const st = camp.structs.find((q) => q.sid === msg.sid);
      if (!st) break;
      camp.destroy(st);
      if (msg.broke) {
        nightStats.broken += 1;
        effects.spawn(st.x, 0.8, st.z, 0xc98a4d, { n: 22, speed: 5, up: 4, life: 0.7, size: 0.18 });
        if (near(st.x, st.z, 20)) { sfx('rockBreak'); hud.toast(`${STRUCT[st.kind].name}이(가) 부서졌다!`, 2); }
      }
      break;
    }
    case 'deny': player.inv[msg.k] = (player.inv[msg.k] || 0) + 1; hud.toast(msg.why, 1.6); sfx('deny'); break;
    case 'event':
      if (msg.k === 'raid') { hud.banner('도깨비 습격!', '둥둥둥… 북소리가 들린다', 2.8, 'raid'); sfx('raid'); camera.shake = 1; }
      else if (msg.k === 'boss') {
        sfx('raid'); sfx('gong'); camera.shake = 1.2;
        hud.banner(msg.type === 'imugi' ? '이무기가 솟아올랐다!' : msg.type === 'dragon' ? '용이 하늘에 올랐다!' : '도깨비 대장이 나타났다!', '모두 힘을 합쳐라!', 3, 'raid');
      } else if (msg.k === 'horde-waveEnd') { hud.banner(`${msg.wave}번째 물결을 막았다!`, '잠깐 숨 돌리자… 곧 다음 물결', 2.6); sfx('craft'); }
      else if (msg.k === 'horde-nextWave') { hud.banner(`경고! ${msg.wave}번째 물결`, '더 많이 몰려온다', 2.6, 'raid'); sfx('raid'); camera.shake = 0.8; }
      else if (msg.k === 'horde-won') { hud.banner('백귀야행을 막아냈다!', '모두 함께 해냈다!', 3.2); sfx('dawn'); gain('bead', 6, { x: player.pos.x, y: 1.4, z: player.pos.z }, 300); meta.bump('hordes'); checkAch(); }
      break;
    case 'fx':
      if (msg.k === 'hitFire') { effects.spawn(world.fire.x, 1, world.fire.z, 0xff7a3a, { n: 10, speed: 4, up: 3, life: 0.5, size: 0.13 }); if (near(world.fire.x, world.fire.z)) { sfx('stomp'); hud.popup('불 -4', { x: world.fire.x, y: 2.4, z: world.fire.z }, camera.cam, 'hurt big'); } }
      else if (msg.k === 'fireSlam') { camera.shake = 1; sfx('stomp'); hud.popup(`불 -${rules.bossSlamFuel}`, { x: world.fire.x, y: 2.4, z: world.fire.z }, camera.cam, 'hurt big'); }
      else if (msg.k === 'stomp' && near(msg.x, msg.z)) camera.shake = Math.max(camera.shake, 0.6);
      else if (msg.k === 'revive') { const f = friends.map.get(msg.id); if (f) effects.spawn(f.pos.x, 1.2, f.pos.z, 0xffe27a, { n: 20, speed: 3, up: 5, life: 0.8, size: 0.13, grav: 3 }); }
      break;
    case 'shot': {
      const st = camp.structs.find((q) => q.sid === msg.from), m = bySid.get(msg.to);
      if (!st || !m) break;
      const mesh = new THREE.Mesh(arrowGeo, arrowMat);
      mesh.position.set(st.x, 3.0, st.z);
      scene.add(mesh);
      arrows.push({ mesh, vel: new THREE.Vector3(m.pos.x - st.x, 0, m.pos.z - st.z).normalize().multiplyScalar(24), target: m, life: 0.8, by: '망루', visual: true });
      break;
    }
    case 'day': tonight = msg.tonight; break;
    case 'revived':
      if (player.dead) {
        player.dead = false; player.hp = Math.round(player.maxHp * 0.5); player.invuln = 3; player.rig.spin.rotation.z = 0;
        mp.downT = undefined;
        hud.banner('일어났다!', `${msg.by} 님이 살려 줬다`, 2.6); sfx('dawn');
        effects.spawn(player.pos.x, 1.2, player.pos.z, 0xffe27a, { n: 24, speed: 3, up: 6, life: 1, size: 0.13, grav: 3 });
      }
      break;
    default: break;
  }
}
/** a fallen friend within reach (to revive) */
function downFriend() {
  if (!mp) return null;
  return friends.list.find((f) => (f.a & 4) && Math.hypot(f.pos.x - player.pos.x, f.pos.z - player.pos.z) < 2.2) || null;
}

function bindNet(net) {
  for (const t of ['b', 'world', 'hurt', 'revived', 'deny']) net.on(t, onServer);
  net.on('join', (m) => { friends.add(m.p); hud.toast(`${m.p.name} 님이 들어왔다 👋`, 2.2); sfx('chest'); })
    .on('p', (m) => friends.update(m))
    .on('leave', (m) => { const f = friends.map.get(m.id); if (f) hud.toast(`${f.name} 님이 나갔다`, 1.8); friends.remove(m.id); })
    .on('emote', (m) => { if (friends.emote(m.id, m.k)) sfx('pickup', 3); })
    .on('lost', () => reconnect(1));
}

async function joinRoom(code, pw) {
  const net = new Net();
  bindNet(net);
  const w = await net.join(code, pw, meta.outfit);
  mp = { net, code, pw, seed: w.seed, startDay: w.startDay, start: w.start, room: w.room, sendT: 0 };
  friends.clear();
  for (const p of w.players) friends.add(p);
  $('mp-screen').hidden = true;
  bySid.clear();
  monsters.puppet = true;
  startGame(readMpSave(code));
  $('btn-emote').hidden = false;
  const pend = mp.pending || []; mp.pending = [];
  for (const m of pend) onServer(m);
  hud.banner(`👫 ${w.room.name || '같이 하기'}`, `방 번호 ${code}${w.room.locked ? ' · 🔒' : ''} · ${friends.count + 1}명`, 3);
}

async function reconnect(attempt) {
  if (!mp || attempt > 6) { if (mp) { hud.toast('연결이 끊겼다. 혼자 하기로 돌아간다', 3); leaveRoom(true); } return; }
  hud.toast(`연결이 끊겼다… 다시 연결 중 (${attempt})`, 1.8);
  try {
    const net = new Net();
    bindNet(net);
    const w = await net.join(mp.code, mp.pw, meta.outfit);
    mp.net = net; mp.start = w.start;
    bySid.clear(); monsters.reset();
    friends.clear();
    for (const p of w.players) friends.add(p);
    hud.toast('다시 연결됐다!', 1.6);
  } catch {
    setTimeout(() => reconnect(attempt + 1), 2000);
  }
}

function leaveRoom(toTitle = false) {
  if (!mp) return;
  saveGame();
  mp.net.leave();
  mp = null;
  monsters.puppet = false;
  bySid.clear();
  friends.clear();
  $('btn-emote').hidden = true;
  $('emote-menu').hidden = true;
  if (toTitle) $('quit-btn').onclick();
}

/** every frame while together: follow the room clock, send where I am, draw friends */
function mpTick(dt) {
  const ck = mpClock();
  if (ck.day > day) { day = ck.day - 1; newDay(); }
  if (Math.abs(daynight.time - ck.time) > 1.5) daynight.time = ck.time;
  mp.sendT -= dt;
  if (mp.sendT <= 0 && mp.net.open) {
    mp.sendT = 0.125; // 8 times a second
    const a = (player.attacking ? 1 : 0) | (player.rolling ? 2 : 0) | (player.dead ? 4 : 0);
    mp.net.send({ t: 'p', x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), f: +player.facing.toFixed(2), s: +Math.min(1, Math.hypot(player.vel.x, player.vel.z) / tune.moveSpeed).toFixed(2), a, hp: Math.round(player.hp / player.maxHp * 100), w: player.weapon, look: meta.outfit });
  }
  friends.frame(dt, camera.cam);
}

// emote menu (preset messages only: safe for kids)
(() => {
  const menu = $('emote-menu');
  for (const e of EMOTES) {
    const b = document.createElement('button');
    b.innerHTML = `<span>${e.icon}</span>${e.text}`;
    b.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      menu.hidden = true;
      if (!mp) return;
      mp.net.send({ t: 'emote', k: e.k });
      hud.popup(`${e.icon} ${e.text}`, { x: player.pos.x, y: 2.8, z: player.pos.z }, camera.cam, 'wood big');
    });
    menu.appendChild(b);
  }
  $('btn-emote').addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); menu.hidden = !menu.hidden; });
})();

// rooms screen
let mpTab = 'list';
/** open room → straight in; locked room → ask the password only then */
async function joinByCode(code, locked) {
  mpMsg('…');
  unlock();
  if (!locked) { try { await joinRoom(code, ''); return; } catch { /* maybe locked */ } }
  const pw = (prompt('비밀번호') || '').replace(/\D/g, '');
  if (!pw) { mpMsg(''); return; }
  try { await joinRoom(code, pw); } catch (err) { mpMsg(err.message); }
}
function mpMsg(t) { $('mp-msg').textContent = t || ''; }
async function showRooms(tab = mpTab) {
  mpTab = tab;
  $('mp-screen').hidden = false;
  $('mp-nick').textContent = myNick();
  mpMsg('');
  const tabs = $('mp-tabs');
  tabs.innerHTML = '';
  for (const [id, label] of [['list', '🌐 방 목록'], ['create', '➕ 방 만들기'], ['code', '🔢 번호로 들어가기']]) {
    const t = document.createElement('button');
    t.className = 'ctab' + (id === tab ? ' on' : '');
    t.textContent = label;
    t.onclick = () => showRooms(id);
    tabs.appendChild(t);
  }
  const body = $('mp-body');
  body.innerHTML = '';
  const tryJoin = async (code, pw) => {
    mpMsg('…');
    try { unlock(); await joinRoom(code, pw); } catch (err) { mpMsg(err.message); }
  };
  if (tab === 'list') {
    body.innerHTML = '<p class="mp-hint">불러오는 중…</p>';
    let rooms = [];
    try { rooms = await listRooms(); } catch { body.innerHTML = '<p class="mp-hint">서버에 연결할 수 없어요. 잠시 뒤 다시 해 주세요.</p>'; return; }
    if (mpTab !== 'list') return;
    body.innerHTML = rooms.length ? '' : '<p class="mp-hint">열린 방이 없어요</p>';
    for (const r of rooms) {
      const row = document.createElement('div');
      row.className = 'room-row';
      row.innerHTML = `<span class="pic">${r.locked ? '🔒' : '🌐'}</span><div><b>${r.name || '도깨비 방'}</b><small>방 번호 ${r.code} · ${r.n}/${r.max}명</small></div>`;
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = r.n >= r.max ? '가득' : '들어가기';
      b.disabled = r.n >= r.max;
      b.onclick = () => {
        joinByCode(r.code, r.locked);
      };
      row.appendChild(b);
      body.appendChild(row);
    }
    const refresh = document.createElement('button');
    refresh.className = 'ghost';
    refresh.textContent = '🔄 새로고침';
    refresh.onclick = () => showRooms('list');
    body.appendChild(refresh);
  } else if (tab === 'create') {
    let taken = [];
    let name = roomName();
    body.innerHTML = `<div class="mp-form">
      <label>방 이름 <span class="room-name"><b id="mp-name">${name}</b> <button class="chip-btn" id="mp-name-re">🔄</button></span></label>
      <label>비밀번호 <input type="tel" id="mp-pw" maxlength="6" placeholder="없음"></label>
      <button class="primary" id="mp-make">방 만들기</button></div>`;
    listRooms().then((rs) => { taken = rs.map((r) => r.name); if (taken.includes(name)) { name = roomName(taken); $('mp-name').textContent = name; } }).catch(() => {});
    $('mp-name-re').onclick = () => { name = roomName([...taken, name]); $('mp-name').textContent = name; };
    $('mp-make').onclick = async () => {
      const pw = $('mp-pw').value.replace(/\D/g, '');
      if (pw && pw.length < 4) { mpMsg('비밀번호는 숫자 4자리 이상'); return; }
      mpMsg('만드는 중…');
      try { await tryJoin(await createRoom(name, pw), pw); } catch (err) { mpMsg(err.message || '방을 만들지 못했어요'); }
    };
  } else {
    body.innerHTML = `<div class="mp-form">
      <label>방 번호 <input type="tel" id="mp-code" maxlength="4" placeholder="1234"></label>
      <button class="primary" id="mp-go">들어가기</button></div>`;
    $('mp-go').onclick = () => {
      const code = $('mp-code').value.replace(/\D/g, '');
      if (code.length !== 4) { mpMsg('방 번호 4자리'); return; }
      joinByCode(code);
    };
  }
}
$('together-btn').onclick = () => { unlock(); showRooms('list'); };
// the button only shows when the room server answers (so nobody sees a broken button)
$('together-btn').hidden = true;
fetch(SERVER_URL + '/', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j && j.ok) $('together-btn').hidden = false; }).catch(() => {});
$('mp-close').onclick = () => { $('mp-screen').hidden = true; };
$('mp-screen').addEventListener('pointerdown', (e) => { if (e.target.id === 'mp-screen') $('mp-screen').hidden = true; });
$('mp-reroll').onclick = () => { setNick(randomNick()); $('mp-nick').textContent = myNick(); };
// links from the ttuk portal: ?room=1234 → "번호로 들어가기" with the number filled in; ?mp=create|code|list → that tab
{
  const rc = params.get('room'), tab = params.get('mp');
  if (/^\d{4}$/.test(rc || '') || ['list', 'create', 'code'].includes(tab)) {
    const u = new URL(location.href); u.searchParams.delete('room'); u.searchParams.delete('mp'); u.searchParams.delete('lock'); history.replaceState(null, '', u);
    if (rc && /^\d{4}$/.test(rc)) {
      showRooms('code').then(() => { $('mp-code').value = rc; joinByCode(rc, params.get('lock') === '1'); });
    }
    else showRooms(tab);
  }
}

// ---------- title: bestiary / achievements / outfits / start gift ----------
const MONSTER_PIC = { dokkaebi: '👹', wisp: '🔵', elite: '👺', centipede: '🐛', fox: '🦊', shadow: '👤', bulgasari: '🐻', boss: '👑', imugi: '🐍', dragon: '🐉' };
function showGifts() {
  const row = $('gift-row');
  const gifts = meta.gifts();
  if (!gifts.length) { row.innerHTML = ''; return; }
  row.innerHTML = '<span>시작 선물:</span>';
  for (const id of [null, ...gifts]) {
    const b = document.createElement('button');
    b.className = 'gift' + ((meta.gift || null) === id ? ' on' : '');
    b.textContent = id ? GIFTS[id].name : '없음';
    b.onclick = () => { meta.setGift(id); showGifts(); };
    row.appendChild(b);
  }
}
let metaTab = 'dex';
function showMeta(tab) {
  metaTab = tab;
  $('meta-screen').hidden = false;
  const tabs = $('meta-tabs');
  tabs.innerHTML = '';
  for (const [id, label] of [['train', '🎓 수련'], ['dex', '📖 도감'], ['ach', '🏆 업적'], ['outfit', '👘 옷']]) {
    const t = document.createElement('button');
    t.className = 'ctab' + (id === tab ? ' on' : '');
    t.textContent = label;
    t.onclick = () => showMeta(id);
    tabs.appendChild(t);
  }
  const list = $('meta-list');
  list.innerHTML = '';
  const row = (pic, title, sub, right, cls = '') => {
    const d = document.createElement('div');
    d.className = 'mrow ' + cls;
    d.innerHTML = `<span class="pic">${pic}</span><div><b>${title}</b><small>${sub}</small></div><em>${right}</em>`;
    list.appendChild(d);
    return d;
  };
  if (tab === 'train') {
    row('🪙', `엽전 ${meta.coins()}닢`, '판이 끝나면 버틴 밤·물리친 요괴·구한 사람만큼 받는다. 수련은 영원히 남는다', '');
    for (const u of UPGRADES) {
      const lv = meta.lv(u.id);
      const full = lv >= u.max;
      const cost = upgradeCost(u, lv);
      const d = row(u.icon, `${u.name} <small style="display:inline">${lv}/${u.max}</small>`, u.per, full ? '완성' : `🪙 ${cost}`, full ? '' : meta.coins() >= cost ? 'pick' : 'locked');
      if (!full && meta.coins() >= cost) d.onclick = () => { if (meta.buy(u.id)) { sfx('craft'); } showMeta('train'); showCoins(); };
    }
  } else if (tab === 'dex') {
    const n = MONSTER_INFO.filter((m) => dex[m.id]).length;
    row('📖', `${n} / ${MONSTER_INFO.length}칸`, '만나면 도감에 기록된다', '');
    for (const m of MONSTER_INFO) {
      const d = dex[m.id];
      if (d) row(MONSTER_PIC[m.id], m.name, m.desc, `${d.kills || 0}마리`);
      else row('❔', '???', '아직 만나지 못했다', '', 'locked');
    }
  } else if (tab === 'ach') {
    row('🌙', `최고 기록 ${meta.life.bestNight}일 밤`, `물리친 요괴 ${meta.life.kills}마리 · 대장 ${meta.life.bosses} · 백귀야행 ${meta.life.hordes}`, '');
    for (const a of ACHIEVEMENTS) {
      const r = a.reward;
      const reward = [r.gift && `🎁 ${GIFTS[r.gift].name}`, r.outfit && `👘 ${OUTFITS[r.outfit].name}`].filter(Boolean).join(' · ');
      row(meta.done[a.id] ? '🏆' : '🔒', a.name, `${a.desc}<br>${reward}`, meta.done[a.id] ? '달성' : '', meta.done[a.id] ? '' : 'locked');
    }
  } else {
    const own = meta.outfits();
    for (const [id, o] of Object.entries(OUTFITS)) {
      const has = own.includes(id);
      const d = row(has ? '👘' : '🔒', o.name, has ? o.desc : '업적을 달성하면 열린다', meta.outfit === id ? '입는 중' : '', (has ? 'pick' : 'locked') + (meta.outfit === id ? ' on' : ''));
      if (has) d.onclick = () => { meta.setOutfit(id); player.setOutfit(id); showMeta('outfit'); };
    }
  }
}
document.querySelectorAll('[data-meta]').forEach((b) => { b.onclick = () => { unlock(); showMeta(b.dataset.meta); }; });
function showCoins() { const b = document.querySelector('[data-meta=train]'); if (b) b.textContent = `🎓 수련 · 🪙${meta.coins()}`; }
showCoins();
$('meta-close').onclick = () => { $('meta-screen').hidden = true; };
// tapping outside a panel closes it (phones: closing buttons are small)
$('meta-screen').addEventListener('pointerdown', (e) => { if (e.target.id === 'meta-screen') $('meta-screen').hidden = true; });
showGifts();
player.setOutfit(meta.outfits().includes(meta.outfit) ? meta.outfit : 'basic');

function startGame(save = null) {
  setTimeout(backGuard, 0);
  if (save instanceof Event) save = null;
  unlock();
  player.reset();
  // 수련: permanent upgrades
  player.mods.maxHp += meta.lv('hp') * 5;
  player.mods.dmg += meta.lv('dmg') * 0.03;
  player.mods.speed += meta.lv('speed') * 0.02;
  player.mods.needs += meta.lv('needs') * 0.04;
  player.xpMul = 1 + meta.lv('xp') * 0.08;
  player.revives = meta.lv('revive');
  player.hp = player.maxHp;
  player.setOutfit(meta.outfits().includes(meta.outfit) ? meta.outfit : 'basic');
  player.perks = [];
  player.pearls = 0;
  pendingLevels = 0;
  monsters.reset();
  camp.reset();
  // every new run gets its own island; a saved run rebuilds the same one
  day = mp ? mpClock().day : save ? save.day : parseInt(params.get('day') || '1', 10);
  world.day = day;
  world.generate(mp ? mp.seed : save && save.seed ? save.seed : (Math.random() * 1e9) >>> 0);
  village.relayout();
  minimap.reset();
  if (save && save.explored) minimap.restore(save.explored);
  horde.reset();
  tonight = pickNight(day);
  monsters.mod = null;
  dog.reset();
  if (save && save.dog) { dog.appear(player.pos.x - 1.5, player.pos.z - 1.5); dog.tame(); }
  else if (day >= 2) strayDog();
  critters.reset();
  critters.repopulate(world, player.pos.x, player.pos.z);
  world.setFireLevel(0);
  world.fire.fuel = rules.fireStart;
  daynight.time = mp ? mpClock().time : parseFloat(params.get('t') || '0');   // ?t=150 → start near dusk
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
    if (!mp) day = save.day;
    if (save.mode) { mode = save.mode; showMode(); }
    Object.assign(player.inv, save.inv);
    player.setAxe(save.axeLevel ?? (save.ironAxe ? 1 : 0));
    player.setArmor(!!save.armor);
    if (save.weapons) { player.weapons = [...save.weapons]; player.setWeapon(save.weapon || 'axe'); }
    player.sandals = !!save.sandals; player.rod = !!save.rod;
    player.level = save.level || 1; player.xp = save.xp || 0; player.perks = save.perks || [];
    for (const id of player.perks) { const pk = PERKS.find((q) => q.id === id); if (pk) pk.apply(player.mods); }
    player.pearls = save.pearls || 0;
    player.mods.dmg += player.pearls * 0.25;
    village.restore(save.villagers || [], world.fire);
    player.hp = save.hp; player.water = save.water; player.food = save.food;
    Object.assign(player.stats, save.stats);
    world.setFireLevel(save.fireLv);
    world.fire.fuel = save.fuel;
    if (!mp) camp.restore(save.camp);
    if (!mp) daynight.time = save.t || 0;
    if (save.pos) { player.pos.set(save.pos[0], 0, save.pos[1]); world.resolve(player.pos, 0.42); camera.snap(player.pos); }
    hud.banner(`${day}일째`, '이어서 버텨라', 2.6);
    return;
  }
  // 수련 start bonuses (new runs only)
  player.inv.wood += meta.lv('wood') * 2;
  player.inv.torch += meta.lv('torch');
  world.fire.fuel += meta.lv('fire') * 5;
  // start gift (unlocked by achievements) and outfit
  const gift = meta.gift && meta.gifts().includes(meta.gift) ? meta.gift : null;
  if (gift === 'wood10') player.inv.wood += 10;
  if (gift === 'ironAxe') player.setAxe(1);
  if (gift === 'charm2') player.inv.charm += 2;
  if (gift === 'traps') player.inv.trap += 3;
  if (gift === 'armor') player.setArmor(true);
  if (gift === 'torch3') player.inv.torch += 3;
  saveGame(); // morning of day 1 is a checkpoint too
  const intro = () => {
    hud.banner('1일째 아침', '백 일 밤을 버텨라', 2.6);
  };
  if (!store.get('dokkaebi.prologue') && params.get('skipstory') !== '1') {
    store.set('dokkaebi.prologue', '1');
    talk(PROLOGUE, intro);
  } else intro();
}

// ---------- experience & level-up ----------
let pendingLevels = 0;
let autoSaveT = 45;
/** achievements: check after anything that can finish one */
function checkAch() {
  for (const a of meta.check(dex)) {
    const r = a.reward;
    const what = [r.gift && `시작 선물 "${GIFTS[r.gift].name}"`, r.outfit && `옷 "${OUTFITS[r.outfit].name}"`].filter(Boolean).join(', ');
    setTimeout(() => { hud.banner(`🏆 업적: ${a.name}`, `${what} 얻음!`, 3); sfx('chest'); }, 1500);
  }
}
let nightStats = { kills: 0, hurt: 0, broken: 0 };
function gainXp(n) {
  player.xp += Math.round(n * (player.xpMul || 1));
  while (player.xp >= xpNeed(player.level)) { player.xp -= xpNeed(player.level); player.level += 1; pendingLevels += 1; }
}
function maybeLevelUp() {
  if (!pendingLevels || state !== 'playing' || hud.talking) return;
  pendingLevels -= 1;
  state = 'levelup';
  input.clear();
  sfx('dawn');
  hud.levelUp(player.level - pendingLevels, rollPerks(), (perk) => {
    perk.apply(player.mods);
    player.perks = [...(player.perks || []), perk.id];
    if (perk.id === 'maxHp') player.hp = Math.min(player.maxHp, player.hp + 20);
    state = 'playing';
    input.clear();
    sfx('craft');
    effects.spawn(player.pos.x, 1.2, player.pos.z, 0xffe27a, { n: 24, speed: 3, up: 6, life: 1, size: 0.13, grav: 4 });
    hud.popup(`${perk.icon} ${perk.name}`, { x: player.pos.x, y: 2.8, z: player.pos.z }, camera.cam, 'fire big');
  });
}

/** show dialogue lines; the world waits while you read */
function talk(lines, done) {
  state = 'talk';
  input.clear();
  hud.say(lines, () => { state = 'playing'; input.clear(); if (done) done(); });
}
$('dialog').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); unlock(); hud.dialogNext(); });
// tap anywhere on the screen moves the dialogue on
$('dialog-catch').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); hud.dialogNext(); });

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
  const ri = document.getElementById('room-info');
  if (ri) {
    ri.hidden = !mp;
    if (mp) ri.innerHTML = `👫 <b>${mp.room.name || '같이 하기'}</b><br>방 번호 <b>${mp.code}</b>${mp.pw ? ` · 비밀번호 <b>${mp.pw}</b>` : ' · 비밀번호 없음'}<br>함께: ${[myNick(), ...friends.list.map((f) => f.name)].join(', ')}`;
  }
  if (p && state === 'playing') saveGame();
  state = p ? 'paused' : 'playing';
  $('pause-screen').hidden = !p;
  $('quit-btn').textContent = mp ? '🚪 방 나가기' : '🏠 그만하기 (저장됨)';
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
  const coins = runCoins({ nights: survived, kills: st.kills, rescued: village.inCamp.length, bosses: st.bosses || 0, hordes: st.hordes || 0 });
  meta.addCoins(coins);
  showCoins();
  $('result-desc').textContent += `  🪙 엽전 +${coins} (첫 화면 "수련"에서 강해지자)`;
  $('result-stats').innerHTML = [
    ['버틴 밤', survived], ['물리친 도깨비', st.kills], ['구한 사람', village.inCamp.length], ['지은 것', st.built],
  ].map(([k, v]) => `<li>${k}<b>${v}</b></li>`).join('');
  setTimeout(() => { $('result-screen').hidden = false; }, won ? 900 : 1400);
}

/** dawn: the night is over, roll into the next day */
function newDay() {
  const survived = day;
  meta.best('bestNight', survived);
  checkAch();
  const lastNight = { type: tonight, hordeWon: horde.done };
  monsters.banishAll();
  eyes.clear();
  camp.clearChests('night');
  if (survived >= rules.totalNights) { endGame(true); return; }
  day += 1;
  daynight.time = 0;
  announced = {};
  world.regrow(rules.regrowShare, player.pos.x, player.pos.z);
  player.hp = Math.min(player.maxHp, player.hp + rules.dawnHeal);
  spawnDayChests(false);
  world.refillBushes();
  critters.repopulate(world, player.pos.x, player.pos.z);
  for (const l of village.lairs) if (l.state === 'guarded') { l.state = 'open'; l.guards = []; }
  horde.reset();
  tonight = pickNight(day);
  monsters.mod = null;
  morningGifts();
  if (!dog.tamed && day >= 2 && dog.state === 'gone') strayDog();
  if (dog.tamed) { gain('rawmeat', 1, { x: dog.pos.x, y: 0.8, z: dog.pos.z }, 1800); setTimeout(() => hud.toast('백구가 토끼를 물어 왔다!', 2), 2400); }
  sfx('dawn');
  saveGame();
  const opened = Object.entries(REGIONS).find(([id, r]) => id !== 'home' && r.unlock === day);
  showSummary(survived, lastNight, () => hud.banner(`${survived}일째 밤을 버텼다!`, opened ? `안개가 걷혔다! ${opened[1].name}이(가) 열렸다` : `꼬끼오! ${day}일째 아침`, 3));
  effects.spawn(player.pos.x, 1.2, player.pos.z, 0xffe27a, { n: 18, speed: 3, up: 5, life: 1, size: 0.14, grav: 3 });
}

/** dawn: stars for the night and a small reward */
function showSummary(night, last, done) {
  const st = nightStats;
  const stars = 1 + (st.kills >= 4 + night ? 1 : 0) + (st.hurt < 40 && st.broken === 0 ? 1 : 0);
  const reward = stars * 2 + (last.hordeWon ? 4 : 0);
  const nm = NIGHTS[last.type] && NIGHTS[last.type].name;
  $('sum-eyebrow').textContent = `${night}일째 밤 결산${nm ? ' · ' + nm : ''}`;
  $('sum-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
  $('sum-stats').innerHTML = [['물리친 요괴', st.kills], ['받은 피해', Math.round(st.hurt)], ['부서진 건물', st.broken], ['레벨', player.level]]
    .map(([k, v]) => `<li>${k}<b>${v}</b></li>`).join('');
  $('sum-reward').textContent = `보상: 도깨비 구슬 +${reward} · 🪙 엽전 +${stars * 2}`;
  state = 'summary';
  input.clear();
  $('summary').hidden = false;
  sfx('chest');
  $('sum-btn').onclick = () => {
    $('summary').hidden = true;
    state = 'playing';
    input.clear();
    gain('bead', reward, { x: player.pos.x, y: 1.4, z: player.pos.z });
    meta.addCoins(stars * 2);
    gainXp(stars * 10);
    done();
  };
}

/** a stray 진돗개 waits somewhere in the home forest */
function strayDog() {
  for (let k = 0; k < 30; k++) {
    const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 10;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (world.colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1)) continue;
    dog.appear(x, z);
    return;
  }
}
const DOG_FOOD = ['meat', 'fishc', 'fish', 'rawmeat', 'skewer'];
/** a building to 강화 right here: no monster close, and the building is nearer than any tree/rock */
function upgradeHere() {
  const up = camp.upgradable(player.pos.x, player.pos.z);
  if (!up) return null;
  if (monsters.alive.some((m) => Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z) < 3)) return null;
  const sd = Math.hypot(up.x - player.pos.x, up.z - player.pos.z) - up.colR;
  const t = findTarget(2.2);
  if (t && t.kind !== 'monster' && Math.hypot(t.x - player.pos.x, t.z - player.pos.z) - (t.obj.r || 0.3) < sd) return null;
  return up;
}
const dogNear = () => dog.state === 'stray' && Math.hypot(dog.pos.x - player.pos.x, dog.pos.z - player.pos.z) < 1.9;

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
$('pause-screen').addEventListener('pointerdown', (e) => { if (e.target.id === 'pause-screen') setPaused(false); });
$('summary').addEventListener('pointerdown', (e) => { if (e.target.id === 'summary') $('sum-btn').onclick(); });
$('quit-btn').onclick = () => {
  if (mp) leaveRoom();
  state = 'title';
  $('pause-screen').hidden = true;
  $('title-screen').hidden = false;
  showContinue();
  showGifts();
  hud.show(false);
  showControls(false);
};
// on ttuk.pages.dev the game sits in /dokkaebi/: show the way back to the game list
if (/\/dokkaebi\/?$/.test(location.pathname)) $('home-link').hidden = false;
// phone back button: playing → pause menu, pause menu → back to the game; on the title it leaves as usual.
// Browsers skip history entries made without a tap, so the guard entry is (re)made on a tap while in the game.
function backGuard() { if (state !== 'title' && !(history.state && history.state.g === 1)) history.pushState({ g: 1 }, ''); }
document.addEventListener('pointerdown', backGuard, true);
addEventListener('popstate', () => {
  if (state === 'title') {
    if (!$('mp-screen').hidden || !$('meta-screen').hidden) { $('mp-screen').hidden = true; $('meta-screen').hidden = true; }
    return;
  }
  if (state === 'playing') setPaused(true);
  else if (state === 'paused') setPaused(false);
  history.pushState({ g: 1 }, '');
});
if (params.get('nopause') !== '1') {
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') setPaused(true); });
}
// leaving or hiding the app always saves (even in test mode)
for (const ev of ['visibilitychange', 'pagehide']) {
  addEventListener(ev, () => { if ((document.hidden || ev === 'pagehide') && ['playing', 'paused'].includes(state)) saveGame(); });
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
const canDrink = () => player.water < 97 && (world.atShore(player.pos.x, player.pos.z) || camp.nearWell(player.pos.x, player.pos.z) || world.nearSpring(player.pos.x, player.pos.z));
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
  gainXp(6);
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
  const df = downFriend();
  if (df) {
    mp.net.send({ t: 'revive', id: df.id });
    sfx('heal');
    hud.popup(`${df.name} 살렸다!`, { x: df.pos.x, y: 2.4, z: df.pos.z }, camera.cam, 'heal big');
    player.stats.revives = (player.stats.revives || 0) + 1;
    gainXp(15);
    return;
  }
  const c = chestNear();
  if (c) { openChest(c); return; }
  const lair = rescuable();
  if (lair) {
    const v = village.free(lair);
    sfx('chest');
    player.stats.rescued = (player.stats.rescued || 0) + 1;
    gainXp(40);
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
  if (dogNear()) {
    const food = DOG_FOOD.find((k) => player.inv[k] > 0);
    if (!food) { hud.toast('배고픈 진돗개다. 고기나 물고기를 주자', 2); sfx('deny'); return; }
    player.inv[food] -= 1;
    dog.tame();
    sfx('eat'); sfx('dawn');
    effects.spawn(dog.pos.x, 1, dog.pos.z, 0xffb3c7, { n: 16, speed: 2, up: 4, life: 0.8, size: 0.12, grav: 3 });
    hud.banner('진돗개 "백구"가 친구가 됐다!', '같이 싸우고, 아침마다 토끼를 물어 온다', 3);
    return;
  }
  const broken = camp.repairable(player.pos.x, player.pos.z);
  if (broken && !nearFire()) {
    const cost = STRUCT[broken.kind].repair;
    if (!canAfford(player.inv, cost)) { hud.toast(`고치려면 ${Object.entries(cost).map(([k, v]) => `${ITEMS[k].name} ${v}`).join(', ')}`, 1.8); sfx('deny'); return; }
    pay(player.inv, cost);
    if (mp && broken.sid) mp.net.send({ t: 'repair', sid: broken.sid });
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
    const what = b.kind === 'herb' ? 'herb' : 'berry';
    gain(what, n, { x: b.x, y: 0.7, z: b.z });
    hud.popup(`+${n} ${what === 'herb' ? '약초' : '산딸기'}`, { x: b.x, y: 1.8, z: b.z }, camera.cam, 'wood big');
    return;
  }
  if (nearFire() && player.wood > 0) {
    const max = world.fire.max;
    if (world.fire.fuel >= max - 1) { hud.toast('불이 충분히 크다', 1.2); sfx('deny'); return; }
    sfx('feed');
    player.wood -= 1;
    player.stats.fed += 1;
    const was = world.fire.fuel;
    world.fire.fuel = Math.min(max, world.fire.fuel + rules.fuelPerWood * (1 + player.mods.fuel));
    if (mp) mp.net.send({ t: 'feed', mul: 1 + player.mods.fuel });
    hud.spend('wood', { x: world.fire.x, y: 0.8, z: world.fire.z }, camera.cam);
    effects.spawn(world.fire.x, 1, world.fire.z, 0xffc25a, { n: 12, speed: 1.5, up: 5, life: 0.7, size: 0.12, grav: 2 });
    hud.popup(was <= 0 ? '불이 다시 붙었다!' : '+불', { x: world.fire.x, y: 2.2, z: world.fire.z }, camera.cam, 'fire');
    return;
  }
  const up = upgradeHere();
  if (up) {
    const next = TIERS[up.tier + 1];
    if (!canAfford(player.inv, next.cost)) { hud.toast(`${next.name}로 강화하려면 ${Object.entries(next.cost).map(([k, v]) => `${ITEMS[k].name} ${v}`).join(', ')}`, 2); sfx('deny'); return; }
    pay(player.inv, next.cost);
    if (mp && up.sid) mp.net.send({ t: 'upgrade', sid: up.sid });
    camp.setTier(up, up.tier + 1);
    up.hp = up.maxHp;
    sfx('build'); sfx('craft');
    effects.spawn(up.x, 1, up.z, up.tier === 2 ? 0x8a96a8 : 0xc0c0c8, { n: 18, speed: 3, up: 5, life: 0.8, size: 0.13, grav: 4 });
    hud.popup(`${next.name} ${STRUCT[up.kind].name}!`, { x: up.x, y: 2.4, z: up.z }, camera.cam, 'fire big');
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

// ---------- bestiary (도감): what you have met / beaten, kept across runs ----------
export const MONSTER_NAMES = { dokkaebi: '도깨비', elite: '큰 도깨비', wisp: '도깨비불', boss: '도깨비 대장', fox: '구미호', centipede: '왕지네', bulgasari: '불가사리', shadow: '어둑시니' };
const MEET_TIPS = {
  wisp: '도깨비불! 하얗게 번쩍이면 돌진한다. 구르기로 피하자',
  elite: '큰 도깨비! 붉은 원 밖으로 피하고, 철퇴가 잘 듣는다',
  centipede: '왕지네! 몸을 세우면 곧장 돌진한다. 구르기로 넘자',
  fox: '구미호! 분신을 만든다. 맞으면 사라지는 쪽은 가짜',
  bulgasari: '불가사리! 지은 것을 먹어 치운다. 막아라',
  shadow: '어둑시니! 가까울수록 커진다. 횃불이나 불빛으로 녹이자',
};
const dex = (() => { try { return JSON.parse(store.get('dokkaebi.dex') || '{}'); } catch { return {}; } })();
function saveDex() { store.set('dokkaebi.dex', JSON.stringify(dex)); }
/** first time you see a monster type: short tip */
function meet(type) {
  if (!dex[type]) { dex[type] = { met: 1, kills: 0 }; saveDex(); if (MEET_TIPS[type]) hud.toast(MEET_TIPS[type], 3); }
}
function seen(type) {
  meet(type);
  dex[type].kills = (dex[type].kills || 0) + 1;
  saveDex();
}

/** every hit on a monster goes through here: crits, damage numbers, kill rewards */
function damageMonster(m, base, { fromX = player.pos.x, fromZ = player.pos.z, kb = 1, canCrit = true, by = null } = {}) {
  let dmg = base, crit = false;
  dmg = Math.round(dmg * (1 + player.mods.dmg));
  if (canCrit && Math.random() < CRIT_CHANCE + player.mods.crit) { dmg = Math.round(dmg * CRIT_MUL); crit = true; }
  let killed;
  if (mp && m.sid) {
    mp.net.send({ t: 'hit', sid: m.sid, dmg, kb, x: +fromX.toFixed(2), z: +fromZ.toFixed(2) });
    m.hit(dmg, fromX, fromZ, kb);
    if (m.state === 'dying') { m.state = 'chase'; m.t = 0; m.hp = 1; } // the server says when it falls
    killed = false;
  } else killed = m.hit(dmg, fromX, fromZ, kb);
  const y = (m.type === 'wisp' ? 1.6 : 2.0 * (m.T.scale || 1));
  hud.popup(crit ? `${dmg} 치명타!` : `${dmg}`, { x: m.pos.x + (Math.random() - 0.5) * 0.6, y, z: m.pos.z }, camera.cam, crit ? 'dmg crit' : 'dmg');
  sfx(killed ? 'kill' : 'hitMonster');
  effects.spawn(m.pos.x, 1.1, m.pos.z, crit ? 0xffe27a : 0xfff2a8, { n: crit ? 14 : 8, speed: 4.5, up: 3, life: 0.35, size: 0.11 });
  if (killed) onMonsterKilled(m, by);
  return { killed, crit, dmg };
}

function onMonsterKilled(m, by) {
  if (m.illusion) { hud.popup('환영이었다!', { x: m.pos.x, y: 2.2, z: m.pos.z }, camera.cam, 'water big'); return; }
  player.stats.kills += 1;
  meta.bump('kills');
  if (m.type === 'boss') meta.bump('bosses');
  if (m.type === 'imugi' || m.type === 'dragon') meta.bump('imugi');
  seen(m.type);
  checkAch();
  gainXp(XP[m.type] || 10);
  nightStats.kills += 1;
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
  if (m.type === 'imugi' || m.type === 'dragon') {
    // 여의주: a glowing pearl that circles you; +25% damage for the rest of the run
    player.mods.dmg += 0.25;
    player.pearls = (player.pearls || 0) + 1;
    hud.banner(m.type === 'dragon' ? '용을 물리쳤다!' : '이무기를 물리쳤다!', '여의주를 얻었다! 모든 피해 +25%', 3.4);
    sfx('dawn'); camera.shake = 1.6; hitStop = 0.3;
    monsters.banishNear(m.pos.x, m.pos.z, 30);
    if (m.type === 'dragon') setTimeout(() => { if (state === 'playing') endGame(true); }, 3500);
  }
  gain('bead', Math.round(m.T.beads * (m.beadMul || 1)), { x: m.pos.x, y: 1.2, z: m.pos.z }, 200);
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
    if (a.by) a.mesh.position.y = Math.max(1.2, a.mesh.position.y - dt * 4); // tower arrows drop toward the target
    a.mesh.lookAt(a.mesh.position.x + a.vel.x, a.mesh.position.y, a.mesh.position.z + a.vel.z);
    a.life -= dt;
    for (const m of monsters.alive) {
      if (Math.hypot(m.pos.x - a.mesh.position.x, m.pos.z - a.mesh.position.z) < m.radius + 0.35) {
        if (!a.visual) damageMonster(m, a.dmg || WEAPONS.bow.dmg, { kb: 0.4, by: a.by || null, canCrit: !a.by });
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
    let got = world.chopTree(t, player.pos.x, player.pos.z, chop);
    sfx(got ? 'treeFall' : 'chop');
    effects.spawn(t.x - fx * 0.3, 0.8, t.z - fz * 0.3, 0xd9a066, { n: 7, speed: 3, up: 3, life: 0.5, size: 0.11 });
    camera.shake = Math.max(camera.shake, 0.25);
    if (got) {
      gainXp(3);
      if (Math.random() < player.mods.gather) { got *= 2; hud.popup('두 배!', { x: t.x, y: 3.2, z: t.z }, camera.cam, 'fire big'); }
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
    let got = world.mineRock(r, mine);
    sfx(got ? 'rockBreak' : 'rock');
    effects.spawn(r.x - fx * 0.4, 0.6, r.z - fz * 0.4, 0xffffff, { n: 5, speed: 4, up: 3, life: 0.25, size: 0.07 });
    effects.spawn(r.x - fx * 0.4, 0.6, r.z - fz * 0.4, 0xa7a9b2, { n: 6, speed: 3, up: 3, life: 0.5, size: 0.12 });
    camera.shake = Math.max(camera.shake, 0.3);
    hitStop = Math.max(hitStop, 0.03);
    if (got) {
      gainXp(3);
      if (Math.random() < player.mods.gather) { got *= 2; hud.popup('두 배!', { x: r.x, y: 2.6, z: r.z }, camera.cam, 'fire big'); }
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
    if (mp) mp.net.send({ t: 'firelv', lv: world.fire.level });
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
    if (id === 'meat') player.hp = Math.min(player.maxHp, player.hp + 8);
    if (id === 'skewer') player.hp = Math.min(player.maxHp, player.hp + 15);
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
    if (player.hp >= player.maxHp - 0.5) { hud.toast('체력이 가득하다', 1.2); sfx('deny'); return; }
    sfx('heal');
    player.inv.herb -= 1;
    player.hp = Math.min(player.maxHp, player.hp + rules.herbHeal);
    effects.spawn(player.pos.x, 1.2, player.pos.z, 0x7be07a, { n: 16, speed: 1.5, up: 4, life: 0.9, size: 0.13, grav: -1 });
    hud.popup(`+${rules.herbHeal}`, { x: player.pos.x, y: 2.5, z: player.pos.z }, camera.cam, 'heal big');
  } else if (id === 'charm') {
    player.inv.charm -= 1;
    sfx('charm');
    if (mp) mp.net.send({ t: 'charm', x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2) });
    const n = monsters.banishNear(player.pos.x, player.pos.z, rules.charmRadius);
    blastT = 0; blast.position.x = player.pos.x; blast.position.z = player.pos.z;
    effects.spawn(player.pos.x, 1, player.pos.z, 0xffd65a, { n: 30, speed: 7, up: 3, life: 0.7, size: 0.14, grav: 2 });
    camera.shake = 0.9;
    hitStop = 0.08;
    hud.popup(n ? `부적! 도깨비 ${n}마리를 쫓았다` : '부적!', { x: player.pos.x, y: 2.6, z: player.pos.z }, camera.cam, 'fire big');
  } else if (PLACEABLE.includes(id)) {
    const ahead = id === 'hut' ? 2.6 : id === 'trap' ? 1.2 : 1.5;
    let x = player.pos.x + fx * ahead, z = player.pos.z + fz * ahead;
    let facing = player.facing;
    if (['fence', 'wall', 'gate'].includes(id)) {
      // line pieces snap to 45° and continue a nearby wall so lines join up neatly
      facing = Math.round(facing / (Math.PI / 4)) * (Math.PI / 4);
      let best = null, bd = 1.3;
      for (const sgm of camp.structs) {
        if (!['fence', 'wall', 'gate'].includes(sgm.kind)) continue;
        const ax = Math.cos(sgm.f), az = -Math.sin(sgm.f), len = sgm.kind === 'fence' ? 1.5 : 1.6;
        for (const sd of [-1, 1]) {
          const cx = sgm.x + ax * len * sd, cz = sgm.z + az * len * sd, d = Math.hypot(cx - x, cz - z);
          if (d < bd) { bd = d; best = { x: cx, z: cz, f: sgm.f }; }
        }
      }
      if (best) { x = best.x; z = best.z; facing = best.f; }
    }
    const why = camp.checkSpot(id, x, z);
    if (why) { hud.toast(why, 1.4); sfx('deny'); return; }
    sfx('build');
    player.inv[id] -= 1;
    if (mp) mp.net.send({ t: 'build', k: id, x: +x.toFixed(2), z: +z.toFixed(2), f: +facing.toFixed(3) });
    else camp.build(id, x, z, facing);
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
  if (horde.active) return { text: `백귀야행 ${horde.wave}/${horde.waves} 물결 · 모닥불을 지켜라!`, target: fire, urgent: true };
  if (night && !inLight) return { text: '불빛 안으로 돌아가!', target: fire, urgent: true };
  if (world.fire.fuel < 15 && player.wood > 0) return { text: '모닥불이 꺼져 간다! 장작 넣기', target: fire, urgent: true };
  const follower = village.people.find((v) => v.state === 'follow');
  if (follower) return { text: `${follower.def.name}을(를) 모닥불까지 데려가기`, target: fire };
  if (night) return { text: '불빛 안에서 새벽까지 버티기', target: null };
  if (player.water < 30) {
    const wellsAndSprings = [...world.springs, ...camp.wells];
    return { text: '물 마시기 (옹달샘·우물·물가)', target: near(wellsAndSprings), urgent: player.water < 12 };
  }
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

function updatePearl(time) {
  pearl.visible = (player.pearls || 0) > 0 && state === 'playing';
  if (!pearl.visible) return;
  pearl.position.set(player.pos.x + Math.sin(time * 2.4) * 0.9, 1.7 + Math.sin(time * 3) * 0.15, player.pos.z + Math.cos(time * 2.4) * 0.9);
  pearl.material.color.setHSL(0.55 + Math.sin(time) * 0.05, 0.6, 0.85);
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
      if (village.inCamp.length === 4) { meta.bump('rescuedAll'); checkAch(); }
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
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = now;
  if (raw < 0.5) watchFps(raw);
  tick(dt);
}

function tick(dt) {
  clock += dt;
  const nowS = clock;
  input.update();

  if (input.consume('pause')) setPaused(state === 'playing');
  if (state === 'levelup' || state === 'summary') {
    if (state === 'summary' && input.consume('action')) $('sum-btn').onclick();
    input.pressed.clear(); renderer.render(scene, camera.cam); return;
  }
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
  const autoOk = !dogNear() && !player.attacking && !player.rolling && !nearFire() && !chestNear() && !bushNear() && !rescuable() && !village.talkable(player.pos.x, player.pos.z) && !camp.repairable(player.pos.x, player.pos.z);
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
  world.day = day;
  const bumped = world.fogClamp(player.pos);
  if (bumped && !announced['fog' + bumped]) {
    announced['fog' + bumped] = true;
    hud.toast(`짙은 안개… ${REGIONS[bumped].name}은(는) ${REGIONS[bumped].unlock}일째에 열린다`, 2.6);
  }
  if (ev === 'strike') resolveStrike();

  const phase = daynight.phase();
  const { darkness } = daynight.update(gdt, player.pos);
  world.water.material.color.copy(daynight.col.water);

  // fire burns down
  const burn = (phase === 'night' ? rules.burnNight : phase === 'dusk' ? (rules.burnDay + rules.burnNight) / 2 : rules.burnDay) * M().burn * (tonight === 'rain' && darkness > 0.3 ? 1.6 : 1);
  if (!mp && world.fire.fuel > 0) {
    world.fire.fuel = Math.max(0, world.fire.fuel - burn * gdt);
    if (world.fire.fuel === 0) { hud.toast('모닥불이 꺼졌다! 장작을 넣어!', 3); camera.shake = 0.5; sfx('fireOut'); }
  }
  world.updateFire(dt, nowS, darkness);
  world.updateMist(nowS);
  world.updateTrees(dt);
  world.updateRocks(dt);
  world.updateOcclusion(dt, player.pos.x, player.pos.z, camera.back);
  camp.update(dt, nowS, darkness, camera.cam, player.pos);
  camp.updateGates(dt, player.pos);

  // torch: a small moving light that also keeps monsters back
  if (player.torchT > 0) {
    player.torchT = Math.max(0, player.torchT - gdt);
    if (player.torchT === 0) { hud.toast('횃불이 다 탔다', 1.6); sfx('fireOut'); }
  }
  updateTorch(nowS, darkness);
  updatePearl(nowS);
  const c = ctx();

  const beat = (key, text, secs) => { if (!announced[key]) { announced[key] = true; hud.toast(text, secs); } };
  // healing in any light
  const inLight = c.zones.some((z) => Math.hypot(player.pos.x - z.x, player.pos.z - z.z) < z.r);
  const regen = rules.regenInLight * (village.has('samwol') ? 2 : 1) * (1 + player.mods.regen);
  if (inLight && player.hurtT > 3 && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + regen * dt);

  // thirst and hunger
  player.water = Math.max(0, player.water - rules.waterDrain * M().need * (1 - player.mods.needs) * gdt);
  player.food = Math.max(0, player.food - rules.foodDrain * M().need * (1 - player.mods.needs) * gdt);
  if ((player.water <= 0 || player.food <= 0) && !player.dead) {
    player.hp = Math.max(0, player.hp - rules.needDamage * gdt * ((player.water <= 0) + (player.food <= 0)));
    if (player.hp <= 0) player.dead = true;
  }

  const nightP = phase === 'night' ? daynight.progress() : -1;
  const events = monsters.update(dt, c, mp || tonight === 'horde' ? -1 : nightP, day);
  for (const m of monsters.alive) if (!m.illusion && !dex[m.type] && Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z) < 13) meet(m.type);
  updateVillage(dt, c, darkness);
  for (const e of dog.update(dt, { player, world, monsters: monsters.alive, darkness })) {
    if (e.type === 'bite') { damageMonster(e.m, 8, { fromX: dog.pos.x, fromZ: dog.pos.z, kb: 0.5, canCrit: false, by: '백구' }); }
    else if (e.type === 'bark') { if (Math.random() < 0.6) sfx('bark'); }
    else if (e.type === 'tired') hud.popup('헥헥…', { x: dog.pos.x, y: 1.6, z: dog.pos.z }, camera.cam, 'water big');
  }
  for (const sh of mp ? [] : camp.towerShots(dt, monsters.alive, darkness > 0.4)) {
    const s = sh.tower;
    const mesh = new THREE.Mesh(arrowGeo, arrowMat);
    mesh.position.set(s.x, 3.0, s.z);
    scene.add(mesh);
    const v = new THREE.Vector3(sh.m.pos.x - s.x, 0, sh.m.pos.z - s.z).normalize().multiplyScalar(24);
    arrows.push({ mesh, vel: v, target: sh.m, life: 0.8, dmg: 8 + s.tier * 4, by: '망루' });
    if (Math.hypot(s.x - player.pos.x, s.z - player.pos.z) < 14) sfx('swing');
  }
  for (const h of mp ? [] : camp.springTraps(monsters.alive)) {
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
    if (mp && e.m.sid && e.type !== 'windup') continue; // together: the server decides what this monster's hit does
    if (e.type === 'hitFire') {
      world.fire.fuel = Math.max(0, world.fire.fuel - 4);
      sfx('stomp'); camera.shake = Math.max(camera.shake, 0.5);
      effects.spawn(world.fire.x, 1, world.fire.z, 0xff7a3a, { n: 10, speed: 4, up: 3, life: 0.5, size: 0.13 });
      hud.popup('불 -4', { x: world.fire.x, y: 2.4, z: world.fire.z }, camera.cam, 'hurt big');
    }
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
      const broke = camp.damage(st, e.m.dmgStruct || Math.round(e.m.damage * (e.m.type === 'boss' ? 2 : 1)));
      if (near) sfx(broke ? 'rockBreak' : 'chop');
      effects.spawn(st.x, 0.8, st.z, 0xc98a4d, { n: broke ? 22 : 6, speed: broke ? 5 : 3, up: 4, life: 0.7, size: broke ? 0.18 : 0.1 });
      if (broke) {
        nightStats.broken += 1;
        hud.toast(`${STRUCT[st.kind].name}이(가) 부서졌다!`, 2);
        camera.shake = Math.max(camera.shake, near ? 0.6 : 0.2);
      }
    }
    if (e.type === 'summon') { monsters.summon(c, day, e.m.pos.x, e.m.pos.z); if (near) sfx('drum'); }
    if (e.type === 'hitPlayer' && player.hurt(Math.max(1, Math.round(e.m.damage * M().dmg)), e.m.pos.x, e.m.pos.z)) {
      sfx('hurt');
      nightStats.hurt += player.lastDamage || 0;
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
    nightStats = { kills: 0, hurt: 0, broken: 0 };
    const dr = dreadFor(day) * M().dread;
    const fr = world.fireRadius();
    eyes.ring(world.fire.x, world.fire.z, fr + 0.8, fr + 3.2, Math.round(5 + dr * 10), dr > 0.5);
    if (tonight === 'horde') {
      if (!mp) horde.start();
      hud.nightIntro('경고! 백귀야행', `${day}일째 밤 · 1번째 물결이 몰려온다! 모닥불을 지켜라`, true, false);
      sfx('raid'); sfx('dread'); sfx('laugh', 0.6, 0.8);
      camera.shake = 1;
    } else if (day >= 3 || bossNight || tonight !== 'normal') {
      // the scary card: black flash, flickering red title, an omen, a cackle in the dark
      const ev = NIGHTS[tonight];
      const omen = bossNight ? '대장이 깨어났다. 오늘 밤은 다르다' : tonight !== 'normal' ? ev.desc : OMENS[(day * 7) % OMENS.length];
      const bossTitle = day >= rules.totalNights ? '용의 밤' : day % 10 === 0 ? '이무기의 밤' : '대장의 밤';
      hud.nightIntro(bossNight ? bossTitle : tonight !== 'normal' ? ev.name : '밤이 왔다', `${day}일째 밤 · ${omen}`, bossNight || tonight === 'bloodmoon', EASY());
      if (EASY()) sfx('gong');
      else { sfx('dread'); sfx('laugh', 0.9, 0.85); sfx('laugh', 1.6, 1.15); }
      camera.shake = Math.max(camera.shake, 0.5);
    } else {
      sfx('laugh', 0.4, 1.1);
    }
  }
  if (phase === 'dusk' && !announced.dusk) {
    announced.dusk = true; sfx('gong');
    if (tonight === 'horde') { hud.banner('오늘 밤은 백귀야행!', '온갖 요괴가 모닥불로 몰려온다. 장작과 덫을 준비하자', 3.2, 'raid'); sfx('drum'); }
    else if (tonight !== 'normal' && tonight !== 'boss') hud.banner(`오늘 밤: ${NIGHTS[tonight].name}`, NIGHTS[tonight].desc, 2.8, tonight === 'bloodmoon' ? 'raid' : '');
    else if (day < 3 && !bossNight) hud.banner(`${day}일째 밤이 온다`, day === 1 ? '도깨비는 불빛 안으로 못 들어온다' : '어제보다 더 많이 온다', 2.6);
    monsters.mod = tonight === 'bloodmoon' ? { hpMul: 1.25, dmgMul: 1.3, beadMul: 2 } : null;
  }
  if (phase === 'night') {
    if (day === 2 && nightP > 0.07) beat('wispTip', '도깨비불은 번쩍이면 돌진한다. 구르기로 피하자', 3);
    if (nightP > rules.nightChestAt && !announced.nightChest) {
      announced.nightChest = true;
      if (camp.spawnChest('night', 15, 26)) hud.toast('멀리서 도깨비 보물 궤짝이 빛난다!', 3);
    }
    if (!mp && bossNight && nightP > rules.bossAt && !announced.boss) {
      announced.boss = true;
      const bm = monsters.spawnBoss(c, day);
      sfx('raid'); sfx('gong');
      if (bm.type === 'imugi') hud.banner('이무기가 솟아올랐다!', '붉은 원이 생기면 그 자리를 피하라. 땅속에 있을 땐 못 때린다', 3.4, 'raid');
      else if (bm.type === 'dragon') hud.banner('용이 하늘에 올랐다!', '붉은 줄이 보이면 옆으로 피하라. 마지막 밤이다!', 3.4, 'raid');
      else hud.banner('도깨비 대장이 나타났다!', '불빛에 숨어 있으면 대장이 불을 흔든다', 3, 'raid');
      camera.shake = 1.2;
    }
    if (!mp && !bossNight && tonight !== 'horde' && nightP > rules.raidAt && !announced.raid) {
      announced.raid = true;
      monsters.raid(c, day);
      sfx('raid');
      hud.banner('도깨비 습격!', '둥둥둥… 북소리가 들린다', 2.8, 'raid');
      camera.shake = 1;
    }
  }

  const hev = mp ? null : horde.update(dt, { monsters, ctx: c, day });
  if (hev === 'waveEnd') {
    hud.banner(`${horde.wave}번째 물결을 막았다!`, '잠깐 숨 돌리자… 곧 다음 물결', 2.6);
    sfx('craft');
    if (camp.spawnChest('night', 4, 8)) hud.toast('모닥불 근처에 상자가 떨어졌다', 2);
  } else if (hev === 'nextWave') {
    hud.banner(`경고! ${horde.wave}번째 물결`, horde.wave === horde.waves ? '마지막 물결이다!' : '더 많이 몰려온다', 2.6, 'raid');
    sfx('raid'); camera.shake = 0.8;
  } else if (hev === 'won') {
    hud.banner('백귀야행을 막아냈다!', '요괴들이 물러갔다. 큰 보상!', 3.2);
    sfx('dawn');
    player.stats.hordes = (player.stats.hordes || 0) + 1;
    meta.bump('hordes'); checkAch();
    gain('bead', 6, { x: player.pos.x, y: 1.4, z: player.pos.z }, 300);
    gain('charm', 1, { x: player.pos.x, y: 1.4, z: player.pos.z }, 600);
    camp.spawnChest('night', 4, 8);
  }
  rain.update(dt, tonight === 'rain' && darkness > 0.25, player.pos);
  if (tonight === 'fog' && darkness > 0.2) {
    scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, 4, darkness);
    scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, 22, darkness);
  }
  daynight.blood = tonight === 'bloodmoon' ? 1 : 0;

  if (mp && player.dead && !(player.revives > 0)) {
    // together: no game over — get back up at the campfire after a few seconds
    if (mp.downT === undefined) {
      const alone = friends.count === 0;
      mp.downT = alone ? 5 : 20;
      hud.banner('쓰러졌다…', alone ? '5초 뒤 모닥불 옆에서 일어난다' : '친구가 와서 "살리기"를 누르면 일어난다 (20초)', 3.2);
      sfx('lose');
      if (!alone) mp.net.send({ t: 'emote', k: 'help' });
    }
    mp.downT -= dt;
    if (mp.downT <= 0) {
      mp.downT = undefined;
      player.dead = false; player.hp = Math.round(player.maxHp * 0.6); player.invuln = 3;
      player.rig.spin.rotation.z = 0;
      player.pos.set(world.fire.x + 1.5, 0, world.fire.z + 1.5);
      camera.snap(player.pos);
      sfx('dawn');
    }
  }
  if (player.dead && player.revives > 0) {
    // 다시 일어나기 (수련): once per run
    player.revives -= 1;
    player.dead = false;
    player.hp = Math.round(player.maxHp / 2);
    player.invuln = 2.5;
    player.rig.spin.rotation.z = 0;
    monsters.banishNear(player.pos.x, player.pos.z, 5);
    effects.spawn(player.pos.x, 1.2, player.pos.z, 0xffe27a, { n: 30, speed: 4, up: 7, life: 1, size: 0.14, grav: 4 });
    hud.banner('다시 일어났다!', '수련의 힘 (이번 판 한 번)', 2.6);
    sfx('dawn');
  }
  if (player.dead && !mp) { endGame(false); }
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
  if (horde.active && horde.phase === 'wave') danger = Math.max(danger, 0.32 + Math.abs(Math.sin(nowS * 4)) * 0.25); // the whole wave flashes red
  const lowHp = player.hp < 35 ? 0.35 + (1 - player.hp / 35) * 0.6 : 0;

  ambience.update(dt, { darkness, fireNear: Math.max(0, 1 - fireDist() / 9), lowHp, playing: true, time: nowS });
  const fighting = horde.active || (monsters.boss && monsters.boss.alive) || (phase === 'night' && announced.raid && monsters.alive.length >= 5) || village.lairs.some((l) => l.state === 'guarded' && Math.hypot(l.x - player.pos.x, l.z - player.pos.z) < 14);
  music.setMood(fighting ? 'battle' : darkness > 0.5 ? 'night' : 'day');
  music.update();
  maybeLevelUp();
  autoSaveT -= dt;
  if (autoSaveT <= 0 && !player.dead) { autoSaveT = 45; saveGame(); }
  const goal = currentGoal(phase, inLight, c.fireR);
  hud.setGoal(goal, player.pos, camera.cam);
  minimap.update(dt, { player, world, camp, village, monsters: monsters.alive, darkness, goal: goal && goal.target, friends: friends.list });
  if (mp) mpTick(dt);
  const chest = chestNear();
  hud.update({
    dt, time: nowS, hp: player.hp, hpMax: player.maxHp, inv: player.inv, fuel: world.fire.fuel, fuelMax: world.fire.max,
    day, phase, progress: daynight.progress(), remain: daynight.remaining(),
    torch: player.torchT,
    weapon: player.weapon, weaponCount: player.weapons.length, arrows: player.inv.arrow || 0,
    weaponName: player.weapon === 'axe' ? ['돌도끼', '쇠도끼', '강철도끼'][player.axeLevel] : WEAPONS[player.weapon].name,
    actionLabel: player.fishT > 0 ? '낚시 중' : downFriend() ? '살리기' : chest ? '열기' : dogNear() ? '먹이 주기' : rescuable() ? '구하기' : (village.talkable(player.pos.x, player.pos.z) && !nearFire()) ? '말 걸기' : (camp.repairable(player.pos.x, player.pos.z) && !nearFire()) ? '고치기' : (!nearFire() && upgradeHere()) ? '강화' : canFish() ? '낚시' : canDrink() ? '물 마시기' : bushNear() ? '따기' : nearFire() && player.wood > 0 ? '장작 넣기' : '베기',
    water: player.water, food: player.food, level: player.level, xp: player.xp, xpNeed: xpNeed(player.level),
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
  get state() { return state; }, get day() { return day; }, get mp() { return mp; }, friends, critters, eyes, village, dog, horde, meta, player, world, monsters, daynight, camera, input, tune, rules, camp, hud,
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
