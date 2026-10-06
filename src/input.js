import { DEFAULT_BINDS } from './settings.js';

// Keyboard + mouse input with pointer lock. Game code asks for named actions
// (action('hide')), which map to rebindable key / mouse-button codes.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.binds = { ...DEFAULT_BINDS };
    this.capture = null; // (code) => void while the rebind menu waits for a key

    window.addEventListener('keydown', (e) => {
      if (this.capture) { e.preventDefault(); const c = this.capture; this.capture = null; c(e.code); return; }
      if (['Space', 'F3', 'Tab'].includes(e.code) || (this.locked && this._bound(e.code))) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Some browsers spike on lock; ignore absurd deltas.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    // mouse buttons as codes 'Mouse0' (left) / 'Mouse2' (right) / 'Mouse3','Mouse4' (side)
    document.addEventListener('mousedown', (e) => {
      if (this.capture) {
        e.preventDefault(); e.stopPropagation();
        const c = this.capture; this.capture = null;
        this._eatClick = e.button === 0; // the click that follows must not hit a menu button
        c('Mouse' + e.button);
        return;
      }
      if (!this.locked) return;
      if (e.button > 2) e.preventDefault(); // side buttons would navigate back/forward
      this.pressed.add('Mouse' + e.button);
      this.keys.add('Mouse' + e.button);
    }, true);
    document.addEventListener('mouseup', (e) => {
      if (e.button > 2) e.preventDefault();
      this.keys.delete('Mouse' + e.button);
    });
    document.addEventListener('click', (e) => {
      if (this._eatClick) { this._eatClick = false; e.stopPropagation(); e.preventDefault(); }
    }, true);
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });
  }

  _bound(code) { return Object.values(this.binds).includes(code); }

  requestLock() {
    const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
    // Fall back if raw input isn't supported.
    if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
  }

  down(code) { return this.keys.has(code); }
  justPressed(code) { return this.pressed.has(code); }
  action(name) { return this.keys.has(this.binds[name]); }
  actionPressed(name) { return this.pressed.has(this.binds[name]); }

  consumeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame() { this.pressed.clear(); }
}
