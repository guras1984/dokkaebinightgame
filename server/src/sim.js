// The room's shared world, run on the server with the same rule code the game uses (src/*.js).
// Phones follow what this decides: monsters, the campfire, buildings, nights, raids, bosses, 백귀야행.
import * as THREE from 'three';
import { rules } from '../../src/config.js';
import { World } from '../../src/world.js';
import { Camp, STRUCT, TIERS } from '../../src/camp.js';
import { Monsters } from '../../src/monsters.js';
import { Horde, pickNight } from '../../src/events.js';

const NO_FX = { spawn() {} };
const CYCLE = rules.dayLength + rules.duskLength + rules.nightLength;
const STATE = { spawn: 0, chase: 1, windup: 2, recover: 3, dying: 4, gone: 5, orbit: 6, aim: 7, dash: 8, dive: 9, under: 10, burst: 11, breath: 12 };

function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export class Sim {
  constructor(meta, saved) {
    this.meta = meta;
    this.scene = new THREE.Scene();
    this.world = new World(this.scene);
    this.world.generate(meta.seed);
    this.camp = new Camp(this.scene, this.world);
    this.monsters = new Monsters(this.scene, NO_FX);
    this.horde = new Horde();
    this.nextSid = 1;
    this.nextStruct = 1;
    this.fuel = rules.fireStart;
    this.level = 0;
    this.out = [];          // messages for everyone
    this.direct = [];       // { to, msg } for one player
    this.announced = {};
    this.snapT = 0;
    const ck = this.clock();
    this.day = ck.day;
    this.tonight = pickNight(this.day, seeded(meta.seed + this.day));
    if (saved) {
      this.fuel = saved.fuel ?? this.fuel;
      this.level = saved.level || 0;
      for (const s of saved.structs || []) this.addStruct(s.k, s.x, s.z, s.f, s.hp, s.t);
    }
    this.world.setFireLevel(this.level);
  }

  clock() {
    const el = Math.max(0, (Date.now() - this.meta.start) / 1000);
    return { day: this.meta.startDay + Math.floor(el / CYCLE), time: el % CYCLE };
  }

  static phase(t) {
    if (t < rules.dayLength) return 'day';
    if (t < rules.dayLength + rules.duskLength) return 'dusk';
    return 'night';
  }
  static darkness(t) {
    const dayEnd = rules.dayLength, nightStart = dayEnd + rules.duskLength, nightEnd = nightStart + rules.nightLength;
    if (t < dayEnd - 10) return 0;
    if (t < nightStart) return Math.min(1, (t - (dayEnd - 10)) / (rules.duskLength + 10));
    if (t < nightEnd - 8) return 1;
    return Math.max(0, (nightEnd - t) / 8);
  }

  save() { return { fuel: Math.round(this.fuel), level: this.level, structs: this.camp.structs.map((s) => ({ k: s.kind, x: s.x, z: s.z, f: s.f, hp: Math.round(s.hp), t: s.tier || 0 })) }; }

  // ---------- buildings ----------
  addStruct(kind, x, z, f, hp, tier) {
    const st = this.camp.build(kind, x, z, f, null);
    st.sid = this.nextStruct++;
    if (tier) this.camp.setTier(st, tier);
    if (hp != null) st.hp = Math.min(st.maxHp, hp);
    return st;
  }
  structMsg(st) { return { sid: st.sid, k: st.kind, x: st.x, z: st.z, f: st.f, hp: Math.round(st.hp), max: st.maxHp, t: st.tier || 0 }; }

  /** messages from a player */
  handle(pid, msg) {
    if (msg.t === 'hit') {
      const m = this.monsters.list.find((q) => q.sid === msg.sid);
      if (!m || !m.alive) return;
      const killed = m.hit(Math.min(400, +msg.dmg || 0), +msg.x || m.pos.x, +msg.z || m.pos.z, Math.min(3, +msg.kb || 1));
      if (killed) m.killedBy = pid;
    } else if (msg.t === 'feed') {
      this.fuel = Math.min(rules.fireLevels[this.level], this.fuel + rules.fuelPerWood * Math.min(2, +msg.mul || 1));
    } else if (msg.t === 'firelv') {
      const lv = Math.max(this.level, Math.min(2, msg.lv | 0));
      if (lv !== this.level) { this.level = lv; this.world.setFireLevel(lv); this.fuel = Math.min(rules.fireLevels[lv], this.fuel + 25); }
    } else if (msg.t === 'build') {
      if (!STRUCT[msg.k]) return;
      const why = this.camp.checkSpot(msg.k, +msg.x, +msg.z);
      if (why) { this.direct.push({ to: pid, msg: { t: 'deny', why, k: msg.k } }); return; }
      const st = this.addStruct(msg.k, +msg.x, +msg.z, +msg.f || 0);
      this.out.push({ t: 'sadd', s: this.structMsg(st), by: pid });
    } else if (msg.t === 'repair') {
      const st = this.camp.structs.find((s) => s.sid === msg.sid);
      if (st) { this.camp.repair(st); this.out.push({ t: 'supd', s: this.structMsg(st) }); }
    } else if (msg.t === 'upgrade') {
      const st = this.camp.structs.find((s) => s.sid === msg.sid);
      if (st && st.tier < 2) { this.camp.setTier(st, st.tier + 1); st.hp = st.maxHp; this.out.push({ t: 'supd', s: this.structMsg(st) }); }
    } else if (msg.t === 'charm') {
      this.monsters.banishNear(+msg.x, +msg.z, rules.charmRadius);
    }
  }

  /** the world a newcomer needs */
  welcome() {
    return {
      t: 'world', fuel: this.fuel, lv: this.level, tonight: this.tonight,
      structs: this.camp.structs.map((s) => this.structMsg(s)),
      monsters: this.monsters.list.filter((m) => m.sid && m.alive).map((m) => this.spawnMsg(m)),
    };
  }

  spawnMsg(m) { return { sid: m.sid, type: m.type, x: +m.pos.x.toFixed(2), z: +m.pos.z.toFixed(2), f: +(m.facing || 0).toFixed(2), hp: m.hp, max: m.maxHp, il: m.illusion ? 1 : 0, ho: m.horde ? 1 : 0 }; }

  /** one step of the shared world. players: [{ id, pos:{x,z}, facing, dead, rolling }] */
  step(dt, players) {
    if (!players.length) return;
    this.monsters.party = players.length;   // more friends → more and tougher monsters
    const ck = this.clock();
    // a new day: monsters leave, a new kind of night is picked
    if (ck.day !== this.day) {
      this.day = ck.day;
      this.monsters.banishAll();
      this.horde.reset();
      this.announced = {};
      this.monsters.mod = null;
      this.tonight = pickNight(this.day, seeded(this.meta.seed + this.day));
      this.out.push({ t: 'day', day: this.day, tonight: this.tonight });
    }
    const t = ck.time, phase = Sim.phase(t), darkness = Sim.darkness(t);
    const nightP = phase === 'night' ? (t - rules.dayLength - rules.duskLength) / rules.nightLength : -1;
    const bossNight = this.day % rules.bossEvery === 0;

    // the shared campfire
    const burn = (phase === 'night' ? rules.burnNight : phase === 'dusk' ? (rules.burnDay + rules.burnNight) / 2 : rules.burnDay) * (this.tonight === 'rain' && darkness > 0.3 ? 1.6 : 1);
    this.fuel = Math.max(0, this.fuel - burn * dt);
    this.world.fire.fuel = this.fuel;
    this.camp.update(dt, t, darkness, null, null);
    const fireR = this.world.fireRadius();
    const zones = this.camp.safeZones(fireR);
    const proxies = players.map((p) => ({ id: p.id, pos: new THREE.Vector3(p.x, 0, p.z), facing: p.f, dead: !!(p.a & 4), rolling: !!(p.a & 2) }));
    const living = proxies.filter((p) => !p.dead);
    const ctx = { player: living[Math.floor(Math.random() * living.length)] || proxies[0], players: proxies, world: this.world, fireR, zones, effects: NO_FX, darkness, camera: null, structs: this.camp.targets(), slowZones: this.camp.slowZones() };

    // night beats
    if (phase === 'dusk' && !this.announced.dusk) {
      this.announced.dusk = true;
      this.monsters.mod = this.tonight === 'bloodmoon' ? { hpMul: 1.25, dmgMul: 1.3, beadMul: 2 } : null;
    }
    if (phase === 'night') {
      if (this.tonight === 'horde' && !this.announced.horde) { this.announced.horde = true; this.horde.start(); this.out.push({ t: 'event', k: 'horde' }); }
      if (bossNight && nightP > rules.bossAt && !this.announced.boss) {
        this.announced.boss = true;
        const b = this.monsters.spawnBoss(ctx, this.day);
        this.out.push({ t: 'event', k: 'boss', type: b.type });
      }
      if (!bossNight && this.tonight !== 'horde' && nightP > rules.raidAt && !this.announced.raid) {
        this.announced.raid = true;
        this.monsters.raid(ctx, this.day);
        this.out.push({ t: 'event', k: 'raid' });
      }
    }

    // monsters
    const events = this.monsters.update(dt, ctx, this.tonight === 'horde' ? -1 : nightP, this.day);
    for (const e of events) {
      const m = e.m;
      if (e.type === 'hitPlayer') this.direct.push({ to: m.target, msg: { t: 'hurt', dmg: m.damage, x: +m.pos.x.toFixed(2), z: +m.pos.z.toFixed(2), sid: m.sid } });
      else if (e.type === 'hitStruct' && m.hitTarget) {
        const st = m.hitTarget;
        if (!this.camp.structs.includes(st)) continue;
        const broke = this.camp.damage(st, m.dmgStruct || Math.round(m.damage * (m.type === 'boss' ? 2 : 1)));
        this.out.push(broke ? { t: 'sdel', sid: st.sid, broke: 1 } : { t: 'supd', s: this.structMsg(st) });
      } else if (e.type === 'hitFire') { this.fuel = Math.max(0, this.fuel - 4); this.out.push({ t: 'fx', k: 'hitFire' }); }
      else if (e.type === 'fireSlam') {
        this.fuel = Math.max(0, this.fuel - rules.bossSlamFuel);
        for (const st of this.camp.targets()) if (Math.hypot(st.x - m.pos.x, st.z - m.pos.z) < 7) { if (this.camp.damage(st, 20)) this.out.push({ t: 'sdel', sid: st.sid, broke: 1 }); else this.out.push({ t: 'supd', s: this.structMsg(st) }); }
        this.out.push({ t: 'fx', k: 'fireSlam' });
      } else if (e.type === 'summon') this.monsters.summon(ctx, this.day, m.pos.x, m.pos.z);
      else if (e.type === 'stomp') this.out.push({ t: 'fx', k: 'stomp', x: +m.pos.x.toFixed(1), z: +m.pos.z.toFixed(1) });
    }
    // traps and watchtowers (server decides the damage)
    for (const h of this.camp.springTraps(this.monsters.alive)) {
      if (h.m.hit(20, h.trap.x, h.trap.z, 0.3)) h.m.killedBy = 'trap';
      this.out.push(h.trap.hp <= 0 ? { t: 'sdel', sid: h.trap.sid } : { t: 'supd', s: this.structMsg(h.trap) });
    }
    for (const sh of this.camp.towerShots(dt, this.monsters.alive, darkness > 0.4)) {
      if (sh.m.hit(8 + sh.tower.tier * 4, sh.tower.x, sh.tower.z, 0.4)) sh.m.killedBy = 'tower';
      this.out.push({ t: 'shot', from: sh.tower.sid, to: sh.m.sid });
    }
    const hev = this.horde.update(dt, { monsters: this.monsters, ctx, day: this.day });
    if (hev) this.out.push({ t: 'event', k: 'horde-' + hev, wave: this.horde.wave });

    // new monsters → spawn messages; dead ones → die messages
    for (const m of this.monsters.list) {
      if (!m.sid) { m.sid = this.nextSid++; this.out.push({ t: 'spawn', m: this.spawnMsg(m) }); }
      if (m.state === 'dying' && !m.dieSent) { m.dieSent = true; this.out.push({ t: 'die', sid: m.sid, by: m.killedBy || null, type: m.type, beads: Math.round((m.T.beads || 1) * (m.beadMul || 1)), illusion: m.illusion ? 1 : 0 }); }
    }

    // snapshot ~10 times a second
    this.snapT -= dt;
    if (this.snapT <= 0) {
      this.snapT = 0.1;
      const ms = [];
      for (const m of this.monsters.list) {
        if (!m.sid || !m.alive) continue;
        ms.push([m.sid, +m.pos.x.toFixed(2), +m.pos.z.toFixed(2), +(m.facing || 0).toFixed(2), STATE[m.state] ?? 1, Math.max(0, Math.round(m.hp))]);
      }
      this.out.push({ t: 's', m: ms, fuel: +this.fuel.toFixed(1), lv: this.level, tn: this.tonight, hw: this.horde.active ? this.horde.wave : 0, boss: this.monsters.boss && this.monsters.boss.alive ? this.monsters.boss.sid : 0 });
    }
  }

  /** take the queued messages */
  drain() { const a = this.out, b = this.direct; this.out = []; this.direct = []; return { all: a, direct: b }; }
}
