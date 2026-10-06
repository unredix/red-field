import * as THREE from 'three';
import { Input } from './input.js';
import { World } from './world.js';
import { buildRedField } from './maps/redfield.js';
import { buildTestLevel } from './maps/testlevel.js';
import { buildGenerated } from './maps/generated.js';
import { Player } from './player.js';
import { Flashlight } from './flashlight.js';
import { Monster } from './monster.js';
import { Arm, Lure, LurePool } from './arm.js';
import { Sparks } from './fx.js';
import { Sfx } from './audio.js';
import { Towers } from './towers.js';
import { Cinematic } from './cinematic.js';
import { Gore } from './gore.js';
import { loadSettings, saveSettings, QUALITY, keyLabel, getFlag, setFlag } from './settings.js';
import { Menu } from './menu.js';
import { Hints } from './hints.js';

// ---------------------------------------------------------------- map choice
// ?map=classic|random|test&seed=N overrides the saved choice (so seeds can be shared)
const settings = loadSettings();
const params = new URLSearchParams(location.search);
const newSeed = () => 1 + Math.floor(Math.random() * 999999);
let MAP = params.get('map');
if (MAP === 'redfield' || MAP === 'gen') MAP = MAP === 'gen' ? 'random' : 'classic';
if (!['classic', 'random', 'test'].includes(MAP)) MAP = settings.map === 'random' ? 'random' : 'classic';
const SEED = MAP === 'random' ? (parseInt(params.get('seed'), 10) || settings.seed || newSeed()) : 0;
if (MAP !== 'test' && (settings.map !== MAP || (MAP === 'random' && settings.seed !== SEED))) {
  settings.map = MAP;
  if (MAP === 'random') settings.seed = SEED;
  saveSettings(settings);
}
function goToMap(map, seed) {
  settings.map = map;
  if (map === 'random') settings.seed = seed;
  saveSettings(settings);
  location.href = `${location.pathname}?map=${map}${map === 'random' ? `&seed=${seed}` : ''}`;
}

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('game');
const ANTIALIAS = QUALITY[settings.quality].antialias; // fixed for the life of the WebGL context
const renderer = new THREE.WebGLRenderer({ canvas, antialias: ANTIALIAS, powerPreference: 'high-performance' });
renderer.setPixelRatio(QUALITY[settings.quality].pixelRatio(window.devicePixelRatio)); // 2x on HiDPI costs 4x the pixels
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = false; // world pass + arm pass

const scene = new THREE.Scene();
// Short far plane: fog hides everything past ~70 m; sky/castle are a camera-attached backdrop.
const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.05, MAP === 'test' ? 200 : 100);
scene.add(camera);

const world = new World(scene);
let level;
if (MAP === 'test') {
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.038);
  scene.add(new THREE.HemisphereLight(0x1c2230, 0x050403, 0.06));
  level = buildTestLevel(scene, world);
} else if (MAP === 'random') {
  level = buildGenerated(scene, world, SEED);
  if (!level.valid) { // the monster couldn't reach everything: try the next seed (a few times)
    const tries = parseInt(params.get('try'), 10) || 0;
    if (tries < 5) location.replace(`${location.pathname}?map=random&seed=${SEED + 1}&try=${tries + 1}`);
    else console.warn(`Seed ${SEED}: some areas may be unreachable for the monster`);
  }
} else {
  level = buildRedField(scene, world);
}

// ---------------------------------------------------------------- game objects
const input = new Input(canvas);
input.binds = settings.binds;
const player = new Player(camera, world, input, level.spawn, level.spawnYaw);
player.allowRespawnKey = !!level.allowRespawnKey;
const flashlight = new Flashlight(scene);
const monster = level.monsterSpawn ? new Monster(scene, world, level.monsterSpawn) : null;
const arm = new Arm(window.innerWidth / window.innerHeight);
const sfx = new Sfx();
const towers = level.towerSites ? new Towers(scene, world, level.towerSites, sfx) : null;
const lurePool = new LurePool(scene); // fixed lights: throwing never recompiles shaders
const sparks = new Sparks(scene);
let lures = [];
let pendingStrike = null; // tower stone the current claw swing will hit

// state: 'ready' (never started) | 'intro' | 'playing' | 'dying' | 'dead' | 'victory' | 'won'
let state = 'ready';
let survival = 0;
let best = 0;
let bestWin = 0;
// best times are kept per map type (classic inherits the old single record)
const BEST_KEY = `rf_best_${MAP}`, BESTWIN_KEY = `rf_bestwin_${MAP}`;
try {
  best = parseFloat(localStorage.getItem(BEST_KEY) ?? (MAP === 'classic' ? localStorage.getItem('rf_best') : null) ?? '0') || 0;
  bestWin = parseFloat(localStorage.getItem(BESTWIN_KEY) ?? (MAP === 'classic' ? localStorage.getItem('rf_bestwin') : null) ?? '0') || 0;
} catch { /* storage blocked */ }
let deathT = 0;
let slowmoT = 0;
let timeScale = 1;
let flashRed = 0;
let hitStopT = 0;   // impact frames: the world freezes (real seconds)
let flashWhiteT = 0;
const deathFrom = new THREE.Vector3();

window.game = {
  THREE, scene, camera, renderer, world, player, flashlight, monster, arm, sfx, level, towers, lurePool, sparks,
  throwLure: () => { const { pos, vel } = arm.throwFrom(camera, player.vel); const l = new Lure(lurePool, world, pos, vel); lures.push(l); return l; },
  get lures() { return lures; },
  get state() { return state; },
  get survival() { return survival; },
  // dev helpers
  die: () => die(),
  restart: () => restart(),
  forcePlay: () => { state = 'playing'; },
  skipIntro: () => cine.skip(),
  intro: () => startIntro(),
  jumpscareSpeed: 1,                        // dev: 0 freezes the death sequence
  jumpscareStep: (dt) => updateJumpscare(dt), // dev: advance it manually
  win: () => startVictory(),
  settings,
  map: MAP,
  seed: SEED,
  goToMap: (map, seed) => goToMap(map, seed),
  applyQuality: (q) => applyQuality(q),
  get hints() { return hints; },
};

// ---------------------------------------------------------------- graphics quality
function applyQuality(name) {
  const q = QUALITY[name] || QUALITY.high;
  renderer.setPixelRatio(q.pixelRatio(window.devicePixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  flashlight.setShadow(q.shadow);
  level.setQuality?.(q);
}
applyQuality(settings.quality);

// ---------------------------------------------------------------- hooks
player.onFootstep = (k) => {
  const r = player.wading ? 10 : player.sprinting ? 16 : player.crouched ? 0 : 7;
  world.noise(player.pos, r);
  sfx.step(k, player.wading);
};
player.onLand = (impact) => {
  if (impact > 5) world.noise(player.pos, Math.min(impact * 1.4, 18));
  sfx.land(impact);
};
if (monster) {
  const nearK = (p, r) => Math.max(0, 1 - Math.hypot(p.x - player.pos.x, p.z - player.pos.z) / r);
  monster.onStep = (p, k) => {
    sfx.drum(p, 0.45 + 0.55 * k);
    if (state === 'playing') player.addShake(0.32 * k * nearK(p, 24) ** 2);
    const loud = monster.state === 'CHASE' || monster.state === 'ATTACK' || monster.state === 'INVESTIGATE';
    if (loud || nearK(p, 20) > 0) soundCue(p, 0.35 + 0.4 * k, 'step');
  };
  monster.onRoar = (p) => {
    sfx.roar(p);
    if (state === 'playing') player.addShake(0.45 * nearK(p, 30));
    soundCue(p, 1);
  };
  monster.onCymbal = (p) => { sfx.cymbal(p); soundCue(p, 0.9); };
  monster.onStunned = (parry) => {
    sfx.clang(parry);
    monster.headWorld(_head);
    if (parry) { // impact frames: freeze, white flash, camera punch, sparks, then slow-mo
      sfx.parryImpact();
      hitStopT = 0.13;
      slowmoT = 0.13 + 0.35;
      flashWhiteT = 0.05;
      player.addShake(0.5);
      player.fov -= 6;
      sparks.burst(_head, 45, 9, true);
    } else {
      hitStopT = 0.04;
      player.addShake(0.15);
      sparks.burst(_head, 14, 5);
    }
    flashRed = -1; // purple flash
  };
  monster.onParryCue = (p) => sfx.parryCue(p);
  monster.onKill = () => die();
  monster.onSniff = (p) => {
    sfx.sniff(p);
    soundCue(p, 0.6);
    if (state === 'playing') hints.show('sniff', "It's following your scent. Wade through a blood pool to wash it off.");
  };
  monster.onCollapse = () => {
    flashRed = -1.6;
    sfx.drum(monster.pos, 1.6);
    sfx.bite();
  };
}
if (towers) {
  towers.onPuzzleStart = () => toast('The tower sings. Strike its stones in the same order.', 5);
  towers.onWrong = () => toast('Wrong note... it heard that.', 2.5);
  towers.onActivated = (site, n) => {
    monster?.alert(site.pos, 0.65);
    toast(n < towers.total ? `A tower awakens (${n}/${towers.total})` : 'All towers awake!', 4);
  };
  towers.onAllActive = () => startVictory();
}

const deathFx = { slam: false, black: false, beats: 0, flat: false, shown: false, sprayed: false };
const _deathQ = new THREE.Quaternion();
const _lookM = new THREE.Matrix4();
function die() {
  if (state !== 'playing') return;
  state = 'dying';
  deathT = 0;
  player.alive = false;
  deathFrom.copy(camera.position);
  Object.assign(deathFx, { slam: false, black: false, beats: 0, flat: false, shown: false, sprayed: false });
  monster?.feed(deathFrom);
  sfx.scream();
  sfx.roar(monster ? monster.pos : null, true);
  if (survival > best) {
    best = survival;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* ignore */ }
  }
}

function restart() {
  cine.skip();
  document.body.classList.remove('cinematic');
  player.respawn();
  monster?.reset();
  towers?.reset();
  pendingStrike = null;
  arm.reset();
  for (const l of lures) l.dispose();
  lures = [];
  lurePool.releaseAll();
  sparks.clear();
  hitStopT = 0;
  flashlight.reset();
  world.clearScent();
  survival = 0;
  deathT = 0;
  state = 'playing';
  ui.death.classList.add('hidden');
  ui.win.classList.add('hidden');
  ui.red.style.opacity = '0';
  clearDeathFx();
  ui.fade.classList.remove('go'); void ui.fade.offsetWidth; ui.fade.classList.add('go');
}

function clearDeathFx() {
  gore.clear();
  ui.jaws.className = '';
  ui.blackout.classList.remove('on');
  canvas.classList.remove('distort');
  canvas.style.transform = '';
  camera.fov = 76;
  camera.updateProjectionMatrix();
  ui.chase.style.opacity = '0';
}

// ---------------------------------------------------------------- intro (~12 s, skippable)
const introFrom = new THREE.Vector3(), introTo = new THREE.Vector3();
function startIntro() {
  if (!monster || !towers) { state = 'playing'; return; }
  state = 'intro';
  introT0 = performance.now();
  document.body.classList.add('cinematic');
  ui.overlay.classList.add('hidden');
  const m = monster;
  const I = level.intro || CLASSIC_INTRO;
  const site = towers.sites[I.tower];
  const g = (x, z) => world.groundHeight(x, z);
  const wf = { x: Math.sin(I.beast.yaw), z: Math.cos(I.beast.yaw) };  // beast walk direction
  const side = { x: -Math.cos(I.beast.yaw), z: Math.sin(I.beast.yaw) }; // camera side
  let roared = false;
  cine.play([
    { // 1: over the field towards the castle
      dur: 4, caption: ['RED FIELD', 'title'],
      update: (k) => {
        const e = k * k * (3 - 2 * k);
        camera.position.set(
          I.flyFrom[0] + (I.flyTo[0] - I.flyFrom[0]) * e,
          I.flyFrom[1] + (I.flyTo[1] - I.flyFrom[1]) * e,
          I.flyFrom[2] + (I.flyTo[2] - I.flyFrom[2]) * e);
        camera.lookAt(I.look[0], I.look[1], I.look[2]);
      },
    },
    { // 2: the beast walks past, then roars
      dur: 4.5, caption: ['It hunts the light... and your scent.'],
      start: () => {
        m.reset();
        m.pos.set(I.beast.x, g(I.beast.x, I.beast.z), I.beast.z);
        m.yaw = I.beast.yaw;
        m.state = 'CHASE';
      },
      update: (k, t, dt) => {
        m.speed = t > 1.6 && t < 2.9 ? 0.5 : 3.4;
        m.pos.x += wf.x * m.speed * dt;
        m.pos.z += wf.z * m.speed * dt;
        m.pos.y = g(m.pos.x, m.pos.z);
        if (t > 1.6 && !roared) { roared = true; m.state = 'ATTACK'; m.attackPhase = 'windup'; m.rear = 0; sfx.roar(m.pos, true); }
        if (t > 2.9 && m.state === 'ATTACK') { m.state = 'CHASE'; m.attackPhase = null; }
        // turn to face the camera for the roar, head tracking it
        const yawT = t > 1.3 && t < 3.3 ? I.beast.yaw - 1.1 : I.beast.yaw; // turns towards the camera side
        m.yaw += (yawT - m.yaw) * Math.min(1, dt * 4);
        m.awareness = 1;
        m._animate(dt, { time, player: { pos: camera.position } });
        m.headWorld(introTo);
        const back = -3 + t * 0.4;
        const cx = m.pos.x + wf.x * back + side.x * 10, cz = m.pos.z + wf.z * back + side.z * 10;
        camera.position.set(cx, g(cx, cz) + 1.6, cz);
        camera.lookAt(introTo);
      },
    },
    { // 3: rise up a tower
      dur: 3.8, caption: ['Wake the three towers. Their song can kill it.'],
      update: (k) => {
        const e = k * k * (3 - 2 * k);
        const a = 0.5 + e * 0.7, r = 12 - e * 3;
        camera.position.set(site.x + Math.sin(a) * r, site.g + 1.5 + e * 10, site.z + Math.cos(a) * r);
        camera.lookAt(site.x, site.g + 3 + e * 11, site.z);
      },
    },
  ], endIntro);
}

let introT0 = 0;
// the classic map's intro shots
const CLASSIC_INTRO = {
  flyFrom: [-40, 24, 40], flyTo: [-18, 16, 20], look: [-6, 4, -60],
  beast: { x: -7, z: 16, yaw: Math.PI / 2 }, tower: 2,
};
function endIntro() {
  monster?.reset();
  document.body.classList.remove('cinematic');
  ui.fade.classList.remove('go'); void ui.fade.offsetWidth; ui.fade.classList.add('go');
  state = 'playing';
  player._updateCamera(0, 0, 0);
  flashlight.reset();
  sfx.click();
  toast('Find the towers (look for the red lights on the horizon)', 5);
  if (towers) setFlag('rf_intro_seen', true);
  hints.show('move', () => `${keyLabel(input.binds.sprint)} sprints but it's loud. Run along walls to wall-run, ${keyLabel(input.binds.jump)} to wall-jump.`);
  if (!input.locked) { menu.setMode('pause'); ui.overlay.classList.remove('hidden'); }
}

function skipIntroInput() {
  if (state === 'intro' && performance.now() - introT0 > 300) cine.skip();
}
// start the run: the intro only plays until it has been seen once
function startGame() {
  if (getFlag('rf_intro_seen', false) || !towers) endIntro();
  else startIntro();
}
window.addEventListener('keydown', (e) => { if (['Space', 'Enter', 'Escape'].includes(e.code)) skipIntroInput(); });
window.addEventListener('mousedown', skipIntroInput);

// ---------------------------------------------------------------- victory
function startVictory() {
  if (!monster || state !== 'playing') return;
  state = 'victory';
  document.body.classList.add('cinematic');
  const m = monster;
  const tgt = new THREE.Vector3();
  towers.fireAt(() => m.headWorld(tgt));
  m.kill();
  sfx.roar(m.pos, true);
  sfx.organChord(m.pos, true);
  const a0 = Math.atan2(player.pos.x - m.pos.x, player.pos.z - m.pos.z);
  cine.play([{
    dur: 6.5, caption: ['The towers sing it to death.'],
    update: (k) => {
      const a = a0 + k * 1.1, r = 19 - k * 4;
      const cx = m.pos.x + Math.sin(a) * r, cz = m.pos.z + Math.cos(a) * r;
      camera.position.set(cx, Math.max(world.groundHeight(cx, cz) + 2, m.pos.y + 8 - k * 3.5), cz);
      camera.lookAt(m.pos.x, m.pos.y + 2.8, m.pos.z);
    },
  }], showWin);
}

function showWin() {
  state = 'won';
  document.body.classList.remove('cinematic');
  if (!bestWin || survival < bestWin) {
    bestWin = survival;
    try { localStorage.setItem(BESTWIN_KEY, String(bestWin)); } catch { /* ignore */ }
  }
  ui.winTime.textContent = fmt(survival);
  ui.winBest.textContent = fmt(bestWin);
  ui.win.classList.remove('hidden');
  screenT0 = performance.now();
  document.exitPointerLock?.();
}

// ---------------------------------------------------------------- UI
const ui = {
  overlay: document.getElementById('overlay'),
  death: document.getElementById('death'),
  deathTime: document.getElementById('death-time'),
  deathBest: document.getElementById('death-best'),
  stamina: document.getElementById('stamina'),
  staminaFill: document.getElementById('stamina-fill'),
  debug: document.getElementById('debug'),
  timer: document.getElementById('timer'),
  eye: document.getElementById('eye'),
  chase: document.getElementById('chase'),
  red: document.getElementById('red'),
  grain: document.getElementById('grain'),
  win: document.getElementById('win'),
  winTime: document.getElementById('win-time'),
  winBest: document.getElementById('win-best'),
  deathTowers: document.getElementById('death-towers'),
  towers: document.getElementById('towers'),
  charge: document.getElementById('charge'),
  chargeRing: document.getElementById('charge-ring'),
  chargeLabel: document.getElementById('charge-label'),
  caption: document.getElementById('caption'),
  fade: document.getElementById('fade'),
  toast: document.getElementById('toast'),
  lmb: document.getElementById('lmb'),
  blackout: document.getElementById('blackout'),
  blood: document.getElementById('blood'),
  jaws: document.getElementById('jaws'),
  fps: document.getElementById('fps'),
  compass: document.getElementById('compass'),
  cues: document.getElementById('cues'),
};
const gore = new Gore(ui.blood);
// jaws overlay: each row is its own random set of curved, bloodied teeth so they interlock
{
  const row = (id, flip) => {
    let teeth = '', blood = '';
    let x = -2 + Math.random() * 3;
    while (x < 102) {
      const w = 5 + Math.random() * 6, h = 16 + Math.random() * 14, lean = (Math.random() - 0.5) * 2;
      const tip = x + w / 2 + lean;
      teeth += `M${x.toFixed(1)},28 Q${(x + w * 0.1).toFixed(1)},${(28 + h * 0.65).toFixed(1)} ${tip.toFixed(1)},${(28 + h).toFixed(1)} Q${(x + w * 0.9).toFixed(1)},${(28 + h * 0.65).toFixed(1)} ${(x + w).toFixed(1)},28 Z `;
      if (Math.random() < 0.45) { // blood running down the tooth
        const bx = x + w * (0.3 + Math.random() * 0.4);
        blood += `M${bx.toFixed(1)},28 Q${(bx + 0.4).toFixed(1)},${(28 + h * 0.4).toFixed(1)} ${(bx + 0.1).toFixed(1)},${(28 + h * (0.5 + Math.random() * 0.4)).toFixed(1)} `;
      }
      x += w * (0.85 + Math.random() * 0.25);
    }
    return `<svg viewBox="0 0 100 50" preserveAspectRatio="none"${flip ? ' style="transform:scaleY(-1)"' : ''}>
      <defs>
        <linearGradient id="tooth${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a6a4a"/><stop offset="0.35" stop-color="#d8c8a8"/><stop offset="1" stop-color="#fff4dc"/></linearGradient>
        <linearGradient id="gum${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0000"/><stop offset="0.8" stop-color="#5a0606"/><stop offset="1" stop-color="#8a1010"/></linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="30" fill="url(#gum${id})"/>
      <path d="${teeth}" fill="url(#tooth${id})" stroke="#3a2010" stroke-width="0.25"/>
      <path d="${blood}" fill="none" stroke="#7a0000" stroke-width="0.9" stroke-linecap="round" opacity="0.85"/>
      <path d="M0,29 Q25,31.5 50,29.5 T100,29" fill="none" stroke="#a02020" stroke-width="0.8" opacity="0.7"/>
    </svg>`;
  };
  ui.jaws.querySelector('.top').innerHTML = row('t', false);
  ui.jaws.querySelector('.bottom').innerHTML = row('b', true);
}
const cine = new Cinematic(ui.caption);
let toastT = 0;
function toast(text, secs = 3) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  toastT = secs;
}
const hints = new Hints({ toast: (t, secs) => toast(t, secs), busy: () => toastT > 0, enabled: () => settings.tips });
let screenT0 = 0; // when the death / win screen appeared (retry keys wait a moment)
const menu = new Menu({
  settings, input,
  antialiasNow: ANTIALIAS,
  map: MAP, seed: SEED, newSeed,
  onMap: (map, seed) => goToMap(map, seed),
  onRestart: () => { sfx.init(); restart(); input.requestLock(); },
  onIntro: () => { sfx.init(); input.requestLock(); startIntro(); },
  onChange: (key) => {
    if (key === 'quality') applyQuality(settings.quality);
    else if (key === 'binds') input.binds = settings.binds;
    else if (key === 'resetTips') hints.reset();
    else if (key === 'tips' && !settings.tips) hints.clearQueue();
    applyHudSettings();
  },
});
menu.setMode('start', { introSeen: getFlag('rf_intro_seen', false) && !!towers });
for (const el of document.querySelectorAll('.map-hint')) {
  el.textContent = MAP === 'random' ? `Seed ${SEED} · press N for a new random map` : '';
}
function applyHudSettings() {
  ui.fps.classList.toggle('show', settings.fps);
  if (settings.fps && !ui.fps.textContent) ui.fps.textContent = '-- fps';
}
let showDebug = false;
let staminaFullT = 0;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
if (MAP === 'test') { ui.timer.style.display = 'none'; ui.towers.style.display = 'none'; }

ui.overlay.addEventListener('click', (e) => {
  if (menu.settingsOpen || e.target.closest('.menu-ui')) return; // buttons / settings handle themselves
  sfx.init();
  input.requestLock();
  if (state === 'ready') startGame();
});
function retry() {
  if ((state !== 'dead' && state !== 'won') || performance.now() - screenT0 < 600) return;
  sfx.init();
  restart();
  input.requestLock();
}
for (const el of [ui.death, ui.win]) el.addEventListener('click', retry);
window.addEventListener('keydown', (e) => {
  if (input.capture || e.repeat) return;
  if (['KeyR', 'Space', 'Enter'].includes(e.code)) retry();
  if (e.code === 'KeyN' && MAP === 'random' && (state === 'dead' || state === 'won') && performance.now() - screenT0 > 600) goToMap('random', newSeed());
  // R on the pause screen restarts the run
  if (e.code === 'KeyR' && state === 'playing' && !input.locked && !menu.settingsOpen) menu.el.restart.click();
});
const noOverlay = ['intro', 'dying', 'dead', 'victory', 'won'];
input.onLockChange = (locked) => {
  if (!locked && state !== 'ready') menu.setMode('pause');
  if (locked && menu.settingsOpen) menu.openSettings(false);
  ui.overlay.classList.toggle('hidden', locked || noOverlay.includes(state));
};
document.addEventListener('visibilitychange', () => { if (document.hidden) sfx.setPaused(true); });
applyHudSettings();

{
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ui.grain.style.backgroundImage = `url(${c.toDataURL()})`;
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  arm.resize(camera.aspect);
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let time = 0;
let fpsAcc = 0, fpsFrames = 0, fps = 0;
const _dir = new THREE.Vector3();
const _head = new THREE.Vector3();

function dangerLevel() {
  if (!monster) return 0;
  const d = Math.hypot(monster.pos.x - player.pos.x, monster.pos.z - player.pos.z);
  const prox = Math.min(Math.max(1 - d / 28, 0), 1);
  const hunting = monster.state === 'CHASE' || monster.state === 'ATTACK';
  return hunting ? Math.max(prox, 0.55) : prox * 0.8;
}

// ---------------------------------------------------------------- death jumpscare timeline
// 0-0.7 s slow-mo stare into its maw, 0.7-0.95 dragged in, 0.95 jaws slam,
// then blood + blackout, slowing heartbeat, flatline, death screen.
const smooth01 = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
function updateJumpscare(realDt) {
  deathT += realDt;
  const T = deathT;
  const slow = T < 0.7 ? 0.25 : 1;
  monster.update(realDt * slow, { player, flashlight, camera, lure: null, time: survival + T });
  monster.headWorld(_head);

  // whip around to face it, then get dragged into the mouth
  _lookM.lookAt(camera.position, _head, camera.up);
  _deathQ.setFromRotationMatrix(_lookM);
  camera.quaternion.slerp(_deathQ, 1 - Math.exp(-(T < 0.15 ? 28 : 14) * realDt));
  const pull = T < 0.7 ? 0.22 * smooth01(0.05, 0.7, T) : 0.22 + 0.63 * smooth01(0.7, 0.95, T);
  camera.position.lerpVectors(deathFrom, _head, pull);
  const amp = T < 0.7 ? 0.035 : T < 1.0 ? 0.14 : 0;
  camera.position.x += (Math.random() - 0.5) * amp;
  camera.position.y += (Math.random() - 0.5) * amp;
  camera.fov += ((T < 0.95 ? 46 : 60) - camera.fov) * Math.min(1, realDt * 12);
  camera.updateProjectionMatrix();

  // screen distortion + pulsing red edges until the bite
  if (T < 1.0) {
    canvas.classList.add('distort');
    const j = T < 0.7 ? 4 : 14;
    canvas.style.transform = `translate(${(Math.random() - 0.5) * j}px, ${(Math.random() - 0.5) * j}px) skew(${(Math.random() - 0.5) * j * 0.15}deg) scale(${1.02 + Math.random() * 0.02})`;
    ui.chase.style.opacity = String(0.6 + 0.35 * Math.sin(T * 30));
  }
  if (T > 0.45 && !deathFx.sprayed) { deathFx.sprayed = true; gore.spray(4); } // spittle hitting the "lens"

  // the bite
  if (T >= 0.95 && !deathFx.slam) {
    deathFx.slam = true;
    monster.feedClose = true;
    ui.jaws.classList.add('on');
    void ui.jaws.offsetWidth;
    ui.jaws.classList.add('bite');
    sfx.crunch();
    ui.red.style.background = 'rgba(200,0,0,0.9)';
    ui.red.style.opacity = '1';
  }
  if (T >= 1.06 && !deathFx.black) {
    deathFx.black = true;
    ui.blackout.classList.add('on');
    canvas.classList.remove('distort');
    canvas.style.transform = '';
    ui.chase.style.opacity = '0';
    ui.red.style.opacity = '0';
    ui.red.style.background = '';
    gore.splatter();
  }
  if (T >= 1.4 && ui.jaws.classList.contains('bite')) ui.jaws.classList.add('fade');
  if (deathFx.black) gore.update(realDt);

  // heart slows... and stops
  const beats = [1.35, 1.95, 2.75];
  if (deathFx.beats < beats.length && T >= beats[deathFx.beats]) { sfx.heartOnce(0.7 - deathFx.beats * 0.2); deathFx.beats++; }
  if (T >= 3.3 && !deathFx.flat) { deathFx.flat = true; sfx.flatline(); }

  if (T >= 3.5 && !deathFx.shown) {
    deathFx.shown = true;
    state = 'dead';
    ui.deathTime.textContent = fmt(survival);
    ui.deathBest.textContent = fmt(best);
    if (towers) ui.deathTowers.textContent = `Towers awakened: ${towers.count}/${towers.total}`;
    ui.death.classList.remove('hidden');
    screenT0 = performance.now();
    document.exitPointerLock?.();
  }
}

// ---------------------------------------------------------------- guidance: tips, compass, sound cues
function clawDenied() {
  sfx.deny();
  hints.show('claw', 'Claw is out of charges. The veins refill one every 25 s.');
}

function checkHints() {
  const k = (a) => keyLabel(input.binds[a]);
  if (player.exhausted) hints.show('stamina', 'Out of breath. Stamina refills when you stop sprinting.');
  if (monster) {
    const d = Math.hypot(monster.pos.x - player.pos.x, monster.pos.z - player.pos.z);
    if (monster.awareness > 0.35) hints.show('aware', () => `The eye means it's noticing you. Hold ${k('hide')} to hide: your light goes dark.`);
    if (monster.state === 'CHASE') hints.show('chase', () => `Break its line of sight. ${k('lure')} throws a lure it will chase.`);
    if (monster.state === 'ATTACK' && monster.attackPhase === 'windup' && d < 15) {
      hints.show('lunge', () => `It's about to lunge. Sidestep, or ${k('slash')} the moment its eyes flash white to parry.`);
    }
  }
  if (!player.hiding && world.inGrass(player.pos.x, player.pos.z)) {
    hints.show('grass', () => `Tall grass: hold ${k('hide')} here and you're nearly invisible.`);
  }
  if (towers) {
    for (const s of towers.sites) {
      if (s.phase === 0 && Math.hypot(s.x - player.pos.x, s.z - player.pos.z) < 12) {
        hints.show('tower', 'Stand in the rune circle with your light on to charge the tower.');
      }
    }
  }
}

// One nudge per session if the first seconds of play run slowly.
const perf = { t: 0, frames: 0, time: 0, done: false };
function checkFrameRate(realDt) {
  if (perf.done) return;
  perf.t += realDt;
  if (perf.t < 3) return; // skip shader warm-up
  perf.frames++; perf.time += realDt;
  if (perf.t < 20) return;
  perf.done = true;
  if (perf.time / perf.frames > 0.022 && settings.quality !== 'low') {
    toast('Low frame rate: lower Graphics in the pause menu (Esc)', 6);
  }
}

// Compass strip: 320 px shows 180 degrees. Heading 0 = north (-z); angles grow to the left like yaw.
const COMPASS_W = 320, COMPASS_FOV = Math.PI;
const compass = { ticks: [], marks: [] };
{
  const strip = ui.compass.querySelector('.strip');
  const names = { 0: 'N', 6: 'W', 12: 'S', 18: 'E' }; // every 15 degrees, counter-clockwise
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    el.className = names[i] ? 'tick major' : 'tick';
    if (names[i]) el.textContent = names[i];
    strip.appendChild(el);
    compass.ticks.push({ el, a: (i / 24) * Math.PI * 2 });
  }
  for (let i = 0; i < (towers ? towers.total : 0); i++) {
    const el = document.createElement('div');
    el.className = 'mk';
    strip.appendChild(el);
    compass.marks.push(el);
  }
}
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const headingTo = (x, z) => Math.atan2(-(x - player.pos.x), -(z - player.pos.z));
function updateCompass(show) {
  ui.compass.classList.toggle('show', show && !!towers);
  if (!show || !towers) return;
  const half = COMPASS_W / 2;
  for (const t of compass.ticks) {
    const rel = wrapPi(t.a - player.yaw);
    const vis = Math.abs(rel) < COMPASS_FOV / 2;
    t.el.style.display = vis ? '' : 'none';
    if (vis) t.el.style.left = `${half - (rel / (COMPASS_FOV / 2)) * half}px`;
  }
  towers.sites.forEach((s, i) => {
    const el = compass.marks[i];
    const rel = wrapPi(headingTo(s.x, s.z) - player.yaw);
    const lim = COMPASS_FOV / 2 - 0.12;
    const edge = Math.abs(rel) > lim;
    const r = Math.max(-1, Math.min(1, rel / lim));
    el.style.left = `${half - r * (half - 8)}px`;
    el.textContent = edge ? (rel > 0 ? '◂✦' : '✦▸') : '✦';
    el.classList.toggle('awake', s.phase === 3);
    el.classList.toggle('edge', edge);
  });
}

// Sound-direction cues: a red arc at the screen edge pointing at monster sounds
// that come from outside the view.
const cues = [];
for (let i = 0; i < 6; i++) {
  const el = document.createElement('div');
  el.className = 'cue';
  ui.cues.appendChild(el);
  cues.push({ el, life: 0, peak: 0 });
}
let cueNext = 0, lastStepCue = -1;
function soundCue(p, loud, kind) {
  if (!settings.soundCues || state !== 'playing' || !input.locked) return;
  const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
  if (d > 35) return;
  if (kind === 'step') { if (time - lastStepCue < 0.35) return; lastStepCue = time; }
  const rel = wrapPi(headingTo(p.x, p.z) - player.yaw);
  if (Math.abs(rel) < Math.PI / 4) return; // you can see it
  const c = cues[cueNext++ % cues.length];
  c.life = 0.8;
  c.peak = Math.min(1, loud * (1.15 - d / 35));
  c.el.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
}
function updateCues(dt) {
  for (const c of cues) {
    if (c.life <= 0) continue;
    c.life -= dt;
    c.el.style.opacity = c.life > 0 ? String(c.peak * Math.min(1, c.life / 0.5)) : '0';
  }
}

function frame() {
  requestAnimationFrame(frame);
  const realDt = Math.min(clock.getDelta(), 1 / 20);
  slowmoT -= realDt;
  timeScale = slowmoT > 0 ? 0.3 : Math.min(1, timeScale + realDt * 3);
  let dt = realDt * timeScale;
  if (hitStopT > 0) { hitStopT -= realDt; dt = 0; }
  if (state === 'playing') canvas.classList.toggle('distort', hitStopT > 0);
  time += dt;

  const playing = state === 'playing' && input.locked;
  const danger = dangerLevel();

  if (playing) {
    world.update(dt);
    player.update(dt);
    survival += dt;

    // the flashlight is only off while hiding (crouched)
    if (flashlight.on === player.hiding) { flashlight.toggle(); sfx.click(); }
    // scent trail; wading through blood washes it away
    world.updateScent(dt, player.pos, player.wading, player.hidden);
    if (input.actionPressed('debug')) { showDebug = !showDebug; ui.debug.style.display = showDebug ? 'block' : 'none'; }
    if (input.actionPressed('slash')) {
      const stone = towers?.aim(camera);
      if (stone) { if (arm.trigger('slash', true)) { pendingStrike = stone; sfx.whoosh(); } }
      else if (arm.trigger('slash')) sfx.whoosh(); else clawDenied();
    }
    if (input.actionPressed('lure')) { if (arm.trigger('throw')) sfx.whoosh(); else clawDenied(); }

    const lure = lures.filter((l) => l.active).at(-1) || null;
    monster?.update(dt, { player, flashlight, camera, lure, time: survival });
  } else if (state === 'intro' || state === 'victory') {
    input.consumeMouse();
    cine.update(realDt);
    if (state === 'victory') monster.update(dt, { player, flashlight, camera, lure: null, time: survival });
  } else if (state === 'dying' && monster) {
    if (window.game.jumpscareSpeed) updateJumpscare(realDt * window.game.jumpscareSpeed);
  } else if (state === 'dead') {
    gore.update(realDt); // drips keep running behind the death screen
  } else {
    input.consumeMouse();
  }

  for (const l of lures) l.update(dt, time);
  sparks.update(dt);
  lures = lures.filter((l) => l.active || l.dying > 0);

  towers?.update(playing || state === 'victory' ? dt : 0, time, { player, camera });

  flashlight.danger = danger;
  flashlight.update(dt, camera, time);
  const cinematic = state === 'intro' || state === 'victory';
  if (!cinematic && state !== 'dying' && state !== 'dead') {
    arm.update(dt, time, {
      player,
      flashlightK: flashlight.light.intensity / flashlight.baseIntensity,
      dangerK: danger,
      onSlashHit: (free) => {
        if (free) { if (pendingStrike) towers.strike(pendingStrike); pendingStrike = null; return; }
        if (!monster) return;
        camera.getWorldDirection(_dir);
        monster.receiveSlash(camera.position, _dir);
      },
      onThrow: () => {
        const { pos, vel } = arm.throwFrom(camera, player.vel);
        const l = new Lure(lurePool, world, pos, vel);
        l.onBounce = (p) => sfx.chime(p, 0.4);
        lures.push(l);
        sfx.chime(pos, 0.6);
      },
    });
  }
  level.update?.(dt, time, camera);
  sfx.setListener(camera);
  sfx.update(realDt, playing ? danger : 0);

  // ---- HUD
  ui.staminaFill.style.width = `${(player.stamina * 100).toFixed(1)}%`;
  ui.stamina.classList.toggle('exhausted', player.exhausted);
  staminaFullT = player.stamina >= 1 ? staminaFullT + dt : 0;
  ui.stamina.style.opacity = staminaFullT > 1.2 ? '0' : '1';
  ui.timer.textContent = fmt(survival);
  if (towers) {
    ui.towers.textContent = `✦ ${towers.count}/${towers.total}`;
    const th = playing ? towers.hud(player) : null;
    ui.charge.classList.toggle('show', !!th);
    towers.aimed = th?.mode === 'melody' ? towers.aim(camera) : null;
    ui.lmb.classList.toggle('show', th?.mode === 'melody');
    ui.lmb.classList.toggle('aimed', !!towers.aimed);
    if (th) {
      ui.chargeRing.style.strokeDashoffset = String(163.4 * (1 - th.progress));
      if (th.mode === 'melody') {
        ui.chargeLabel.textContent = 'Repeat the song: ' + '●'.repeat(th.input) + '○'.repeat(th.len - th.input);
      } else if (th.mode === 'blocked') {
        ui.chargeLabel.textContent = "Stand up to charge (it can't feed on darkness)";
      } else {
        ui.chargeLabel.textContent = `Charging ${Math.round(th.progress * 100)}%`;
      }
    }
  }
  if (toastT > 0) { toastT -= realDt; if (toastT <= 0) ui.toast.classList.remove('show'); }
  const paused = state === 'playing' && !input.locked;
  sfx.setPaused(paused);
  document.body.classList.toggle('paused', paused);
  if (playing) { checkHints(); checkFrameRate(realDt); }
  hints.update(playing ? realDt : 0);
  updateCompass(playing && settings.compass);
  updateCues(realDt);
  if (monster) {
    const aw = monster.awareness;
    ui.eye.style.opacity = String(aw < 0.08 ? 0 : 0.15 + aw * 0.85);
    ui.eye.classList.toggle('hunting', monster.state === 'CHASE' || monster.state === 'ATTACK');
    const hunting = playing && (monster.state === 'CHASE' || monster.state === 'ATTACK');
    if (state !== 'dying') ui.chase.style.opacity = hunting ? String(0.35 + 0.25 * Math.sin(time * 8)) : '0';
  }
  if (flashWhiteT > 0) { // first frames of a parry
    flashWhiteT -= realDt;
    ui.red.style.background = 'rgba(255,250,255,0.85)';
    ui.red.style.opacity = '1';
  } else if (flashRed < 0) { // purple parry/stun flash
    flashRed = Math.min(0, flashRed + realDt * 3);
    ui.red.style.background = 'radial-gradient(ellipse at center, rgba(150,60,255,0.25), rgba(90,20,200,0.6))';
    ui.red.style.opacity = String(-flashRed);
    if (flashRed === 0) { ui.red.style.opacity = '0'; ui.red.style.background = ''; }
  }

  ui.grain.style.backgroundPosition = `${(Math.random() * 128) | 0}px ${(Math.random() * 128) | 0}px`;

  fpsAcc += realDt; fpsFrames++;
  if (fpsAcc > 0.5) {
    fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0;
    if (settings.fps) ui.fps.textContent = `${fps} fps`;
  }
  if (showDebug) {
    const p = player.pos;
    ui.debug.textContent =
      `fps    ${fps}\n` +
      `state  ${player.state}${player.hidden ? ' (hidden)' : ''}\n` +
      `speed  ${player.speed.toFixed(2)} m/s\n` +
      `pos    ${p.x.toFixed(1)} ${p.y.toFixed(2)} ${p.z.toFixed(1)}\n` +
      `stam   ${(player.stamina * 100).toFixed(0)}%   arm ${arm.charges}\n` +
      (monster ? `monster ${monster.state}  aware ${monster.awareness.toFixed(2)}  dist ${monster.pos.distanceTo(p).toFixed(1)}\n` : '');
  }

  input.endFrame();
  renderer.clear();
  renderer.render(scene, camera);
  if (!cinematic && state !== 'dying' && state !== 'dead' && state !== 'won') {
    renderer.clearDepth();
    renderer.render(arm.scene, arm.camera);
  }
}

player._updateCamera(0, 0, 0);
// compile every shader now (behind the start screen) instead of on first use
renderer.compile(scene, camera);
renderer.compile(arm.scene, arm.camera);
frame();
