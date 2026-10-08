import * as THREE from 'three';
import { PropKit } from '../props.js';
import { mulberry32 } from '../world.js';
import { buildTerrain, buildBackdrop, buildEmbers, makePathDist, makePlacer, smooth, bakeField, makeNoise } from './common.js';
import { LANDMARKS } from './landmarks.js';
import { unreachableSpots } from './mapcheck.js';

// Seeded random Red Field. Same size, sky, fog and prop budget as the classic map:
//   1. layout: spawn on an edge, 3 towers >= 60 m apart, 2 blood pools covering
//      the towers, 3 random landmarks
//   2. mud paths: minimum spanning tree between all of them, with wobbly midpoints
//   3. terrain: warped fractal hills with flat and rough areas, 1-2 rocky ridges,
//      maybe a dry blood-creek ravine (cover from sight) with fords where paths
//      cross; flattened under set pieces and baked into a heightfield
//   4. zones: the map is split into 6-8 biome regions (field, graves, deadwood,
//      junk, rocks); landmarks force their own. Each zone has its own ground
//      tint, hilliness, prop palette and density
//   5. props: landmarks, structures (ruined stone walls, low walls / hedges, crate
//      and coffin barricades), zone filler up to a fixed density budget, tall grass
//      spread evenly (farthest-point), then every spot the player can get to but
//      the monster can't bite is opened up
//   6. the monster spawns far away, out of sight of the player
// The same seed always builds the same map.

const HALF = 70;
const PATH_C = new THREE.Color(0.55, 0.36, 0.3);
const BLOOD_C = new THREE.Color(0.55, 0.12, 0.1);
const STONE_C = new THREE.Color(0.5, 0.36, 0.34);
const RAVINE_C = new THREE.Color(0.34, 0.08, 0.06);
const MAX_SLOPE = 0.47; // props avoid ground steeper than ~25 degrees

// Biomes. tint/tintK: ground colour; rough: hill height factor; density: how
// much filler (relative); palette: [prop, weight]; grass: short grass kept (0..1);
// structures: [type, weight] for walls / hedges / barricades built in the zone.
const ZONES = {
  field:    { tint: new THREE.Color(1.05, 0.34, 0.3), tintK: 0.2, rough: 0.6, density: 0.45, grass: 1,
              palette: [['cross', 5], ['instrument', 3], ['boulder', 1], ['bassDrum', 1]],
              structures: [['stoneWall', 2], ['lowWall', 3]] },
  graves:   { tint: new THREE.Color(0.62, 0.4, 0.38), tintK: 0.45, rough: 0.85, density: 1.3, grass: 0.85,
              palette: [['cross', 4], ['tombstone', 5], ['tree', 1], ['boulder', 0.5]],
              structures: [['stoneWall', 3], ['lowWall', 1], ['barricade', 1]] },
  deadwood: { tint: new THREE.Color(0.5, 0.24, 0.17), tintK: 0.5, rough: 1, density: 1.25, grass: 0.75,
              palette: [['tree', 6], ['boulder', 3], ['cross', 1]],
              structures: [['hedge', 3]] },
  junk:     { tint: new THREE.Color(0.95, 0.42, 0.22), tintK: 0.4, rough: 0.9, density: 1, grass: 0.8,
              palette: [['instrument', 4], ['bassDrum', 2], ['speakers', 1.5], ['cross', 1], ['boulder', 1.5]],
              structures: [['barricade', 3], ['stoneWall', 1]] },
  rocks:    { tint: new THREE.Color(0.58, 0.43, 0.41), tintK: 0.45, rough: 1.55, density: 1, grass: 0.5,
              palette: [['boulder', 7], ['cross', 1], ['tree', 1.5]],
              structures: [['stoneWall', 1]] },
};
const ZONE_TYPES = Object.keys(ZONES);
const _tint = new THREE.Color();
const DENSITY = 335;       // collider budget before the towers (classic map: ~426 in total)
const GRASS_PATCHES = 31;  // tall hiding grass

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

  // terrain features come first (they only avoid the towers and spawn); pools and
  // landmarks are then placed clear of them
  const keepOut = [...towers.map((tw) => [tw, 17]), [spawn, 13]];
  const along = (pts, step = 3) => {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / step);
      for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    out.push(pts.at(-1));
    return out;
  };
  const clearOf = (pts, extra) => along(pts).every(([x, z]) => keepOut.every(([o, rr]) => Math.hypot(x - o.x, z - o.z) > rr + extra));

  // ridges: 1-2 long hills with rocky crests that block the view across the map
  const ridges = [];
  for (let n = 0, want = rnd() < 0.5 ? 2 : 1; n < want; n++) {
    for (let i = 0; i < 80; i++) {
      const cx = R(-48, 48), cz = R(-48, 48), a = R(0, Math.PI), len = R(35, 60);
      const dx = Math.cos(a), dz = Math.sin(a), pts = [];
      for (let j = 0; j <= 4; j++) {
        const u = j / 4 - 0.5, off = R(-6, 6);
        pts.push([cx + dx * len * u - dz * off, cz + dz * len * u + dx * off]);
      }
      if (pts.some(([x, z]) => Math.abs(x) > HALF - 8 || Math.abs(z) > HALF - 8) || !clearOf(pts, 7)) continue;
      if (ridges.some((q) => along(pts).some(([x, z]) => q.dist(x, z) < 22))) continue;
      ridges.push({ pts, h: R(3, 5.5), w: R(7, 10), dist: makePathDist([pts]) });
      break;
    }
  }
  // ravine: a dry, blood-stained creek bed from edge to edge; crouching in it hides you
  let ravine = null;
  if (rnd() < 0.7) {
    for (let i = 0; i < 80 && !ravine; i++) {
      const vertical = rnd() < 0.5, a0 = R(-45, 45), a1 = R(-45, 45), pts = [];
      for (let j = 0; j <= 6; j++) {
        const u = -HALF - 4 + ((HALF * 2 + 8) * j) / 6, v = a0 + (a1 - a0) * (j / 6) + (j % 6 ? R(-12, 12) : 0);
        pts.push(vertical ? [v, u] : [u, v]);
      }
      if (!clearOf(pts, 6)) continue;
      // deep with a narrow crest: a crouched player is out of the monster's sight from ~13 m
      ravine = { pts, depth: R(3.3, 3.9), w: R(4.6, 5.3), dist: makePathDist([pts]) };
    }
  }

  const occupied = [[spawn, 8], ...towers.map((tw) => [tw, 13])];
  const free = (p, r) => occupied.every(([o, orr]) => dist(o, p) > orr + r);
  const claimArea = (p, r) => occupied.push([p, r]);
  for (const q of ridges) for (const [x, z] of along(q.pts, 4)) claimArea({ x, z }, q.w * 0.6);
  if (ravine) for (const [x, z] of along(ravine.pts, 4)) claimArea({ x, z }, ravine.w + 1);

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

  // ------------------------------------------------------------------ zones (biomes)
  // landmarks force their zone; the rest are spread out, unused types first
  const zones = landmarks.map((L) => ({ x: L.x, z: L.z, type: LANDMARKS[L.type].zone }));
  const want = 6 + Math.floor(rnd() * 3);
  for (let i = 0; i < 300 && zones.length < want; i++) {
    const p = { x: R(-60, 60), z: R(-60, 60), type: null };
    if (zones.every((q) => dist(q, p) >= 30)) zones.push(p);
  }
  for (const zn of zones) {
    if (zn.type) continue;
    const unused = ZONE_TYPES.filter((ty) => !zones.some((q) => q.type === ty));
    const from = unused.length ? unused : ZONE_TYPES;
    zn.type = from[Math.floor(rnd() * from.length)];
  }
  // nearest zone, the next one, and how much to blend towards it near the border (0..0.5)
  const zoneAt = (x, z) => {
    let a = zones[0], da = Infinity, b = zones[0], db = Infinity;
    for (const zn of zones) {
      const d = (x - zn.x) ** 2 + (z - zn.z) ** 2;
      if (d < da) { b = a; db = da; a = zn; da = d; } else if (d < db) { b = zn; db = d; }
    }
    return { a: ZONES[a.type], b: ZONES[b.type], type: a.type, mix: 0.5 * (1 - smooth(0, 7, Math.sqrt(db) - Math.sqrt(da))) };
  };

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
  const { noise, fbm } = makeNoise(rnd);
  const hill = R(0.85, 1.25);
  const relief = (x, z) => {
    // warped fractal hills; a slow "roughness" field makes some areas flat and some hilly
    const wx = x + 10 * noise(x * 0.012 + 3.1, z * 0.012), wz = z + 10 * noise(x * 0.012, z * 0.012 + 7.7);
    const zn = zoneAt(x, z);
    const zoneRough = zn.a.rough + (zn.b.rough - zn.a.rough) * zn.mix; // rocky zones are hillier, fields flatter
    const rough = (0.45 + 0.9 * (0.5 + 0.5 * noise(x * 0.009 + 11.3, z * 0.009 - 4.2))) * zoneRough;
    let h = hill * rough * 4 * fbm(wx * 0.022, wz * 0.022, 4);
    for (const q of ridges) {
      const d = q.dist(x, z);
      if (d < q.w) h += q.h * (1 - smooth(0, q.w, d)) * (0.75 + 0.25 * noise(x * 0.08, z * 0.08));
    }
    if (ravine) {
      const d = ravine.dist(x, z);
      if (d < ravine.w + 4) { // fords where a path crosses
        const ford = 1 - 0.65 * (1 - smooth(2, 7, pathDist(x, z)));
        h -= ravine.depth * ford * (1 - smooth(1.3, ravine.w, d));
        // a low berm of thrown-up earth along both banks keeps the downhill side high enough to hide in
        h += 1.5 * ford * smooth(ravine.w - 1.5, ravine.w + 0.5, d) * (1 - smooth(ravine.w + 0.5, ravine.w + 4, d));
      }
    }
    h -= 0.25 * (1 - smooth(0, 2.5, pathDist(x, z)));
    const e = Math.max(Math.abs(x), Math.abs(z)) - (HALF - 5);
    if (e > 0) h += e * e * 0.09;
    return h;
  };

  // sometimes a blood pool collects in the ravine bed
  if (ravine && rnd() < 0.5) {
    const pts = along(ravine.pts, 4).filter(([x, z]) => Math.abs(x) < HALF - 14 && Math.abs(z) < HALF - 14 && pathDist(x, z) > 9);
    for (let i = 0; i < 20 && pts.length; i++) {
      const [x, z] = pts[Math.floor(rnd() * pts.length)];
      const p = { x, z };
      if (!free(p, 7) || pools.some((q) => dist(q, p) < 20)) continue;
      p.w = R(6, 7.5); p.d = R(4, 5); p.inRavine = true;
      p.y = relief(x, z);
      pools.push(p); claimArea(p, 7);
      break;
    }
  }

  const flats = [
    ...towers.map((tw) => ({ x: tw.x, z: tw.z, y: 0.3, r1: 10, r2: 15 })),
    ...pools.map((p) => (p.inRavine ? { x: p.x, z: p.z, y: p.y, r1: 4.5, r2: 7 } : { x: p.x, z: p.z, y: 0, r1: 6.5, r2: 11.5 })),
    { x: spawn.x, z: spawn.z, y: 0.2, r1: 4, r2: 9 },
    ...landmarks.map((L) => {
      const f = LANDMARKS[L.type].flat;
      const r = LANDMARKS[L.type].r;
      if (f) return { x: L.x, z: L.z, ...f };
      // a soft base that stops short of the ravine (otherwise it would fill it in)
      const r2 = Math.min(r + 6, ravine ? ravine.dist(L.x, L.z) - ravine.w - 1 : Infinity);
      return { x: L.x, z: L.z, y: relief(L.x, L.z), r1: Math.min(r * 0.6, r2 - 4), r2 };
    }),
  ];
  const rawHeight = (x, z) => {
    let h = relief(x, z);
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
    const zn = zoneAt(x, z);
    _tint.copy(zn.a.tint).lerp(zn.b.tint, zn.mix);
    c.lerp(_tint, zn.a.tintK + (zn.b.tintK - zn.a.tintK) * zn.mix);
    c.lerp(PATH_C, 1 - smooth(1.2, 2.8, pathDist(x, z)));
    for (const p of pools) c.lerp(BLOOD_C, (1 - smooth(4, 9, Math.hypot(x - p.x, z - p.z))) * 0.7);
    for (const y of yards) c.lerp(STONE_C, (1 - smooth(8, 14, Math.hypot(x - y.x, z - y.z))) * 0.6);
    for (const q of ridges) c.lerp(STONE_C, (1 - smooth(0, q.w * 0.45, q.dist(x, z))) * 0.35); // rocky crests
    if (ravine) c.lerp(RAVINE_C, (1 - smooth(1, ravine.w * 0.8, ravine.dist(x, z))) * 0.75);
  };
  // ground steepness (rise per metre)
  const slope = (x, z) => Math.hypot(heightFn(x + 0.8, z) - heightFn(x - 0.8, z), heightFn(x, z + 0.8) - heightFn(x, z - 0.8)) / 1.6;
  const flatEnough = (x, z, r) => slope(x, z) < MAX_SLOPE && (r < 1.2 || [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => slope(x + a * r * 0.7, z + b * r * 0.7) < MAX_SLOPE));

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
  const { R: KR, clear, claim, scatter, solids } = makePlacer({ rnd: krnd, half: HALF, reserved, pathDist, ok: flatEnough });

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
  const ctx = { kit, R: KR, rnd: krnd, clear, claim, pathDist, reserved, steep: (x, z) => slope(x, z) > MAX_SLOPE };
  for (const L of landmarks) {
    L.r = LANDMARKS[L.type].r;
    LANDMARKS[L.type].build(ctx, L);
  }
  for (const L of landmarks) reserved.push([L.x, L.z, L.r]);

  // rocky outcrops along the ridge crests
  for (const q of ridges) {
    for (const [x, z] of along(q.pts, 6)) {
      if (krnd() < 0.35) continue;
      const bx = x + KR(-1.5, 1.5), bz = z + KR(-1.5, 1.5);
      if (!clear(bx, bz, 1.6, 1.5)) continue;
      claim(bx, bz, 1.6);
      kit.boulder(bx, bz, KR(1.3, 2.4), KR(1.2, 2.3), KR(1.3, 2.4), krnd() * 6);
    }
  }

  // zone filler until the density budget is reached: each spot gets a prop from
  // its zone's palette, and dense zones (graves, deadwood) get more of them
  const types = ['guitar', 'guitar', 'violin', 'cello'];
  const PROPS = { // [radius, spacing, place]
    cross: [0.8, 3, (x, z) => kit.cross(x, z, KR(2.6, 4.4), krnd() * 6, (krnd() - 0.5) * 0.3, krnd() < 0.8)],
    tombstone: [0.5, 1.2, (x, z) => kit.tombstone(x, z, (krnd() - 0.5) * 0.5)],
    tree: [0.6, 3, (x, z) => kit.deadTree(x, z, KR(5, 8.5), krnd() < 0.4)],
    boulder: [2.4, 3, (x, z) => kit.boulder(x, z, KR(1.4, 2.8), KR(1.2, 2.8), KR(1.4, 2.8), krnd() * 6)],
    instrument: [0.4, 0.3, (x, z) => {
      const ty = types[Math.floor(krnd() * types.length)];
      kit.instrument(ty, x, z, krnd() * 6, ty === 'cello' ? krnd() < 0.7 : krnd() < 0.25);
    }],
    bassDrum: [0.5, 0.3, (x, z) => kit.bassDrum(x, z, krnd() * 6)],
    speakers: [1.2, 1.5, (x, z) => kit.speakerStack(x, z, krnd() * 6, 1 + Math.floor(krnd() * 3))],
  };
  const pick = (pal) => {
    let tot = 0;
    for (const [, w] of pal) tot += w;
    let v = krnd() * tot;
    for (const [k, w] of pal) if ((v -= w) <= 0) return k;
    return pal[0][0];
  };
  // structures: wall runs and barricades from the zone's list. Stone walls keep
  // 4+ m from other solids (the monster gets round their ends), get gateways where
  // paths cross and one breach it fits through; single missing blocks are player-only gaps.
  const structs = { stoneWall: 0, lowWall: 0, hedge: 0, barricade: 0 }, structAt = [];
  const steepAt = (x, z) => slope(x, z) > MAX_SLOPE;
  const wantStructs = 9 + Math.floor(krnd() * 5);
  for (let i = 0, made = 0; i < 500 && made < wantStructs; i++) {
    const x = KR(-58, 58), z = KR(-58, 58);
    const Z = ZONES[zoneAt(x, z).type];
    const type = pick(Z.structures);
    if (type === 'barricade') {
      if (!clear(x, z, 5, 2) || pathDist(x, z) < 7) continue;
      const graves = zoneAt(x, z).type === 'graves';
      const n = 5 + Math.floor(krnd() * 3), a0 = krnd() * 6, gapAt = Math.floor(krnd() * n);
      for (let k = 0; k < n; k++) {
        if (k === gapAt || k === (gapAt + Math.floor(n / 2)) % n) continue; // two openings
        const a = a0 + (k / n) * Math.PI * 2, rr = KR(3, 4.2);
        const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
        if (steepAt(px, pz)) continue;
        const v = krnd();
        if (graves ? v < 0.6 : v < 0.2) kit.coffin(px, pz, a + Math.PI / 2 + KR(-0.4, 0.4), krnd() < 0.35);
        else if (v < 0.75) kit.crateStack(px, pz, 2 + Math.floor(krnd() * 2), KR(-0.25, 0.25));
        else if (graves) kit.crateStack(px, pz, 1, KR(-0.3, 0.3));
        else kit.uprightPiano(px, pz, a + Math.PI / 2);
      }
      if (krnd() < 0.6) kit.crateStack(x + KR(-1, 1), z + KR(-1, 1), 1, KR(-0.3, 0.3)); // something to climb
      claim(x, z, 5);
      structs.barricade++; made++; structAt.push({ type, x, z });
      continue;
    }
    // a run: straight, L or (stone walls only) U shaped legs along x / z
    const stone = type === 'stoneWall';
    const shape = krnd(), ax = krnd() < 0.5, sgn = krnd() < 0.5 ? -1 : 1;
    const L1 = Math.round(KR(4, stone ? 7 : 8)) * 2, L2 = Math.round(KR(3, 5)) * 2;
    const legs = [];
    const leg = (x1, z1, dx, dz) => { legs.push([x1, z1, x1 + dx, z1 + dz]); return [x1 + dx, z1 + dz]; };
    let [ex, ez] = ax ? leg(x, z, L1, 0) : leg(x, z, 0, L1);
    if (shape > 0.5) [ex, ez] = ax ? leg(ex, ez, 0, L2 * sgn) : leg(ex, ez, L2 * sgn, 0);
    if (stone && shape > 0.85) ax ? leg(ex, ez, -L1, 0) : leg(ex, ez, 0, -L1);
    const pts = [];
    for (const [x1, z1, x2, z2] of legs) {
      const n = Math.max(1, Math.round(Math.hypot(x2 - x1, z2 - z1) / 2));
      for (let k = 0; k <= n; k++) pts.push([x1 + (x2 - x1) * (k / n), z1 + (z2 - z1) * (k / n)]);
    }
    const margin = stone ? 3.2 : 1.5;
    if (!pts.every(([px, pz]) => Math.abs(px) < 62 && Math.abs(pz) < 62 && clear(px, pz, 0.8, margin))) continue;
    const bad = pts.filter(([px, pz]) => steepAt(px, pz) || pathDist(px, pz) < 2.4).length;
    if (bad > pts.length * 0.35) continue; // mostly on a path or a slope
    for (const [x1, z1, x2, z2] of legs) {
      if (stone) {
        const n = Math.max(1, Math.round(Math.hypot(x2 - x1, z2 - z1) / 2));
        const breach = n >= 5 ? 1 + Math.floor(krnd() * (n - 3)) : -9; // 2 blocks: the monster fits
        const hole = n >= 4 && krnd() < 0.6 ? Math.floor(krnd() * n) : -9; // 1 block: player only
        kit.stoneWall(x1, z1, x2, z2, KR(2.6, 3.3), (px, pz, k) =>
          pathDist(px, pz) < 2.4 || steepAt(px, pz) || k === breach || k === breach + 1 || k === hole);
      } else {
        const skip = (px, pz) => pathDist(px, pz) < 1.8 || steepAt(px, pz);
        if (type === 'hedge') kit.hedge(x1, z1, x2, z2, skip); else kit.lowWall(x1, z1, x2, z2, skip);
      }
    }
    for (const [px, pz] of pts) claim(px, pz, 0.8);
    structs[type]++; made++; structAt.push({ type, x, z });
  }

  for (let i = 0; i < 8000 && world.colliders.length < DENSITY; i++) {
    const x = KR(-66, 66), z = KR(-66, 66);
    const Z = ZONES[zoneAt(x, z).type];
    if (krnd() * 1.3 > Z.density) continue;
    const [rad, spacing, place] = PROPS[pick(Z.palette)];
    if (!clear(x, z, rad, spacing) || pathDist(x, z) < rad + 1.2) continue;
    if (rad >= 0.5) claim(x, z, rad);
    place(x, z);
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
  const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
  const thinned = (x, z) => { const zn = zoneAt(x, z); return hash(x, z) > zn.a.grass + (zn.b.grass - zn.a.grass) * zn.mix; };
  // grass takes on the zone's colour too (it covers most of the ground)
  const grassTint = (x, z, c) => {
    const zn = zoneAt(x, z);
    _tint.copy(zn.a.tint).lerp(zn.b.tint, zn.mix).multiplyScalar(0.3);
    c.lerp(_tint, (zn.a.tintK + (zn.b.tintK - zn.a.tintK) * zn.mix) * 0.9);
  };
  kit.grass(patches.map((p) => ({ ...p, count: Math.round(p.r * p.r * 55), hMin: 1.0, hMax: 1.6, tint: grassTint })), 0x9a1414, true);
  kit.grass([{
    x: 0, z: 0, r: HALF + 3, square: true, count: 105000, hMin: 0.2, hMax: 0.6,
    avoid: (x, z) => pathDist(x, z) < 1.6 || inPool(x, z, 0.6) || inBuilding(x, z) || thinned(x, z),
    tint: grassTint,
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
  // every spot the player can get to (on foot or climbing) must be within the
  // monster's bite: knock out the nearest removable piece (boulder, wall block,
  // crate stack) next to any that isn't, until none are left
  const buildNav = (squeeze = 0) => { world.markSmall(1.8, 1.0); world.buildNav(-HALF, -HALF, HALF, HALF, 1, 1.6, 0.9, 3.6, squeeze); };
  buildNav();
  let opened = 0;
  for (let pass = 0; pass < 10; pass++) {
    const spots = unreachableSpots(world, { spawn });
    if (!spots.length) break;
    for (const sp of spots) {
      let best = null, bestD = Infinity;
      if (sp.kind === 'top') best = kit.removable.has(sp.top) ? sp.top : sp.from && kit.removable.has(sp.from) ? sp.from : null;
      if (!best) {
        for (const b of world.colliders) {
          const removable = kit.removable.has(b);
          if (b.small || (!removable && (b.max.y - b.min.y > 6 || b.max.x - b.min.x > 6 || b.max.z - b.min.z > 6))) continue; // not walls
          const cx = Math.max(b.min.x, Math.min(sp.x, b.max.x)), cz = Math.max(b.min.z, Math.min(sp.z, b.max.z));
          const d = Math.hypot(cx - sp.x, cz - sp.z) - (removable ? 1 : 0); // prefer removable pieces
          if (d < bestD) { bestD = d; best = b; }
        }
      }
      if (best && world.colliders.includes(best)) { kit.removeCollider(best); opened++; }
    }
    buildNav();
  }
  buildNav(0.45); // with the fine grid for squeezing through gaps
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
    terrain: { ridges: ridges.map((q) => q.pts), ravine: ravine && ravine.pts, slope },
    zones: zones.map((zn) => ({ x: zn.x, z: zn.z, type: zn.type })),
    zoneAt: (x, z) => zoneAt(x, z).type,
    layout: { spawn, towers, monster, pools, landmarks: landmarks.map((L) => L.type), paths: paths.length, grassPatches: patches.length, opened, structs, structAt },
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
