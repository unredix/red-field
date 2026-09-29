import * as THREE from 'three';
import { makeGuitar } from './props.js';
import { mergeStatic } from './batch.js';
import { fleshTexture, drumSkinTexture, drumShellTexture, glowTexture } from './textures.js';

// Procedural drum beast (monster.png), built at unit scale facing +Z with the
// feet at y = 0. The Monster class scales it and animates the named parts:
//   body (rear torso, hind legs, tail) -> chest (front torso, front legs, neck)
//   neck[0] -> neck[1] -> headPivot -> head (drum) -> jaw -> tongue
// Replace with a GLB later by returning the same named parts.

const TAU = Math.PI * 2;

function displace(geo, amp, freq, seed = 0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + amp * (Math.sin(x * freq + seed) * Math.sin(y * freq * 0.8 + 1.3) * Math.sin(z * freq * 0.9 + seed * 0.5)
      + 0.6 * Math.sin(z * freq * 1.7 + y * 3 + seed));
    p.setXYZ(i, x * n, y * n, z * n);
  }
  geo.computeVertexNormals();
  return geo;
}

// Muscular limb segment hanging down -Y from its joint (length len).
function limbGeo(len, rTop, rMid, rBot, seg = 12) {
  const pts = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bulge = Math.sin(t * Math.PI) * (rMid - (rTop + rBot) / 2);
    const r = rTop + (rBot - rTop) * t + bulge;
    pts.push(new THREE.Vector2(Math.max(r, 0.01), -t * len));
  }
  pts.unshift(new THREE.Vector2(0.001, 0.02));
  pts.push(new THREE.Vector2(0.001, -len - 0.02));
  return new THREE.LatheGeometry(pts, seg);
}

export function buildMonsterModel() {
  const flesh = fleshTexture();
  flesh.repeat.set(2, 2);
  const shellTex = drumShellTexture();
  const mat = {
    flesh: new THREE.MeshStandardMaterial({ map: flesh, bumpMap: flesh, bumpScale: 4, roughness: 0.5, emissive: 0x5a0804, emissiveMap: flesh, emissiveIntensity: 0.55 }),
    wet: new THREE.MeshStandardMaterial({ color: 0x5a0808, roughness: 0.2, metalness: 0.1 }),
    shell: new THREE.MeshStandardMaterial({ map: shellTex, roughness: 0.3, metalness: 0.2 }),
    skin: new THREE.MeshStandardMaterial({ map: drumSkinTexture(), roughness: 0.7, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xa8a8a8, metalness: 0.9, roughness: 0.3 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.9, roughness: 0.35 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xe0d0b8, roughness: 0.45 }),
    spike: new THREE.MeshStandardMaterial({ color: 0x2a0a08, roughness: 0.4, metalness: 0.3 }),
    ivory: new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.5 }),
    ebony: new THREE.MeshStandardMaterial({ color: 0x0c0808, roughness: 0.4 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6a4020, roughness: 0.6 }),
    string: new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.3 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x050000, roughness: 1 }),
    eye: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.1) }),
    pupil: new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x3a0e0a, roughness: 0.6 }),
    snareShell: new THREE.MeshStandardMaterial({ color: 0x5a0a0a, roughness: 0.35, metalness: 0.2 }),
    snareSkin: new THREE.MeshStandardMaterial({ color: 0xc0b098, roughness: 0.7 }),
    drool: new THREE.MeshStandardMaterial({ color: 0xa02828, roughness: 0.05, transparent: true, opacity: 0.45 }),
    guitarRed: new THREE.MeshStandardMaterial({ color: 0x6a120e, roughness: 0.35 }),
    guitarWood: new THREE.MeshStandardMaterial({ color: 0x5a3018, roughness: 0.5 }),
    neck: new THREE.MeshStandardMaterial({ color: 0x1a100a, roughness: 0.6 }),
  };
  mat.wet.userData.keep = true; // keep its wet look instead of folding into plain colours
  const M = (geo, m) => { const mesh = new THREE.Mesh(geo, m); return mesh; };
  const coneGeo = new THREE.ConeGeometry(1, 1, 6);
  const spikeAt = (parent, x, y, z, r, h, rx = 0, rz = 0, m = mat.spike) => {
    const s = M(coneGeo, m); s.scale.set(r, h, r); s.position.set(x, y, z); s.rotation.set(rx, 0, rz); parent.add(s); return s;
  };

  const root = new THREE.Group();
  const BODY_Y = 2.05; // standing height of the torso centre
  const body = new THREE.Group();
  body.position.y = BODY_Y;
  root.add(body);

  // ---------------------------------------------------------------- rear torso
  const rear = M(displace(new THREE.SphereGeometry(1, 22, 16), 0.06, 7, 1), mat.flesh);
  rear.scale.set(0.92, 0.82, 1.3);
  rear.position.set(0, 0, -0.7);
  body.add(rear);
  // haunches
  for (const s of [-1, 1]) {
    const h = M(displace(new THREE.SphereGeometry(0.55, 14, 10), 0.08, 9, s), mat.flesh);
    h.position.set(s * 0.62, -0.15, -1.2);
    h.scale.set(0.8, 1, 1.15);
    body.add(h);
  }

  // ---------------------------------------------------------------- chest (bends with the spine)
  const chest = new THREE.Group();
  chest.position.set(0, 0, 0.1);
  body.add(chest);
  const front = M(displace(new THREE.SphereGeometry(1, 22, 16), 0.07, 6, 3), mat.flesh);
  front.scale.set(1.05, 0.95, 1.15);
  front.position.set(0, 0.05, 0.55);
  chest.add(front);
  // exposed ribs wrapping the flanks and belly, gap along the spine
  const gap = 0.55 * Math.PI;
  const ribGeo = new THREE.TorusGeometry(1, 0.045, 6, 20, TAU - gap);
  for (let i = 0; i < 5; i++) {
    const rib = M(ribGeo, mat.bone);
    rib.rotation.z = Math.PI / 2 + gap / 2;
    rib.position.set(0, 0.05, 0.1 + i * 0.22);
    const k = 1 - Math.abs(i - 2) * 0.05;
    rib.scale.set(1.07 * k, 0.97 * k, 1);
    chest.add(rib);
  }
  // shoulders
  for (const s of [-1, 1]) {
    const sh = M(displace(new THREE.SphereGeometry(0.5, 14, 10), 0.08, 9, s + 4), mat.flesh);
    sh.position.set(s * 0.72, -0.05, 0.8);
    chest.add(sh);
  }

  // ---------------------------------------------------------------- spine ridge + piano-key scales
  const plateGeo = new THREE.BoxGeometry(0.28, 0.1, 0.22);
  for (let i = 0; i < 14; i++) {
    const z = -1.75 + i * 0.22;
    const parent = z > 0.1 ? chest : body;
    const lz = z > 0.1 ? z - 0.1 : z;
    const y = 0.8 + Math.sin((i / 13) * Math.PI) * 0.12;
    const plate = M(plateGeo, mat.spike);
    plate.position.set(0, y, lz);
    parent.add(plate);
    spikeAt(parent, 0, y + 0.22, lz, 0.07 + (i % 3) * 0.02, 0.35 + ((i * 7) % 5) * 0.08, -0.35);
  }
  const whiteKey = new THREE.BoxGeometry(0.07, 0.025, 0.24);
  const blackKey = new THREE.BoxGeometry(0.045, 0.035, 0.15);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 16; i++) {
      const z = -1.5 + i * 0.1;
      const k = M(whiteKey, mat.ivory);
      k.position.set(s * 0.58, 0.62, z);
      k.rotation.set(0, Math.PI / 2, s * 0.75);
      body.add(k);
      if (i % 7 !== 2 && i % 7 !== 6) {
        const b = M(blackKey, mat.ebony);
        b.position.set(s * 0.6, 0.66, z + 0.05);
        b.rotation.set(0, Math.PI / 2, s * 0.75);
        body.add(b);
      }
    }
  }

  // ---------------------------------------------------------------- instruments grown into the back
  const guitars = [
    [-0.35, 0.55, -0.9, 0.5, 0.3, 1.2, body], [0.4, 0.55, -1.4, -0.45, -0.2, 1.35, body],
    [0.1, 0.6, -0.3, -0.1, -0.5, 1.45, body], [-0.45, 0.5, 0.2, 0.55, 0.4, 1.15, chest], [0.4, 0.55, 0.45, -0.5, 0.25, 1.1, chest],
  ];
  guitars.forEach(([x, y, z, rz, rx, s, parent], i) => {
    const g = makeGuitar(i % 2 ? mat.guitarRed : mat.guitarWood, mat.neck, s);
    for (let k = -1.5; k <= 1.5; k++) { // strings
      const str = M(new THREE.BoxGeometry(0.004, 1.0, 0.004), mat.string);
      str.position.set(k * 0.012, 0.65, 0.05);
      g.add(str);
    }
    g.position.set(x, y - 0.35, parent === chest ? z - 0.1 : z);
    g.rotation.set(rx, i * 1.3, rz);
    parent.add(g);
  });
  // snare on the left shoulder
  const snare = new THREE.Group();
  snare.add(M(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 20, 1, true), mat.snareShell));
  for (const s of [1, -1]) {
    const cap = M(new THREE.CircleGeometry(0.34, 20), mat.snareSkin); cap.rotation.x = -s * Math.PI / 2; cap.position.y = s * 0.13; snare.add(cap);
    const hoop = M(new THREE.TorusGeometry(0.345, 0.02, 5, 20), mat.chrome); hoop.rotation.x = Math.PI / 2; hoop.position.y = s * 0.13; snare.add(hoop);
  }
  snare.position.set(-0.8, 0.55, 0.75);
  snare.rotation.set(0.4, 0, 0.7);
  chest.add(snare);
  // drumsticks and violin bows stabbed in like spears
  for (const [x, y, z, rx, rz, parent] of [[0.5, 0.6, 0.9, -0.5, -0.6, chest], [-0.2, 0.75, 0.6, -0.8, 0.3, chest], [0.6, 0.45, -0.4, 0.4, -0.9, body]]) {
    const st = M(new THREE.CylinderGeometry(0.018, 0.028, 0.9, 6), mat.wood);
    st.position.set(x, y, z); st.rotation.set(rx, 0, rz); parent.add(st);
  }
  for (const [x, y, z, rx, rz] of [[-0.55, 0.6, -1.1, 0.6, 0.8], [0.3, 0.72, -0.6, -0.3, -0.5]]) {
    const bow = new THREE.Group();
    bow.add(M(new THREE.BoxGeometry(0.02, 1.3, 0.02), mat.wood));
    const hair = M(new THREE.BoxGeometry(0.006, 1.2, 0.006), mat.ivory); hair.position.z = 0.05; bow.add(hair);
    bow.position.set(x, y, z); bow.rotation.set(rx, 0, rz); body.add(bow);
  }
  // cymbal stack
  for (let i = 0; i < 2; i++) {
    const c = M(new THREE.CylinderGeometry(0.62 - i * 0.18, 0.62 - i * 0.18, 0.02, 24), mat.brass);
    c.position.set(-0.35, 1.08 + i * 0.12, -0.5);
    c.rotation.set(0.3, 0, 0.35);
    body.add(c);
  }
  const rod = M(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 5), mat.chrome);
  rod.position.set(-0.3, 0.85, -0.5); rod.rotation.set(0.3, 0, 0.35); body.add(rod);
  // hanging flesh strips under the belly
  const stripGeo = new THREE.ConeGeometry(0.05, 0.6, 4);
  for (let i = 0; i < 9; i++) {
    const st = M(stripGeo, mat.flesh);
    const z = -1.3 + i * 0.3;
    st.position.set(Math.sin(i * 2.3) * 0.35, -0.85, z);
    st.rotation.set(Math.PI, 0, Math.sin(i) * 0.2);
    st.scale.y = 0.6 + (i % 3) * 0.35;
    (z > 0.1 ? chest : body).add(st);
    if (z > 0.1) st.position.z -= 0.1;
  }

  // ---------------------------------------------------------------- neck (two fleshy segments)
  const neck = [];
  let parent = chest;
  const neckDefs = [[0, 0.32, 1.25, 0.52, 0.45, 0.62, -0.3], [0, 0.08, 0.55, 0.45, 0.4, 0.55, -0.1]];
  for (const [x, y, z, r0, r1, len, rx] of neckDefs) {
    const seg = new THREE.Group();
    seg.position.set(x, y, z);
    seg.rotation.x = rx;
    const m = M(displace(new THREE.CylinderGeometry(r1, r0, len, 14, 3), 0.07, 10, z), mat.flesh);
    m.rotation.x = Math.PI / 2;
    m.position.z = len / 2 - 0.05;
    seg.add(m);
    for (const s of [-1, 1]) { // cables
      const cab = M(new THREE.CylinderGeometry(0.03, 0.03, len + 0.1, 5), mat.flesh);
      cab.rotation.x = Math.PI / 2;
      cab.position.set(s * r1 * 0.85, r1 * 0.35, len / 2);
      seg.add(cab);
    }
    spikeAt(seg, 0, r0 + 0.08, len * 0.4, 0.07, 0.4, -0.5, 0, mat.flesh);
    parent.add(seg);
    neck.push(seg);
    parent = seg;
  }

  // ---------------------------------------------------------------- drum head
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.05, 0.5);
  headPivot.rotation.x = 0.4; // undo the neck tilt so the face looks forward
  parent.add(headPivot);
  const head = new THREE.Group();
  headPivot.add(head);
  const shell = M(new THREE.CylinderGeometry(0.95, 0.95, 1.2, 28, 1, true), mat.shell);
  shell.rotation.x = Math.PI / 2; shell.position.z = 0.6;
  head.add(shell);
  const back = M(new THREE.CircleGeometry(0.95, 28), mat.skin); back.rotation.y = Math.PI; head.add(back);
  // front skin with a torn, fleshy wound
  const faceSkin = M(new THREE.CircleGeometry(0.95, 28), mat.skin); faceSkin.position.z = 1.2; head.add(faceSkin);
  const tear = new THREE.Shape();
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * TAU, r = 0.18 + ((i * 37) % 7) * 0.025;
    const px = 0.42 + Math.cos(a) * r * 1.3, py = 0.02 + Math.sin(a) * r;
    if (i === 0) tear.moveTo(px, py); else tear.lineTo(px, py);
  }
  const wound = M(new THREE.ShapeGeometry(tear), mat.wet); wound.position.z = 1.205; head.add(wound);
  for (const z of [0, 1.2]) {
    const hoop = M(new THREE.TorusGeometry(0.98, 0.065, 8, 32), mat.chrome); hoop.position.z = z; head.add(hoop);
  }
  // tension rods + lugs
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const rodM = M(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 5), mat.chrome);
    rodM.rotation.x = Math.PI / 2; rodM.position.set(Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0.6); head.add(rodM);
    const lug = M(new THREE.BoxGeometry(0.08, 0.08, 0.22), mat.chrome);
    lug.position.set(Math.cos(a) * 0.97, Math.sin(a) * 0.97, 0.6); lug.rotation.z = a; head.add(lug);
  }
  const headCenter = new THREE.Object3D();
  headCenter.position.set(0, -0.2, 0.9);
  head.add(headCenter);

  // mouth, gums, two rows of teeth
  const mouth = M(new THREE.CircleGeometry(0.8, 24, Math.PI, Math.PI), mat.mouth);
  mouth.position.set(0, -0.08, 1.21); head.add(mouth);
  const gum = M(new THREE.TorusGeometry(0.8, 0.06, 6, 24, Math.PI), mat.wet);
  gum.rotation.z = Math.PI; gum.position.set(0, -0.08, 1.22); head.add(gum);
  const upperGum = M(new THREE.BoxGeometry(1.6, 0.08, 0.1), mat.wet); upperGum.position.set(0, -0.1, 1.23); head.add(upperGum);
  const tooth = new THREE.ConeGeometry(1, 1, 6);
  const addTooth = (parent, x, y, z, r, h, rz, rx = 0) => { const t = M(tooth, mat.bone); t.scale.set(r, h, r); t.position.set(x, y, z); t.rotation.set(rx, 0, rz); parent.add(t); };
  for (let i = 0; i < 13; i++) addTooth(head, -0.72 + i * 0.12, -0.22, 1.25, 0.055, 0.22 + ((i * 5) % 4) * 0.07, Math.PI);
  for (let i = 0; i < 9; i++) addTooth(head, -0.5 + i * 0.125, -0.18, 1.1, 0.04, 0.16, Math.PI, 0.2);
  for (let i = 0; i < 9; i++) { // teeth around the lower rim, pointing inward
    const a = Math.PI + (i + 1) * (Math.PI / 10);
    addTooth(head, Math.cos(a) * 0.74, -0.08 + Math.sin(a) * 0.74, 1.25, 0.05, 0.24, a + Math.PI / 2);
  }

  // eyes: metal rings, glowing irises with slit pupils
  const eyes = [];
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,50,20,1)', 'rgba(255,0,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  for (const s of [-1, 1]) {
    const e = M(new THREE.SphereGeometry(0.13, 14, 10), mat.eye); e.position.set(s * 0.4, 0.42, 1.2); head.add(e);
    const pupil = M(new THREE.BoxGeometry(0.03, 0.2, 0.02), mat.pupil); pupil.position.set(s * 0.4, 0.42, 1.33); head.add(pupil);
    for (const [r, t] of [[0.17, 0.035], [0.22, 0.02]]) { const ring = M(new THREE.TorusGeometry(r, t, 6, 18), mat.chrome); ring.position.set(s * 0.4, 0.42, 1.24); head.add(ring); }
    for (let k = 0; k < 4; k++) { // rivets
      const a = (k / 4) * TAU + 0.4;
      const rv = M(new THREE.SphereGeometry(0.025, 5, 4), mat.chrome); rv.position.set(s * 0.4 + Math.cos(a) * 0.2, 0.42 + Math.sin(a) * 0.2, 1.26); head.add(rv);
    }
    const glow = new THREE.Sprite(glowMat); glow.scale.set(0.55, 0.55, 1); glow.position.set(s * 0.4, 0.42, 1.32); head.add(glow);
    eyes.push(glow);
  }
  const eyeLight = new THREE.PointLight(0xff2010, 1.5, 9, 2);
  eyeLight.position.set(0, 0.4, 2.6);
  head.add(eyeLight);

  // cymbal hat, horns, side spikes
  const cym = M(new THREE.CylinderGeometry(0.9, 0.9, 0.03, 32), mat.brass); cym.position.set(0.15, 1.08, 0.5); cym.rotation.z = 0.25; head.add(cym);
  const bell = M(new THREE.SphereGeometry(0.18, 12, 8, 0, TAU, 0, Math.PI / 2), mat.brass); bell.position.copy(cym.position); bell.rotation.z = 0.25; head.add(bell);
  spikeAt(head, 0.2, 1.5, 0.5, 0.1, 0.8, 0, -0.1);
  for (const s of [-1, 1]) {
    spikeAt(head, s * 0.95, 0.4, 0.4, 0.1, 0.8, 0, -s * 1.1);
    spikeAt(head, s * 0.8, 0.75, 0.2, 0.07, 0.55, -0.3, -s * 0.7);
  }

  // ---------------------------------------------------------------- jaw + tongue + drool
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.78, 0.25);
  head.add(jaw);
  const jawMesh = M(displace(new THREE.BoxGeometry(1.45, 0.3, 1.1, 4, 2, 4), 0.05, 12, 2), mat.flesh);
  jawMesh.position.set(0, -0.1, 0.5); jaw.add(jawMesh);
  const bed = M(new THREE.BoxGeometry(1.2, 0.05, 0.9), mat.wet); bed.position.set(0, 0.06, 0.5); jaw.add(bed);
  for (let i = 0; i < 11; i++) addTooth(jaw, -0.62 + i * 0.124, 0.14, 0.98, 0.05, 0.2 + ((i * 3) % 4) * 0.06, 0);
  for (let i = 0; i < 7; i++) addTooth(jaw, -0.4 + i * 0.13, 0.12, 0.8, 0.035, 0.14, 0, -0.2);
  const tongue = [];
  let tp = jaw;
  for (let i = 0; i < 2; i++) {
    const t = new THREE.Group();
    t.position.set(0, i === 0 ? 0.1 : 0, i === 0 ? 0.25 : 0.45);
    const tm = M(new THREE.CapsuleGeometry(0.16 - i * 0.04, 0.35, 4, 8), mat.wet);
    tm.rotation.x = Math.PI / 2; tm.scale.set(1.3, 1, 0.5); tm.position.z = 0.22;
    t.add(tm);
    tp.add(t);
    tongue.push(t);
    tp = t;
  }
  const drool = new THREE.Group();
  drool.position.set(0, 0.05, 1.0);
  for (const [x, len] of [[-0.35, 0.7], [0.25, 0.5], [0.05, 0.9]]) {
    const d = M(new THREE.CylinderGeometry(0.012, 0.02, len, 5), mat.drool);
    d.position.set(x, -len / 2, 0);
    drool.add(d);
  }
  jaw.add(drool);

  // ---------------------------------------------------------------- legs
  // front: shoulder -> upper -> knee(elbow) -> lower with paw; hind: hip -> thigh -> knee -> shin -> ankle -> metatarsal+foot
  const legs = [];
  const claw = new THREE.ConeGeometry(1, 1, 6);
  const paw = (parent, n, len) => {
    const pad = M(displace(new THREE.SphereGeometry(0.2, 10, 8), 0.1, 10, n), mat.pad);
    pad.scale.set(1.2, 0.55, 1.4); parent.add(pad);
    for (let c = 0; c < n; c++) {
      const x = (c - (n - 1) / 2) * 0.1;
      for (let k = 0; k < 2; k++) { // two-part curved claw
        const cl = M(claw, mat.bone);
        cl.scale.set(0.035 - k * 0.012, len * 0.5, 0.035 - k * 0.012);
        cl.position.set(x * (1 + k * 0.2), -0.02 - k * 0.07, 0.2 + k * len * 0.42);
        cl.rotation.x = Math.PI / 2 + 0.3 + k * 0.5;
        parent.add(cl);
      }
    }
  };
  for (const [sx, isFront] of [[1, true], [-1, true], [1, false], [-1, false]]) {
    const hip = new THREE.Group();
    const L = isFront ? [1.05, 1.05] : [0.92, 0.85, 0.62];
    const parentGroup = isFront ? chest : body;
    hip.position.set(sx * (isFront ? 0.95 : 0.88), isFront ? -0.3 : -0.25, isFront ? 0.75 : -1.2);
    parentGroup.add(hip);
    const upper = M(limbGeo(L[0], isFront ? 0.36 : 0.44, isFront ? 0.4 : 0.5, 0.2), mat.flesh);
    hip.add(upper);
    const knee = new THREE.Group(); knee.position.y = -L[0]; hip.add(knee);
    const lower = M(limbGeo(L[1], isFront ? 0.2 : 0.22, isFront ? 0.25 : 0.27, 0.13), mat.flesh);
    knee.add(lower);
    let ankle = null;
    if (isFront) {
      spikeAt(knee, 0, 0.02, -0.18, 0.06, 0.4, -2.3, 0, mat.flesh); // elbow spike
      const hand = new THREE.Group(); hand.position.y = -L[1]; knee.add(hand);
      paw(hand, 4, 0.45);
      legs.push({ hip, knee, foot: hand, L, front: true, side: sx, parent: parentGroup });
    } else {
      spikeAt(knee, 0, 0, 0.16, 0.06, 0.35, 2.3, 0, mat.flesh); // knee spike
      ankle = new THREE.Group(); ankle.position.y = -L[1]; knee.add(ankle);
      const meta = M(limbGeo(L[2], 0.14, 0.15, 0.1, 10), mat.flesh);
      ankle.add(meta);
      const foot = new THREE.Group(); foot.position.y = -L[2]; ankle.add(foot);
      paw(foot, 3, 0.35);
      legs.push({ hip, knee, ankle, foot, L, front: false, side: sx, parent: parentGroup });
    }
  }

  // ---------------------------------------------------------------- tail with hanging crosses
  const tail = [];
  const pendulums = [];
  parent = body;
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.15 : 0, i === 0 ? -1.95 : -0.66);
    const r0 = 0.4 * (1 - i / 8), r1 = 0.4 * (1 - (i + 1) / 8);
    const m = M(displace(new THREE.CylinderGeometry(r1, r0, 0.72, 10, 2), 0.06, 11, i), mat.flesh);
    m.rotation.x = Math.PI / 2; m.position.z = -0.36;
    seg.add(m);
    spikeAt(seg, 0, r0 + 0.12, -0.3, 0.08 * (1 - i * 0.08), 0.45 * (1 - i * 0.08), -0.5, 0, mat.flesh);
    if (i % 2 === 1) for (const s of [-1, 1]) spikeAt(seg, s * r0 * 0.9, r0 * 0.3, -0.35, 0.05, 0.3, 0, -s * 1.2, mat.flesh);
    if (i === 2 || i === 4) { // rosary chain with a little cross
      const pend = new THREE.Group();
      pend.position.set(i === 2 ? 0.2 : -0.18, -r0, -0.35);
      const chain = M(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4), mat.chrome); chain.position.y = -0.3; pend.add(chain);
      for (let b = 0; b < 5; b++) { const bead = M(new THREE.SphereGeometry(0.03, 5, 4), mat.wood); bead.position.y = -0.08 - b * 0.11; pend.add(bead); }
      const cv = M(new THREE.BoxGeometry(0.05, 0.32, 0.04), mat.wood); cv.position.y = -0.72; pend.add(cv);
      const ch = M(new THREE.BoxGeometry(0.2, 0.05, 0.04), mat.wood); ch.position.y = -0.66; pend.add(ch);
      seg.add(pend);
      pendulums.push(pend);
    }
    parent.add(seg);
    tail.push(seg);
    parent = seg;
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // ---------------------------------------------------------------- merge rigid parts per animated group
  const animated = new Set([chest, headPivot, jaw, drool, ...neck, ...tongue, ...tail, ...pendulums]);
  for (const L of legs) { animated.add(L.hip); animated.add(L.knee); if (L.ankle) animated.add(L.ankle); animated.add(L.foot); }
  const mergeGroup = (g) => mergeStatic(g, new Set([...animated].filter((a) => a !== g)));
  [body, chest, head, jaw, drool, ...neck, ...tongue, ...tail, ...pendulums].forEach(mergeGroup);
  for (const L of legs) { mergeGroup(L.hip); mergeGroup(L.knee); if (L.ankle) mergeGroup(L.ankle); mergeGroup(L.foot); }

  const noShadow = [drool, ...tongue, ...pendulums, ...tail.slice(3), ...legs.map((l) => l.foot), ...legs.filter((l) => l.ankle).map((l) => l.ankle)];
  for (const g of noShadow) for (const c of g.children) if (c.isMesh) c.castShadow = false;

  return {
    root, body, bodyY: BODY_Y, chest, neck, headPivot, head, headCenter, jaw, tongue, drool, legs, tail, pendulums,
    eyes, eyeLight, eyeMat: mat.eye, fleshMat: mat.flesh,
  };
}
