import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Static mesh batching: merges many small meshes that share a material into
// one draw call. Used for map props (per spatial chunk) and for the rigid
// parts of the monster.

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

// Geometry baked into `relativeTo` space, non-indexed, position/normal/uv
// (+ color when `color` is given, used to fold plain materials together).
function bakeGeometry(mesh, relativeTo, color = null) {
  mesh.updateWorldMatrix(true, false);
  if (relativeTo) {
    relativeTo.updateWorldMatrix(true, false);
    _inv.copy(relativeTo.matrixWorld).invert();
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
  } else _m.copy(mesh.matrixWorld);
  let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.clearGroups();
  g.applyMatrix4(_m);
  if (color) {
    const n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

// Untextured lit materials get folded into one vertex-coloured material per chunk.
const isPlain = (m) => m.isMeshStandardMaterial && !m.map && !m.transparent && !m.userData.keep;
const PLAIN_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });

function mergeable(o) {
  return o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material) && !o.userData.noBatch;
}

// Merge meshes under `root` into it, grouped by material. Nodes in `stop`
// (animated sub-groups) and everything below them are left alone.
export function mergeStatic(root, stop = new Set()) {
  const buckets = new Map();
  const found = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (stop.has(child)) continue;
      if (mergeable(child)) found.push(child);
      walk(child);
    }
  };
  walk(root);
  for (const mesh of found) {
    const plain = isPlain(mesh.material);
    const key = plain ? 'plain' : mesh.material.uuid;
    if (!buckets.has(key)) buckets.set(key, { mat: plain ? PLAIN_MAT : mesh.material, geos: [], shadow: false });
    const b = buckets.get(key);
    b.geos.push(bakeGeometry(mesh, root, plain ? mesh.material.color : null));
    b.shadow ||= mesh.castShadow;
  }
  for (const mesh of found) {
    // keep non-mesh children (lights, sprites, empties) by reparenting them
    for (const c of [...mesh.children]) if (!found.includes(c)) root.attach(c);
    mesh.parent.remove(mesh);
  }
  for (const { mat, geos, shadow } of buckets.values()) {
    const merged = new THREE.Mesh(mergeGeometries(geos, false), mat);
    merged.castShadow = shadow;
    merged.receiveShadow = true;
    root.add(merged);
  }
}

// World-space batching of static props into spatial chunks with distance culling.
export class ChunkBatcher {
  constructor(scene, chunkSize = 35) {
    this.scene = scene;
    this.chunkSize = chunkSize;
    this.pending = [];
    this.chunks = []; // { mesh, center, radius }
  }

  add(obj) { this.pending.push(obj); }

  bake() {
    const buckets = new Map();
    const center = new THREE.Vector3();
    const meshes = [];
    for (const obj of this.pending) {
      obj.updateMatrixWorld(true);
      obj.traverse((o) => { if (mergeable(o)) meshes.push(o); });
    }
    for (const mesh of meshes) {
      mesh.getWorldPosition(center);
      const cx = Math.floor(center.x / this.chunkSize), cz = Math.floor(center.z / this.chunkSize);
      const plain = isPlain(mesh.material);
      const key = `${cx},${cz},${plain ? 'plain' : mesh.material.uuid}`;
      if (!buckets.has(key)) buckets.set(key, { mat: plain ? PLAIN_MAT : mesh.material, geos: [], shadow: false, receive: false });
      const b = buckets.get(key);
      b.geos.push(bakeGeometry(mesh, null, plain ? mesh.material.color : null));
      b.shadow ||= mesh.castShadow;
      b.receive ||= mesh.receiveShadow;
    }
    // remove the originals (anything non-mergeable stays in the scene), then empty groups
    for (const mesh of meshes) mesh.parent.remove(mesh);
    const empty = (o) => !o.isMesh && !o.isLight && !o.isSprite && !o.isPoints && o.children.every(empty);
    for (const obj of this.pending) if (obj.parent && empty(obj)) obj.parent.remove(obj);
    for (const b of buckets.values()) {
      const geo = mergeGeometries(b.geos, false);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, b.mat);
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      this.chunks.push({ mesh, center: geo.boundingSphere.center.clone(), radius: geo.boundingSphere.radius });
    }
    this.pending = [];
    return this.chunks.length;
  }

  // Hide chunks that are fully inside the fog.
  cull(camPos, dist) {
    for (const c of this.chunks) c.mesh.visible = c.center.distanceTo(camPos) - c.radius < dist;
  }
}
