import * as THREE from 'three';
import { mudTexture, glowTexture } from '../textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Pieces shared by every outdoor map (classic Red Field and generated maps):
// terrain mesh, sky/castle backdrop, embers, path distance and prop placement.

export const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Terrain mesh from a height function; colorFn(x, z, color) sets each vertex colour.
export function buildTerrain(scene, half, heightFn, colorFn) {
  const size = half * 2 + 90, seg = 190;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, heightFn(x, z));
    colorFn(x, z, c);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const tex = mudTexture();
  tex.repeat.set(size / 4, size / 4);
  const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 2.5, vertexColors: true, roughness: 0.92 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
}

// Sample a field (height, distance...) once into a grid (bilinear lookups
// afterwards), so a rich generated terrain costs the same at runtime as a simple one.
export function bakeField(fn, extent, cell = 0.5) {
  const n = Math.ceil((extent * 2) / cell) + 1;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = fn(-extent + i * cell, -extent + j * cell);
  const inv = 1 / cell, max = n - 1.001;
  return (x, z) => {
    let fx = (x + extent) * inv, fz = (z + extent) * inv;
    fx = fx < 0 ? 0 : fx > max ? max : fx;
    fz = fz < 0 ? 0 : fz > max ? max : fz;
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * n + i;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + n] * (1 - u) + h[k + n + 1] * u) * v;
  };
}

export const bakeHeight = bakeField;

// Seeded 2D value noise in [-1, 1] (smooth, tileless) and a fractal sum of it.
export function makeNoise(rnd) {
  const N = 256, mask = N - 1;
  const perm = new Uint8Array(N * 2), val = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; val[i] = rnd() * 2 - 1; }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i];
  const at = (i, j) => val[perm[perm[i & mask] + (j & mask)]];
  const noise = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = at(xi, zi), b = at(xi + 1, zi), c = at(xi, zi + 1), d = at(xi + 1, zi + 1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
  const fbm = (x, z, oct = 4) => {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { s += amp * noise(x * f, z * f); norm += amp; amp *= 0.5; f *= 2.03; }
    return s / norm;
  };
  return { noise, fbm };
}

// Distance to the nearest of a set of polylines ([[x, z], ...]).
export function makePathDist(paths) {
  return (x, z) => {
    let best = Infinity;
    for (const path of paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, az] = path[i], [bx, bz] = path[i + 1];
        const dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        if (d < best) best = d;
      }
    }
    return best;
  };
}

// Placement bookkeeping: reserved discs + spacing between solid props.
export function makePlacer({ rnd, half, reserved = [], pathDist = () => Infinity, ok = null }) {
  const R = (a, b) => a + rnd() * (b - a);
  const solids = [];
  const clear = (x, z, r, spacing = 1) => {
    if (Math.abs(x) > half - 3 || Math.abs(z) > half - 3) return false;
    if (ok && !ok(x, z, r)) return false; // e.g. too steep
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
  return { R, clear, claim, scatter, reserved, solids };
}

// Tileable fbm noise baked once into a texture (much cheaper than per-pixel noise).
export function cloudTexture(size = 256) {
  const period = 8;
  const lattice = Array.from({ length: 5 }, () => Float32Array.from({ length: 128 * 128 }, Math.random));
  const vnoise = (x, y, oct) => {
    const p = period << oct, L = lattice[oct];
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const at = (a, b) => L[((a % p + p) % p) * 128 + ((b % p + p) % p)];
    return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v;
  };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0, a = 0.5;
      for (let o = 0; o < 5; o++) {
        const f = (period << o) / size;
        n += a * vnoise(x * f, y * f, o);
        a *= 0.5;
      }
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.min(255, n * 255); data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Sky + castle form a "backdrop" that follows the camera and is drawn first
// without depth test, so the camera far plane can stay short (fog hides the rest).
export function buildBackdrop(scene) {
  const backdrop = new THREE.Group();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: { uTime: { value: 0 }, uFog: { value: scene.fog.color }, uClouds: { value: cloudTexture() } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uFog;
      uniform sampler2D uClouds;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 horizon = vec3(0.16, 0.012, 0.008);
        vec3 low = vec3(0.035, 0.003, 0.002);
        vec3 top = vec3(0.004, 0.0, 0.0);
        vec3 col = mix(horizon, low, smoothstep(0.0, 0.14, y));
        col = mix(col, top, smoothstep(0.14, 0.6, y));
        vec2 uv = vDir.xz / (y + 0.18) * 1.2 + vec2(uTime * 0.012, uTime * 0.005);
        float c = texture2D(uClouds, uv * 0.12).r * 0.75 + texture2D(uClouds, uv * 0.37 + 0.3).r * 0.25;
        float cl = smoothstep(0.42, 0.78, c);
        vec3 lit = mix(vec3(0.003, 0.0, 0.0), vec3(0.09, 0.008, 0.006), smoothstep(0.35, 0.0, y));
        col = mix(col, lit * (0.5 + c), cl * smoothstep(-0.02, 0.08, y));
        col = mix(uFog, col, smoothstep(-0.08, 0.02, y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), skyMat);
  dome.renderOrder = -3;
  dome.frustumCulled = false;
  backdrop.add(dome);

  // castle silhouette (scaled down and moved in so it fits inside the dome)
  const dark = new THREE.MeshBasicMaterial({ color: 0x030000, fog: false, depthTest: false, depthWrite: false });
  const castle = new THREE.Group();
  const towers = [[0, 55, 7], [-14, 38, 5], [13, 42, 5], [-24, 26, 4], [24, 30, 4], [-7, 46, 4], [7, 49, 4]];
  const parts = [];
  for (const [x, h, r] of towers) {
    const t = new THREE.CylinderGeometry(r * 0.8, r, h, 8); t.translate(x, h / 2, 0); parts.push(t);
    const sp = new THREE.ConeGeometry(r * 0.9, h * 0.45, 8); sp.translate(x, h + h * 0.22, 0); parts.push(sp);
  }
  const base = new THREE.BoxGeometry(60, 18, 20); base.translate(0, 9, 0);
  parts.push(base);
  castle.add(new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed()), false), dark));
  const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.08), fog: false, depthTest: false, depthWrite: false });
  const cy = 55 + 55 * 0.45 + 6;
  const vGeo = new THREE.BoxGeometry(1.2, 14, 1.2); vGeo.translate(0, cy, 0);
  const hGeo = new THREE.BoxGeometry(8, 1.2, 1.2); hGeo.translate(0, cy + 3, 0);
  const v = new THREE.Mesh(mergeGeometries([vGeo, hGeo], false), red);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,40,20,0.9)', 'rgba(255,0,0,0)'), blending: THREE.AdditiveBlending, fog: false, depthWrite: false,
  }));
  glow.scale.set(60, 60, 1);
  glow.position.set(0, cy, 2);
  castle.add(v, glow);
  castle.traverse((o) => { if (o.isMesh) { o.renderOrder = o.material === red ? -1 : -2; o.frustumCulled = false; } });
  castle.scale.setScalar(0.55);
  castle.position.set(-6, -12, -84);
  backdrop.add(castle);
  scene.add(backdrop);
  return { backdrop, skyMat };
}

export function buildEmbers(scene) {
  const N = 450;
  const pos = new Float32Array(N * 3);
  const spd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos.set([(Math.random() - 0.5) * 60, Math.random() * 18, (Math.random() - 0.5) * 60], i * 3);
    spd[i] = 0.3 + Math.random() * 0.9;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.09, map: glowTexture('rgba(255,120,60,1)', 'rgba(255,20,0,0)'), color: 0xff5530,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return {
    update(dt, time, cam) {
      const a = geo.attributes.position;
      for (let i = 0; i < N; i++) {
        let x = a.getX(i), y = a.getY(i), z = a.getZ(i);
        y += spd[i] * dt;
        x += Math.sin(time * 0.7 + i) * 0.3 * dt + 0.25 * dt;
        z += Math.cos(time * 0.5 + i * 1.3) * 0.3 * dt;
        if (x - cam.x > 30) x -= 60; else if (x - cam.x < -30) x += 60;
        if (z - cam.z > 30) z -= 60; else if (z - cam.z < -30) z += 60;
        if (y - cam.y > 14) y -= 18;
        if (y - cam.y < -4) y += 18;
        a.setXYZ(i, x, y, z);
      }
      a.needsUpdate = true;
    },
  };
}

