import * as THREE from 'three';
import { PropKit } from '../props.js';
import { mulberry32 } from '../world.js';
import { buildTerrain, buildBackdrop, buildEmbers, makePathDist, makePlacer, smooth, bakeField } from './common.js';
import { LANDMARKS } from './landmarks.js';
import { deepPockets } from './mapcheck.js';

// Seeded random Red Field. Same size, sky, fog and prop budget as the classic map:
//   1. layout: spawn on an edge, 3 towers >= 60 m apart, 2 blood pools covering
//      the towers, 3 random landmarks
//   2. mud paths: minimum spanning tree between all of them, with wobbly midpoints
//   3. terrain: rolling hills with seeded phases, flattened under set pieces,
//      baked into a heightfield (cheap lookups at runtime)
//   4. props: landmarks, filler up to a fixed density budget, tall grass spread
//      evenly (farthest-point), then pockets the monster can't reach are opened up
//   5. the monster spawns far away, out of sight of the player
// The same seed always builds the same map.

const HALF = 70;
const PATH_C = new THREE.Color(0.55, 0.36, 0.3);
const BLOOD_C = new THREE.Color(0.55, 0.12, 0.1);
const STONE_C = new THREE.Color(0.5, 0.36, 0.34);
const DENSITY = 335;       // collider budget before the towers (classic map: ~426 in total)
const GRASS_PATCHES = 27;  // tall hiding grass

export function buildGenerated(scene, world, seed) {
  const timings = {}, t0 = performance.now();
  let tLast = t0;
  const mark = (name) => { const t = performance.now(); timings[name] = Math.round(t - tLast); tLast = t; };
  const rnd = mulberry32((seed * 2654435761) >>> 0); // layout stream (props use kit.rnd)
  const R = (a, b) => a + rnd() * (b - a);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const inside = (p, m) => Math.abs(p.x) < HALF - m && Math.abs(p.z) < HALF - m;

  // ------------------------------------------------------------------ 1. layout
  const side = Math.floor(rnd() * 4), t = R(-45, 45);
  const spawn = [{ x: t, z: 58 }, { x: t, z: -58 }, { x: 58, z: t }, { x: -58, z: t }][side];
  spawn.yaw = Math.atan2(spawn.x, spawn.z); // face the centre (player yaw: forward = -sin, -cos)

  // towers: at least 60 m apart, 45 m from the spawn (best spread of up to 200 tries)
  let towers = null, bestScore = -1;
  for (let i = 0; i < 200; i++) {
    const set = [0, 1, 2].map(() => ({ x: R(-58, 58), z: R(-58, 58) }));
    if (set.some((p) => dist(p, spawn) < 45)) continue;
    const score = Math.min(dist(set[0], set[1]), dist(set[1], set[2]), dist(set[0], set[2]));
    if (score > bestScore) { bestScore = score; towers = set; }
    if (score >= 75) break;
  }

  const occupied = [[spawn, 8], ...towers.map((tw) => [tw, 13])];
  const free = (p, r) => occupied.every(([o, orr]) => dist(o, p) > orr + r);
  const claimArea = (p, r) => occupied.push([p, r]);

  // blood pools: two (a smaller third if needed), placed so every tower has one within ~55 m
  const pools = [];
  const poolReach = (ps) => Math.max(...towers.map((tw) => Math.min(...ps.map((p) => dist(p, tw)))));
  for (let n = 0; n < 4; n++) {
    if (n >= 2 && poolReach(pools) <= 55) break; // extra (smaller) pools only when two can't cover the towers
    let best = null;
    for (let i = 0; i < 160; i++) {
      // half the candidates anywhere, half in a ring just outside a tower's clearing
      const tw = towers[i % 3], a = R(0, Math.PI * 2), rr = R(23, 42);
      const p = i % 2 ? { x: tw.x + Math.cos(a) * rr, z: tw.z + Math.sin(a) * rr } : { x: R(-56, 56), z: R(-56, 56) };
      if (!inside(p, 12) || !free(p, 9)) continue;
      const score = poolReach([...pools, p]);
      if (!best || score < best.score) best = { p, score };
    }
    if (!best) continue;
    best.p.w = n < 2 ? R(8, 10) : R(6, 7.5); best.p.d = n < 2 ? R(5, 6.5) : R(4, 5);
    pools.push(best.p); claimArea(best.p, 9);
  }

  // landmarks: 3 of the 5 kinds (if one doesn't fit, the next kind gets a go)
  const kinds = Object.keys(LANDMARKS);
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  const landmarks = [];
  for (const type of kinds) {
    if (landmarks.length === 3) break;
    const def = LANDMARKS[type];
    for (let i = 0; i < 150; i++) {
      const p = { type, x: R(-62, 62), z: R(-62, 62), rot: rnd() * Math.PI * 2, axis: rnd() < 0.5 ? 'x' : 'z' };
      if (!inside(p, def.r * 0.8 + 2) || !free(p, def.r * 0.85)) continue;
      landmarks.push(p); claimArea(p, def.r * 0.85);
      break;
    }
  }

  // ------------------------------------------------------------------ 2. paths (MST, Prim)
  const nodes = [spawn, ...towers, ...pools];
  for (const L of landmarks) {
    const ents = LANDMARKS[L.type].entries(L);
    if (ents.length) for (const [x, z] of ents) nodes.push({ x, z });
    else nodes.push({ x: L.x, z: L.z });
  }
  const inTree = [0], paths = [];
  while (inTree.length < nodes.length) {
    let best = null;
    for (const a of inTree) {
      for (let b = 0; b < nodes.length; b++) {
        if (inTree.includes(b)) continue;
        const d = dist(nodes[a], nodes[b]);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    inTree.push(best.b);
    const A = nodes[best.a], B = nodes[best.b];
    const pts = [[A.x, A.z]];
    const mids = 2 + Math.floor(rnd() * 2);
    const nx = -(B.z - A.z) / best.d, nz = (B.x - A.x) / best.d;
    for (let k = 1; k <= mids; k++) {
      const f = k / (mids + 1), off = R(-0.18, 0.18) * best.d;
      const x = Math.max(-HALF + 4, Math.min(HALF - 4, A.x + (B.x - A.x) * f + nx * off));
      const z = Math.max(-HALF + 4, Math.min(HALF - 4, A.z + (B.z - A.z) * f + nz * off));
      pts.push([x, z]);
    }
    pts.push([B.x, B.z]);
    paths.push(pts);
  }
  // exact polyline distance is costly and asked ~300k times while building: bake it (1 m grid)
  const pathDist = bakeField(makePathDist(paths), HALF + 46, 1);

  mark('layout');
  // ------------------------------------------------------------------ 3. terrain
  const ph = Array.from({ length: 7 }, () => R(0, Math.PI * 2));
  const fq = Array.from({ length: 4 }, () => R(0.85, 1.15));
  const hill = R(0.8, 1.35);
  const flats = [
    ...towers.map((tw) => ({ x: tw.x, z: tw.z, y: 0.3, r1: 10, r2: 15 })),
    ...pools.map((p) => ({ x: p.x, z: p.z, y: 0, r1: 6.5, r2: 11.5 })),
    { x: spawn.x, z: spawn.z, y: 0.2, r1: 4, r2: 9 },
    ...landmarks.filter((L) => LANDMARKS[L.type].flat).map((L) => ({ x: L.x, z: L.z, ...LANDMARKS[L.type].flat })),
  ];
  const rawHeight = (x, z) => {
    let h = hill * (1.3 * Math.sin(x * 0.03 * fq[0] + ph[0]) * Math.cos(z * 0.027 * fq[1] + ph[1])
      + 0.9 * Math.sin(x * 0.09 * fq[2] + ph[2]) * Math.cos(z * 0.075 * fq[3] + ph[3]))
      + 0.5 * Math.sin(x * 0.19 + z * 0.13 + ph[4])
      + 0.25 * Math.sin(z * 0.31 - x * 0.07 + ph[5])
      + 0.12 * Math.sin(x * 0.53 + z * 0.41 + ph[6]);
    h -= 0.25 * (1 - smooth(0, 2.5, pathDist(x, z)));
    const e = Math.max(Math.abs(x), Math.abs(z)) - (HALF - 5);
    if (e > 0) h += e * e * 0.09;
    for (const f of flats) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r2) h = f.y + (h - f.y) * smooth(f.r1, f.r2, d);
    }
    return h;
  };
  const heightFn = bakeField(rawHeight, HALF + 46, 0.5);
  mark('bake');
  const yards = landmarks.filter((L) => LANDMARKS[L.type].stoneYard);
  const groundColor = (x, z, c) => {
    const n = 0.5 + 0.5 * Math.sin(x * 0.7 + Math.sin(z * 0.5) * 2) * Math.cos(z * 0.6);
    c.setRGB(0.95 + n * 0.25, 0.32 + n * 0.08, 0.3);
    c.lerp(PATH_C, 1 - smooth(1.2, 2.8, pathDist(x, z)));
    for (const p of pools) c.lerp(BLOOD_C, (1 - smooth(4, 9, Math.hypot(x - p.x, z - p.z))) * 0.7);
    for (const y of yards) c.lerp(STONE_C, (1 - smooth(8, 14, Math.hypot(x - y.x, z - y.z))) * 0.6);
  };

  world.heightFn = heightFn;
  scene.fog = new THREE.FogExp2(0x1c0404, 0.032);
  scene.background = new THREE.Color(0x1c0404);
  scene.add(new THREE.HemisphereLight(0x8a1a14, 0x1a0505, 0.55));
  buildTerrain(scene, HALF, heightFn, groundColor);
  const { backdrop, skyMat } = buildBackdrop(scene);
  const embers = buildEmbers(scene);
  mark('terrain');

  // ------------------------------------------------------------------ 4. props
  const kit = new PropKit(scene, world, seed);
  const krnd = kit.rnd;
  const reserved = [
    [spawn.x, spawn.z, 6],
    ...towers.map((tw) => [tw.x, tw.z, 11]),
    ...pools.map((p) => [p.x, p.z, Math.max(p.w, p.d) / 2 + 2]),
  ];
  const { R: KR, clear, claim, scatter, solids } = makePlacer({ rnd: krnd, half: HALF, reserved, pathDist });

  // invisible walls + the rock ring just outside them
  world.addCollider(-HALF - 1, -10, -HALF - 1, HALF + 1, 30, -HALF);
  world.addCollider(-HALF - 1, -10, HALF, HALF + 1, 30, HALF + 1);
  world.addCollider(-HALF - 1, -10, -HALF, -HALF, 30, HALF);
  world.addCollider(HALF, -10, -HALF, HALF + 1, 30, HALF);
  for (let u = -HALF; u <= HALF; u += 6) {
    const j = () => (krnd() - 0.5) * 3;
    for (const s4 of [0, 1, 2, 3]) {
      const s = 3 + krnd() * 3, h = 3 + krnd() * 5;
      const off = HALF + s * 1.15;
      const [x, z] = [[u + j(), -off], [u + j(), off], [-off, u + j()], [off, u + j()]][s4];
      kit.boulder(x, z, s, h, s, krnd() * 6, false);
    }
  }

  // blood pools (the first gets the old shed and piano next to it)
  pools.forEach((p, i) => {
    kit.pool(p.x, p.z, p.w, p.d);
    if (i === 0) {
      kit.beachBall(p.x - p.w / 2 - 1, p.z - p.d / 2 + 0.5);
      for (let k = 0; k < 20; k++) {
        const a = krnd() * Math.PI * 2, sx = p.x + Math.cos(a) * 15, sz = p.z + Math.sin(a) * 15;
        if (!clear(sx, sz, 5.5, 1) || pathDist(sx, sz) < 5) continue;
        kit.shed(sx, sz); claim(sx, sz, 5.5);
        p.shed = { x: sx, z: sz };
        break;
      }
      const px = p.x + p.w / 2 + 3, pz = p.z;
      if (clear(px, pz, 1.5, 0.5)) { kit.piano(px, pz, 0.7); claim(px, pz, 1.5); }
    }
  });

  // landmarks, then keep the filler out of them
  const ctx = { kit, R: KR, rnd: krnd, clear, claim, pathDist, reserved };
  for (const L of landmarks) {
    L.r = LANDMARKS[L.type].r;
    LANDMARKS[L.type].build(ctx, L);
  }
  for (const L of landmarks) reserved.push([L.x, L.z, L.r]);

  // filler in the classic proportions until the density budget is reached
  // (so maps with sparse landmarks don't end up emptier)
  const A = [-66, 66, -66, 66];
  const types = ['guitar', 'guitar', 'violin', 'cello'];
  for (let round = 0; round < 60 && world.colliders.length < DENSITY; round++) {
    scatter(3, A, 0.8, 3, (x, z) => kit.cross(x, z, KR(2.6, 4.4), krnd() * 6, (krnd() - 0.5) * 0.3, krnd() < 0.8));
    scatter(3, A, 2.4, 3, (x, z) => kit.boulder(x, z, KR(1.4, 2.8), KR(1.2, 2.8), KR(1.4, 2.8), krnd() * 6));
    scatter(1, A, 0.6, 3, (x, z) => kit.deadTree(x, z, KR(5, 8), krnd() < 0.4));
    for (let i = 0; i < 4; i++) {
      const x = KR(-66, 66), z = KR(-66, 66);
      if (!clear(x, z, 0.4, 0)) continue;
      const ty = types[Math.floor(krnd() * types.length)];
      kit.instrument(ty, x, z, krnd() * 6, ty === 'cello' ? krnd() < 0.7 : krnd() < 0.25);
    }
    const x = KR(-64, 64), z = KR(-64, 64);
    if (clear(x, z, 0.5, 0)) kit.bassDrum(x, z, krnd() * 6);
  }

  // tall hiding grass spread evenly: each patch goes where cover is furthest away
  const inPool = (x, z, m) => pools.some((p) => Math.abs(x - p.x) < p.w / 2 + m && Math.abs(z - p.z) < p.d / 2 + m);
  const inBuilding = (x, z) => yards.some((y) => Math.abs(x - y.x) < 6.5 && Math.abs(z - y.z) < 10.5)
    || pools.some((p) => p.shed && Math.abs(x - p.shed.x) < 4 && Math.abs(z - p.shed.z) < 3.3);
  const nearSolid = (x, z, r) => solids.some(([sx, sz, sr]) => (x - sx) ** 2 + (z - sz) ** 2 < (sr + r) ** 2);
  const cands = [];
  for (let x = -62; x <= 62; x += 4) {
    for (let z = -62; z <= 62; z += 4) {
      const cx = x + KR(-1.5, 1.5), cz = z + KR(-1.5, 1.5);
      if (pathDist(cx, cz) < 3.6 || inPool(cx, cz, 2) || inBuilding(cx, cz) || nearSolid(cx, cz, 1.2)) continue;
      if (Math.hypot(cx - spawn.x, cz - spawn.z) < 7 || towers.some((tw) => Math.hypot(cx - tw.x, cz - tw.z) < 11)) continue;
      cands.push({ x: cx, z: cz, d: Infinity });
    }
  }
  const patches = [];
  while (patches.length < GRASS_PATCHES && cands.length) {
    let pick = 0;
    if (!patches.length) pick = Math.floor(krnd() * cands.length);
    else for (let i = 1; i < cands.length; i++) if (cands[i].d > cands[pick].d) pick = i;
    const c = cands.splice(pick, 1)[0];
    const p = { x: c.x, z: c.z, r: Math.max(2.6, Math.min(KR(3.2, 4.5), pathDist(c.x, c.z) - 1)) };
    patches.push(p);
    for (const q of cands) q.d = Math.min(q.d, Math.hypot(q.x - p.x, q.z - p.z));
  }
  kit.grass(patches.map((p) => ({ ...p, count: Math.round(p.r * p.r * 55), hMin: 1.0, hMax: 1.6 })), 0x9a1414, true);
  kit.grass([{
    x: 0, z: 0, r: HALF + 3, square: true, count: 105000, hMin: 0.2, hMax: 0.6,
    avoid: (x, z) => pathDist(x, z) < 1.6 || inPool(x, z, 0.6) || inBuilding(x, z),
  }], 0x7a1010, false);

  const plants = [];
  const orch = landmarks.find((L) => L.type === 'orchestra');
  for (let i = 0; i < 260; i++) {
    let x, z;
    if (krnd() < 0.45) {
      const u = (krnd() - 0.5) * 2 * HALF, s4 = Math.floor(krnd() * 4), d = HALF - 1 - krnd() * 5;
      [x, z] = [[u, -d], [u, d], [-d, u], [d, u]][s4];
    } else {
      x = (krnd() - 0.5) * 2 * (HALF - 4); z = (krnd() - 0.5) * 2 * (HALF - 4);
      if (pathDist(x, z) < 2 || inPool(x, z, 1) || inBuilding(x, z) || (orch && Math.hypot(x - orch.x, z - orch.z) < 13)) continue;
    }
    plants.push([x, z, KR(0.8, 1.7)]);
  }
  kit.plants(plants);

  const towerSites = towers.map((tw) => kit.tower(tw.x, tw.z));
  mark('props');

  // ------------------------------------------------------------------ navigation + fairness
  // open up pockets the monster can't reach (a player could hide there forever):
  // remove the nearest boulder (or speaker stack) around each pocket until none are left
  const buildNav = () => { world.markSmall(1.8, 1.0); world.buildNav(-HALF, -HALF, HALF, HALF, 1, 1.6, 0.9, 3.6); };
  buildNav();
  let opened = 0;
  for (let pass = 0; pass < 8; pass++) {
    const pockets = deepPockets(world);
    if (!pockets.length) break;
    for (const pk of pockets) {
      let best = null, bestD = Infinity;
      for (const b of world.colliders) {
        const boulder = kit.boulderCols.has(b);
        if (b.small || (!boulder && (b.max.y - b.min.y > 6 || b.max.x - b.min.x > 6 || b.max.z - b.min.z > 6))) continue; // not walls
        const cx = Math.max(b.min.x, Math.min(pk.x, b.max.x)), cz = Math.max(b.min.z, Math.min(pk.z, b.max.z));
        const d = Math.hypot(cx - pk.x, cz - pk.z) - (kit.boulderCols.has(b) ? 1 : 0); // prefer boulders
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best) { kit.removeCollider(best); opened++; }
    }
    buildNav();
  }
  mark('nav');
  const chunks = kit.bake();
  mark('merge');

  // the monster starts far away, walkable, and out of the player's sight
  const eye = (p, h) => new THREE.Vector3(p.x, heightFn(p.x, p.z) + h, p.z);
  let monster = null;
  for (let i = 0; i < 120 && !monster; i++) {
    const p = { x: R(-56, 56), z: R(-56, 56) };
    if (dist(p, spawn) < 60 || towers.some((tw) => dist(tw, p) < 18) || !world.walkable(p.x, p.z)) continue;
    if (i < 100 && world.lineOfSight(eye(p, 2.5), eye(spawn, 1.6))) continue;
    monster = p;
  }
  monster ||= { x: -spawn.x * 0.9, z: -spawn.z * 0.9 };

  // ------------------------------------------------------------------ validation
  // the monster must be able to reach every tower circle and the player's spawn
  const reach = (to) => {
    const path = world.findPath(new THREE.Vector3(monster.x, 0, monster.z), new THREE.Vector3(to.x, 0, to.z));
    return !!path && path.length > 0 && Math.hypot(path.at(-1).x - to.x, path.at(-1).z - to.z) < 6;
  };
  const targets = [spawn, ...towers.map((tw) => {
    const d = dist(tw, spawn); // a point on the rune circle facing the spawn
    return { x: tw.x + ((spawn.x - tw.x) / d) * 5, z: tw.z + ((spawn.z - tw.z) / d) * 5 };
  })];
  const valid = world.walkable(spawn.x, spawn.z) && targets.every(reach);

  // ------------------------------------------------------------------ intro camera hints
  const far = towers.reduce((b, tw, i) => (dist(tw, spawn) > dist(towers[b], spawn) ? i : b), 0);
  let walk = null; // the beast walks along the longest path segment
  for (const p of paths) {
    for (let i = 0; i < p.length - 1; i++) {
      const len = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
      if (!walk || len > walk.len) walk = { a: p[i], b: p[i + 1], len };
    }
  }
  const wyaw = Math.atan2(walk.b[0] - walk.a[0], walk.b[1] - walk.a[1]);
  const mid = [(walk.a[0] + walk.b[0]) / 2, (walk.a[1] + walk.b[1]) / 2];
  const cdir = [-spawn.x / 58, -spawn.z / 58]; // spawn -> centre
  const intro = {
    flyFrom: [spawn.x - cdir[0] * 6, 24, spawn.z - cdir[1] * 6],
    flyTo: [spawn.x + cdir[0] * 22, 16, spawn.z + cdir[1] * 22],
    look: [towers[far].x, 4, towers[far].z],
    beast: { x: mid[0] - Math.sin(wyaw) * 6, z: mid[1] - Math.cos(wyaw) * 6, yaw: wyaw },
    tower: far,
  };

  return {
    spawn: new THREE.Vector3(spawn.x, heightFn(spawn.x, spawn.z), spawn.z),
    spawnYaw: spawn.yaw,
    monsterSpawn: new THREE.Vector3(monster.x, 0, monster.z),
    towerSites,
    bounds: HALF,
    seed,
    valid,
    intro,
    pathDist,
    timings: { ...timings, total: Math.round(performance.now() - t0) },
    layout: { spawn, towers, monster, pools, landmarks: landmarks.map((L) => L.type), paths: paths.length, grassPatches: patches.length, opened },
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
