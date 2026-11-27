// All sounds are synthesized with Web Audio (no audio files): small, original, and easy to tweak.
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('dokkaebi.muted') === '1'; } catch { /* private mode */ }

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

/** call from a tap/click so iOS lets audio play */
export function unlock() {
  const c = ensure();
  if (c && c.state !== 'running') c.resume();
  ambience.start();
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('dokkaebi.muted', m ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
}

// ---------- building blocks ----------
function env(g, t, a, peak, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
}

function tone({ type = 'sine', f = 440, f2 = null, t = 0, a = 0.005, dur = 0.2, vol = 0.3, out = master }) {
  const c = ctx, now = c.currentTime + t;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, now);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + a + dur);
  env(g, now, a, vol, dur);
  o.connect(g); g.connect(out);
  o.start(now); o.stop(now + a + dur + 0.05);
}

function noise({ t = 0, a = 0.003, dur = 0.15, vol = 0.3, type = 'bandpass', f = 1000, f2 = null, q = 1, out = master }) {
  const c = ctx, now = c.currentTime + t;
  const s = c.createBufferSource(); s.buffer = noiseBuf;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f, now);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, now + a + dur);
  const g = c.createGain();
  env(g, now, a, vol, dur);
  s.connect(fl); fl.connect(g); g.connect(out);
  s.start(now, Math.random()); s.stop(now + a + dur + 0.05);
}

const r = (a, b) => a + Math.random() * (b - a);

// ---------- the sound list ----------
const SFX = {
  swing: () => noise({ type: 'bandpass', f: 600, f2: 2400, q: 1.2, a: 0.04, dur: 0.14, vol: 0.18 }),
  roll: () => noise({ type: 'lowpass', f: 900, f2: 300, a: 0.03, dur: 0.25, vol: 0.2 }),
  chop: () => {
    tone({ type: 'triangle', f: r(150, 180), f2: 70, dur: 0.12, vol: 0.5 });
    noise({ type: 'bandpass', f: r(900, 1200), q: 2, dur: 0.08, vol: 0.45 });
  },
  treeFall: () => {
    noise({ type: 'lowpass', f: 1800, f2: 200, a: 0.02, dur: 0.6, vol: 0.4 });
    tone({ type: 'sine', f: 90, f2: 40, t: 0.45, dur: 0.35, vol: 0.7 });
    noise({ type: 'lowpass', f: 400, t: 0.45, dur: 0.3, vol: 0.5 });
  },
  rock: () => {
    noise({ type: 'highpass', f: 2500, q: 0.7, dur: 0.06, vol: 0.5 });
    tone({ type: 'square', f: r(700, 900), f2: 400, dur: 0.05, vol: 0.12 });
  },
  rockBreak: () => {
    noise({ type: 'bandpass', f: 1500, f2: 300, q: 0.8, dur: 0.4, vol: 0.55 });
    tone({ type: 'sine', f: 120, f2: 50, dur: 0.25, vol: 0.5 });
  },
  pickup: (i = 0) => tone({ type: 'triangle', f: 660 * Math.pow(1.122, i), f2: 990 * Math.pow(1.122, i), a: 0.005, dur: 0.12, vol: 0.22 }),
  bead: () => { [0, 4, 7, 12].forEach((s, i) => tone({ type: 'sine', f: 880 * Math.pow(2, s / 12), t: i * 0.05, dur: 0.25, vol: 0.13 })); },
  hitMonster: () => {
    tone({ type: 'sine', f: 140, f2: 60, dur: 0.15, vol: 0.7 });
    noise({ type: 'bandpass', f: 2000, q: 1, dur: 0.05, vol: 0.5 });
  },
  kill: () => {
    tone({ type: 'square', f: 520, f2: 90, a: 0.005, dur: 0.3, vol: 0.12 });
    [0, 5, 9].forEach((s, i) => tone({ type: 'sine', f: 600 * Math.pow(2, s / 12), t: 0.08 + i * 0.06, dur: 0.3, vol: 0.12 }));
  },
  hurt: () => {
    tone({ type: 'sawtooth', f: 220, f2: 70, dur: 0.25, vol: 0.25 });
    tone({ type: 'sine', f: 80, f2: 40, dur: 0.3, vol: 0.7 });
  },
  windup: () => tone({ type: 'sawtooth', f: 90, f2: 160, a: 0.2, dur: 0.25, vol: 0.06 }),
  stomp: () => { tone({ type: 'sine', f: 70, f2: 30, dur: 0.5, vol: 0.9 }); noise({ type: 'lowpass', f: 500, dur: 0.4, vol: 0.5 }); },
  wispCharge: () => tone({ type: 'sine', f: 400, f2: 1600, a: 0.02, dur: 0.4, vol: 0.12 }),
  wispDash: () => noise({ type: 'bandpass', f: 3000, f2: 800, q: 3, dur: 0.3, vol: 0.25 }),
  feed: () => {
    noise({ type: 'lowpass', f: 400, f2: 2500, a: 0.05, dur: 0.35, vol: 0.35 });
    for (let i = 0; i < 5; i++) noise({ type: 'highpass', f: 3000, t: 0.1 + Math.random() * 0.4, dur: 0.02, vol: 0.3 });
  },
  chest: () => {
    tone({ type: 'sawtooth', f: 180, f2: 260, a: 0.05, dur: 0.25, vol: 0.06 });
    [0, 4, 7, 11, 14].forEach((s, i) => tone({ type: 'triangle', f: 523 * Math.pow(2, s / 12), t: 0.22 + i * 0.07, dur: 0.4, vol: 0.14 }));
  },
  drink: () => { for (let i = 0; i < 4; i++) tone({ type: 'sine', f: r(300, 500), f2: r(700, 1000), t: i * 0.11, a: 0.01, dur: 0.07, vol: 0.2 }); },
  eat: () => { for (let i = 0; i < 3; i++) noise({ type: 'bandpass', f: r(1500, 2500), q: 2, t: i * 0.12, dur: 0.05, vol: 0.35 }); },
  cook: () => noise({ type: 'highpass', f: 4000, a: 0.05, dur: 0.6, vol: 0.18 }),
  build: () => { [0, 0.13].forEach((t) => { tone({ type: 'triangle', f: 200, f2: 120, t, dur: 0.08, vol: 0.5 }); noise({ type: 'bandpass', f: 1200, q: 2, t, dur: 0.05, vol: 0.3 }); }); },
  craft: () => { [0, 7, 12].forEach((s, i) => tone({ type: 'triangle', f: 440 * Math.pow(2, s / 12), t: i * 0.08, dur: 0.25, vol: 0.15 })); },
  charm: () => {
    noise({ type: 'bandpass', f: 300, f2: 4000, q: 0.8, a: 0.02, dur: 0.5, vol: 0.4 });
    [0, 7, 12, 19].forEach((s, i) => tone({ type: 'sine', f: 330 * Math.pow(2, s / 12), t: i * 0.03, dur: 0.8, vol: 0.12 }));
  },
  heal: () => { [0, 4, 7].forEach((s, i) => tone({ type: 'sine', f: 523 * Math.pow(2, s / 12), t: i * 0.09, dur: 0.35, vol: 0.12 })); },
  // big drum (buk) for raids
  drum: (t = 0, v = 1) => {
    tone({ type: 'sine', f: 110, f2: 45, t, a: 0.003, dur: 0.45, vol: 0.9 * v });
    noise({ type: 'lowpass', f: 600, t, dur: 0.12, vol: 0.5 * v });
  },
  raid: () => { [0, 0.28, 0.56, 0.95, 1.12, 1.3, 1.7].forEach((t, i) => SFX.drum(t, i % 3 === 2 ? 1 : 0.7)); },
  heartbeat: () => { tone({ type: 'sine', f: 60, f2: 40, dur: 0.12, vol: 0.8 }); tone({ type: 'sine', f: 55, f2: 38, t: 0.18, dur: 0.14, vol: 0.6 }); },
  // low gong when night falls
  gong: () => { [1, 2.76, 5.4].forEach((m, i) => tone({ type: 'sine', f: 98 * m, a: 0.01, dur: 2.5 - i * 0.6, vol: 0.25 / (i + 1) })); },
  // bright rising chime at dawn
  dawn: () => { [0, 2, 4, 7, 9, 12].forEach((s, i) => tone({ type: 'triangle', f: 392 * Math.pow(2, s / 12), t: i * 0.1, dur: 0.6, vol: 0.13 })); },
  fireOut: () => noise({ type: 'lowpass', f: 2000, f2: 200, a: 0.05, dur: 0.8, vol: 0.35 }),
  deny: () => tone({ type: 'square', f: 180, f2: 140, dur: 0.1, vol: 0.08 }),
  // dokkaebi cackle: a few "heh" syllables, a vowel formant over a buzzy voice
  laugh: (t0 = 0, pitch = 1) => {
    const n = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.13, f = (260 - i * 18) * pitch;
      tone({ type: 'sawtooth', f, f2: f * 0.8, t, a: 0.01, dur: 0.09, vol: 0.05 });
      noise({ type: 'bandpass', f: 1100 * pitch, q: 4, t, a: 0.01, dur: 0.08, vol: 0.12 });
    }
  },
  // breathy whisper from somewhere in the dark
  whisper: () => {
    for (let i = 0; i < 3; i++) noise({ type: 'bandpass', f: r(1800, 3200), q: 6, t: i * r(0.15, 0.3), a: 0.08, dur: r(0.2, 0.4), vol: 0.07 });
  },
  // low dissonant swell for the night-start card
  dread: () => {
    tone({ type: 'sawtooth', f: 55, f2: 52, a: 0.4, dur: 2.6, vol: 0.12 });
    tone({ type: 'sawtooth', f: 58.3, f2: 55, a: 0.4, dur: 2.6, vol: 0.1 });
    tone({ type: 'sine', f: 880, f2: 840, t: 0.3, a: 0.8, dur: 1.8, vol: 0.03 });
    noise({ type: 'lowpass', f: 200, f2: 900, a: 0.6, dur: 2, vol: 0.25 });
  },
  lose: () => { [0, -3, -7, -12].forEach((s, i) => tone({ type: 'triangle', f: 330 * Math.pow(2, s / 12), t: i * 0.22, dur: 0.5, vol: 0.15 })); },
};

/** play a named sound effect */
export function sfx(name, ...args) {
  if (!ctx || muted || ctx.state !== 'running') return;
  const f = SFX[name];
  if (f) f(...args);
}

// ---------- ambience: wind + crickets at night, birds by day, fire crackle near the fire ----------
export const ambience = {
  started: false,
  start() {
    if (this.started || !ensure()) return;
    this.started = true;
    const c = ctx;
    const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 350;
    this.wind = c.createGain(); this.wind.gain.value = 0;
    s.connect(fl); fl.connect(this.wind); this.wind.connect(master);
    s.start();
    this.windFilter = fl;
    this.timer = { cricket: 0, bird: 2, crackle: 0, heart: 0 };
  },
  update(dt, { darkness, fireNear, lowHp, playing, time }) {
    if (!this.started || !ctx || muted || ctx.state !== 'running') return;
    const t = this.timer;
    const wantWind = playing ? 0.03 + darkness * 0.09 : 0.02;
    this.wind.gain.setTargetAtTime(wantWind, ctx.currentTime, 0.5);
    this.windFilter.frequency.setTargetAtTime(300 + Math.sin(time * 0.3) * 120, ctx.currentTime, 0.5);
    if (!playing) return;
    if (darkness > 0.6 && (t.cricket -= dt) <= 0) {
      t.cricket = r(0.6, 1.8);
      const f = r(4200, 5200);
      for (let i = 0; i < 3; i++) tone({ type: 'sine', f, t: i * 0.06, a: 0.005, dur: 0.03, vol: 0.025 });
    }
    if (darkness < 0.3 && (t.bird -= dt) <= 0) {
      t.bird = r(3, 7);
      const f = r(1800, 2600);
      tone({ type: 'sine', f, f2: f * 1.4, a: 0.01, dur: 0.08, vol: 0.04 });
      tone({ type: 'sine', f: f * 1.2, f2: f * 0.9, t: 0.12, a: 0.01, dur: 0.1, vol: 0.035 });
    }
    if (fireNear > 0 && (t.crackle -= dt) <= 0) {
      t.crackle = r(0.05, 0.35);
      noise({ type: 'highpass', f: r(2500, 5000), dur: 0.015, vol: 0.12 * fireNear });
    }
    if (lowHp > 0 && (t.heart -= dt) <= 0) {
      t.heart = 0.9 - lowHp * 0.35;
      SFX.heartbeat();
    }
  },
};

/** for automated checks */
export const audioState = () => (ctx ? ctx.state : 'none');

// ---------- background music (generated, no files) ----------
// day: calm pentatonic plucks (가야금 느낌) / night: low drone + sparse eerie notes / battle: 장구 장단 + fast ostinato
const SCALES = {
  day: [261.6, 293.7, 349.2, 392.0, 440.0, 523.3, 587.3],   // 평조 느낌 (C D F G A)
  night: [164.8, 196.0, 220.0, 246.9, 293.7, 329.6, 392.0], // 계면조 느낌 (E G A B D)
  battle: [220.0, 261.6, 293.7, 329.6, 392.0, 440.0],
};
const TEMPO = { day: 84, night: 58, battle: 118 };

function pluck(f, t, vol, out) {
  const c = ctx, now = c.currentTime + t;
  const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
  o.type = 'triangle'; o2.type = 'sine';
  o.frequency.setValueAtTime(f * 1.03, now); o.frequency.exponentialRampToValueAtTime(f, now + 0.06); // the little string bend
  o2.frequency.setValueAtTime(f * 2, now);
  const g2 = c.createGain(); g2.gain.value = 0.25;
  env(g, now, 0.004, vol, 1.1);
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(out);
  o.start(now); o2.start(now); o.stop(now + 1.3); o2.stop(now + 1.3);
}

export const music = {
  mood: 'off', bus: null, beat: 0, next: 0, step: 0, drone: null, note: 3,
  setMood(m) { this.mood = m; },
  update() {
    if (!ctx || ctx.state !== 'running') return;
    if (!this.bus) {
      this.bus = ctx.createGain(); this.bus.gain.value = 0; this.bus.connect(master);
      // night drone: two detuned low saws through a slow filter
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
      [55, 55.6].forEach((hz) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.connect(f); o.start(); });
      f.connect(this.droneGain); this.droneGain.connect(this.bus);
      this.next = ctx.currentTime + 0.1;
    }
    const mood = muted ? 'off' : this.mood;
    this.bus.gain.setTargetAtTime(mood === 'off' ? 0 : 0.32, ctx.currentTime, 0.8);
    this.droneGain.gain.setTargetAtTime(mood === 'night' ? 0.09 : mood === 'battle' ? 0.05 : 0, ctx.currentTime, 1.2);
    if (mood === 'off') return;
    const spb = 60 / TEMPO[mood] / 2; // eighth notes
    while (this.next < ctx.currentTime + 0.25) {
      const t = this.next - ctx.currentTime;
      this.playStep(mood, Math.max(0, t));
      this.next += spb;
      this.step++;
    }
  },
  playStep(mood, t) {
    const sc = SCALES[mood];
    const s = this.step;
    const walk = () => { this.note = Math.max(0, Math.min(sc.length - 1, this.note + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)])); return sc[this.note]; };
    if (mood === 'day') {
      if (s % 2 === 0 && Math.random() < 0.7) pluck(walk(), t, 0.16, this.bus);
      if (s % 16 === 0) pluck(sc[0] / 2, t, 0.14, this.bus);                  // low root every bar
      if (s % 16 === 8) pluck(sc[3] / 2, t, 0.1, this.bus);
    } else if (mood === 'night') {
      if (s % 4 === 0 && Math.random() < 0.45) pluck(walk() / 2, t, 0.12, this.bus);
      if (s % 32 === 16 && Math.random() < 0.6) pluck(sc[0] * 1.414, t, 0.06, this.bus); // a sour tritone now and then
    } else {
      // 장구: 덩(low+slap) 쿵(low) 덕(slap) in a driving 12/8-ish pattern
      const pat = 'D.kdD.k.D.kd';
      const ch = pat[s % pat.length];
      if (ch === 'D') { tone({ type: 'sine', f: 95, f2: 50, t, dur: 0.22, vol: 0.5, out: this.bus }); noise({ type: 'bandpass', f: 1800, q: 1.2, t, dur: 0.05, vol: 0.3, out: this.bus }); }
      if (ch === 'k') tone({ type: 'sine', f: 120, f2: 70, t, dur: 0.15, vol: 0.35, out: this.bus });
      if (ch === 'd') noise({ type: 'bandpass', f: 2600, q: 2, t, dur: 0.04, vol: 0.3, out: this.bus });
      if (s % 2 === 0) pluck(sc[[0, 2, 1, 3, 0, 4, 3, 2][(s / 2) % 8]], t, 0.12, this.bus);
    }
  },
};
