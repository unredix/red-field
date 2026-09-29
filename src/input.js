// Keyboard + mouse input with pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;

    window.addEventListener('keydown', (e) => {
      if (['Space', 'F3', 'Tab'].includes(e.code)) e.preventDefault();
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

    // mouse buttons as codes 'Mouse0' (left) / 'Mouse2' (right)
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.pressed.add('Mouse' + e.button);
      this.keys.add('Mouse' + e.button);
    });
    document.addEventListener('mouseup', (e) => this.keys.delete('Mouse' + e.button));
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });
  }

  requestLock() {
    const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
    // Fall back if raw input isn't supported.
    if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
  }

  down(code) { return this.keys.has(code); }
  justPressed(code) { return this.pressed.has(code); }

  consumeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  endFrame() { this.pressed.clear(); }
}
