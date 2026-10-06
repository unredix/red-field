import * as THREE from 'three';
import { PropKit } from '../props.js';
import { buildTerrain, buildBackdrop, buildEmbers } from './common.js';

// The Red Field (maps.png). 140 x 140 m, walled by rocks.
//   centre     blood pool, shed, piano, crosses (the original small map)
//   north      ruined chapel inside a fenced graveyard
//   east       dead forest with hanging dolls
//   south      "orchestra" clearing: chairs, pianos, drum kits, gong, speaker stacks
//   west       rock canyon with player-only gaps, second blood pool
//   corners    junkyard, crosses, rocks

const HALF = 70;
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Mud paths (polylines)
const PATHS = [
  [[-68, 58], [-56, 50], [-45, 38], [-34, 22], [-22, 10], [-10, 2], [-1, -1], [4, 1], [12, 8], [20, 16], [30, 22], [42, 28], [56, 32], [68, 36]],
  [[-1, -1], [2, -14], [-2, -28], [0, -41]],            // to the chapel door
  [[12, 8], [10, 22], [6, 34], [4, 42]],                // to the orchestra
  [[42, 28], [48, 10], [52, -10], [50, -30], [44, -48]], // through the forest
  [[-22, 10], [-36, 4], [-48, -8], [-54, -26], [-50, -44]], // into the canyon
];
function pathDist(x, z) {
  let best = Infinity;
  for (const path of PATHS) {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) best = d;
    }
  }
  return best;
}

const POOL = { x: 6, z: 8, w: 8, d: 5 };
const POOL2 = { x: -48, z: 24, w: 10, d: 6 };
const SHED = { x: -24, z: 2 };
const CHAPEL = { x: 0, z: -52 };
const ORCH = { x: 4, z: 52 };
// the three towers the player must wake (north-east forest edge, north-west, south-east)
const TOWERS = [{ x: 52, z: -52 }, { x: -57, z: -59 }, { x: 52, z: 50 }];
const FLATS = [
  { x: POOL.x, z: POOL.z, y: 0, r1: 6, r2: 11 },
  { x: POOL2.x, z: POOL2.z, y: 0.4, r1: 7, r2: 12 },
  { x: SHED.x, z: SHED.z, y: 0.3, r1: 5, r2: 9 },
  { x: CHAPEL.x, z: CHAPEL.z, y: 0.2, r1: 13, r2: 19 },
  { x: ORCH.x, z: ORCH.z, y: 0, r1: 15, r2: 21 },
  ...TOWERS.map((t) => ({ x: t.x, z: t.z, y: 0.3, r1: 10, r2: 15 })),
];

function heightFn(x, z) {
  let h = 1.3 * Math.sin(x * 0.03 + 0.5) * Math.cos(z * 0.027 - 0.3)
    + 0.9 * Math.sin(x * 0.09 + 1.3) * Math.cos(z * 0.075 + 0.4)
    + 0.5 * Math.sin(x * 0.19 + z * 0.13 + 2.1)
    + 0.25 * Math.sin(z * 0.31 - x * 0.07)
    + 0.12 * Math.sin(x * 0.53 + z * 0.41);
  h -= 0.25 * (1 - smooth(0, 2.5, pathDist(x, z))); // paths are slight ruts
  const e = Math.max(Math.abs(x), Math.abs(z)) - (HALF - 5);
  if (e > 0) h += e * e * 0.09; // rises into the surrounding hills
  for (const f of FLATS) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r2) h = f.y + (h - f.y) * smooth(f.r1, f.r2, d);
  }
  return h;
}

// ground colour: reddish field, mud paths, blood around the pools, stone in the chapel yard
const PATH_C = new THREE.Color(0.55, 0.36, 0.3);
const BLOOD_C = new THREE.Color(0.55, 0.12, 0.1);
const STONE_C = new THREE.Color(0.5, 0.36, 0.34);
function groundColor(x, z, c) {
  const n = 0.5 + 0.5 * Math.sin(x * 0.7 + Math.sin(z * 0.5) * 2) * Math.cos(z * 0.6);
  c.setRGB(0.95 + n * 0.25, 0.32 + n * 0.08, 0.3); // reddish field
  c.lerp(PATH_C, 1 - smooth(1.2, 2.8, pathDist(x, z)));
  for (const pl of [POOL, POOL2]) c.lerp(BLOOD_C, (1 - smooth(4, 9, Math.hypot(x - pl.x, z - pl.z))) * 0.7);
  c.lerp(STONE_C, (1 - smooth(8, 14, Math.hypot(x - CHAPEL.x, z - CHAPEL.z))) * 0.6); // chapel yard
}

export function buildRedField(scene, world) {
  world.heightFn = heightFn;
  scene.fog = new THREE.FogExp2(0x1c0404, 0.032);
  scene.background = new THREE.Color(0x1c0404);
  scene.add(new THREE.HemisphereLight(0x8a1a14, 0x1a0505, 0.55));

  buildTerrain(scene, HALF, heightFn, groundColor);
  const { backdrop, skyMat } = buildBackdrop(scene);
  const embers = buildEmbers(scene);

  const kit = new PropKit(scene, world);
  const rnd = kit.rnd;
  const R = (a, b) => a + rnd() * (b - a);

  // ---- placement bookkeeping: reserved areas + spacing between solid props
  const reserved = [
    [POOL.x, POOL.z, 7], [POOL2.x, POOL2.z, 8], [SHED.x, SHED.z, 6], [CHAPEL.x, CHAPEL.z, 13],
    [ORCH.x, ORCH.z, 16], [-58, 56, 6], [30, -30, 6], ...TOWERS.map((t) => [t.x, t.z, 11]),
  ];
  const solids = [];
  const clear = (x, z, r, spacing = 1) => {
    if (Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3) return false;
    for (const [rx, rz, rr] of reserved) if ((x - rx) ** 2 + (z - rz) ** 2 < (rr + r) ** 2) return false;
    for (const [sx, sz, sr] of solids) if ((x - sx) ** 2 + (z - sz) ** 2 < (sr + r + spacing) ** 2) return false;
    return true;
  };
  const claim = (x, z, r) => solids.push([x, z, r]);
  const scatter = (n, area, r, spacing, place, tries = 30) => {
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < tries; t++) {
        const x = R(area[0], area[1]), z = R(area[2], area[3]);
        if (!clear(x, z, r, spacing) || pathDist(x, z) < r + 1.2) continue;
        claim(x, z, r);
        place(x, z);
        break;
      }
    }
  };

  // ---- invisible boundary walls
  world.addCollider(-HALF - 1, -10, -HALF - 1, HALF + 1, 30, -HALF);
  world.addCollider(-HALF - 1, -10, HALF, HALF + 1, 30, HALF + 1);
  world.addCollider(-HALF - 1, -10, -HALF, -HALF, 30, HALF);
  world.addCollider(HALF, -10, -HALF, HALF + 1, 30, HALF);

  // ---- boundary rocks (visual ring + cliffs on the east), pushed just outside the invisible walls
  for (let t = -HALF; t <= HALF; t += 6) {
    const j = () => (rnd() - 0.5) * 3;
    for (const side of [0, 1, 2, 3]) {
      const s = side === 3 ? 4 + rnd() * 3 : 3 + rnd() * 3;
      const h = side === 3 ? 7 + rnd() * 6 : 3 + rnd() * 4;
      const off = HALF + s * 1.15;
      const [x, z] = [[t + j(), -off], [t + j(), off], [-off, t + j()], [off, t + j()]][side];
      kit.boulder(x, z, s, h, s, rnd() * 6, false);
    }
  }

  // =================================================================== centre (the original map)
  kit.pool(POOL.x, POOL.z, POOL.w, POOL.d);
  kit.beachBall(POOL.x - 5.2, POOL.z - 3.4);
  kit.shed(SHED.x, SHED.z);
  kit.piano(-7, 3, 0.7);
  claim(-7, 3, 1.5);
  // the pair at z=-6 leaves a gap only the player fits through
  const rocks = [
    [-19.5, -6, 2.0, 2.2, 2.0], [-13.8, -6, 2.0, 2.0, 2.0],
    [12, -14, 2.6, 2.8, 2.2], [15.5, -16.5, 1.6, 1.5, 1.6],
    [21, 2, 2.2, 2.6, 2.8], [-5, -20, 2.4, 2.0, 2.0],
    [-25, 16, 2.8, 3.0, 2.4], [-21.8, 19.5, 1.4, 1.3, 1.5],
    [26, -24, 2.5, 2.4, 2.5], [8, 24, 2.2, 2.5, 2.0], [-10, 26, 1.8, 1.8, 2.2],
    [24, 12, 1.5, 1.4, 1.5], [0, -28, 2.2, 2.6, 2.0], [-28, -24, 2.0, 2.0, 2.4],
  ];
  for (const [x, z, sx, sy, sz] of rocks) { kit.boulder(x, z, sx, sy, sz, rnd() * 6); claim(x, z, sx * 1.1); }
  const crosses = [
    [-18, -18], [-8, -12], [3, -8], [14, -4], [-14, 8], [-3, 12], [16, 18], [-17, 26], [2, 30],
    [26, -12], [28, 4], [-30, -8], [-12, -28], [18, -28], [30, 20], [-30, 28],
  ];
  for (const [x, z] of crosses) { kit.cross(x, z, R(2.8, 4.4), rnd() * Math.PI * 2, (rnd() - 0.5) * 0.25, rnd() < 0.85); claim(x, z, 0.8); }

  // =================================================================== north: chapel + graveyard
  kit.chapel(CHAPEL.x, CHAPEL.z);
  for (let z = -65; z <= -41; z += 3.4) {
    for (let x = -32; x <= 32; x += 3) {
      if (Math.abs(x) < 9) continue; // chapel + yard
      if (rnd() < 0.3) continue;
      const jx = x + (rnd() - 0.5) * 1.2, jz = z + (rnd() - 0.5) * 1.0;
      if (!clear(jx, jz, 0.5, 0.4) || pathDist(jx, jz) < 1.5) continue;
      claim(jx, jz, 0.5);
      if (rnd() < 0.55) kit.tombstone(jx, jz, (rnd() - 0.5) * 0.5);
      else kit.cross(jx, jz, R(2.2, 3.2), (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.3, rnd() < 0.5);
    }
  }
  kit.fence(-34, -67, 34, -67);
  kit.fence(-34, -38, -5, -38);
  kit.fence(5, -38, 34, -38);
  kit.fence(-34, -67, -34, -38);
  kit.fence(34, -67, 34, -38);
  for (const [x, z] of [[-28, -44], [24, -60], [-14, -62], [29, -45], [-24, -56]]) {
    if (clear(x, z, 0.6, 0.5)) { kit.deadTree(x, z, R(6, 9), rnd() < 0.6); claim(x, z, 0.6); }
  }

  // =================================================================== east: dead forest
  scatter(60, [38, 66, -46, 30], 0.6, 3.6, (x, z) => kit.deadTree(x, z, R(5.5, 10), rnd() < 0.3));
  scatter(6, [40, 64, -40, 25], 2.2, 2, (x, z) => kit.boulder(x, z, R(1.6, 2.6), R(1.4, 2.6), R(1.6, 2.6), rnd() * 6));

  // =================================================================== south: orchestra clearing
  {
    const { x: cx, z: cz } = ORCH;
    for (const [r0, n] of [[6, 14], [8, 18], [10, 22]]) {
      for (let i = 0; i < n; i++) {
        const a = Math.PI * 0.15 + (i / n) * Math.PI * 1.7; // open towards the north (the path)
        if (rnd() < 0.2) continue;
        const x = cx + Math.sin(a) * r0, z = cz + Math.cos(a) * r0;
        const face = Math.atan2(cx - x, cz - z);
        kit.chair(x, z, face + (rnd() - 0.5) * 0.4, rnd() < 0.25);
        if (rnd() < 0.5) kit.musicStand(cx + Math.sin(a) * (r0 - 0.8), cz + Math.cos(a) * (r0 - 0.8), face + Math.PI);
      }
    }
    kit.uprightPiano(cx - 12, cz + 2, Math.PI / 2); claim(cx - 12, cz + 2, 1);
    kit.uprightPiano(cx + 11, cz + 6, -Math.PI / 2 - 0.3); claim(cx + 11, cz + 6, 1);
    kit.piano(cx + 2, cz + 13, 2.6); claim(cx + 2, cz + 13, 1.6);
    kit.drumKit(cx - 5, cz + 12.5, Math.PI); kit.drumKit(cx + 7, cz + 11, Math.PI + 0.5);
    kit.gong(cx - 9, cz + 11, Math.PI - 0.6);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.25 + (i / 8) * Math.PI * 1.5;
      const x = cx + Math.sin(a) * R(14, 16), z = cz + Math.cos(a) * R(14, 16);
      kit.speakerStack(x, z, Math.atan2(cx - x, cz - z), 2 + Math.floor(rnd() * 2));
      claim(x, z, 1.2);
    }
    for (let i = 0; i < 5; i++) kit.instrument('cello', cx + R(-12, 12), cz + R(-4, 12), rnd() * 6, true);
    for (let i = 0; i < 4; i++) kit.bassDrum(cx + R(-13, 13), cz + R(-3, 14), rnd() * 6);
  }

  // =================================================================== west: rock canyon + second pool
  for (const x of [-56, -45]) {
    let z = -42;
    let k = 0;
    while (z < -6) {
      const s = R(2.8, 3.6);
      kit.boulder(x + R(-1, 1), z, s, R(2.8, 3.4), s, rnd() * 6); // tops stay within the monster's reach
      claim(x, z, s * 1.2);
      // mostly tight gaps (player only), every third a wide one (monster passage)
      z += s * 2.05 + (++k % 3 === 0 ? 4.5 : R(0.9, 1.6));
    }
  }
  kit.pool(POOL2.x, POOL2.z, POOL2.w, POOL2.d);
  scatter(10, [-68, -38, -66, 10], 1.2, 2, (x, z) => kit.boulder(x, z, R(1.2, 2.4), R(1.2, 2.4), R(1.2, 2.4), rnd() * 6));

  // =================================================================== corners & general scatter
  // south-east junkyard
  for (let i = 0; i < 7; i++) {
    const x = R(40, 64), z = R(44, 64);
    if (!clear(x, z, 1.2, 1.5)) continue;
    claim(x, z, 1.2);
    kit.speakerStack(x, z, rnd() * 6, 1 + Math.floor(rnd() * 3));
  }
  scatter(3, [40, 64, 44, 64], 1.6, 2, (x, z) => kit.uprightPiano(x, z, rnd() * 6));
  for (let i = 0; i < 8; i++) kit.bassDrum(R(38, 66), R(40, 66), rnd() * 6);
  kit.fence(38, 40, 66, 40);
  // extra crosses, rocks and instruments everywhere
  scatter(26, [-66, 66, -66, 66], 0.8, 3, (x, z) => kit.cross(x, z, R(2.6, 4.4), rnd() * 6, (rnd() - 0.5) * 0.3, rnd() < 0.8));
  scatter(26, [-66, 66, -66, 66], 2.4, 3, (x, z) => kit.boulder(x, z, R(1.4, 2.8), R(1.2, 2.8), R(1.4, 2.8), rnd() * 6));
  const types = ['guitar', 'guitar', 'violin', 'cello'];
  for (let i = 0; i < 45; i++) {
    const x = R(-66, 66), z = R(-66, 66);
    if (!clear(x, z, 0.4, 0)) continue;
    const t = types[Math.floor(rnd() * types.length)];
    kit.instrument(t, x, z, rnd() * 6, t === 'cello' ? rnd() < 0.7 : rnd() < 0.25);
  }
  scatter(10, [-66, 66, -66, 66], 0.6, 3, (x, z) => kit.deadTree(x, z, R(5, 8), rnd() < 0.4));
  for (let i = 0; i < 10; i++) {
    const x = R(-64, 64), z = R(-64, 64);
    if (clear(x, z, 0.5, 0)) kit.bassDrum(x, z, rnd() * 6);
  }

  // ---- grass: tall hiding patches + short field grass
  const patches = [
    { x: -12, z: -16, r: 4.2 }, { x: 16, z: -3, r: 3.6 }, { x: -20, z: 22, r: 4 },
    { x: 18, z: 20, r: 3.4 }, { x: -3, z: 17, r: 4 }, { x: 28, z: -6, r: 3.2 },
    { x: -50, z: 50, r: 4.5 }, { x: -60, z: 36, r: 3.8 }, { x: -40, z: 12, r: 3.6 },
    { x: -62, z: -14, r: 3.4 }, { x: -38, z: -34, r: 4 }, { x: -20, z: -46, r: 3.2 },
    { x: 20, z: -52, r: 3.4 }, { x: 46, z: -20, r: 4.2 }, { x: 58, z: 6, r: 3.8 },
    { x: 50, z: -58, r: 3.6 }, { x: 28, z: 40, r: 4 }, { x: -18, z: 44, r: 4.2 },
    { x: 22, z: 62, r: 3.4 }, { x: -34, z: 62, r: 3.6 }, { x: 36, z: 12, r: 3.2 },
  ];
  kit.grass(patches.map((p) => ({ ...p, count: Math.round(p.r * p.r * 55), hMin: 1.0, hMax: 1.6 })), 0x9a1414, true);
  const inRect = (x, z, P, m) => Math.abs(x - P.x) < P.w / 2 + m && Math.abs(z - P.z) < P.d / 2 + m;
  const inChapel = (x, z) => Math.abs(x - CHAPEL.x) < 6.5 && Math.abs(z - CHAPEL.z) < 10.5;
  const inShed = (x, z) => Math.abs(x - SHED.x) < 4 && Math.abs(z - SHED.z) < 3.3;
  kit.grass([{
    x: 0, z: 0, r: HALF + 3, square: true, count: 105000, hMin: 0.2, hMax: 0.6,
    avoid: (x, z) => pathDist(x, z) < 1.6 || inRect(x, z, POOL, 0.6) || inRect(x, z, POOL2, 0.6) || inShed(x, z) || inChapel(x, z),
  }], 0x7a1010, false);

  // ---- red broad-leaf plants
  const plants = [];
  for (let i = 0; i < 260; i++) {
    let x, z;
    if (rnd() < 0.45) {
      const t = (rnd() - 0.5) * 2 * HALF, side = Math.floor(rnd() * 4), d = HALF - 1 - rnd() * 5;
      [x, z] = [[t, -d], [t, d], [-d, t], [d, t]][side];
    } else {
      x = (rnd() - 0.5) * 2 * (HALF - 4); z = (rnd() - 0.5) * 2 * (HALF - 4);
      if (pathDist(x, z) < 2 || inRect(x, z, POOL, 1) || inRect(x, z, POOL2, 1) || inShed(x, z) || inChapel(x, z) ||
        Math.hypot(x - ORCH.x, z - ORCH.z) < 13) continue;
    }
    plants.push([x, z, R(0.8, 1.7)]);
  }
  kit.plants(plants);

  // ---- the three towers
  const towerSites = TOWERS.map((t) => kit.tower(t.x, t.z));

  // merge static props into chunked draw calls
  const chunks = kit.bake();

  // ---- navigation for the monster (radius 1.6 m); it crashes through anything smaller than the player
  world.markSmall(1.8, 1.0);
  world.buildNav(-HALF, -HALF, HALF, HALF, 1, 1.6, 0.9, 3.6);

  return {
    spawn: new THREE.Vector3(-58, heightFn(-58, 56), 56),
    spawnYaw: -Math.PI * 0.25, // facing the centre
    monsterSpawn: new THREE.Vector3(30, 0, -30),
    towerSites,
    bounds: HALF,
    stats: { chunks, colliders: world.colliders.length },
    setQuality: (q) => kit.setQuality(q),
    update(dt, time, camera) {
      backdrop.position.copy(camera.position);
      skyMat.uniforms.uTime.value = time;
      embers.update(dt, time, camera.position);
      kit.update(time, camera.position);
    },
  };
}
