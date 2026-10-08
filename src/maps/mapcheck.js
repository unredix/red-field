import * as THREE from 'three';

// Quality checks for generated maps (used by the generator itself and by the
// game.sweep() dev hook). All distances in metres; nav cells are 1 m.

// Connected components of the monster's walkable nav cells (labelled by World.buildNav).
export function navComponents(world) {
  const n = world.nav;
  return { comp: n.comp, sizes: n.sizes, main: n.main };
}

// Walkable cells the monster can't get to that lie more than `minDist` from
// anywhere it can stand: places a player could hide forever.
export function deepPockets(world, minDist = 3) {
  const n = world.nav, N = n.cols * n.rows;
  const { comp, main } = navComponents(world);
  // distance (in cells, 8-connected) from the main component
  const dist = new Float32Array(N).fill(Infinity);
  const queue = [];
  for (let i = 0; i < N; i++) if (comp[i] === main) { dist[i] = 0; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q], x = c % n.cols, y = (c / n.cols) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= n.cols || yy >= n.rows) continue;
        const j = yy * n.cols + xx, d = dist[c] + (dx && dy ? 1.414 : 1);
        if (d < dist[j]) { dist[j] = d; queue.push(j); }
      }
    }
  }
  const groups = new Map(); // component id -> deep cells
  for (let i = 0; i < N; i++) {
    if (n.blocked[i] || comp[i] === main || dist[i] * n.cell <= minDist) continue;
    if (!groups.has(comp[i])) groups.set(comp[i], []);
    groups.get(comp[i]).push(i);
  }
  return [...groups.values()].map((cells) => {
    let sx = 0, sz = 0;
    for (const i of cells) { sx += n.minX + ((i % n.cols) + 0.5) * n.cell; sz += n.minZ + (((i / n.cols) | 0) + 0.5) * n.cell; }
    return { cells, x: sx / cells.length, z: sz / cells.length };
  });
}

// Distance (m, 8-connected) from every cell to the monster's main walkable area.
function distFromMain(n) {
  const N = n.cols * n.rows, dist = new Float32Array(N).fill(Infinity), queue = [];
  for (let i = 0; i < N; i++) if (!n.blocked[i] && n.comp[i] === n.main) { dist[i] = 0; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q], x = c % n.cols, y = (c / n.cols) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= n.cols || yy >= n.rows) continue;
        const j = yy * n.cols + xx, d = dist[c] + (dx && dy ? 1.414 : 1) * n.cell;
        if (d < dist[j]) { dist[j] = d; queue.push(j); }
      }
    }
  }
  return dist;
}

// Places the player can get to but the monster can never bite them:
//  - ground the player can walk/climb to that is more than `reach` m from anywhere
//    the monster can stand (narrow corridors between walls, sealed corners...)
//  - tops of props the player can climb onto (from the ground or hopping from
//    another top) that the monster can't reach: nowhere for it to stand within
//    `reach` m horizontally and `reachUp` m below.
// Player climbing: jump 1.18 m + 1.8 m tall + 0.55 m mantle reach = ~3.5 m.
// Bite reach: its head sits ~2.5 m in front of its body and bites 3 m out.
// `squeeze`: judge with the grid it uses when squeezing through narrow gaps.
export function unreachableSpots(world, { spawn, climb = 3.5, reach = 5, reachUp = 6, squeeze = false } = {}) {
  const n = world.nav, { cols, rows, cell, minX, minZ } = n, N = cols * rows;
  const g = squeeze ? world.navSqueeze : n; // the monster's grid
  const H = world.heightFn || (() => 0);
  const ground = new Float32Array(N);
  for (let i = 0; i < N; i++) ground[i] = H(minX + ((i % cols) + 0.5) * cell, minZ + (((i / cols) | 0) + 0.5) * cell);
  const cellsIn = (x0, z0, x1, z1, fn) => {
    const c0 = Math.max(0, Math.ceil((x0 - minX) / cell - 0.5)), c1 = Math.min(cols - 1, Math.floor((x1 - minX) / cell - 0.5));
    const r0 = Math.max(0, Math.ceil((z0 - minZ) / cell - 0.5)), r1 = Math.min(rows - 1, Math.floor((z1 - minZ) / cell - 0.5));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * cols + c);
  };
  // 0 = open ground, 1 = inside something you can climb over, 2 = too tall to climb
  const occ = new Uint8Array(N);
  for (const b of world.colliders) {
    cellsIn(b.min.x - 0.3, b.min.z - 0.3, b.max.x + 0.3, b.max.z + 0.3, (i) => {
      const h = b.max.y - ground[i];
      if (h <= 0.45 || b.min.y > ground[i] + 1.8) return; // step over it / walk under it
      occ[i] = Math.max(occ[i], h > climb ? 2 : 1);
    });
  }
  // where the player can get on foot (climbing over anything climbable)
  const reached = new Uint8Array(N);
  const [sc, sr] = world._cellOf(spawn.x, spawn.z);
  const stack = [sr * cols + sc];
  reached[stack[0]] = 1;
  while (stack.length) {
    const c = stack.pop(), x = c % cols, y = (c / cols) | 0;
    for (const j of [x > 0 ? c - 1 : -1, x < cols - 1 ? c + 1 : -1, y > 0 ? c - cols : -1, y < rows - 1 ? c + cols : -1]) {
      if (j >= 0 && !reached[j] && occ[j] < 2) { reached[j] = 1; stack.push(j); }
    }
  }
  const distG = distFromMain(g);
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const [gc, gr] = world._cellOf(minX + ((i % cols) + 0.5) * cell, minZ + (((i / cols) | 0) + 0.5) * cell, g);
    dist[i] = distG[gr * g.cols + gc];
  }
  const spots = [];
  // ground: cluster the unsafe cells
  const seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (seen[i] || !reached[i] || occ[i] || dist[i] <= reach) continue;
    const cells = [], st = [i];
    seen[i] = 1;
    while (st.length) {
      const c = st.pop(); cells.push(c);
      const x = c % cols, y = (c / cols) | 0;
      for (const j of [x > 0 ? c - 1 : -1, x < cols - 1 ? c + 1 : -1, y > 0 ? c - cols : -1, y < rows - 1 ? c + cols : -1]) {
        if (j >= 0 && !seen[j] && reached[j] && !occ[j] && dist[j] > reach) { seen[j] = 1; st.push(j); }
      }
    }
    let sx = 0, sz = 0;
    for (const c of cells) { sx += minX + ((c % cols) + 0.5) * cell; sz += minZ + (((c / cols) | 0) + 0.5) * cell; }
    spots.push({ kind: 'ground', x: sx / cells.length, z: sz / cells.length, cells: cells.length });
  }
  // tops: which can the player climb onto?
  const tops = world.colliders.filter((b) => b.max.x - b.min.x >= 0.5 && b.max.z - b.min.z >= 0.5 && b.max.x - b.min.x < 30 && b.max.z - b.min.z < 30);
  const from = new Map(); // top -> the top it was climbed from (null = from the ground)
  const queue = [];
  for (const b of tops) {
    let ok = false;
    cellsIn(b.min.x - 1, b.min.z - 1, b.max.x + 1, b.max.z + 1, (i) => { if (!ok && reached[i] && occ[i] < 2 && b.max.y - ground[i] <= climb) ok = true; });
    if (ok) { from.set(b, null); queue.push(b); }
  }
  const gap = (a, b) => Math.hypot(Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x), Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z));
  for (let q = 0; q < queue.length; q++) {
    const a = queue[q];
    for (const b of tops) {
      if (from.has(b) || b.max.y - a.max.y > climb || gap(a, b) > 3) continue;
      from.set(b, a); queue.push(b);
    }
  }
  for (const b of queue) {
    let ok = false;
    const [c0, r0] = world._cellOf(b.min.x - reach, b.min.z - reach, g), [c1, r1] = world._cellOf(b.max.x + reach, b.max.z + reach, g);
    for (let rr = r0; rr <= r1 && !ok; rr++) {
      for (let cc = c0; cc <= c1 && !ok; cc++) {
        const i = rr * g.cols + cc;
        if (!g.blocked[i] && g.comp[i] === g.main && b.max.y - H(g.minX + (cc + 0.5) * g.cell, g.minZ + (rr + 0.5) * g.cell) <= reachUp) ok = true;
      }
    }
    if (!ok) spots.push({ kind: 'top', x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, top: b, from: from.get(b), h: +(b.max.y - H((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2)).toFixed(1) });
  }
  // everywhere the player can stand (for tests): open ground cells and climbable tops
  spots.standGround = [];
  for (let i = 0; i < N; i++) if (reached[i] && !occ[i]) spots.standGround.push(i);
  spots.cellPos = (i) => ({ x: minX + ((i % cols) + 0.5) * cell, z: minZ + (((i / cols) | 0) + 0.5) * cell });
  spots.standTops = queue;
  return spots;
}

export const GATES = {
  valid: (m) => m.valid,
  // deepPockets is still reported; unsafeSpots (player-reachable, not bitable) replaces it as the gate
  unsafeSpots: (m) => m.unsafeSpots === 0,
  unsafeSqueeze: (m) => m.unsafeSqueeze === 0,
  towerSpacing: (m) => m.towerSpacing >= 60,
  poolReach: (m) => m.poolReach <= 55,
  grassGap: (m) => m.grassGap <= 25,
  spawnLOS: (m) => !m.spawnLOS,
  colliders: (m) => m.colliders >= 330 && m.colliders <= 420,
  genMs: (m) => m.genMs <= 2000,
  steepProps: (m) => !(m.steepProps > 4),
  ravineHidden: (m) => m.ravineHidden !== false,
  zoneTypes: (m) => !(m.zoneTypes < 4),
};

export function checkMap(world, level, genMs = 0) {
  const L = level.layout, T = L.towers;
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const m = { seed: level.seed, valid: !!level.valid, genMs: Math.round(genMs), colliders: world.colliders.length };
  m.deepPockets = deepPockets(world).reduce((s, p) => s + p.cells.length, 0);
  const unsafe = unreachableSpots(world, { spawn: L.spawn });
  m.unsafeSpots = unsafe.length;
  m.unsafeSqueeze = unreachableSpots(world, { spawn: L.spawn, squeeze: true }).length;
  m.unsafe = unsafe.map((u) => `${u.kind}@${u.x.toFixed(0)},${u.z.toFixed(0)}${u.cells ? `x${u.cells}` : ` h${u.h}`}`).join(' ');
  m.towerSpacing = Math.round(Math.min(d2(T[0], T[1]), d2(T[1], T[2]), d2(T[0], T[2])));
  m.poolReach = Math.round(Math.max(...T.map((t) => Math.min(...L.pools.map((p) => d2(p, t))))));
  // largest distance from a walkable spot to tall grass
  let gap = 0;
  for (let x = -62; x <= 62; x += 5) {
    for (let z = -62; z <= 62; z += 5) {
      if (!world.walkable(x, z)) continue;
      let d = Infinity;
      for (const g of world.grass) d = Math.min(d, Math.hypot(x - g.x, z - g.z) - g.r);
      gap = Math.max(gap, d);
    }
  }
  m.grassGap = Math.round(gap);
  const g = (p, h) => new THREE.Vector3(p.x, world.groundHeight(p.x, p.z) + h, p.z);
  m.spawnLOS = world.lineOfSight(g(L.monster, 2.5), g(L.spawn, 1.6));
  // big obstacles sitting on the mud paths
  m.pathBlockers = level.pathDist
    ? world.colliders.filter((b) => !b.small && b.max.x - b.min.x < 20 && level.pathDist((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2) < 1.2).length
    : 0;
  // terrain features (stage 2)
  const tr = level.terrain;
  if (tr) {
    m.ridges = tr.ridges.length;
    m.ravine = !!tr.ravine;
    // props standing on ground steeper than ~25 degrees (they'd float or sink)
    m.steepProps = world.colliders.filter((b) => {
      const w = b.max.x - b.min.x, d = b.max.z - b.min.z;
      if (w > 10 || d > 10) return false; // walls / bounds
      return tr.slope((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2) > 0.6;
    }).length;
    // a crouched player in the ravine bed can't be seen from the bank 15 m away
    // (sampled at the ravine's bends, from both banks; it must hide you from most directions)
    if (tr.ravine) {
      const pts = tr.ravine;
      let tested = 0, hidden = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const [x, z] = pts[i];
        if (Math.abs(x) > 55 || Math.abs(z) > 55 || (level.pathDist && level.pathDist(x, z) < 10)) continue;
        // across the channel: perpendicular to the bend's average direction (prev -> next)
        const [px, pz] = pts[i + 1], [qx, qz] = pts[i - 1];
        const len = Math.hypot(px - qx, pz - qz), nx = -(pz - qz) / len, nz = (px - qx) / len;
        for (const side of [1, -1]) {
          const ox = x + nx * 15 * side, oz = z + nz * 15 * side;
          if (Math.abs(ox) > 66 || Math.abs(oz) > 66) continue;
          tested++;
          if (!world.lineOfSight(g({ x: ox, z: oz }, 3.5), g({ x, z }, 0.9))) hidden++;
        }
      }
      m.ravineHide = tested ? Math.round((100 * hidden) / tested) : 100;
      m.ravineHidden = m.ravineHide >= 65; // natural banks: hidden from at least two thirds of directions
    }
  }
  // zones (stage 3): how many different biomes, and how much ground each covers
  if (level.zones) {
    m.zoneTypes = new Set(level.zones.map((z) => z.type)).size;
    const area = {};
    for (let x = -64; x <= 64; x += 4) for (let z = -64; z <= 64; z += 4) { const t = level.zoneAt(x, z); area[t] = (area[t] || 0) + 1; }
    m.zoneArea = area;
  }
  // heightFn cost per call
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < 20000; i++) acc += world.heightFn((i * 7.31) % 130 - 65, (i * 3.77) % 130 - 65);
  m.heightUs = +((performance.now() - t0) / 20).toFixed(2) + (acc > Infinity ? 1 : 0);
  m.fails = Object.keys(GATES).filter((k) => !GATES[k](m));
  return m;
}
