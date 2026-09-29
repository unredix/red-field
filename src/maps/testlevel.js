import * as THREE from 'three';
import {
  concreteTexture, floorTexture, crateTexture, metalTexture, labelTexture,
} from '../textures.js';

// Movement test level (load with ?map=test). built from axis-aligned boxes.
// Every solid box is also pushed into `colliders` (THREE.Box3) which the
// player controller collides against. When you add real models later, keep
// using simple invisible boxes for collision (see addCollider).

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Scale BoxGeometry UVs so textures tile in world units instead of stretching.
function worldUVs(geo, w, h, d, texWorldSize) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, (uv.getX(idx) * dims[f][0]) / texWorldSize, (uv.getY(idx) * dims[f][1]) / texWorldSize);
    }
  }
  uv.needsUpdate = true;
}

export function buildTestLevel(scene, world) {
  const colliders = world.colliders;

  const tex = {
    concrete: concreteTexture(),
    floor: floorTexture(),
    crate: crateTexture(),
    metal: metalTexture(),
  };

  const mat = {
    concrete: new THREE.MeshStandardMaterial({ map: tex.concrete, bumpMap: tex.concrete, bumpScale: 1.5, roughness: 0.95 }),
    floor: new THREE.MeshStandardMaterial({ map: tex.floor, bumpMap: tex.floor, bumpScale: 1.5, roughness: 0.85 }),
    crate: new THREE.MeshStandardMaterial({ map: tex.crate, bumpMap: tex.crate, bumpScale: 2, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ map: tex.metal, bumpMap: tex.metal, bumpScale: 1, roughness: 0.55, metalness: 0.35 }),
    barrelRed: new THREE.MeshStandardMaterial({ map: tex.metal, color: 0xa03322, roughness: 0.5, metalness: 0.3 }),
    barrelBlue: new THREE.MeshStandardMaterial({ map: tex.metal, color: 0x2f4a7a, roughness: 0.5, metalness: 0.3 }),
  };
  // texture world size (metres per repeat); crates use per-face UVs
  const texWorld = { concrete: 3, floor: 4, metal: 2, crate: 0 };

  function addCollider(minX, minY, minZ, maxX, maxY, maxZ) {
    const b = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
    colliders.push(b);
    return b;
  }

  // x,z = centre, y = bottom
  function box(x, y, z, w, h, d, m = 'concrete') {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (texWorld[m]) worldUVs(geo, w, h, d, texWorld[m]);
    const mesh = new THREE.Mesh(geo, mat[m]);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    addCollider(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2);
    return mesh;
  }

  function crate(x, y, z, s = 1.2, rotY = 0) {
    const m = box(x, y, z, s, s, s, 'crate');
    m.rotation.y = rotY; // visual only; tiny rotations keep collision believable
    return m;
  }

  function barrel(x, z, m = 'barrelRed', y = 0) {
    const geo = new THREE.CylinderGeometry(0.35, 0.35, 0.95, 16);
    const mesh = new THREE.Mesh(geo, mat[m]);
    mesh.position.set(x, y + 0.475, z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    addCollider(x - 0.35, y, z - 0.35, x + 0.35, y + 0.95, z + 0.35);
  }

  // Straight stairs rising along +x or -x / +z or -z.
  function stairs(x, z, dirX, dirZ, steps, stepH, stepD, width, m = 'concrete') {
    for (let i = 0; i < steps; i++) {
      const h = stepH * (i + 1);
      const cx = x + dirX * (i * stepD + stepD / 2);
      const cz = z + dirZ * (i * stepD + stepD / 2);
      const w = dirX !== 0 ? stepD : width;
      const d = dirZ !== 0 ? stepD : width;
      box(cx, 0, cz, w, h, d, m);
    }
  }

  function label(text, x, y, z, rotY = 0, w = 1, h = 0.5, color = '#ddd') {
    const m = new THREE.MeshStandardMaterial({ map: labelTexture(text, color), transparent: true, roughness: 1 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    scene.add(mesh);
    return mesh;
  }

  function glowSign(text, x, y, z, rotY, color = '#3f6') {
    const m = new THREE.MeshBasicMaterial({ map: labelTexture(text, color, '#0a120c', 256, 96) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    scene.add(mesh);
  }

  // ---------------------------------------------------------------- ground & bounds
  box(0, -1, 0, 100, 1, 100, 'floor');
  box(0, 0, -50.5, 102, 8, 1);
  box(0, 0, 50.5, 102, 8, 1);
  box(-50.5, 0, 0, 1, 8, 100);
  box(50.5, 0, 0, 1, 8, 100);

  // ---------------------------------------------------------------- spawn area / pillar hall
  for (const px of [-8, -4, 4, 8]) {
    for (const pz of [-4, -10]) box(px, 0, pz, 0.8, 7, 0.8);
  }
  // table
  box(-6, 0, -7, 1.6, 0.78, 0.9, 'crate');
  // barrels
  barrel(6, -7); barrel(6.8, -7.4, 'barrelBlue'); barrel(6.3, -6.2);
  barrel(6.4, -6.8, 'barrelRed', 0.95); // stacked
  // scattered crates
  crate(1.5, 0, -12, 1.2, 0.1);
  crate(-1.2, 0, -13, 1.0, -0.2);
  crate(-1.2, 1.0, -13, 0.8, 0.3);
  // doorway frame
  box(-1.6, 0, -16, 0.4, 3, 0.4);
  box(1.6, 0, -16, 0.4, 3, 0.4);
  box(0, 3, -16, 3.6, 0.4, 0.4);

  // ---------------------------------------------------------------- height test lane (west of spawn)
  const heights = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
  heights.forEach((h, i) => {
    const x = -8 - i * 2;
    box(x, 0, 4, 1.6, h, 1);
    label(`${h.toFixed(1)}m`, x, Math.min(h, 1.2) - 0.25, 4.51, 0, 0.8, 0.4);
  });

  // ---------------------------------------------------------------- warehouse (north)
  for (const rx of [-15, -10, 10, 15]) box(rx, 0, -32, 1.4, 4, 12, 'metal');
  // parkour chain onto a rack: 1.2 -> 2.4 -> rack 4.0
  crate(-12.5, 0, -24);
  crate(-12.5, 0, -25.4); crate(-12.5, 1.2, -25.4);
  crate(-12.5, 0, -26.8); crate(-12.5, 1.2, -26.8); crate(-12.5, 2.4, -26.8, 1.2, 0.05);
  // random crate piles
  const rnd = mulberry32(7);
  for (let i = 0; i < 18; i++) {
    const x = -6 + rnd() * 12;
    const z = -22 - rnd() * 22;
    const s = 0.9 + rnd() * 0.7;
    crate(x, 0, z, s, (rnd() - 0.5) * 0.3);
    if (rnd() < 0.35) crate(x, s, z, s * 0.8, (rnd() - 0.5) * 0.4);
  }
  // high catwalk across the racks
  box(0, 4, -38, 31.4, 0.2, 1.4, 'metal');

  // ---------------------------------------------------------------- wall-run course (east)
  stairs(10.4, 0, 1, 0, 12, 0.25, 0.55, 3); // rises to 3m at x=17
  box(20, 0, 0, 6, 3, 6);  // platform A (x 17..23)
  box(36, 0, 0, 6, 3, 6);  // platform B (x 33..39)
  box(28, 0, -3.5, 12, 7, 1); // run walls on both sides of the 10m gap
  box(28, 0, 3.5, 12, 7, 1);
  crate(37.5, 3, 1.5);
  label('WALL RUN →', 24, 4.4, -2.99, 0, 1.6, 0.5, '#c44');

  // ---------------------------------------------------------------- wall-jump chimney (west)
  box(-30.5, 0, -10, 1, 8, 8); // x -31..-30
  box(-27.5, 0, -10, 1, 8, 8); // x -28..-27  => 2m gap
  box(-29, 0, -15, 4, 8, 2);    // closes the far end; mantle onto its top
  label('WALL JUMP ↑', -29, 2.2, -13.99, 0, 1.6, 0.5, '#c44');
  // single freestanding wall for kicks / wall runs
  box(-40, 0, -6, 1, 6, 10);

  // ---------------------------------------------------------------- crawl tunnel (south-west)
  // block x -38..-32, z 5..15, tunnel 1.4 wide, 1.2 high along z
  box(-36.85, 0, 10, 2.3, 3, 10);
  box(-33.15, 0, 10, 2.3, 3, 10);
  box(-35, 1.2, 10, 1.4, 1.8, 10);
  label('CROUCH', -35, 2, 4.99, Math.PI, 1.2, 0.45, '#c44');
  label('CROUCH', -35, 2, 15.01, 0, 1.2, 0.45, '#c44');

  // ---------------------------------------------------------------- maze (south, with a ceiling)
  {
    const cols = 8, rows = 6, cell = 3.2, t = 0.3, wallH = 3.2;
    const ox = -(cols * cell) / 2, oz = 16;
    const mrnd = mulberry32(1337);
    const hW = Array.from({ length: rows + 1 }, () => Array(cols).fill(true));
    const vW = Array.from({ length: rows }, () => Array(cols + 1).fill(true));
    const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
    const stack = [[0, 0]];
    seen[0][0] = true;
    while (stack.length) {
      const [r, c] = stack[stack.length - 1];
      const n = [];
      if (r > 0 && !seen[r - 1][c]) n.push([r - 1, c, () => (hW[r][c] = false)]);
      if (r < rows - 1 && !seen[r + 1][c]) n.push([r + 1, c, () => (hW[r + 1][c] = false)]);
      if (c > 0 && !seen[r][c - 1]) n.push([r, c - 1, () => (vW[r][c] = false)]);
      if (c < cols - 1 && !seen[r][c + 1]) n.push([r, c + 1, () => (vW[r][c + 1] = false)]);
      if (!n.length) { stack.pop(); continue; }
      const [nr, nc, carve] = n[Math.floor(mrnd() * n.length)];
      carve();
      seen[nr][nc] = true;
      stack.push([nr, nc]);
    }
    const entrance = 4, exit = 3;
    hW[0][entrance] = false;
    hW[rows][exit] = false;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (hW[r][c]) box(ox + c * cell + cell / 2, 0, oz + r * cell, cell + t, wallH, t);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) {
        if (vW[r][c]) box(ox + c * cell, 0, oz + r * cell + cell / 2, t, wallH, cell + t);
      }
    }
    box(0, wallH, oz + (rows * cell) / 2, cols * cell + t, 0.2, rows * cell + t); // ceiling
    glowSign('EXIT', ox + exit * cell + cell / 2, wallH - 0.25, oz + rows * cell - 0.2, Math.PI);
    label('MAZE', ox + entrance * cell + cell / 2, wallH - 0.4, oz - 0.16, Math.PI, 1.2, 0.45, '#c44');
  }

  // ---------------------------------------------------------------- catwalk + tower (south-east)
  stairs(18, 22, 1, 0, 12, 0.25, 0.55, 3); // x 18..24.6 up to 3m
  box(32.3, 2.8, 22, 15.4, 0.2, 1.2, 'metal');     // catwalk deck
  for (let x = 26; x <= 38; x += 4) box(x, 0, 22, 0.15, 2.8, 0.15, 'metal'); // posts
  box(32.3, 3.9, 21.35, 15.4, 0.06, 0.06, 'metal'); // rails
  box(32.3, 3.9, 22.65, 15.4, 0.06, 0.06, 'metal');
  box(42, 0, 22, 6, 3, 6); // tower base (x 39..45)
  box(42, 3, 19.05, 6, 1, 0.1, 'metal'); // tower railings
  box(42, 3, 24.95, 6, 1, 0.1, 'metal');
  box(44.95, 3, 22, 0.1, 1, 6, 'metal');
  box(42.5, 3, 22, 2, 2, 2); // block on top to mantle
  crate(40.2, 3, 23.8, 1.0);

  // ---------------------------------------------------------------- misc scatter
  barrel(-20, 20, 'barrelBlue'); barrel(-20.8, 20.4); barrel(-44, -44); barrel(44, -44, 'barrelBlue');
  crate(-22, 0, 28); crate(-22, 0, 29.3, 1.2, 0.2); crate(-22, 1.2, 28.6, 1.0, -0.15);
  box(22, 0, -20, 8, 1.2, 0.4); // low wall to vault
  box(22, 0, -24, 8, 2.0, 0.4);
  box(22, 0, -28, 8, 3.0, 0.4);

  return {
    spawn: new THREE.Vector3(0, 0, 8),
    spawnYaw: 0, // facing -Z (north)
  };
}
