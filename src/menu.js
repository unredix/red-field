import { ACTIONS, DEFAULT_BINDS, QUALITY, keyLabel, saveSettings } from './settings.js';

// Start / pause screen and the settings panel (graphics, HUD toggles, key bindings).
// Game-side effects go through onChange(key) so this file only touches the DOM.
export class Menu {
  constructor({ settings, input, onChange, onRestart, onIntro, antialiasNow, map, seed, onMap, newSeed }) {
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
      tutorialPanel: $('menu-tutorial'), tutorial: $('tutorial'),
    };
    this.page = 'main'; // 'main' | 'settings' | 'tutorial'
    this.mode = 'start';

    // map choice: switching map or seed reloads the page with the new level
    this.map = map;
    this.seed = seed;
    for (const b of $('set-map').querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.map === map);
      b.addEventListener('click', () => {
        if (b.dataset.map === this.map) return;
        onMap(b.dataset.map, b.dataset.map === 'random' ? newSeed() : 0);
      });
    }
    $('seed-row').classList.toggle('hidden', map !== 'random');
    $('seed-label').textContent = `Seed ${seed}`;
    $('btn-new-seed').addEventListener('click', () => onMap('random', newSeed()));
    $('btn-copy-seed').addEventListener('click', () => {
      const url = `${location.origin}${location.pathname}?map=random&seed=${seed}`;
      navigator.clipboard?.writeText(url).then(() => { $('btn-copy-seed').textContent = 'Copied ✓'; }, () => { $('btn-copy-seed').textContent = url; });
    });
    this.el.mapNote = $('map-note');

    this.el.restart.addEventListener('click', () => onRestart());
    this.el.intro.addEventListener('click', () => onIntro());
    this.el.open.addEventListener('click', () => this.openPage('settings'));
    this.el.back.addEventListener('click', () => this.openPage('main'));
    $('btn-tutorial').addEventListener('click', () => this.openPage('tutorial'));
    $('btn-tutorial-back').addEventListener('click', () => this.openPage('main'));
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
    this.el.mapNote.textContent = pause ? 'Changing the map restarts the run.' : '';
    this.el.intro.classList.toggle('hidden', pause || !introSeen);
  }

  // true while a sub-page (settings, tutorial) is showing: clicks don't start the game
  get settingsOpen() { return this.page !== 'main'; }

  openSettings(open) { this.openPage(open ? 'settings' : 'main'); }

  openPage(page) {
    this.page = page;
    if (page !== 'settings') this.input.capture = null;
    this.el.main.classList.toggle('hidden', page !== 'main');
    this.el.settings.classList.toggle('hidden', page !== 'settings');
    this.el.tutorialPanel.classList.toggle('hidden', page !== 'tutorial');
    this.el.tutorialPanel.scrollTop = 0;
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
      [k('jump'), 'Jump / wall jump (uses stamina)'],
      [`Hold ${k('hide')}`, 'Hide: you stop and your flashlight goes dark. Best in tall grass'],
      [k('slash'), 'Claw slash: stuns up close. Parry its lunge'],
      [k('lure'), 'Throw a lure. It chases the light'],
      ['Esc', 'Pause'],
    ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');

    // how-to-play page (uses the current key bindings)
    const kb = (a) => `<kbd>${k(a)}</kbd>`;
    this.el.tutorial.innerHTML = [
      ['The goal', [
        'Wake the <b>three towers</b>. When the last one wakes, they sing the beast to death.',
        'Their red crowns are visible from anywhere. The compass at the top points to the ones still asleep.',
      ]],
      ['The beast', [
        '<b>One bite kills.</b> It hunts by sight, sound and smell, and it gets faster the longer a run lasts.',
        'Your flashlight is on whenever you move, and it sees the light from far away. Sprinting is loud.',
      ]],
      ['Hiding', [
        `Hold ${kb('hide')} to crouch: you freeze and your light goes dark.`,
        'In <b>tall grass</b> it only notices you up close. Rocks, walls, hedges, ridges and ravines break its line of sight.',
        "Nowhere is safe for long: it can squeeze, slowly, through gaps it doesn't normally fit.",
      ]],
      ['Scent', [
        'When it loses you, it starts <b>sniffing</b> and follows your trail.',
        'Wade through a <b>blood pool</b> to wash the trail away and mask your scent for a few seconds.',
      ]],
      ['The claw', [
        `${kb('slash')} slashes and stuns it up close. ${kb('lure')} throws a glowing lure that it chases instead of you.`,
        'Both use claw charges. The veins on your arm show them (2 max, about 25 s each to refill) and pulse faster when it is near.',
      ]],
      ['Its lunge and charge', [
        'Before it bites, its eyes flare and a cymbal crashes. <b>Sidestep or back off.</b>',
        'Or <b>parry</b>: slash the moment its eyes flash white. It gets knocked back and stunned for longer.',
        'In a chase it sometimes crouches and <b>drums</b>, then charges. It turns badly: sidestep, or put a wall between you. Afterwards it is winded for a moment.',
      ]],
      ['Waking a tower', [
        '1. Stand in the glowing rune circle to charge it to 50%. The hum is loud, so it will come.',
        '2. The tower plays a tune on its standing stones. Strike them in the same order (a wrong note is very loud).',
        '3. Charge it the rest of the way.',
      ]],
      ['Stamina', [
        `${kb('sprint')} sprints and ${kb('jump')} jumps (also off walls). Both use stamina.`,
        "Run it empty and you can't sprint until you catch your breath. It refills when you stop.",
      ]],
    ].map(([h, ps], i) => `<section><h3><span>${i + 1}</span>${h}</h3>${ps.map((t) => `<p>${t}</p>`).join('')}</section>`).join('');

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
