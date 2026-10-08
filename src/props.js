import * as THREE from 'three';
import { mulberry32 } from './world.js';
import { ChunkBatcher } from './batch.js';
import {
  woodTexture, burlapTexture, rockTexture, concreteTexture, beachBallTexture, leafTexture,
  drumShellTexture, drumSkinTexture,
} from './textures.js';

// Procedural placeholder props for the red field. Each builder adds meshes to
// the scene and colliders to the world. Swap meshes for GLB models later but
// keep the collider calls.

const _dummy = new THREE.Object3D();
const HOLE_MAT = new THREE.MeshStandardMaterial({ color: 0x050202, roughness: 1 });

// Instruments are also used by the monster, so they're standalone.
export function makeGuitar(bodyMat, neckMat, scale = 1) {
  const g = new THREE.Group();
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 20), bodyMat);
  lower.rotation.x = Math.PI / 2; lower.position.y = 0.2;
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 20), bodyMat);
  upper.rotation.x = Math.PI / 2; upper.position.y = 0.43;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), HOLE_MAT);
  hole.position.set(0, 0.34, 0.041);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.03), neckMat);
  neck.position.y = 0.82;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.025), neckMat);
  head.position.y = 1.18; head.rotation.x = -0.2;
  g.add(lower, upper, hole, neck, head);
  g.scale.setScalar(scale);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export class PropKit {
  constructor(scene, world, seed = 42) {
    this.scene = scene;
    this.world = world;
    this.rnd = mulberry32(seed);

    const wood = woodTexture();
    const rock = rockTexture();
    rock.repeat.set(1.5, 1.5);
    const concrete = concreteTexture();
    const shell = drumShellTexture();
    this.mat = {
      wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.9 }),
      burlap: new THREE.MeshStandardMaterial({ map: burlapTexture(), roughness: 1 }),
      black: new THREE.MeshStandardMaterial({ color: 0x050303, roughness: 0.4 }),
      pin: new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.8, roughness: 0.3 }),
      pinHead: new THREE.MeshStandardMaterial({ color: 0xaa1111, roughness: 0.4 }),
      rock: new THREE.MeshStandardMaterial({ map: rock, bumpMap: rock, bumpScale: 3, roughness: 0.95, flatShading: true }),
      concrete: new THREE.MeshStandardMaterial({ map: concrete, color: 0x9a8a80, roughness: 0.9 }),
      piano: new THREE.MeshStandardMaterial({ color: 0x0c0808, roughness: 0.22, metalness: 0.1 }),
      ivory: new THREE.MeshStandardMaterial({ color: 0xc8b89a, roughness: 0.5 }),
      blood: new THREE.MeshStandardMaterial({ color: 0x3a0202, roughness: 0.06, metalness: 0.4, emissive: 0x120000 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.9, roughness: 0.25 }),
      guitarRed: new THREE.MeshStandardMaterial({ color: 0x7a1510, roughness: 0.35 }),
      guitarWood: new THREE.MeshStandardMaterial({ color: 0x6a3a1a, roughness: 0.5 }),
      neck: new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.6 }),
      ball: new THREE.MeshStandardMaterial({ map: beachBallTexture(), roughness: 0.4 }),
      leaf: new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.35, color: 0xffffff }),
      stone: new THREE.MeshStandardMaterial({ map: concrete, color: 0x6e6460, roughness: 0.95 }),
      chapel: new THREE.MeshStandardMaterial({ map: concrete, bumpMap: concrete, bumpScale: 2, color: 0x7a605a, roughness: 0.95 }),
      bark: new THREE.MeshStandardMaterial({ map: wood, color: 0x6a5048, roughness: 1 }),
      shell: new THREE.MeshStandardMaterial({ map: shell, roughness: 0.35, metalness: 0.2 }),
      skin: new THREE.MeshStandardMaterial({ map: drumSkinTexture(), roughness: 0.7 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xa8843a, metalness: 0.85, roughness: 0.35 }),
      speaker: new THREE.MeshStandardMaterial({ color: 0x141212, roughness: 0.8 }),
      cone: new THREE.MeshStandardMaterial({ color: 0x2a2626, roughness: 0.6 }),
      candle: new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.6 }),
      flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, 0.3) }),
      rope: new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 1 }),
    };
    this._grassMats = [];
    this.instChunks = [];
    this.batcher = new ChunkBatcher(scene, 35);
    this.added = [];             // every placed prop (generated maps may remove some)
    this.boulderCols = new Set(); // colliders that belong to boulders
  }

  g(x, z) { const h = this.world.groundHeight(x, z); return Number.isFinite(h) ? h : 0; }

  _add(obj) {
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(obj);
    this.batcher.add(obj); // merged into chunks by bake()
    this.added.push(obj);
    return obj;
  }

  // Remove a collider and the props standing on it (before bake()).
  // Generated maps use this to open up pockets the monster can't reach.
  removeCollider(box) {
    const i = this.world.colliders.indexOf(box);
    if (i >= 0) this.world.colliders.splice(i, 1);
    this.world._gridDirty = true;
    this.boulderCols.delete(box);
    const on = (o) => o.position.x > box.min.x - 0.1 && o.position.x < box.max.x + 0.1 &&
      o.position.z > box.min.z - 0.1 && o.position.z < box.max.z + 0.1;
    const gone = new Set(this.added.filter(on));
    for (const o of gone) o.parent?.remove(o);
    this.batcher.pending = this.batcher.pending.filter((o) => !gone.has(o));
    this.added = this.added.filter((o) => !gone.has(o));
  }

  // Call once after all props are placed.
  bake() { return this.batcher.bake(); }

  _colliderFrom(obj, shrink = 1, topScale = 1) {
    obj.updateWorldMatrix(true, true); // parents too: a part of a group must use the group's placement
    const b = new THREE.Box3().setFromObject(obj);
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const hx = ((b.max.x - b.min.x) / 2) * shrink, hz = ((b.max.z - b.min.z) / 2) * shrink;
    const top = b.min.y + (b.max.y - b.min.y) * topScale;
    return this.world.addCollider(cx - hx, b.min.y - 0.5, cz - hz, cx + hx, top, cz + hz);
  }

  // ---------------------------------------------------------------- cross + voodoo doll
  doll() {
    const d = new THREE.Group();
    const m = this.mat.burlap;
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), m);
    body.scale.set(0.19, 0.25, 0.13);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), m);
    head.position.y = 0.37;
    const armGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.32, 8);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, m);
      arm.position.set(s * 0.3, 0.14, 0); arm.rotation.z = s * (Math.PI / 2 - 0.15);
      const leg = new THREE.Mesh(armGeo, m);
      leg.position.set(s * 0.09, -0.35, 0); leg.rotation.z = s * 0.12;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), this.mat.black);
      eye.position.set(s * 0.06, 0.4, 0.14); eye.scale.z = 0.4;
      d.add(arm, leg, eye);
    }
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.01), this.mat.black);
    mouth.position.set(0, 0.3, 0.15);
    d.add(body, head, mouth);
    // pins
    const pinGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.22, 4);
    const headGeo = new THREE.SphereGeometry(0.022, 6, 5);
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Group();
      const shaft = new THREE.Mesh(pinGeo, this.mat.pin); shaft.position.y = 0.11;
      const ph = new THREE.Mesh(headGeo, this.mat.pinHead); ph.position.y = 0.22;
      p.add(shaft, ph);
      p.position.set((this.rnd() - 0.5) * 0.2, (this.rnd() - 0.3) * 0.45, 0.08);
      p.rotation.set(Math.PI / 2 - 0.4 + this.rnd() * 0.8, 0, (this.rnd() - 0.5) * 1.5);
      d.add(p);
    }
    return d;
  }

  cross(x, z, h = 3.2, rotY = 0, tilt = 0, withDoll = true) {
    const grp = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, h + 0.5, 0.22), this.mat.wood);
    post.position.y = h / 2 - 0.25;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 0.2), this.mat.wood);
    beam.position.y = h - 0.85;
    grp.add(post, beam);
    if (withDoll) {
      const d = this.doll();
      d.position.set(0, h - 1.2, 0.2);
      d.rotation.z = (this.rnd() - 0.5) * 0.3;
      d.scale.setScalar(1.4 + this.rnd() * 0.6);
      grp.add(d);
    }
    grp.position.set(x, this.g(x, z), z);
    grp.rotation.set(0, rotY, tilt);
    this._add(grp);
    const gy = this.g(x, z);
    this.world.addCollider(x - 0.16, gy - 0.5, z - 0.16, x + 0.16, gy + h, z + 0.16);
    return grp;
  }

  // ---------------------------------------------------------------- broken grand piano
  piano(x, z, rotY = 0) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 1.9), this.mat.piano);
    body.position.set(0, 0.88, 0);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.35, 20, 1, false, 0, Math.PI), this.mat.piano);
    tail.position.set(0, 0.88, 0.95);
    tail.rotation.y = -Math.PI / 2;
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0.75, 1.07, 0.2);
    lidPivot.rotation.z = 0.7;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 2.2), this.mat.piano);
    lid.position.x = -0.75;
    lidPivot.add(lid);
    const keys = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.28), this.mat.ivory);
    keys.position.set(0, 0.8, -1.08);
    grp.add(body, tail, lidPivot, keys);
    for (let i = 0; i < 14; i++) {
      if (this.rnd() < 0.25) continue; // missing keys
      const k = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.16), this.mat.piano);
      k.position.set(-0.65 + i * 0.1, 0.84, -1.02);
      grp.add(k);
    }
    const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.72, 8);
    for (const [lx, lz] of [[0.6, -0.8], [0.1, 1.5]]) { // one leg missing -> tilted
      const leg = new THREE.Mesh(legGeo, this.mat.piano);
      leg.position.set(lx, 0.36, lz);
      grp.add(leg);
    }
    grp.position.set(x, this.g(x, z) - 0.05, z);
    grp.rotation.set(0.04, rotY, -0.18);
    this._add(grp);
    this._colliderFrom(body, 1, 1);
    return grp;
  }

  // ---------------------------------------------------------------- instruments on the ground
  instrument(type, x, z, rotY, stuck = false) {
    let obj;
    if (type === 'guitar') obj = makeGuitar(this.rnd() < 0.5 ? this.mat.guitarRed : this.mat.guitarWood, this.mat.neck, 1);
    else if (type === 'violin') obj = makeGuitar(this.mat.guitarWood, this.mat.neck, 0.55);
    else obj = makeGuitar(this.mat.guitarWood, this.mat.neck, 1.25); // cello
    const g = this.g(x, z);
    if (stuck) {
      obj.position.set(x, g - 0.25, z);
      obj.rotation.set(0.3 + this.rnd() * 0.4, rotY, (this.rnd() - 0.5) * 0.4);
    } else {
      obj.position.set(x, g + 0.05, z);
      obj.rotation.order = 'YXZ';
      obj.rotation.set(-Math.PI / 2 + 0.05, rotY, 0);
    }
    this._add(obj);
    return obj;
  }

  beachBall(x, z) {
    const r = 0.45;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), this.mat.ball);
    const g = this.g(x, z);
    m.position.set(x, g + r - 0.05, z);
    m.rotation.set(0.4, 1.2, 0.3);
    this._add(m);
    this.world.addCollider(x - 0.32, g - 0.5, z - 0.32, x + 0.32, g + 0.85, z + 0.32);
  }

  // ---------------------------------------------------------------- blood pool
  pool(cx, cz, w, d) {
    const g = this.g(cx, cz);
    const rimW = 0.4, rimH = 0.28;
    const rim = (x, z, sx, sz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, rimH, sz), this.mat.concrete);
      m.position.set(x, g + rimH / 2, z);
      this._add(m);
      this.world.addCollider(x - sx / 2, g - 0.5, z - sz / 2, x + sx / 2, g + rimH, z + sz / 2);
    };
    rim(cx, cz - d / 2 - rimW / 2, w + rimW * 2, rimW);
    rim(cx, cz + d / 2 + rimW / 2, w + rimW * 2, rimW);
    rim(cx - w / 2 - rimW / 2, cz, rimW, d);
    rim(cx + w / 2 + rimW / 2, cz, rimW, d);

    const surf = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.mat.blood);
    surf.rotation.x = -Math.PI / 2;
    surf.position.set(cx, g + 0.22, cz);
    surf.receiveShadow = true;
    this.scene.add(surf);
    this.world.pools.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

    // pool ladders on the north edge
    for (const ox of [-1.2, 1.2]) {
      const lad = new THREE.Group();
      for (const s of [-0.25, 0.25]) {
        const arch = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 12, Math.PI), this.mat.chrome);
        arch.rotation.y = Math.PI / 2;
        arch.position.set(s, rimH + 0.35, 0);
        const down = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), this.mat.chrome);
        down.position.set(s, rimH - 0.05, 0.22);
        lad.add(arch, down);
      }
      for (let i = 0; i < 2; i++) {
        const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), this.mat.chrome);
        rung.rotation.z = Math.PI / 2;
        rung.position.set(0, 0.05 + i * 0.25, 0.22);
        lad.add(rung);
      }
      lad.position.set(cx + ox, g, cz - d / 2 - rimW / 2);
      this._add(lad);
    }
  }

  // ---------------------------------------------------------------- boulders
  boulder(x, z, sx, sy, sz, rotY = 0, collider = true) {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position;
    const seed = this.rnd() * 100;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const n = 1 + 0.18 * Math.sin(vx * 3.1 + seed) * Math.cos(vz * 2.7 + seed * 0.5) + 0.1 * Math.sin(vy * 5.3 + vx * 2 + seed);
      p.setXYZ(i, vx * n, vy * n * (vy < 0 ? 0.6 : 1), vz * n);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.mat.rock);
    m.scale.set(sx, sy, sz);
    m.rotation.y = rotY;
    const g = this.g(x, z);
    m.position.set(x, g + sy * 0.45, z);
    this._add(m);
    if (collider) this.boulderCols.add(this._colliderFrom(m, 0.8, 0.97));
    return m;
  }

  // ---------------------------------------------------------------- grass (instanced, with wind)
  _grassMaterial(color) {
    const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.75 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      mat.userData.shader = shader;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5;
        transformed.x += sin(uTime * 1.6 + ph) * position.y * position.y * 0.12;
        transformed.z += cos(uTime * 1.1 + ph) * position.y * position.y * 0.06;`,
      );
    };
    this._grassMats.push(mat);
    return mat;
  }

  _bladeGeometry() {
    const geo = new THREE.PlaneGeometry(0.09, 1, 1, 4);
    geo.translate(0, 0.5, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) * (1 - y * 0.9));
      p.setZ(i, y * y * 0.15);
    }
    geo.computeVertexNormals();
    return geo;
  }

  // Instanced scatter split into spatial chunks so off-screen / far chunks are culled.
  // items: [{ x, z, y, rx, ry, rz, sx, sy, sz, r, g, b }]
  _instancedChunks(geo, mat, items, { chunk = 20, castShadow = false, far = 50, kind = 'other' } = {}) {
    const buckets = new Map();
    for (const it of items) {
      const key = `${Math.floor(it.x / chunk)},${Math.floor(it.z / chunk)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(it);
    }
    const col = new THREE.Color();
    for (const list of buckets.values()) {
      // shuffle so any prefix is an even subsample (graphics quality draws only the first N)
      // (Math.random, not this.rnd, so the seeded map layout stays the same)
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        _dummy.position.set(it.x, it.y, it.z);
        _dummy.rotation.set(0, it.ry, 0);
        _dummy.rotateX(it.rx);
        _dummy.rotateZ(it.rz);
        _dummy.scale.set(it.sx, it.sy, it.sz);
        _dummy.updateMatrix();
        mesh.setMatrixAt(i, _dummy.matrix);
        mesh.setColorAt(i, col.setRGB(it.r, it.g, it.b));
      });
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      mesh.castShadow = castShadow;
      this.scene.add(mesh);
      this.instChunks.push({ mesh, center: mesh.boundingSphere.center.clone(), radius: mesh.boundingSphere.radius, far, baseFar: far, cap: list.length, kind, castShadow });
    }
  }

  // Scatter blades. zones = [{x,z,r,count,hMin,hMax,avoid?}]; hide=true registers hiding zones.
  grass(zones, color, hide) {
    if (!this._blade) this._blade = this._bladeGeometry();
    const mat = this._grassMaterial(color);
    const items = [];
    const c = new THREE.Color();
    for (const zn of zones) {
      if (hide && !zn.square) this.world.grass.push({ x: zn.x, z: zn.z, r: zn.r * 0.9 });
      for (let i = 0; i < zn.count; i++) {
        let x, z;
        if (zn.square) { x = zn.x + (this.rnd() * 2 - 1) * zn.r; z = zn.z + (this.rnd() * 2 - 1) * zn.r; }
        else { const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * zn.r; x = zn.x + Math.cos(a) * d; z = zn.z + Math.sin(a) * d; }
        if (zn.avoid && zn.avoid(x, z)) continue;
        const h = zn.hMin + this.rnd() * (zn.hMax - zn.hMin);
        c.setHSL(0.99 + this.rnd() * 0.02, 0.7, 0.18 + this.rnd() * 0.12);
        if (zn.tint) zn.tint(x, z, c); // optional per-area colour (generated maps: biome tint)
        items.push({
          x, z, y: this.g(x, z) - 0.05, rx: (this.rnd() - 0.5) * 0.3, ry: this.rnd() * Math.PI * 2, rz: (this.rnd() - 0.5) * 0.3,
          sx: 1 + this.rnd(), sy: h, sz: 1, r: c.r, g: c.g, b: c.b,
        });
      }
    }
    // tall hiding grass stays visible further (it's a landmark); short grass fades in the fog early
    this._instancedChunks(this._blade, mat, items, { chunk: hide ? 30 : 20, castShadow: hide, far: hide ? 70 : 42, kind: hide ? 'tallGrass' : 'grass' });
  }

  // Broad red leaves (instanced). list = [[x, z, scale]]
  plants(list) {
    const leafGeo = new THREE.PlaneGeometry(0.55, 1.0);
    leafGeo.translate(0, 0.5, 0);
    const items = [];
    for (const [x, z, s] of list) {
      const g = this.g(x, z);
      for (let i = 0; i < 8; i++) {
        const ls = s * (0.6 + this.rnd() * 0.6);
        items.push({
          x, z, y: g, ry: (i / 8) * Math.PI * 2 + this.rnd() * 0.5, rx: 0.5 + this.rnd() * 0.7, rz: 0,
          sx: ls, sy: ls, sz: ls, r: 0.7 + this.rnd() * 0.3, g: 0.1 + this.rnd() * 0.1, b: 0.1,
        });
      }
    }
    this._instancedChunks(leafGeo, this.mat.leaf, items, { chunk: 30, castShadow: true, far: 60 });
  }

  // ---------------------------------------------------------------- ruined shed (axis aligned)
  // w along x, d along z, doorways of `door` width in the north and south walls.
  shed(cx, cz, w = 7.5, d = 6, door = 4.4) {
    const g = this.g(cx, cz);
    const H = 2.6, t = 0.18;
    const wall = (x, z, sx, sz, h = H, y = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), this.mat.wood);
      m.position.set(x, g + y + h / 2, z);
      this._add(m);
      this.world.addCollider(x - sx / 2, g + y - 0.5, z - sz / 2, x + sx / 2, g + y + h, z + sz / 2);
    };
    const seg = (w - door) / 2;
    for (const zz of [cz - d / 2, cz + d / 2]) {
      wall(cx - w / 2 + seg / 2, zz, seg, t);
      wall(cx + w / 2 - seg / 2, zz, seg, t);
      wall(cx, zz, door, t, 0.4, H - 0.4); // lintel
    }
    wall(cx - w / 2, cz, t, d);
    wall(cx + w / 2, cz, t, d);
    // half-collapsed roof: flat north half + a fallen slab
    wall(cx, cz - d / 4, w + 0.3, d / 2 + 0.2, 0.15, H);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.12, d / 2), this.mat.wood);
    slab.position.set(cx + 0.3, g + 1.2, cz + d / 4 + 0.2);
    slab.rotation.x = -0.45;
    this._add(slab);
  }

  // ---------------------------------------------------------------- graveyard
  tombstone(x, z, rotY = 0) {
    const grp = new THREE.Group();
    const w = 0.6 + this.rnd() * 0.3, h = 0.7 + this.rnd() * 0.5;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.16), this.mat.stone);
    slab.position.y = h / 2 - 0.1;
    const topGeo = new THREE.CylinderGeometry(w / 2, w / 2, 0.16, 12, 1, false, 0, Math.PI);
    topGeo.rotateX(Math.PI / 2); topGeo.rotateZ(Math.PI / 2); // rounded half-disc on top
    const top = new THREE.Mesh(topGeo, this.mat.stone);
    top.position.y = h - 0.1;
    grp.add(slab, top);
    const g = this.g(x, z);
    grp.position.set(x, g, z);
    grp.rotation.set((this.rnd() - 0.5) * 0.25, rotY, (this.rnd() - 0.5) * 0.25);
    this._add(grp);
    this.world.addCollider(x - 0.4, g - 0.5, z - 0.4, x + 0.4, g + h + 0.1, z + 0.4);
  }

  // Axis-aligned broken fence (0.85 m: you jump it, the monster steps over it).
  // skip(x, z): optional, true = leave that section out (generated maps: steep ground)
  fence(x1, z1, x2, z2, skip = null) {
    const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(len / 2));
    const alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    for (let i = 0; i < n; i++) {
      if (this.rnd() < 0.18) continue; // missing sections
      const t0 = i / n, t1 = (i + 1) / n;
      const ax = x1 + (x2 - x1) * t0, az = z1 + (z2 - z1) * t0, bx = x1 + (x2 - x1) * t1, bz = z1 + (z2 - z1) * t1;
      if (skip && skip((ax + bx) / 2, (az + bz) / 2)) continue;
      const g = this.g((ax + bx) / 2, (az + bz) / 2);
      const grp = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), this.mat.wood);
      post.position.set(ax, g + 0.4, az);
      grp.add(post);
      for (const y of [0.35, 0.72]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(alongX ? Math.abs(bx - ax) : 0.06, 0.08, alongX ? 0.06 : Math.abs(bz - az)), this.mat.wood);
        rail.position.set((ax + bx) / 2, g + y, (az + bz) / 2);
        rail.rotation.z = alongX ? (this.rnd() - 0.5) * 0.15 : 0;
        grp.add(rail);
      }
      this._add(grp);
      const hw = 0.08;
      this.world.addCollider(Math.min(ax, bx) - hw, g - 0.5, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, g + 0.85, Math.max(az, bz) + hw);
    }
  }

  // ---------------------------------------------------------------- dead trees (optionally with a hanging doll)
  deadTree(x, z, h = 7, hangDoll = false) {
    const grp = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.32, h, 7), this.mat.bark);
    trunk.position.y = h / 2 - 0.2;
    trunk.rotation.z = (this.rnd() - 0.5) * 0.12;
    grp.add(trunk);
    const branchGeo = new THREE.CylinderGeometry(0.03, 0.09, 1, 5);
    branchGeo.translate(0, 0.5, 0);
    const nb = 4 + Math.floor(this.rnd() * 4);
    let hangAt = null;
    for (let i = 0; i < nb; i++) {
      const y = h * (0.45 + this.rnd() * 0.5), len = 1.2 + this.rnd() * 2.2;
      const b = new THREE.Mesh(branchGeo, this.mat.bark);
      b.position.y = y;
      b.rotation.set(0, this.rnd() * Math.PI * 2, 0);
      b.rotateZ(0.6 + this.rnd() * 0.7);
      b.scale.set(1, len, 1);
      grp.add(b);
      if (i % 2 === 0) { // twig
        const tw = new THREE.Mesh(branchGeo, this.mat.bark);
        tw.position.set(0, len * 0.6, 0);
        tw.rotation.z = -0.8 + this.rnd() * 0.4;
        tw.scale.set(0.6, 0.5, 0.6);
        b.add(tw);
      }
      if (!hangAt && len > 2) hangAt = b;
    }
    if (hangDoll && hangAt) {
      grp.updateMatrixWorld(true);
      const tip = new THREE.Vector3(0, hangAt.scale.y * 0.8, 0).applyMatrix4(hangAt.matrix);
      const ropeLen = 1.2 + this.rnd() * 0.8;
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, ropeLen, 4), this.mat.rope);
      rope.position.set(tip.x, tip.y - ropeLen / 2, tip.z);
      const d = this.doll();
      d.scale.setScalar(1.5);
      d.position.set(tip.x, tip.y - ropeLen - 0.55, tip.z);
      d.rotation.set(0, this.rnd() * Math.PI * 2, 0.1);
      grp.add(rope, d);
    }
    const g = this.g(x, z);
    grp.position.set(x, g, z);
    grp.rotation.y = this.rnd() * Math.PI * 2;
    this._add(grp);
    this.world.addCollider(x - 0.28, g - 0.5, z - 0.28, x + 0.28, g + h, z + 0.28);
  }

  // ---------------------------------------------------------------- orchestra pieces
  chair(x, z, rotY, fallen = false) {
    const grp = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), this.mat.wood);
    seat.position.y = 0.45;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.04), this.mat.wood);
    back.position.set(0, 0.72, -0.21);
    grp.add(seat, back);
    const legGeo = new THREE.BoxGeometry(0.04, 0.45, 0.04);
    for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
      const l = new THREE.Mesh(legGeo, this.mat.wood);
      l.position.set(lx, 0.225, lz);
      grp.add(l);
    }
    const g = this.g(x, z);
    grp.position.set(x, g, z);
    grp.rotation.order = 'YXZ';
    grp.rotation.set(fallen ? -Math.PI / 2 + 0.1 : 0, rotY, 0);
    if (fallen) grp.position.y = g + 0.22;
    this._add(grp);
  }

  musicStand(x, z, rotY) {
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 1.1, 5), this.mat.chrome);
    pole.position.y = 0.55;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.02), this.mat.speaker);
    plate.position.set(0, 1.15, 0);
    plate.rotation.x = -0.4;
    grp.add(pole, plate);
    grp.position.set(x, this.g(x, z), z);
    grp.rotation.set(0, rotY, (this.rnd() - 0.5) * 0.3);
    this._add(grp);
  }

  uprightPiano(x, z, rotY) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 0.6), this.mat.piano);
    body.position.y = 0.65;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.3), this.mat.piano);
    shelf.position.set(0, 0.72, 0.42);
    const keys = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.2), this.mat.ivory);
    keys.position.set(0, 0.79, 0.44);
    grp.add(body, shelf, keys);
    const g = this.g(x, z);
    grp.position.set(x, g, z);
    grp.rotation.set(0, rotY, (this.rnd() - 0.5) * 0.12);
    this._add(grp);
    this._colliderFrom(body, 0.9, 1);
  }

  // Drum as separate shell + skins so it can be batched (axis = local y).
  _drum(r, h) {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20, 1, true), this.mat.shell));
    for (const s of [1, -1]) {
      const cap = new THREE.Mesh(new THREE.CircleGeometry(r, 20), this.mat.skin);
      cap.rotation.x = -s * Math.PI / 2;
      cap.position.y = (s * h) / 2;
      grp.add(cap);
    }
    return grp;
  }

  drumKit(x, z, rotY) {
    const grp = new THREE.Group();
    const kick = this._drum(0.36, 0.45);
    kick.rotation.x = Math.PI / 2;
    kick.position.set(0, 0.36, 0);
    grp.add(kick);
    for (const [tx, ty, tz, r] of [[-0.25, 0.85, 0.05, 0.16], [0.25, 0.85, 0.05, 0.18], [0.55, 0.6, 0.5, 0.2], [-0.5, 0.65, 0.45, 0.17]]) {
      const tom = this._drum(r, r * 1.2);
      tom.position.set(tx, ty, tz);
      tom.rotation.x = 0.3;
      grp.add(tom);
    }
    for (const [cx, cz, h] of [[-0.8, 0.2, 1.3], [0.85, 0.1, 1.45]]) {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, h, 5), this.mat.chrome);
      stand.position.set(cx, h / 2, cz);
      const cym = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.015, 20), this.mat.brass);
      cym.position.set(cx, h, cz);
      cym.rotation.z = (this.rnd() - 0.5) * 0.6;
      grp.add(stand, cym);
    }
    const g = this.g(x, z);
    grp.position.set(x, g, z);
    grp.rotation.set(0, rotY, (this.rnd() - 0.5) * 0.15);
    this._add(grp);
  }

  // Stack of amp cabinets (climbable cover).
  speakerStack(x, z, rotY, n = 3) {
    const grp = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const cab = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 0.8), this.mat.speaker);
      cab.add(box);
      for (const [sx, sy] of [[-0.3, 0.2], [0.3, 0.2], [-0.3, -0.22], [0.3, -0.22]]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.06, 16), this.mat.cone);
        c.rotation.x = Math.PI / 2;
        c.position.set(sx, sy, 0.41);
        cab.add(c);
      }
      cab.position.y = 0.5 + i * 1.0;
      cab.rotation.y = (this.rnd() - 0.5) * 0.25;
      grp.add(cab);
    }
    const g = this.g(x, z);
    grp.position.set(x, g, z);
    grp.rotation.y = rotY;
    this._add(grp);
    this.world.addCollider(x - 0.65, g - 0.5, z - 0.65, x + 0.65, g + n * 1.0, z + 0.65);
  }

  gong(x, z, rotY) {
    const grp = new THREE.Group();
    for (const sx of [-1.1, 1.1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.8, 0.15), this.mat.wood);
      p.position.set(sx, 1.4, 0);
      grp.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.18), this.mat.wood);
    beam.position.y = 2.75;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.05, 28), this.mat.brass);
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 1.65;
    grp.add(beam, disc);
    const g = this.g(x, z);
    grp.position.set(x, g, z);
    grp.rotation.y = rotY;
    this._add(grp);
  }

  bassDrum(x, z, rotY) {
    const d = this._drum(0.4, 0.5);
    const g = this.g(x, z);
    d.position.set(x, g + 0.38, z);
    d.rotation.set(Math.PI / 2, 0, rotY);
    this._add(d);
  }

  candles(x, y, z, n = 5) {
    for (let i = 0; i < n; i++) {
      const h = 0.1 + this.rnd() * 0.2;
      const cx = x + (this.rnd() - 0.5) * 1.6, cz = z + (this.rnd() - 0.5) * 0.5;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, h, 6), this.mat.candle);
      c.position.set(cx, y + h / 2, cz);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.05, 5), this.mat.flame);
      f.position.set(cx, y + h + 0.03, cz);
      this._add(c); this._add(f);
    }
  }

  // ---------------------------------------------------------------- organ-pipe tower (static parts)
  // Returns the site description the Towers system animates (crown, stones).
  tower(x, z, stoneCount = 5, stoneRadius = 8) {
    const g = this.g(x, z);
    if (!this.mat.pipe) {
      this.mat.pipe = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, metalness: 0.6, roughness: 0.4 });
      this.mat.pipeDark = new THREE.MeshStandardMaterial({ color: 0x0a0606, roughness: 0.8 });
    }
    const grp = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.7, 1.2, 8), this.mat.chapel);
    base.position.y = 0.5;
    grp.add(base);
    // a ring of pipes around a tall central spire
    const pipes = [[0, 0, 13, 0.45]];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pipes.push([Math.cos(a) * 1.3, Math.sin(a) * 1.3, 6 + ((i * 5) % 8) * 0.7 + this.rnd() * 1.2, 0.22 + this.rnd() * 0.12]);
    }
    for (const [px, pz, h, r] of pipes) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), this.mat.pipe);
      pipe.position.set(px, 1.1 + h / 2, pz);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.2, r * 1.2, 0.15, 12), this.mat.pipe);
      cap.position.set(px, 1.1 + h, pz);
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(r * 1.1, r * 1.4, 0.05), this.mat.pipeDark);
      const outward = Math.atan2(px, pz);
      mouth.position.set(px + Math.sin(outward) * r * 0.98, 2.2, pz + Math.cos(outward) * r * 0.98);
      mouth.rotation.y = outward;
      grp.add(pipe, cap, mouth);
    }
    // crown pedestal
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.7, 0.8, 8), this.mat.pipe);
    ped.position.y = 1.1 + 13 + 0.4;
    grp.add(ped);
    grp.position.set(x, g, z);
    this._add(grp);
    this.world.addCollider(x - 2.2, g - 0.5, z - 2.2, x + 2.2, g + 1.1, z + 2.2); // base (steppable-ish, monster ignores)
    this.world.addCollider(x - 1.6, g + 1.1, z - 1.6, x + 1.6, g + 14.1, z + 1.6); // pipes

    // standing resonator stones in a ring
    const stones = [];
    for (let i = 0; i < stoneCount; i++) {
      const a = (i / stoneCount) * Math.PI * 2 + 0.3;
      const sx = x + Math.cos(a) * stoneRadius, sz = z + Math.sin(a) * stoneRadius;
      const sg = this.g(sx, sz);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.8, 0.5), this.mat.stone);
      st.position.set(sx, sg + 0.8, sz);
      st.rotation.set((this.rnd() - 0.5) * 0.12, Math.atan2(x - sx, z - sz), (this.rnd() - 0.5) * 0.12);
      this._add(st);
      this.world.addCollider(sx - 0.45, sg - 0.5, sz - 0.45, sx + 0.45, sg + 1.7, sz + 0.45);
      stones.push({ x: sx, z: sz, y: sg, face: Math.atan2(x - sx, z - sz) });
    }
    return { x, z, g, crownY: g + 1.1 + 13 + 1.6, stones };
  }

  // ---------------------------------------------------------------- ruined chapel (axis aligned)
  // 12 x 20 m, big door south (the monster fits), small door north (it doesn't), windows to vault through.
  chapel(cx, cz) {
    const g = this.g(cx, cz);
    const w = 12, d = 20, H = 5, t = 0.5;
    const wall = (x, z, sx, sz, h, y = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), this.mat.chapel);
      m.position.set(x, g + y + h / 2, z);
      this._add(m);
      this.world.addCollider(x - sx / 2, g + y - (y ? 0 : 0.5), z - sz / 2, x + sx / 2, g + y + h, z + sz / 2);
    };
    const S = cz + d / 2, N = cz - d / 2, W = cx - w / 2, E = cx + w / 2;
    // south: 5 m door
    const door = 5, seg = (w - door) / 2;
    wall(W + seg / 2, S, seg, t, H);
    wall(E - seg / 2, S, seg, t, H);
    wall(cx, S, door, t, 1.2, H - 1.2);
    // north: 1.3 m door near the east corner
    wall(cx - 1.4, N, 9.2, t, H);
    wall(cx + 5.25, N, 1.5, t, H);
    wall(cx + 3.85, N, 1.3, t, H - 2.2, 2.2); // lintel over the small door
    // side walls with two windows each (sill 1.2, top 3.0)
    for (const x of [W, E]) {
      const pieces = [[N, N + 4], [N + 6, cz + 3], [cz + 5, S]]; // solid spans along z
      for (const [z0, z1] of pieces) wall(x, (z0 + z1) / 2, t, z1 - z0, H);
      for (const [z0, z1] of [[N + 4, N + 6], [cz + 3, cz + 5]]) {
        wall(x, (z0 + z1) / 2, t, z1 - z0, 1.2);        // under the window
        wall(x, (z0 + z1) / 2, t, z1 - z0, H - 3.0, 3.0); // above
      }
    }
    // roof: beams + the north half still standing
    for (let z = N + 1.5; z < S; z += 3) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.3), this.mat.wood);
      b.position.set(cx, g + H - 0.15, z);
      b.rotation.z = (this.rnd() - 0.5) * 0.1;
      this._add(b);
    }
    wall(cx, cz - d / 4, w + 0.6, d / 2, 0.3, H);
    // altar, cross and candles
    wall(cx, N + 2, 3, 1.2, 1.1);
    this.cross(cx, N + 0.8, 4.2, 0, 0, true);
    this.candles(cx, g + 1.1, N + 2);
    // pews (0.85 m: jump them; the monster steps over)
    for (let z = cz - 4; z <= cz + 6; z += 2.2) {
      for (const sx of [-1, 1]) {
        const px = cx + sx * 3.1;
        const grp = new THREE.Group();
        const seat = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 0.5), this.mat.wood);
        seat.position.y = 0.45;
        const back = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.45, 0.06), this.mat.wood);
        back.position.set(0, 0.62, 0.24);
        grp.add(seat, back);
        grp.position.set(px, g, z);
        if (this.rnd() < 0.25) grp.rotation.y = (this.rnd() - 0.5) * 0.6; // knocked askew
        this._add(grp);
        this.world.addCollider(px - 1.7, g - 0.5, z - 0.3, px + 1.7, g + 0.85, z + 0.3);
      }
    }
    // rubble where the roof came down
    for (let i = 0; i < 4; i++) {
      this.boulder(cx + (this.rnd() - 0.5) * 7, cz + 5 + this.rnd() * 3, 0.5 + this.rnd() * 0.4, 0.4, 0.5 + this.rnd() * 0.4, this.rnd() * 6, false);
    }
  }

  // Graphics quality: thin out grass, pull in cull distances, drop grass shadows.
  setQuality({ density = 1, farMul = 1, cullMul = 1, grassShadow = true } = {}) {
    this.cullDist = 85 * cullMul;
    for (const c of this.instChunks) {
      c.far = c.baseFar * farMul;
      if (c.kind === 'grass') c.mesh.count = Math.max(1, Math.floor(c.cap * density));
      else if (c.kind === 'tallGrass') {
        c.mesh.count = Math.max(1, Math.floor(c.cap * Math.max(density, 0.7))); // it's a hiding spot; keep it thick
        c.mesh.castShadow = c.castShadow && grassShadow;
      }
    }
  }

  update(time, camPos) {
    for (const m of this._grassMats) if (m.userData.shader) m.userData.shader.uniforms.uTime.value = time;
    if (!camPos) return;
    this.batcher.cull(camPos, this.cullDist ?? 85);
    for (const c of this.instChunks) c.mesh.visible = c.center.distanceTo(camPos) - c.radius < c.far;
  }
}
