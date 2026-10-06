// Player settings (graphics, HUD toggles, key bindings), saved in localStorage.

export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  sprint: 'ShiftLeft', jump: 'Space', hide: 'KeyC',
  slash: 'Mouse0', lure: 'Mouse2', debug: 'F3',
};

// order + labels for the controls table and the rebind list
export const ACTIONS = [
  ['forward', 'Move forward'], ['back', 'Move back'], ['left', 'Move left'], ['right', 'Move right'],
  ['sprint', 'Sprint (loud)'], ['jump', 'Jump / wall jump'],
  ['hide', 'Hide (hold): stop, light off'], ['slash', 'Claw slash / parry'],
  ['lure', 'Throw a lure'], ['debug', 'Debug overlay'],
];

export const QUALITY = {
  low:    { label: 'Low',    pixelRatio: (dpr) => Math.min(dpr, 1) * 0.75, shadow: 0,    density: 0.45, farMul: 0.85, cullMul: 0.82, grassShadow: false, antialias: false },
  medium: { label: 'Medium', pixelRatio: (dpr) => Math.min(dpr, 1),        shadow: 512,  density: 0.75, farMul: 0.93, cullMul: 0.92, grassShadow: false, antialias: true },
  high:   { label: 'High',   pixelRatio: (dpr) => Math.min(dpr, 1.5),      shadow: 1024, density: 1,    farMul: 1,    cullMul: 1,    grassShadow: true,  antialias: true },
};

const DEFAULTS = { quality: 'high', fps: false, compass: true, soundCues: true, tips: true, map: 'classic', seed: 0 };
const KEY = 'rf_settings';

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* storage blocked */ }
  const s = { ...DEFAULTS, ...saved, binds: { ...DEFAULT_BINDS, ...(saved.binds || {}) } };
  if (!QUALITY[s.quality]) s.quality = DEFAULTS.quality;
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// Small persistent flags (intro seen, tips seen).
export function getFlag(name, fallback = null) {
  try { const v = localStorage.getItem(name); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function setFlag(name, value) {
  try { localStorage.setItem(name, JSON.stringify(value)); } catch { /* ignore */ }
}

const NAMED = {
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt', Space: 'Space', Tab: 'Tab', CapsLock: 'Caps',
  Enter: 'Enter', Backspace: 'Backspace', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};

export function keyLabel(code) {
  if (!code) return '?';
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
