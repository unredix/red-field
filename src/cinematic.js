// Tiny shot sequencer for scripted camera moments (intro, victory).
// A shot: { dur, caption?: [line, style?], start?(), update?(k 0..1, t, dt), end?() }

export class Cinematic {
  constructor(captionEl) {
    this.captionEl = captionEl;
    this.shots = null;
  }

  get playing() { return !!this.shots; }

  play(shots, onEnd) {
    this.shots = shots;
    this.onEnd = onEnd;
    this.i = -1;
    this._next();
  }

  _next() {
    this.i++;
    this.t = 0;
    const s = this.shots[this.i];
    if (!s) { this._finish(); return; }
    s.start?.();
    this._caption(s.caption);
  }

  _caption(c) {
    const el = this.captionEl;
    if (!el) return;
    el.classList.remove('show', 'title');
    if (!c) return;
    el.textContent = c[0];
    if (c[1]) el.classList.add(c[1]);
    void el.offsetWidth; // restart the CSS fade
    el.classList.add('show');
  }

  _finish() {
    const done = this.onEnd;
    this.shots = null;
    this._caption(null);
    done?.();
  }

  skip() {
    if (!this.shots) return;
    this.shots[this.i]?.end?.();
    this._finish();
  }

  update(dt) {
    if (!this.shots) return;
    const s = this.shots[this.i];
    this.t += dt;
    s.update?.(Math.min(this.t / s.dur, 1), this.t, dt);
    if (this.t >= s.dur) { s.end?.(); this._next(); }
  }
}
