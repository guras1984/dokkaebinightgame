// Keyboard + touch input. Produces a move vector (screen space, y = up) and edge/held actions.
const STICK_RADIUS = 56;
const DEADZONE = 0.12;

// Map by physical key (e.code) so Korean input mode (W → 'ㅈ', or 'Process' while composing) still works.
const CODE_MAP = {
  KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyJ: 'j', KeyK: 'k', KeyP: 'p',
  ArrowUp: 'arrowup', ArrowDown: 'arrowdown', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright',
  KeyC: 'c', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
  Space: ' ', ShiftLeft: 'shift', ShiftRight: 'shift', Escape: 'escape',
};
function keyName(e) {
  return CODE_MAP[e.code] || (e.key || '').toLowerCase();
}

export class Input {
  constructor() {
    this.move = { x: 0, y: 0 };
    this.keys = new Set();
    this.pressed = new Set();
    this.actionHeld = false;
    this.touchActive = false;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };

    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => this.clear());

    this.zone = document.getElementById('stick-zone');
    this.stickEl = document.getElementById('stick');
    this.knob = document.getElementById('stick-knob');
    this.zone.addEventListener('pointerdown', (e) => this.stickDown(e));
    addEventListener('pointermove', (e) => this.stickMove(e));
    addEventListener('pointerup', (e) => this.stickUp(e));
    addEventListener('pointercancel', (e) => this.stickUp(e));

    this.bindButton('btn-action', 'action', true);
    this.bindButton('btn-roll', 'roll', false);
  }

  static isTouchDevice() {
    return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  onKey(e, down) {
    const k = keyName(e);
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (down) {
      if (!e.repeat) {
        if (k === 'j' || k === ' ') this.pressed.add('action');
        if (k === 'k' || k === 'shift') this.pressed.add('roll');
        if (k === 'p' || k === 'escape') this.pressed.add('pause');
        if (k === 'c') this.pressed.add('craft');
        if (['1', '2', '3', '4'].includes(k)) this.pressed.add('slot' + k);
      }
      this.keys.add(k);
    } else {
      this.keys.delete(k);
    }
    this.actionHeld = this.keys.has('j') || this.keys.has(' ') || this.buttonHeld;
  }

  bindButton(id, name, holdable) {
    const el = document.getElementById(id);
    const up = () => {
      el.classList.remove('down');
      if (holdable) { this.buttonHeld = false; this.actionHeld = this.keys.has('j') || this.keys.has(' '); }
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      el.classList.add('down');
      this.pressed.add(name);
      if (holdable) { this.buttonHeld = true; this.actionHeld = true; }
    });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  stickDown(e) {
    if (this.stick.id !== null) return;
    e.preventDefault();
    this.stick.id = e.pointerId;
    this.stick.ox = e.clientX; this.stick.oy = e.clientY;
    this.stick.x = 0; this.stick.y = 0;
    this.stickEl.style.left = e.clientX + 'px';
    this.stickEl.style.top = e.clientY + 'px';
    this.stickEl.hidden = false;
    this.knob.style.transform = '';
  }

  stickMove(e) {
    if (e.pointerId !== this.stick.id) return;
    let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
    this.stick.x = dx / STICK_RADIUS; this.stick.y = dy / STICK_RADIUS;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  stickUp(e) {
    if (e.pointerId !== this.stick.id) return;
    this.stick.id = null; this.stick.x = 0; this.stick.y = 0;
    this.stickEl.hidden = true;
  }

  consume(name) {
    const had = this.pressed.has(name);
    this.pressed.delete(name);
    return had;
  }

  clear() {
    this.keys.clear(); this.pressed.clear();
    this.actionHeld = false; this.buttonHeld = false;
    this.stick.id = null; this.stick.x = 0; this.stick.y = 0;
    if (this.stickEl) this.stickEl.hidden = true;
  }

  update() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y += 1;
    if (k.has('s') || k.has('arrowdown')) y -= 1;
    if (x || y) {
      const l = Math.hypot(x, y); x /= l; y /= l;
    } else if (this.stick.id !== null) {
      x = this.stick.x; y = -this.stick.y;
      const l = Math.hypot(x, y);
      if (l < DEADZONE) { x = 0; y = 0; }
      else {
        // rescale so the deadzone edge maps to 0 and the rim to 1 (analog walk → run)
        const s = Math.min(1, (l - DEADZONE) / (1 - DEADZONE)) / l;
        x *= s; y *= s;
      }
    }
    this.move.x = x; this.move.y = y;
  }
}
