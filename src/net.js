// 같이 하기: talking to the room server (Cloudflare). Pure networking, no rendering.
const params = new URLSearchParams(location.search);
// production server (Cloudflare workers.dev); on this Mac during development, the local copy
export const SERVER = params.get('server')
  || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://127.0.0.1:8787' : 'https://dokkaebi-night.kjshin842.workers.dev');

const ADJ = ['용감한', '날쌘', '씩씩한', '슬기로운', '튼튼한', '반짝이는', '신나는', '든든한', '재빠른', '꿋꿋한'];
const NOUN = ['나무꾼', '호랑이', '까치', '토끼', '곰', '여우', '해태', '거북이', '수달', '부엉이'];
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };

/** names come from a preset list (no typing → no personal info, no bad words) */
export function randomNick() { return `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`; }
export function myNick() { let n = store.get('dokkaebi.nick'); if (!n) { n = randomNick(); store.set('dokkaebi.nick', n); } return n; }
export function setNick(n) { store.set('dokkaebi.nick', n); }
export function myPid() { let p = store.get('dokkaebi.pid'); if (!p) { p = Math.random().toString(36).slice(2, 10); store.set('dokkaebi.pid', p); } return p; }

export const EMOTES = [
  { k: 'here', icon: '📍', text: '여기로 와!' },
  { k: 'help', icon: '🆘', text: '도와줘!' },
  { k: 'thanks', icon: '🙏', text: '고마워!' },
  { k: 'go', icon: '👉', text: '가자!' },
  { k: 'yes', icon: '👍', text: '좋아!' },
  { k: 'no', icon: '✋', text: '안 돼!' },
  { k: 'laugh', icon: '😆', text: 'ㅋㅋㅋ' },
  { k: 'wow', icon: '😮', text: '우와!' },
];

export async function listRooms() {
  const r = await fetch(`${SERVER}/rooms`);
  return (await r.json()).rooms || [];
}
export async function createRoom(name, password) {
  const r = await fetch(`${SERVER}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) });
  if (!r.ok) throw new Error('방을 만들지 못했어요');
  return (await r.json()).code;
}

/** one live connection to a room */
export class Net {
  constructor() { this.ws = null; this.handlers = {}; this.offset = 0; this.closedByMe = false; }
  on(type, fn) { this.handlers[type] = fn; return this; }
  emit(type, msg) { const h = this.handlers[type]; if (h) h(msg); }

  /** resolves with the welcome message, rejects with a friendly reason */
  join(code, password, look) {
    this.code = code; this.password = password; this.look = look;
    return new Promise((resolve, reject) => {
      const u = new URL(`${SERVER.replace(/^http/, 'ws')}/room/${code}`);
      u.searchParams.set('pw', password || '');
      u.searchParams.set('name', myNick());
      u.searchParams.set('pid', myPid());
      u.searchParams.set('look', look || 'basic');
      let opened = false;
      const ws = new WebSocket(u);
      this.ws = ws;
      this.closedByMe = false;
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'welcome') {
          opened = true;
          this.offset = msg.now - Date.now();
          this.you = msg.you;
          resolve(msg);
        }
        this.emit(msg.t, msg);
      };
      ws.onclose = () => {
        if (!opened) { reject(new Error('들어갈 수 없어요 (방 번호·비밀번호를 확인하거나, 방이 가득 찼어요)')); return; }
        if (!this.closedByMe) this.emit('lost', {});
      };
      ws.onerror = () => {};
      this.ping = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 25000);
    });
  }

  /** server clock in ms */
  now() { return Date.now() + this.offset; }
  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  leave() { this.closedByMe = true; clearInterval(this.ping); try { this.ws.close(1000, 'leave'); } catch { /* ignore */ } this.ws = null; }
  get open() { return this.ws && this.ws.readyState === 1; }
}
