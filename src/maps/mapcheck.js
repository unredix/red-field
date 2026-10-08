import * as THREE from 'three';

// Quality checks for generated maps (used by the generator itself and by the
// game.sweep() dev hook). All distances in metres; nav cells are 1 m.

// Connected components of the monster's walkable nav cells.
export function navComponents(world) {
  const n = world.nav, N = n.cols * n.rows;
  const comp = new Int32Array(N).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < N; i++) {
    if (n.blocked[i] || comp[i] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    comp[i] = id; stack.push(i);
    while (stack.length) {
      const c = stack.pop(); size++;
      const x = c % n.cols, y = (c / n.cols) | 0;
      const nb = [x > 0 ? c - 1 : -1, x < n.cols - 1 ? c + 1 : -1, y > 0 ? c - n.cols : -1, y < n.rows - 1 ? c + n.cols : -1];
      for (const j of nb) if (j >= 0 && !n.blocked[j] && comp[j] < 0) { comp[j] = id; stack.push(j); }
    }
    sizes.push(size);
  }
  let main = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
  return { comp, sizes, main };
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

export const GATES = {
  valid: (m) => m.valid,
  deepPockets: (m) => m.deepPockets === 0,
  towerSpacing: (m) => m.towerSpacing >= 60,
  poolReach: (m) => m.poolReach <= 55,
  grassGap: (m) => m.grassGap <= 25,
  spawnLOS: (m) => !m.spawnLOS,
  colliders: (m) => m.colliders >= 330 && m.colliders <= 420,
  genMs: (m) => m.genMs <= 2000,
  steepProps: (m) => !(m.steepProps > 4),
  ravineHidden: (m) => m.ravineHidden !== false,
};

export function checkMap(world, level, genMs = 0) {
  const L = level.layout, T = L.towers;
  const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const m = { seed: level.seed, valid: !!level.valid, genMs: Math.round(genMs), colliders: world.colliders.length };
  m.deepPockets = deepPockets(world).reduce((s, p) => s + p.cells.length, 0);
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
        const [px, pz] = pts[i + 1];
        const len = Math.hypot(px - x, pz - z), nx = -(pz - z) / len, nz = (px - x) / len;
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
  // heightFn cost per call
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < 20000; i++) acc += world.heightFn((i * 7.31) % 130 - 65, (i * 3.77) % 130 - 65);
  m.heightUs = +((performance.now() - t0) / 20).toFixed(2) + (acc > Infinity ? 1 : 0);
  m.fails = Object.keys(GATES).filter((k) => !GATES[k](m));
  return m;
}
