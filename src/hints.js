import { getFlag, setFlag } from './settings.js';

// First-time contextual tips. Each id is shown once ever (remembered in
// localStorage), queued behind other toasts so tower messages are never overwritten.
const KEY = 'rf_tips_seen';

export class Hints {
  constructor({ toast, busy, enabled }) {
    this.toast = toast;     // (text, secs) => void
    this.busy = busy;       // () => bool, true while another toast is showing
    this.enabled = enabled; // () => bool
    this.seen = new Set(getFlag(KEY, []));
    this.queue = [];
    this.gap = 0;
  }

  // text may be a function so key labels are read when the tip actually shows
  show(id, text) {
    if (!this.enabled() || this.seen.has(id) || this.queue.some((q) => q.id === id)) return;
    this.queue.push({ id, text });
  }

  update(dt) {
    this.gap -= dt;
    if (!this.queue.length || this.gap > 0 || this.busy()) return;
    if (!this.enabled()) { this.queue = []; return; }
    const { id, text } = this.queue.shift();
    this.toast(typeof text === 'function' ? text() : text, 5.5);
    this.seen.add(id);
    setFlag(KEY, [...this.seen]);
    this.gap = 8;
  }

  clearQueue() { this.queue = []; }

  reset() {
    this.seen.clear();
    this.queue = [];
    setFlag(KEY, []);
  }
}
