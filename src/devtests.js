import * as THREE from 'three';
import { World } from './world.js';
import { buildRedField } from './maps/redfield.js';
import { buildGenerated } from './maps/generated.js';
import { Monster, MONSTER_CONFIG } from './monster.js';
import { unreachableSpots } from './maps/mapcheck.js';

// Headless monster tests (dev only, loaded on demand from window.game):
//   game.reachTest(): can the monster get to (and bite) a player standing anywhere?
//   game.rushSim():   charge-burst balance against scripted players
// Both step the real Monster AI at 30 Hz without rendering.

const DT = 1 / 30;
const stubPlayer = () => ({ pos: new THREE.Vector3(), height: 1.8, alive: true, hidden: false, hiding: false, sprinting: false });
const offscreenCam = () => { // far above, looking up: never "sees" the monster (allows unstick hops)
  const c = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  c.position.set(0, 500, 0); c.lookAt(0, 1000, 0); c.updateMatrixWorld(true);
  return c;
};
const ctxFor = (player, camera, time = 0) => ({ player, flashlight: { on: true, light: { angle: 0.5 } }, camera, lure: null, time });
const dispose = (sc) => sc.traverse((o) => { o.geometry?.dispose?.(); for (const m of [].concat(o.material || [])) { m.map?.dispose?.(); m.dispose?.(); } });

function buildMap(map, seed) {
  const sc = new THREE.Scene(), w = new World(sc);
  const L = map === 'classic' ? buildRedField(sc, w) : buildGenerated(sc, w, seed);
  return { sc, w, L };
}

// Chase a stationary player until the monster bites (true) or maxT runs out.
function chaseTo(w, monster, player, cam, maxT) {
  monster.reset();
  let bit = false, attackAt = null, squeezed = false;
  monster.onKill = () => { bit = true; };
  const ctx = ctxFor(player, cam);
  const u0 = monster.unstuckCount;
  for (let t = 0; t < maxT; t += DT) {
    monster.awareness = 1; monster.lastKnown.copy(player.pos); monster.lostT = 0;
    if (monster.state !== 'CHASE' && monster.state !== 'ATTACK') monster._setState('CHASE');
    w.update(DT);
    monster.update(DT, ctx);
    squeezed ||= monster.squeezing;
    if (monster.state === 'ATTACK' && attackAt === null) attackAt = t;
    if (bit) return { t: +t.toFixed(1), attackAt: +attackAt.toFixed(1), squeezed, hops: monster.unstuckCount - u0 };
  }
  return { t: null, attackAt, squeezed, hops: monster.unstuckCount - u0, end: monster.pos.distanceTo(player.pos).toFixed(1) };
}

// Player spots per map: random open ground, ground the monster's normal grid
// can't stand on (hugging walls, in narrow gaps), and climbable tops.
// `extra`: [{x, z}] more ground spots to test on every map (e.g. known trouble spots).
export async function reachTest({ maps = null, from = 1, to = 10, perMap = 6, maxT = 60, log = null, extra = [] } = {}) {
  const list = maps || ['classic', ...Array.from({ length: to - from + 1 }, (_, i) => from + i)];
  const rows = [];
  for (const m of list) {
    const map = m === 'classic' ? 'classic' : 'random', seed = m === 'classic' ? 0 : m;
    const { sc, w, L } = buildMap(map, seed);
    const spawn = L.layout?.spawn || L.spawn;
    const st = unreachableSpots(w, { spawn });
    let rs = (seed + 1) * 9301;
    const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const spots = [];
    const open = st.standGround.filter((i) => { const p = st.cellPos(i); return w.walkable(p.x, p.z); });
    const tight = st.standGround.filter((i) => { const p = st.cellPos(i); return !w.walkable(p.x, p.z); });
    for (let k = 0; k < Math.ceil(perMap / 2); k++) { const p = st.cellPos(pick(open)); spots.push({ kind: 'open', ...p, y: w.groundHeight(p.x, p.z) }); }
    for (let k = 0; k < Math.ceil(perMap / 3); k++) { const p = st.cellPos(pick(tight)); spots.push({ kind: 'tight', ...p, y: w.groundHeight(p.x, p.z) }); }
    const tops = st.standTops.filter((b) => b.max.y - w.groundHeight((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2) > 1.5);
    for (let k = 0; k < Math.ceil(perMap / 3) && tops.length; k++) {
      const b = pick(tops);
      spots.push({ kind: 'top', x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, y: b.max.y });
    }
    for (const p of extra) spots.push({ kind: 'extra', x: p.x, z: p.z, y: w.groundHeight(p.x, p.z) });
    for (const u of st) if (u.kind === 'ground') spots.push({ kind: 'unsafe', x: u.x, z: u.z, y: w.groundHeight(u.x, u.z) });
    const monster = new Monster(sc, w, L.monsterSpawn), player = stubPlayer(), cam = offscreenCam();
    for (const s of spots) {
      player.pos.set(s.x, s.y, s.z);
      const r = chaseTo(w, monster, player, cam, maxT);
      const row = { map: m, kind: s.kind, at: `${s.x.toFixed(0)},${s.z.toFixed(0)}`, h: +(s.y - w.groundHeight(s.x, s.z)).toFixed(1), ...r };
      rows.push(row);
      log?.(row);
      await new Promise((res) => setTimeout(res, 0));
    }
    dispose(sc);
  }
  return rows;
}

// Step-by-step log of a chase to one spot (state changes + a line every `every` s).
export function traceChase({ map = 'random', seed = 1, x, z, y = null, secs = 30, every = 1 } = {}) {
  const { sc, w, L } = buildMap(map, seed);
  const monster = new Monster(sc, w, L.monsterSpawn), player = stubPlayer(), cam = offscreenCam();
  player.pos.set(x, y ?? w.groundHeight(x, z), z);
  monster.reset();
  const ctx = ctxFor(player, cam), head = new THREE.Vector3(), log = [];
  let last = '', bit = false;
  monster.onKill = () => { bit = true; };
  for (let t = 0; t < secs && !bit; t += DT) {
    monster.awareness = 1; monster.lastKnown.copy(player.pos); monster.lostT = 0;
    if (monster.state !== 'CHASE' && monster.state !== 'ATTACK') monster._setState('CHASE');
    w.update(DT);
    monster.update(DT, ctx);
    monster.headWorld(head);
    const key = `${monster.state}/${monster.attackPhase || ''} sq=${monster.squeezing} off=${monster.goalOff} sees=${monster.sees} miss=${monster.misses}`;
    const tick = Math.round(t / DT) % Math.round(every / DT) === 0;
    if (key !== last || tick) {
      const p = monster.path || [];
      log.push(`${t.toFixed(1)} ${key} pos=${monster.pos.x.toFixed(1)},${monster.pos.z.toFixed(1)} d=${monster.pos.distanceTo(player.pos).toFixed(1)} ` +
        `head=${Math.hypot(head.x - player.pos.x, head.z - player.pos.z).toFixed(1)} sp=${monster.speed.toFixed(1)} bl=${monster.blockedT.toFixed(1)} ` +
        `path=${p.slice(0, 3).map((q) => `${q.x.toFixed(1)},${q.z.toFixed(1)}`).join(' ')}${p.length > 3 ? '…' : ''}`);
      last = key;
    }
  }
  log.push(bit ? 'BITTEN' : 'not bitten');
  globalThis._trace = { w, monster, player }; // for poking at in the console
  return log;
}

// ---------------------------------------------------------------- charge balance
// Flat empty field; the player starts `d` m in front of a chasing monster.
//   bot 'run':   sprints straight away (real stamina: 5.5 s, then walks until 35%)
//   bot 'dodge': same, but cuts 90 degrees sideways when the tell starts
//   bot 'still': stands there
export function rushSim({ d = 14, bot = 'run', maxT = 12, rush = true, time = 0 } = {}) {
  const sc = new THREE.Scene(), w = new World(sc);
  w.heightFn = () => 0;
  w.buildNav(-150, -150, 150, 150, 1, 1.6, 0.9, 3.6, 0);
  const monster = new Monster(sc, w, new THREE.Vector3(0, 0, -100));
  const player = stubPlayer(), cam = offscreenCam();
  player.pos.set(0, 0, -100 + d);
  let bit = false, minHead = Infinity, phase = null, dodgeDir = null;
  monster.onKill = () => { bit = true; };
  const C = MONSTER_CONFIG, saved = C.rushMinDist;
  if (!rush) C.rushMinDist = 1e9;
  monster.yaw = 0;
  monster.awareness = 1;
  monster._setState('CHASE');
  monster.rushCd = 0;
  let stamina = 1, exhausted = false, events = [];
  const head = new THREE.Vector3();
  for (let t = 0; t < maxT && !bit; t += DT) {
    // player bot
    let vx = 0, vz = 0;
    if (bot !== 'still') {
      const sprint = !exhausted;
      const sp = sprint ? 8.2 : 4.4;
      if (sprint) { stamina -= DT / 5.5; if (stamina <= 0) { stamina = 0; exhausted = true; } }
      else { stamina = Math.min(1, stamina + DT / 3.5); if (stamina >= 0.35) exhausted = false; }
      if (bot === 'dodge' && monster.rush && !dodgeDir) dodgeDir = 1;
      if (dodgeDir) { vx = sp; } else { vz = sp; }
      player.sprinting = sprint;
    }
    player.pos.x += vx * DT; player.pos.z += vz * DT;
    monster.awareness = 1;
    w.update(DT);
    monster.update(DT, ctxFor(player, cam, time));
    const ph = monster.rush?.phase || (monster.state === 'ATTACK' ? `attack:${monster.attackPhase}` : monster.state);
    if (ph !== phase) { events.push(`${t.toFixed(1)} ${ph} d${monster.pos.distanceTo(player.pos).toFixed(1)}`); phase = ph; }
    if (monster.rush?.phase === 'charge') { monster.headWorld(head); minHead = Math.min(minHead, Math.hypot(head.x - player.pos.x, head.z - player.pos.z)); }
  }
  C.rushMinDist = saved;
  dispose(sc);
  return { d, bot, rush, time, bit, minHeadInCharge: +minHead.toFixed(1), events: events.join(' | ') };
}

// Average monster ground speed over a long chase with the player always 18 m
// ahead (in rush range), with and without charge bursts.
export function rushPace({ secs = 60, time = 0 } = {}) {
  const out = {};
  for (const rush of [false, true]) {
    const sc = new THREE.Scene(), w = new World(sc);
    w.heightFn = () => 0;
    w.buildNav(-2000, -60, 2000, 60, 4, 1.6, 0.9, 3.6, 0);
    const monster = new Monster(sc, w, new THREE.Vector3(-1900, 0, 0));
    const player = stubPlayer(), cam = offscreenCam();
    const C = MONSTER_CONFIG, saved = C.rushMinDist;
    if (!rush) C.rushMinDist = 1e9;
    monster.yaw = Math.PI / 2;
    monster._setState('CHASE');
    const x0 = monster.pos.x;
    let rushes = 0;
    monster.onRush = () => rushes++;
    for (let t = 0; t < secs; t += DT) {
      player.pos.set(monster.pos.x + 18, 0, 0);
      monster.awareness = 1;
      w.update(DT);
      monster.update(DT, ctxFor(player, cam, time));
      if (monster.state === 'ATTACK') monster._setState('CHASE');
    }
    C.rushMinDist = saved;
    out[rush ? 'withRush' : 'noRush'] = { avgSpeed: +((monster.pos.x - x0) / secs).toFixed(2), rushes };
    dispose(sc);
  }
  return out;
}
