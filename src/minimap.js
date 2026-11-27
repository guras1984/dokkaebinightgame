import { rules } from './config.js';
import { INNER, REGIONS } from './world.js';

// Round minimap in the corner + a big map when tapped. Oriented like the screen (the camera looks toward -x,-z).
const RX = 1 / Math.SQRT2, RZ = -1 / Math.SQRT2;   // screen right in world
const UX = -1 / Math.SQRT2, UZ = -1 / Math.SQRT2;  // screen up in world
const GRID = 44;                                    // explored-area grid
const shade = (hex, k) => (Math.round(((hex >> 16) & 255) * k) << 16) | (Math.round(((hex >> 8) & 255) * k) << 8) | Math.round((hex & 255) * k);

export class Minimap {
  constructor() {
    this.small = document.getElementById('minimap');
    this.big = document.getElementById('bigmap');
    this.bigCanvas = document.getElementById('bigmap-canvas');
    this.sctx = this.small.getContext('2d');
    this.bctx = this.bigCanvas.getContext('2d');
    this.explored = new Uint8Array(GRID * GRID);
    this.t = 0;
    this.open = false;
    this.small.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.toggle(true); });
    this.big.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.toggle(false); });
  }

  toggle(on) { this.open = on; this.big.hidden = !on; }
  reset() { this.explored.fill(0); }
  serialize() { return Array.from(this.explored).join(''); }
  restore(str) { if (str && str.length === GRID * GRID) for (let i = 0; i < str.length; i++) this.explored[i] = str.charCodeAt(i) === 49 ? 1 : 0; }

  /** mark what the player has seen */
  explore(px, pz) {
    const R = rules.islandRadius, cell = (2 * R) / GRID, rr = 10;
    for (let gx = Math.floor((px - rr + R) / cell); gx <= Math.floor((px + rr + R) / cell); gx++) {
      for (let gz = Math.floor((pz - rr + R) / cell); gz <= Math.floor((pz + rr + R) / cell); gz++) {
        if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) continue;
        const cx = -R + (gx + 0.5) * cell, cz = -R + (gz + 0.5) * cell;
        if (Math.hypot(cx - px, cz - pz) < rr) this.explored[gz * GRID + gx] = 1;
      }
    }
  }

  update(dt, s) {
    this.t += dt;
    this.explore(s.player.pos.x, s.player.pos.z);
    this.acc = (this.acc || 0) + dt;
    if (this.acc < 0.12) return; // ~8 fps is plenty
    this.acc = 0;
    this.draw(this.sctx, this.small.width, s, s.player.pos, 26, false);
    if (this.open) this.draw(this.bctx, this.bigCanvas.width, s, { x: 0, z: 0 }, rules.islandRadius + 3, true);
  }

  draw(g, size, s, center, range, big) {
    const c = size / 2, k = (size / 2) / range;
    const P = (x, z) => {
      const dx = x - center.x, dz = z - center.z;
      return [c + (dx * RX + dz * RZ) * k, c - (dx * UX + dz * UZ) * k];
    };
    const R = rules.islandRadius, w = s.world;
    g.save();
    g.clearRect(0, 0, size, size);
    g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#2a5f8f'; g.fillRect(0, 0, size, size); // sea
    // island and regions (sampled on a coarse grid: simple and robust)
    const step = big ? 2.2 : 2.6;
    const cell = (2 * R) / GRID;
    for (let x = -R; x <= R; x += step) {
      for (let z = -R; z <= R; z += step) {
        const d = Math.hypot(x, z);
        if (d > R + 1) continue;
        const [sx, sy] = P(x, z);
        if (sx < -8 || sy < -8 || sx > size + 8 || sy > size + 8) continue;
        const id = d < INNER ? 'home' : w.regionAt(x, z);
        const open = REGIONS[id].unlock <= w.day;
        const gx = Math.floor((x + R) / cell), gz = Math.floor((z + R) / cell);
        const seen = this.explored[gz * GRID + gx];
        let hex = open ? REGIONS[id].ground : 0x8e8aa6;
        if (!seen) hex = shade(hex, 0.42); // not visited yet: dark
        g.fillStyle = '#' + hex.toString(16).padStart(6, '0');
        g.fillRect(sx - step * k / 2 - 0.5, sy - step * k / 2 - 0.5, step * k + 1, step * k + 1);
      }
    }
    // night darkening
    if (s.darkness > 0.3) { g.fillStyle = `rgba(8,10,30,${(s.darkness - 0.3) * 0.5})`; g.fillRect(0, 0, size, size); }
    const dot = (x, z, r, color, stroke) => {
      const [sx, sy] = P(x, z);
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fillStyle = color; g.fill();
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
    };
    for (const sp of w.springs) dot(sp.x, sp.z, big ? 3 : 2.5, '#5fb8ff');
    for (const st of s.camp.structs) dot(st.x, st.z, big ? 2.5 : 2, st.zoneR ? '#ffd27a' : '#b07a45');
    for (const ch of s.camp.chests) if (!ch.opened) dot(ch.x, ch.z, big ? 4 : 3, ch.kind === 'night' ? '#7fd3ff' : '#f1c24b', '#3a1d00');
    for (const l of s.village.lairs) {
      if (l.state === 'empty') continue;
      const [sx, sy] = P(l.x, l.z);
      g.fillStyle = l.state === 'sealed' ? '#9a5cff' : '#ffd23a';
      g.font = `900 ${big ? 16 : 13}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(l.state === 'sealed' ? '◆' : '!', sx, sy);
    }
    for (const v of s.village.people) if (v.state !== 'caged') dot(v.pos.x, v.pos.z, big ? 3 : 2.5, '#7be07a');
    // fire
    dot(w.fire.x, w.fire.z, big ? 6 : 4.5, '#ff8a1a', '#ffe27a');
    // monsters: shown when close, always red; the chief big
    for (const m of s.monsters) {
      const far = Math.hypot(m.pos.x - s.player.pos.x, m.pos.z - s.player.pos.z) > 24;
      if (far && !big) continue;
      dot(m.pos.x, m.pos.z, m.type === 'boss' ? 6 : m.type === 'elite' ? 3.5 : 2.5, '#ff3b2a');
    }
    // goal blink
    if (s.goal && Math.sin(this.t * 8) > 0) {
      const [gx2, gy2] = P(s.goal.x, s.goal.z);
      g.beginPath(); g.arc(gx2, gy2, big ? 8 : 6, 0, Math.PI * 2); g.strokeStyle = '#ffd27a'; g.lineWidth = 2; g.stroke();
    }
    // player arrow (facing projected to the screen frame)
    const [px, py] = P(s.player.pos.x, s.player.pos.z);
    const fx = Math.sin(s.player.facing), fz = Math.cos(s.player.facing);
    const ang = Math.atan2(-(fx * UX + fz * UZ), fx * RX + fz * RZ);
    g.translate(px, py); g.rotate(ang);
    g.beginPath(); g.moveTo(big ? 9 : 7, 0); g.lineTo(big ? -6 : -5, big ? 6 : 5); g.lineTo(big ? -3 : -2, 0); g.lineTo(big ? -6 : -5, big ? -6 : -5); g.closePath();
    g.fillStyle = '#ffffff'; g.fill(); g.strokeStyle = '#1a1a2a'; g.lineWidth = 1.5; g.stroke();
    g.restore();
    // ring
    g.beginPath(); g.arc(c, c, c - 1.5, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.stroke();
    if (big) {
      g.fillStyle = '#fff8ea'; g.font = '800 13px sans-serif'; g.textAlign = 'center';
      for (const id of Object.keys(REGIONS)) {
        if (id === 'home') { const [hx, hy] = P(0, -INNER * 0.55); g.fillText(REGIONS[id].name, hx, hy); continue; }
        const sc = w.sector(id);
        const [lx, ly] = P(Math.sin(sc.mid) * 38, Math.cos(sc.mid) * 38);
        const open = REGIONS[id].unlock <= w.day;
        g.fillText(open ? REGIONS[id].name : `${REGIONS[id].name} (${REGIONS[id].unlock}일째)`, lx, ly + 20);
      }
    }
  }
}
