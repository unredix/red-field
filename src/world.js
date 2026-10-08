import * as THREE from 'three';

// Shared world data used by the player, the monster and the arm:
// static box colliders, optional terrain heightfield, hiding zones,
// line of sight, noise events and a navigation grid for the monster.

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _ray = new THREE.Ray();
const _hitP = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];        // static Box3s
    this.dynamicColliders = []; // e.g. the monster's body (player only)
    this.heightFn = null;       // (x, z) => y, or null for box-only maps
    this.grass = [];            // { x, z, r } hiding zones
    this.pools = [];            // { minX, maxX, minZ, maxZ } wading zones
    this.noises = [];           // { pos, radius, t }
    this.scent = [];            // player scent trail { x, z, t }, oldest first
    this.scentEpoch = 0;        // bumps when the trail is washed away
    this.nav = null;
    this.time = 0;
    this._gridDirty = true;
    this._near = [];
    this._stamp = 0;
  }

  addCollider(minX, minY, minZ, maxX, maxY, maxZ) {
    const b = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
    this.colliders.push(b);
    this._gridDirty = true;
    return b;
  }

  // ---------------------------------------------------------------- spatial grid (XZ)
  _buildGrid() {
    const cell = (this._cell = 8);
    this._grid = new Map();
    this._marks = new Uint32Array(this.colliders.length);
    this.colliders.forEach((c, i) => {
      for (let x = Math.floor(c.min.x / cell); x <= Math.floor(c.max.x / cell); x++) {
        for (let z = Math.floor(c.min.z / cell); z <= Math.floor(c.max.z / cell); z++) {
          const k = x * 4096 + z;
          let list = this._grid.get(k);
          if (!list) this._grid.set(k, (list = []));
          list.push(i);
        }
      }
    });
    this._gridDirty = false;
  }

  // Static colliders overlapping the XZ rectangle. The returned array is reused.
  near(minX, minZ, maxX, maxZ) {
    if (this._gridDirty) this._buildGrid();
    const out = this._near;
    out.length = 0;
    const stamp = ++this._stamp;
    const cell = this._cell;
    for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x++) {
      for (let z = Math.floor(minZ / cell); z <= Math.floor(maxZ / cell); z++) {
        const list = this._grid.get(x * 4096 + z);
        if (!list) continue;
        for (const i of list) {
          if (this._marks[i] !== stamp) { this._marks[i] = stamp; out.push(this.colliders[i]); }
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- scent trail
  addScent(pos, faint = false) {
    const last = this.scent[this.scent.length - 1];
    if (last && (last.x - pos.x) ** 2 + (last.z - pos.z) ** 2 < 1) return;
    this.scent.push({ x: pos.x, z: pos.z, t: this.time, faint });
    while (this.scent.length && this.time - this.scent[0].t > 90) this.scent.shift();
  }

  clearScent() {
    this.scentMask = 0;
    if (!this.scent.length) return;
    this.scent.length = 0;
    this.scentEpoch++;
  }

  // Called every frame with the player's state. Wading through blood wipes the
  // trail and masks your scent for a while after you climb out; scent left while
  // hidden in tall grass is faint (only smelled up close).
  updateScent(dt, pos, wading, hidden = false) {
    if (wading) { this.clearScent(); this.scentMask = 8; return; }
    if (this.scentMask > 0) { this.scentMask -= dt; return; }
    this.addScent(pos, hidden);
  }

  groundHeight(x, z) {
    return this.heightFn ? this.heightFn(x, z) : -Infinity;
  }

  inGrass(x, z) {
    for (const g of this.grass) if ((x - g.x) ** 2 + (z - g.z) ** 2 < g.r * g.r) return true;
    return false;
  }

  inPool(x, z) {
    for (const p of this.pools) if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ) return true;
    return false;
  }

  noise(pos, radius) {
    if (radius <= 0) return;
    this.noises.push({ pos: pos.clone(), radius, t: this.time });
  }

  update(dt) {
    this.time += dt;
    // noises live one frame for listeners; keep a short tail for debugging
    if (this.noises.length && this.time - this.noises[0].t >= 0.1) this.noises = this.noises.filter((n) => this.time - n.t < 0.1);
  }

  // True if nothing solid is between a and b.
  lineOfSight(a, b) {
    _dir.subVectors(b, a);
    const len = _dir.length();
    if (len < 1e-4) return true;
    _dir.divideScalar(len);
    _ray.set(a, _dir);
    for (const c of this.near(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z))) {
      if (_ray.intersectBox(c, _hitP) && _hitP.distanceTo(a) < len - 0.05) return false;
    }
    if (this.heightFn) {
      const steps = Math.ceil(len / 1.5);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
        if (y < this.heightFn(x, z) + 0.1) return false;
      }
    }
    return true;
  }

  // Mark colliders the (huge) monster simply crashes through: anything shorter
  // than the player or thinner than `thin` (crosses, trees, fences, pianos...).
  markSmall(height = 1.8, thin = 1.0) {
    for (const b of this.colliders) {
      const g = this.heightFn ? this.heightFn((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2) : 0;
      b.small = b.max.y - g < height || Math.max(b.max.x - b.min.x, b.max.z - b.min.z) < thin;
    }
  }

  // ---------------------------------------------------------------- navigation grid
  // Cells are blocked where a creature of `radius` would overlap an obstacle
  // that sits between minH and maxH above the ground (it steps over lower ones).
  // A second, finer grid (`navSqueeze`) is for the monster squeezing through
  // gaps only the player normally fits through (radius `squeeze`), crawling
  // under anything higher than `crawlH` (a shed roof).
  buildNav(minX, minZ, maxX, maxZ, cell, radius, minH = 0.6, maxH = 2.4, squeeze = 0.45, crawlH = 1.6) {
    this.nav = this._rasterNav(minX, minZ, maxX, maxZ, cell, radius, minH, maxH);
    this.navSqueeze = squeeze ? this._rasterNav(minX, minZ, maxX, maxZ, cell / 2, squeeze, minH, crawlH) : null;
  }

  _rasterNav(minX, minZ, maxX, maxZ, cell, radius, minH, maxH) {
    const cols = Math.ceil((maxX - minX) / cell);
    const rows = Math.ceil((maxZ - minZ) / cell);
    const blocked = new Uint8Array(cols * rows);
    const ground = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ground[r * cols + c] = this.heightFn ? this.heightFn(minX + (c + 0.5) * cell, minZ + (r + 0.5) * cell) : 0;
      }
    }
    // rasterize each collider's expanded footprint (small ones don't block the monster)
    for (const b of this.colliders) {
      if (b.small) continue;
      const c0 = Math.max(0, Math.ceil((b.min.x - radius - minX) / cell - 0.5));
      const c1 = Math.min(cols - 1, Math.floor((b.max.x + radius - minX) / cell - 0.5));
      const r0 = Math.max(0, Math.ceil((b.min.z - radius - minZ) / cell - 0.5));
      const r1 = Math.min(rows - 1, Math.floor((b.max.z + radius - minZ) / cell - 0.5));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          if (blocked[i]) continue;
          const g = ground[i];
          if (b.max.y < g + minH || b.min.y > g + maxH) continue;
          blocked[i] = 1;
        }
      }
    }
    // connected components: paths are only ever planned inside one of them
    const N = cols * rows, comp = new Int32Array(N).fill(-1), sizes = [], stack = [];
    for (let i = 0; i < N; i++) {
      if (blocked[i] || comp[i] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      comp[i] = id; stack.push(i);
      while (stack.length) {
        const c = stack.pop(); size++;
        const x = c % cols, y = (c / cols) | 0;
        if (x > 0 && !blocked[c - 1] && comp[c - 1] < 0) { comp[c - 1] = id; stack.push(c - 1); }
        if (x < cols - 1 && !blocked[c + 1] && comp[c + 1] < 0) { comp[c + 1] = id; stack.push(c + 1); }
        if (y > 0 && !blocked[c - cols] && comp[c - cols] < 0) { comp[c - cols] = id; stack.push(c - cols); }
        if (y < rows - 1 && !blocked[c + cols] && comp[c + cols] < 0) { comp[c + cols] = id; stack.push(c + cols); }
      }
      sizes.push(size);
    }
    let main = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
    return { minX, minZ, cell, cols, rows, blocked, radius, comp, sizes, main };
  }

  // The grid helpers below take an optional grid (default: the normal one).
  _cellOf(x, z, n = this.nav) {
    const c = Math.floor((x - n.minX) / n.cell), r = Math.floor((z - n.minZ) / n.cell);
    return [Math.max(0, Math.min(n.cols - 1, c)), Math.max(0, Math.min(n.rows - 1, r))];
  }

  walkable(x, z, n = this.nav) {
    if (!n) return true;
    const c = Math.floor((x - n.minX) / n.cell), r = Math.floor((z - n.minZ) / n.cell);
    if (c < 0 || r < 0 || c >= n.cols || r >= n.rows) return false;
    return !n.blocked[r * n.cols + c];
  }

  // Nearest walkable cell centre to (x,z) (spiral search). With `comp`, only
  // cells of that connected component count.
  nearestWalkable(x, z, comp = -1, n = this.nav) {
    const [c0, r0] = this._cellOf(x, z, n);
    const maxRad = Math.max(n.cols, n.rows);
    for (let rad = 0; rad < maxRad; rad++) {
      let best = null, bestD = Infinity;
      for (let r = r0 - rad; r <= r0 + rad; r++) {
        const edge = Math.abs(r - r0) === rad;
        for (let c = c0 - rad; c <= c0 + rad; c += edge ? 1 : 2 * rad || 1) {
          if (c < 0 || r < 0 || c >= n.cols || r >= n.rows) continue;
          const i = r * n.cols + c;
          if (n.blocked[i] || (comp >= 0 && n.comp[i] !== comp)) continue;
          const cx = n.minX + (c + 0.5) * n.cell, cz = n.minZ + (r + 0.5) * n.cell;
          const d = (cx - x) ** 2 + (cz - z) ** 2;
          if (d < bestD) { bestD = d; best = new THREE.Vector3(cx, 0, cz); }
        }
      }
      if (best) return best;
    }
    return new THREE.Vector3(x, 0, z);
  }

  // Nearest walkable cell of component `comp` within maxR m of (x,z) that can
  // see the point (x, y, z) from eyeH m up (so it doesn't stop on the wrong side
  // of a wall). null if there's none.
  nearestVisible(x, z, y, comp, maxR = 6, eyeH = 3, n = this.nav) {
    const [c0, r0] = this._cellOf(x, z, n), R = Math.ceil(maxR / n.cell);
    const to = new THREE.Vector3(x, y, z), from = new THREE.Vector3();
    const cands = [];
    for (let r = r0 - R; r <= r0 + R; r++) {
      for (let c = c0 - R; c <= c0 + R; c++) {
        if (c < 0 || r < 0 || c >= n.cols || r >= n.rows) continue;
        const i = r * n.cols + c;
        if (n.blocked[i] || n.comp[i] !== comp) continue;
        const cx = n.minX + (c + 0.5) * n.cell, cz = n.minZ + (r + 0.5) * n.cell;
        const d = (cx - x) ** 2 + (cz - z) ** 2;
        if (d <= maxR * maxR) cands.push([d, cx, cz]);
      }
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz] of cands) {
      const g = this.heightFn ? this.heightFn(cx, cz) : 0;
      if (this.lineOfSight(from.set(cx, g + eyeH, cz), to)) return new THREE.Vector3(cx, 0, cz);
    }
    return null;
  }

  // Connected component of the cell at (x,z), or -1 if it's blocked.
  compAt(x, z, n = this.nav) {
    const [c, r] = this._cellOf(x, z, n);
    const i = r * n.cols + c;
    return n.blocked[i] ? -1 : n.comp[i];
  }

  // Walkable straight line on the grid (for path smoothing).
  _clearLine(ax, az, bx, bz, n = this.nav) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (n.cell * 0.4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.walkable(ax + (bx - ax) * t, az + (bz - az) * t, n)) return false;
    }
    return true;
  }

  // A* on the grid. Returns an array of Vector3 waypoints (y = 0) or null.
  findPath(from, to, n = this.nav) {
    if (!n) return [to.clone()];
    // start: snap onto the main walkable area if we're off it (pushed into a
    // corner, knocked back...); goal: the closest point we can actually get to
    let start = this._cellOf(from.x, from.z, n);
    if (this.compAt(from.x, from.z, n) !== n.main) {
      const w = this.nearestWalkable(from.x, from.z, n.main, n);
      start = this._cellOf(w.x, w.z, n);
    }
    const sComp = n.comp[start[1] * n.cols + start[0]];
    let goalP = to;
    if (this.compAt(to.x, to.z, n) !== sComp) goalP = this.nearestWalkable(to.x, to.z, sComp, n);
    const goal = this._cellOf(goalP.x, goalP.z, n);
    if (this._clearLine(from.x, from.z, goalP.x, goalP.z, n)) return [new THREE.Vector3(goalP.x, 0, goalP.z)];

    // A* with buffers kept per grid (no garbage per call: it runs several times a
    // second and fresh arrays every time meant GC hitches) and a typed binary heap
    const N = n.cols * n.rows, cols = n.cols, blocked = n.blocked;
    const A = n.astar ||= { g: new Float32Array(N), came: new Int32Array(N), seen: new Uint32Array(N), closed: new Uint32Array(N), gen: 0, hf: new Float32Array(4096), hi: new Int32Array(4096) };
    const gen = ++A.gen;
    let hf = A.hf, hi = A.hi, size = 0;
    const push = (f, i) => {
      if (size === hf.length) {
        const nf = new Float32Array(size * 2); nf.set(hf); hf = A.hf = nf;
        const ni = new Int32Array(size * 2); ni.set(hi); hi = A.hi = ni;
      }
      let k = size++;
      while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= f) break; hf[k] = hf[p]; hi[k] = hi[p]; k = p; }
      hf[k] = f; hi[k] = i;
    };
    const pop = () => {
      const top = hi[0];
      if (--size > 0) {
        const f = hf[size], i = hi[size];
        let k = 0;
        for (;;) {
          let c = 2 * k + 1;
          if (c >= size) break;
          if (c + 1 < size && hf[c + 1] < hf[c]) c++;
          if (hf[c] >= f) break;
          hf[k] = hf[c]; hi[k] = hi[c]; k = c;
        }
        hf[k] = f; hi[k] = i;
      }
      return top;
    };
    const si = start[1] * cols + start[0], gi = goal[1] * cols + goal[0], gc = goal[0], gr = goal[1];
    const h = (c, r) => { const dx = Math.abs(c - gc), dz = Math.abs(r - gr); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    A.seen[si] = gen; A.g[si] = 0; A.came[si] = -1;
    push(h(start[0], start[1]), si);
    let found = false, iter = 0;
    while (size && iter++ < N * 2) {
      const cur = pop();
      if (cur === gi) { found = true; break; }
      if (A.closed[cur] === gen) continue;
      A.closed[cur] = gen;
      const cc = cur % cols, cr = (cur / cols) | 0, g0 = A.g[cur];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nc = cc + dx, nr = cr + dz;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= n.rows) continue;
          const ni = nr * cols + nc;
          if (blocked[ni] || A.closed[ni] === gen) continue;
          if (dx && dz && (blocked[cr * cols + nc] || blocked[nr * cols + cc])) continue; // no corner cutting
          const g = g0 + (dx && dz ? 1.414 : 1);
          if (A.seen[ni] !== gen || g < A.g[ni]) { A.seen[ni] = gen; A.g[ni] = g; A.came[ni] = cur; push(g + h(nc, nr), ni); }
        }
      }
    }
    if (!found) return null;

    // keep only the corners of the grid path, then string-pull: from each point
    // go to the furthest corner after it that's in a straight walkable line
    const cells = [];
    for (let i = gi; i !== -1; i = A.came[i]) cells.push(i);
    cells.reverse();
    const pts = [];
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      if (k > 0 && k < cells.length - 1) {
        const a = cells[k - 1], b = cells[k + 1];
        if (i - a === b - i) continue; // same step in and out: not a corner
      }
      pts.push(new THREE.Vector3(n.minX + ((i % cols) + 0.5) * n.cell, 0, n.minZ + (((i / cols) | 0) + 0.5) * n.cell));
    }
    pts[pts.length - 1].set(goalP.x, 0, goalP.z);
    const out = [];
    let ax = from.x, az = from.z, k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) {
        if (this._clearLine(ax, az, pts[j].x, pts[j].z, n)) { far = j; break; }
      }
      out.push(pts[far]);
      ax = pts[far].x; az = pts[far].z;
      k = far + 1;
    }
    return out;
  }
}
