// 도깨비 밤 · 같이 하기 서버
// - Lobby (one object): the list of rooms people can see
// - Room (one object per room code): who is in the room, the island seed, the shared clock; relays movement
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
      for (let i = 0; i < 20; i++) {
        const code = String(1000 + Math.floor(Math.random() * 9000));
        const room = env.ROOM.get(env.ROOM.idFromName(code));
        const r = await room.fetch('https://x/init', { method: 'POST', body: JSON.stringify({ code, name, pwHash: pw ? await sha(pw) : '', seed, day: 1 }) });
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
    // drop rooms nobody has touched for 2 hours
    for (const [c, r] of Object.entries(rooms)) if (now - r.t > 2 * 3600e3) delete rooms[c];
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
    await lobby.fetch('https://x/upsert', { method: 'POST', body: JSON.stringify({ code: m.code, name: m.name, locked: !!m.pwHash, n: this.players(except).length }) });
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/init') {
      if (await this.load()) return new Response('taken', { status: 409 });
      const b = await req.json();
      // the shared clock: day 1 starts now; every client computes day/time from start
      this.meta = { code: b.code, name: b.name, pwHash: b.pwHash, seed: b.seed, startDay: b.day, start: Date.now(), created: Date.now() };
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
    const me = { id: pid, name: NICK_OK.test(nick) ? nick : '도깨비 사냥꾼', look: url.searchParams.get('look') || 'basic', x: 0, z: 2.4, f: 0, s: 0, hp: 100 };
    server.serializeAttachment(me);
    server.send(JSON.stringify({ t: 'welcome', you: me.id, room: { code: m.code, name: m.name, locked: !!m.pwHash }, seed: m.seed, startDay: m.startDay, start: m.start, now: Date.now(), players: this.players().filter((p) => p.id !== me.id) }));
    this.broadcast({ t: 'join', p: me }, server);
    await this.report();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment();
    if (!me) return;
    if (msg.t === 'p') {
      // movement: keep the last state (for late joiners) and pass it on
      Object.assign(me, { x: +msg.x || 0, z: +msg.z || 0, f: +msg.f || 0, s: +msg.s || 0, a: msg.a | 0, hp: msg.hp | 0, w: String(msg.w || '').slice(0, 8), look: String(msg.look || me.look).slice(0, 12) });
      ws.serializeAttachment(me);
      this.broadcast({ t: 'p', id: me.id, x: me.x, z: me.z, f: me.f, s: me.s, a: me.a, hp: me.hp, w: me.w, look: me.look }, ws);
    } else if (msg.t === 'emote' && EMOTES.includes(msg.k)) {
      this.broadcast({ t: 'emote', id: me.id, k: msg.k, x: me.x, z: me.z });
    } else if (msg.t === 'time') {
      ws.send(JSON.stringify({ t: 'time', now: Date.now() }));
    }
  }

  async webSocketClose(ws) {
    const me = ws.deserializeAttachment();
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    if (me) this.broadcast({ t: 'leave', id: me.id }, ws);
    await this.report(ws);
  }

  async webSocketError(ws) { await this.webSocketClose(ws); }
}
