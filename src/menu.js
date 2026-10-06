import { ACTIONS, DEFAULT_BINDS, QUALITY, keyLabel, saveSettings } from './settings.js';

// Start / pause screen and the settings panel (graphics, HUD toggles, key bindings).
// Game-side effects go through onChange(key) so this file only touches the DOM.
export class Menu {
  constructor({ settings, input, onChange, onRestart, onIntro, antialiasNow }) {
    this.s = settings;
    this.input = input;
    this.onChange = onChange;
    this.antialiasNow = antialiasNow;
    const $ = (id) => document.getElementById(id);
    this.el = {
      overlay: $('overlay'), main: $('menu-main'), settings: $('menu-settings'),
      title: $('menu-title'), click: $('menu-click'), controls: $('controls'),
      restart: $('btn-restart'), intro: $('btn-intro'), open: $('btn-settings'), back: $('btn-back'),
      quality: $('set-quality'), aaNote: $('aa-note'), binds: $('binds'), bindNote: $('bind-note'),
      resetBinds: $('btn-reset-binds'), resetTips: $('btn-reset-tips'),
    };
    this.settingsOpen = false;
    this.mode = 'start';

    this.el.restart.addEventListener('click', () => onRestart());
    this.el.intro.addEventListener('click', () => onIntro());
    this.el.open.addEventListener('click', () => this.openSettings(true));
    this.el.back.addEventListener('click', () => this.openSettings(false));
    for (const b of this.el.quality.querySelectorAll('button')) {
      b.addEventListener('click', () => { this.s.quality = b.dataset.q; this._save('quality'); });
    }
    for (const key of ['fps', 'compass', 'soundCues', 'tips']) {
      const cb = $('set-' + key);
      cb.checked = !!this.s[key];
      cb.addEventListener('change', () => { this.s[key] = cb.checked; this._save(key); });
    }
    this.el.resetTips.addEventListener('click', () => {
      this.onChange('resetTips');
      this.el.resetTips.textContent = 'Tips reset ✓';
      setTimeout(() => { this.el.resetTips.textContent = 'Reset tips'; }, 1500);
    });
    this.el.resetBinds.addEventListener('click', () => {
      this.s.binds = { ...DEFAULT_BINDS };
      this.el.bindNote.textContent = '';
      this._save('binds');
    });
    this._render();
  }

  _save(key) {
    saveSettings(this.s);
    this.onChange(key);
    this._render();
  }

  setMode(mode, { introSeen = false } = {}) {
    this.mode = mode;
    const pause = mode === 'pause';
    this.el.title.textContent = pause ? 'PAUSED' : 'RED FIELD';
    this.el.click.textContent = pause ? 'Click to resume' : 'Click to start';
    this.el.restart.classList.toggle('hidden', !pause);
    this.el.intro.classList.toggle('hidden', pause || !introSeen);
  }

  openSettings(open) {
    this.settingsOpen = open;
    if (!open) this.input.capture = null;
    this.el.main.classList.toggle('hidden', open);
    this.el.settings.classList.toggle('hidden', !open);
    this._render();
  }

  _render() {
    const s = this.s;
    for (const b of this.el.quality.querySelectorAll('button')) b.classList.toggle('on', b.dataset.q === s.quality);
    this.el.aaNote.textContent = QUALITY[s.quality].antialias !== this.antialiasNow
      ? 'Antialiasing changes after you reload the page.' : '';

    // controls table on the start/pause screen
    const k = (a) => keyLabel(s.binds[a]);
    this.el.controls.innerHTML = [
      [`${k('forward')} ${k('left')} ${k('back')} ${k('right')}`, 'Move'],
      [k('sprint'), 'Sprint (loud)'],
      [k('jump'), 'Jump / wall jump'],
      [`Hold ${k('hide')}`, 'Hide: you stop and your flashlight goes dark. Best in tall grass'],
      [k('slash'), 'Claw slash: stuns up close. Parry its lunge'],
      [k('lure'), 'Throw a lure. It chases the light'],
      ['Esc', 'Pause'],
    ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');

    // rebind list
    this.el.binds.innerHTML = '';
    for (const [action, label] of ACTIONS) {
      const tr = document.createElement('tr');
      const btn = document.createElement('button');
      btn.className = 'key';
      btn.textContent = keyLabel(s.binds[action]);
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._rebind(action, btn); });
      tr.innerHTML = `<td>${label}</td>`;
      const td = document.createElement('td');
      td.appendChild(btn);
      tr.appendChild(td);
      this.el.binds.appendChild(tr);
    }
  }

  _rebind(action, btn) {
    btn.textContent = 'Press a key…';
    btn.classList.add('wait');
    this.el.bindNote.textContent = 'Esc cancels.';
    this.input.capture = (code) => {
      if (code === 'Escape') { this.el.bindNote.textContent = ''; this._render(); return; }
      const binds = this.s.binds;
      const other = Object.keys(binds).find((a) => a !== action && binds[a] === code);
      if (other) binds[other] = binds[action]; // swap with whoever had it
      binds[action] = code;
      this.el.bindNote.textContent =
        code.startsWith('Control') ? 'Careful: Ctrl + W / S / T are browser shortcuts (close tab, save, new tab).'
        : other ? `Swapped with "${ACTIONS.find((x) => x[0] === other)[1]}".` : '';
      this._save('binds');
    };
  }
}
