// 도깨비 밤 · 같이 하기 서버
// - Lobby (one object): the list of rooms people can see
// - Room (one object per room code): who is in the room, the island seed, the shared clock; relays movement
import { Sim } from './sim.js';

// Kid-safety: no free chat (only preset quick messages), names come from a preset list on the client,
// passwords are stored hashed.

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const MAX_PLAYERS = 6;
const EMOTES = ['here', 'help', 'thanks', 'go', 'yes', 'no', 'laugh', 'wow'];
const NICK_OK = /^[가-힣 ]{2,12}$/;

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dokkaebi:' + text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const lobby = env.LOBBY.get(env.LOBBY.idFromName('lobby'));

    // list rooms
    if (url.pathname === '/rooms' && req.method === 'GET') return lobby.fetch('https://x/list');

    // create a room → 4-digit code
    if (url.pathname === '/rooms' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const pw = String(body.password || '').replace(/\D/g, '').slice(0, 6);
      const name = String(body.name || '').slice(0, 24);
      const seed = (Math.random() * 1e9) >>> 0;
      const t0 = Math.max(0, Math.min(184, +body.t || 0)); // start later in the day (for testing nights)
      for (let i = 0; i < 20; i++) {
        const code = String(1000 + Math.floor(Math.random() * 9000));
        const room = env.ROOM.get(env.ROOM.idFromName(code));
        const r = await room.fetch('https://x/init', { method: 'POST', body: JSON.stringify({ code, name, pwHash: pw ? await sha(pw) : '', seed, day: 1, t0 }) });
        if (r.ok) {
          await lobby.fetch('https://x/upsert', { method: 'POST', body: JSON.stringify({ code, name, locked: !!pw, n: 0 }) });
          return json({ code });
        }
      }
      return json({ error: 'busy' }, 503);
    }

    // join a room: websocket
    const m = url.pathname.match(/^\/room\/(\d{4})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket only' }, 426);
      const room = env.ROOM.get(env.ROOM.idFromName(m[1]));
      return room.fetch(req);
    }
    if (url.pathname === '/') return json({ ok: true, game: '도깨비 밤', server: 'together v1' });
    return json({ error: 'not found' }, 404);
  },
};

export class Lobby {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const url = new URL(req.url);
    const rooms = (await this.state.storage.get('rooms')) || {};
    const now = Date.now();
    // drop rooms that stopped checking in
    for (const [c, r] of Object.entries(rooms)) if (now - r.t > 3 * 60e3) delete rooms[c];   // a running room checks in every minute; silence = gone
    if (url.pathname === '/list') {
      const list = Object.entries(rooms).map(([code, r]) => ({ code, name: r.name, n: r.n, max: MAX_PLAYERS, locked: r.locked }))
        .filter((r) => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 30);
      return json({ rooms: list });
    }
    if (url.pathname === '/upsert') {
      const b = await req.json();
      rooms[b.code] = { name: b.name, locked: b.locked, n: b.n, t: now };
      await this.state.storage.put('rooms', rooms);
      return json({ ok: true });
    }
    if (url.pathname === '/remove') {
      const b = await req.json();
      delete rooms[b.code];
      await this.state.storage.put('rooms', rooms);
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.meta = null;
    // answer pings without waking the room up
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async load() {
    if (!this.meta) this.meta = await this.state.storage.get('meta');
    return this.meta;
  }

  /** the shared world runs while anyone is in the room */
  async ensureSim() {
    if (!this.sim) {
      const m = await this.load();
      if (!m) return null;
      const saved = await this.state.storage.get('world');
      this.sim = new Sim(m, saved);
      this.saveT = Date.now();
    }
    if (!this.loop) this.loop = setInterval(() => this.tick(), 100);
    return this.sim;
  }

  tick() {
    this.n = (this.n || 0) + 1;
    if (this.n % 20 === 0) this.dropSilent();   // every 2 s
    if (this.n % 600 === 0) this.report();       // every minute: "still alive" to the room list
    const socks = this.state.getWebSockets().filter((ws) => ws.deserializeAttachment());
    if (!socks.length) {
      clearInterval(this.loop); this.loop = null;
      if (this.sim) this.state.storage.put('world', this.sim.save());
      this.sim = null;
      return;
    }
    const players = socks.map((ws) => ws.deserializeAttachment());
    try { this.sim.step(0.1, players); } catch (err) { console.log('sim error', err && err.stack); }
    const { all, direct } = this.sim.drain();
    if (all.length) this.broadcast({ t: 'b', l: all });
    for (const d of direct) {
      const ws = socks.find((w) => { const a = w.deserializeAttachment(); return a && a.id === d.to; });
      if (ws) { try { ws.send(JSON.stringify(d.msg)); } catch { /* gone */ } }
    }
    if (Date.now() - this.saveT > 30000) { this.saveT = Date.now(); this.state.storage.put('world', this.sim.save()); }
  }

  /** a phone that closed the app or lost signal never says goodbye: if we hear nothing (moves or the 25 s ping) for 45 s, it has left */
  dropSilent() {
    const now = Date.now();
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a) continue;
      const ping = this.state.getWebSocketAutoResponseTimestamp(ws);
      const last = Math.max(a.seen || 0, ping ? ping.getTime() : 0);
      if (now - last > 45000) { this.leave(ws, a); continue; }
      // standing still for 7 minutes (asleep, phone left on the table): leave the room, so an empty room can close
      if (now - (a.moved || a.seen || now) > (+this.env.IDLE_MS || 7 * 60000)) {
        try { ws.send(JSON.stringify({ t: 'kicked', why: 'idle' })); } catch { /* gone */ }
        this.leave(ws, a);
      }
    }
  }

  leave(ws, me) {
    ws.serializeAttachment(null);   // no longer counted, even if the socket lingers
    try { ws.close(4000, 'gone'); } catch { /* already closed */ }
    if (me) this.broadcast({ t: 'leave', id: me.id }, ws);
    this.report(ws);
  }

  /** a room nobody has been in for a minute is gone (so together always starts fresh) */
  async alarm() {
    if (this.players().length) return;
    const m = await this.load();
    if (m) await this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby')).fetch('https://x/remove', { method: 'POST', body: JSON.stringify({ code: m.code }) });
    clearInterval(this.loop); this.loop = null; this.sim = null; this.meta = null;
    await this.state.storage.deleteAll();
  }

  players(except) {
    return this.state.getWebSockets().filter((ws) => ws !== except).map((ws) => ws.deserializeAttachment()).filter(Boolean);
  }

  broadcast(msg, except) {
    const text = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) { if (ws !== except) { try { ws.send(text); } catch { /* gone */ } } }
  }

  async report(except) {
    const m = await this.load();
    if (!m) return;
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
    const n = this.players(except).length;
    await lobby.fetch('https://x/upsert', { method: 'POST', body: JSON.stringify({ code: m.code, name: m.name, locked: !!m.pwHash, n }) });
    if (!n) await this.state.storage.setAlarm(Date.now() + (+this.env.EMPTY_MS || 60000));
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/init') {
      if (await this.load()) return new Response('taken', { status: 409 });
      const b = await req.json();
      // the shared clock: day 1 starts now; every client computes day/time from start
      this.meta = { code: b.code, name: b.name, pwHash: b.pwHash, seed: b.seed, startDay: b.day, start: Date.now() - (b.t0 || 0) * 1000, created: Date.now() };
      await this.state.storage.put('meta', this.meta);
      return new Response('ok');
    }
    // websocket join
    const m = await this.load();
    if (!m) return json({ error: 'no room' }, 404);
    const pw = (url.searchParams.get('pw') || '').replace(/\D/g, '');
    if (m.pwHash && (await sha(pw)) !== m.pwHash) return json({ error: 'password' }, 403);
    if (this.players().length >= MAX_PLAYERS) return json({ error: 'full' }, 409);
    const nick = (url.searchParams.get('name') || '').trim();
    const pid = (url.searchParams.get('pid') || '').slice(0, 24) || crypto.randomUUID().slice(0, 8);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    // a colour slot nobody in the room is using, so friends look different
    const used = new Set(this.players().map((q) => q.c));
    let c = 0; while (used.has(c)) c++;
    const me = { c, id: pid, name: NICK_OK.test(nick) ? nick : '도깨비 사냥꾼', look: url.searchParams.get('look') || 'basic', x: 0, z: 2.4, f: 0, s: 0, hp: 100, seen: Date.now(), moved: Date.now() };
    server.serializeAttachment(me);
    const sim = await this.ensureSim();
    server.send(JSON.stringify({ t: 'welcome', you: me.id, c: me.c, room: { code: m.code, name: m.name, locked: !!m.pwHash }, seed: m.seed, startDay: m.startDay, start: m.start, now: Date.now(), players: this.players().filter((p) => p.id !== me.id) }));
    if (sim) server.send(JSON.stringify(sim.welcome()));
    this.broadcast({ t: 'join', p: me }, server);
    await this.report();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment();
    if (!me) return;
    if (!this.loop) await this.ensureSim();   // woke up from sleep: keep the world (and the idle/silence checks) running
    if (msg.t === 'p') {
      // movement: keep the last state (for late joiners) and pass it on
      const nx = +msg.x || 0, nz = +msg.z || 0;
      if (Math.hypot(nx - me.x, nz - me.z) > 0.05 || (msg.a & 1)) me.moved = Date.now();
      Object.assign(me, { x: +msg.x || 0, z: +msg.z || 0, f: +msg.f || 0, s: +msg.s || 0, a: msg.a | 0, hp: msg.hp | 0, w: String(msg.w || '').slice(0, 8), look: String(msg.look || me.look).slice(0, 12), seen: Date.now() });
      ws.serializeAttachment(me);
      this.broadcast({ t: 'p', id: me.id, x: me.x, z: me.z, f: me.f, s: me.s, a: me.a, hp: me.hp, w: me.w, look: me.look }, ws);
    } else if (msg.t === 'emote' && EMOTES.includes(msg.k)) {
      this.broadcast({ t: 'emote', id: me.id, k: msg.k, x: me.x, z: me.z });
    } else if (msg.t === 'revive') {
      // pass "you were revived" to the fallen friend
      const target = this.state.getWebSockets().find((w) => { const a = w.deserializeAttachment(); return a && a.id === msg.id; });
      if (target) target.send(JSON.stringify({ t: 'revived', by: me.name }));
      this.broadcast({ t: 'fx', k: 'revive', id: msg.id, by: me.id });
    } else if (['hit', 'feed', 'firelv', 'build', 'repair', 'upgrade', 'charm'].includes(msg.t)) {
      const sim = await this.ensureSim();
      if (sim) sim.handle(me.id, msg);
    } else if (msg.t === 'time') {
      ws.send(JSON.stringify({ t: 'time', now: Date.now() }));
    }
  }

  async webSocketClose(ws) {
    const me = ws.deserializeAttachment();
    this.leave(ws, me);
  }

  async webSocketError(ws) { await this.webSocketClose(ws); }
}
