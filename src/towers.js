import * as THREE from 'three';
import { glowTexture } from './textures.js';

// The three organ-pipe towers. Waking one takes three steps:
//   1. charge: stand in its rune circle with your light on (not hiding) until 50%
//   2. melody: the tower sings a sequence on its standing stones; strike the
//      stones in the same order with your claw (a wrong note is LOUD)
//   3. charge the rest of the way to 100%
// Charging hums louder and louder and draws the monster in. When all three are
// awake they strike the monster down.

export const TOWER_CONFIG = {
  circleRadius: 4.3,
  halfTime: 10,        // seconds of charging for each half
  decay: 0.015,        // progress lost per second while nobody charges
  noiseEvery: 1.5,
  noiseBase: 18,       // noise radius while charging, grows with progress
  noiseGrow: 30,
  wrongNoise: 45,      // a wrong note can be heard across a big chunk of the map
  replayEvery: 6,      // seconds of idling before the melody plays again
  noteTime: 0.55,
  noteGap: 0.2,
  strikeRange: 5,     // how far the claw reaches a stone
  stoneRadius: 0.75,  // aim tolerance around the stone's axis
  stoneBottom: 0.1,   // the stone's aim capsule runs from its foot...
  stoneTop: 2.3,      // ...up to the floating gem
  beaconDist: 80,      // beacons/beams farther than this are drawn at this distance (camera far is 100)
};
const C = TOWER_CONFIG;

const NOTES = [220, 247.5, 277, 330, 370];               // A pentatonic-ish
const HUES = [[0.8, 0.35, 1.6], [1.6, 0.25, 0.3], [1.6, 0.85, 0.2], [0.25, 1.1, 1.3], [1.3, 1.25, 1.35]];

function runeTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.translate(s / 2, s / 2);
  ctx.lineWidth = 3;
  for (const r of [124, 112, 70]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.lineWidth = 2;
  for (let i = 0; i < 24; i++) { // ticks + glyphs between the outer rings
    ctx.save();
    ctx.rotate((i / 24) * Math.PI * 2);
    ctx.beginPath(); ctx.moveTo(0, -112); ctx.lineTo(0, -124); ctx.stroke();
    if (i % 2) {
      ctx.beginPath(); ctx.moveTo(-5, -92); ctx.lineTo(0, -104); ctx.lineTo(5, -92); ctx.moveTo(0, -104); ctx.lineTo(0, -80); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, -92, 5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  for (let i = 0; i < 5; i++) { // pentagram-ish star
    const a0 = (i / 5) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 2) / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(Math.cos(a0) * 70, Math.sin(a0) * 70); ctx.lineTo(Math.cos(a1) * 70, Math.sin(a1) * 70); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Towers {
  constructor(scene, world, sites, sfx) {
    this.scene = scene;
    this.world = world;
    this.sfx = sfx;
    this.sites = sites;
    this.onActivated = null;   // (site, count)
    this.onAllActive = null;   // ()
    this.onWrong = null;       // (site)
    this.onPuzzleStart = null; // (site)

    const glowMap = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    const rune = runeTexture();
    const gemGeo = new THREE.OctahedronGeometry(0.18);
    for (const site of sites) {
      site.pos = new THREE.Vector3(site.x, site.g, site.z);
      site.crownPos = new THREE.Vector3(site.x, site.crownY, site.z);
      site.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.85), new THREE.MeshBasicMaterial({ color: 0xff2010 }));
      site.crystal.position.copy(site.crownPos);
      site.glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowMap, color: 0xff2010, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false,
      }));
      site.glow.renderOrder = 2;
      site.circle = new THREE.Mesh(new THREE.CircleGeometry(C.circleRadius, 64), new THREE.MeshBasicMaterial({
        map: rune, color: 0xa040ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      site.circle.rotation.x = -Math.PI / 2;
      site.circle.position.set(site.x, site.g + 0.07, site.z);
      site.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 140, 16, 1, true), new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.7, 0.3, 1.6), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false, side: THREE.DoubleSide,
      }));
      site.beam.visible = false;
      site.beam.frustumCulled = false;
      site.gems = site.stones.map((st, i) => {
        const gem = new THREE.Mesh(gemGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(...HUES[i % HUES.length]) }));
        gem.position.set(st.x, st.y + 2.05, st.z);
        scene.add(gem);
        return gem;
      });
      scene.add(site.crystal, site.glow, site.circle, site.beam);
    }
    this.strikeBeams = [];
    this.reset();
  }

  reset() {
    for (const s of this.sites) {
      s.phase = 0;          // 0 charge, 1 melody, 2 charge, 3 awake
      s.progress = 0;
      s.puzzle = null;
      s.flash = s.stones.map(() => 0);
      s.wrongT = 0;
      s.noiseT = 0;
      s.idleCharge = 0;
      s.hum?.stop();
      s.hum = null;
      s.beam.visible = false;
    }
    for (const b of this.strikeBeams) this.scene.remove(b);
    this.strikeBeams = [];
    this.strikeTarget = null;
    this.current = null;
    this.aimed = null; // stone under the crosshair (set by the game each frame)
  }

  get count() { return this.sites.filter((s) => s.phase === 3).length; }
  get total() { return this.sites.length; }

  // ---------------------------------------------------------------- melody puzzle
  _startPuzzle(site) {
    const len = 3 + this.count; // 3, 4, then 5 notes
    const seq = [];
    while (seq.length < len) {
      const n = Math.floor(Math.random() * site.stones.length);
      if (n !== seq[seq.length - 1]) seq.push(n);
    }
    site.puzzle = { seq, input: 0, queue: [], playT: 0, idleT: C.replayEvery - 1.2 };
    this.sfx.organChord(site.crownPos);
    this.onPuzzleStart?.(site);
  }

  _note(site, idx) {
    site.flash[idx] = 1;
    const st = site.stones[idx];
    this.sfx.organNote(_v.set(st.x, st.y, st.z).clone(), NOTES[idx % NOTES.length]);
  }

  _updatePuzzle(site, dt, dist) {
    const P = site.puzzle;
    if (P.queue.length || P.playing) {
      P.playT -= dt;
      if (P.playT <= 0) {
        if (P.queue.length) { this._note(site, P.queue.shift()); P.playT = C.noteTime + C.noteGap; P.playing = true; }
        else P.playing = false;
      }
    } else if (dist < 20) {
      P.idleT += dt;
      if (P.idleT > C.replayEvery) { P.queue = [...P.seq]; P.playT = 0.2; P.idleT = 0; P.input = 0; }
    }
  }

  // Stone the camera is aiming at within striking range, or null. Each stone is a
  // vertical capsule from its foot to the floating gem, so aiming at any part of it
  // (including the gem) works from the ground.
  aim(camera) {
    const o = camera.position;
    camera.getWorldDirection(_v);
    let best = null, bestS = Infinity;
    for (const site of this.sites) {
      if (Math.hypot(site.x - o.x, site.z - o.z) > 16) continue;
      site.stones.forEach((st, idx) => {
        // closest approach between the view ray and the segment (x, y0..y1, z)
        const y0 = st.y + C.stoneBottom, y1 = st.y + C.stoneTop;
        const wx = o.x - st.x, wy = o.y - y0, wz = o.z - st.z;
        const b = _v.y, d = _v.x * wx + _v.y * wy + _v.z * wz;
        const denom = 1 - b * b;
        let t = denom > 1e-6 ? (wy - b * d) / denom : 0;            // along the segment
        t = Math.min(Math.max(t, 0), y1 - y0);
        let s = Math.max(0, _v.x * -wx + _v.y * (t - wy) + _v.z * -wz); // along the ray
        t = Math.min(Math.max(wy + _v.y * s, 0), y1 - y0);
        const px = o.x + _v.x * s - st.x, py = o.y + _v.y * s - (y0 + t), pz = o.z + _v.z * s - st.z;
        const dist = Math.hypot(px, py, pz);
        if (dist < C.stoneRadius && s < C.strikeRange && s < bestS) { bestS = s; best = { site, idx }; }
      });
    }
    return best;
  }

  // Called when the claw connects with a stone.
  strike({ site, idx }) {
    this._note(site, idx);
    if (site.phase !== 1) return;
    const P = site.puzzle;
    P.queue = []; P.playing = false; P.idleT = 0;
    if (P.seq[P.input] === idx) {
      P.input++;
      if (P.input >= P.seq.length) { // solved
        site.phase = 2;
        site.puzzle = null;
        this.sfx.organChord(site.crownPos);
      }
    } else {
      P.input = 0;
      P.idleT = C.replayEvery - 2; // replays shortly
      site.wrongT = 0.6;
      this.sfx.wrongNote(site.crownPos);
      this.world.noise(site.pos, C.wrongNoise);
      this.onWrong?.(site);
    }
  }

  _activate(site) {
    site.phase = 3;
    site.progress = 1;
    site.beam.visible = true;
    site.hum?.stop();
    site.hum = null;
    this.sfx.organChord(site.crownPos, true);
    const n = this.count;
    this.onActivated?.(site, n);
    if (n === this.total) this.onAllActive?.();
  }

  // ---------------------------------------------------------------- final strike
  // All towers fire at the monster (target = function returning a Vector3).
  fireAt(target) {
    this.strikeTarget = target;
    for (const site of this.sites) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1, 10, 1, true), new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.55, 0.18, 1.3), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: false, side: THREE.DoubleSide,
      }));
      b.frustumCulled = false;
      b.userData.site = site;
      this.scene.add(b);
      this.strikeBeams.push(b);
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt, time, { player, camera }) {
    this.current = null;
    const cam = camera.position;
    for (const site of this.sites) {
      const d = Math.hypot(player.pos.x - site.x, player.pos.z - site.z);
      const inCircle = player.alive && d < C.circleRadius && Math.abs(player.pos.y - site.g) < 2.5;
      if ((inCircle && site.phase < 3) || (site.phase === 1 && d < 12)) this.current = site;
      const charging = inCircle && !player.hiding && (site.phase === 0 || site.phase === 2);

      if (site.phase === 0 || site.phase === 2) {
        if (charging) {
          site.progress += (0.5 * dt) / C.halfTime;
          site.noiseT -= dt;
          if (site.noiseT <= 0) { site.noiseT = C.noiseEvery; this.world.noise(site.pos, C.noiseBase + C.noiseGrow * site.progress); }
          if (site.phase === 0 && site.progress >= 0.5) { site.progress = 0.5; site.phase = 1; this._startPuzzle(site); }
          else if (site.phase === 2 && site.progress >= 1) this._activate(site);
        } else {
          site.progress = Math.max(site.phase === 2 ? 0.5 : 0, site.progress - C.decay * dt);
        }
      } else if (site.phase === 1) this._updatePuzzle(site, dt, d);

      // hum while charging, fades out shortly after you step away
      if (charging) {
        site.idleCharge = 0;
        if (!site.hum) site.hum = this.sfx.towerHum(site.crownPos.clone());
      } else site.idleCharge += dt;
      if (site.hum) {
        site.hum.set(charging ? site.progress : 0);
        if (site.idleCharge > 2) { site.hum.stop(); site.hum = null; }
      }

      // ---- visuals
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.5 + site.x);
      const col = site.crystal.material.color;
      let glowScale = 7, glowCol;
      if (site.phase === 3) {
        col.setRGB(1.4, 0.8, 2.2);
        glowCol = [0.8, 0.45, 1.4]; glowScale = 12;
      } else if (site.phase === 1) {
        col.setRGB(0.9 + pulse * 0.4, 0.3, 1.5);
        glowCol = [0.7, 0.25, 1.1]; glowScale = 9;
      } else {
        const k = site.phase === 2 ? 1 : site.progress * 2;
        col.setRGB(1.2 - k * 0.4 + pulse * 0.2, 0.12 + k * 0.2, 0.08 + k * 1.3);
        glowCol = [0.7 - k * 0.2, 0.08 + k * 0.15, 0.05 + k * 0.9];
        glowScale = 6 + k * 3 + (charging ? pulse * 2 : 0);
      }
      if (site.wrongT > 0) { site.wrongT -= dt; col.setRGB(2, 0.1, 0.05); glowCol = [1.2, 0.05, 0.02]; }
      site.crystal.rotation.y += dt * (site.phase === 3 ? 2.5 : charging ? 1.5 : 0.4);
      site.glow.material.color.setRGB(...glowCol);

      // far-away crowns/beams are pulled in to beaconDist so they stay visible through the short far plane
      const dist = cam.distanceTo(site.crownPos);
      const k = dist > C.beaconDist ? C.beaconDist / dist : 1;
      site.glow.position.copy(site.crownPos).sub(cam).multiplyScalar(k).add(cam);
      site.glow.scale.setScalar(glowScale * k);
      if (site.beam.visible) {
        site.beam.position.set(site.x, site.crownY + 70, site.z).sub(cam).multiplyScalar(k).add(cam);
        site.beam.scale.setScalar(k);
        site.beam.material.opacity = 0.25 + 0.1 * pulse;
      }

      site.circle.material.opacity = site.phase === 3 ? 0.55
        : 0.2 + pulse * 0.06 + (inCircle ? 0.2 : 0) + site.progress * 0.35 + (charging ? pulse * 0.15 : 0);
      site.circle.rotation.z += dt * (charging ? 0.6 : 0.05);

      site.gems.forEach((gem, i) => {
        site.flash[i] = Math.max(0, site.flash[i] - dt * 2.2);
        const f = site.flash[i];
        const aimed = this.aimed && this.aimed.site === site && this.aimed.idx === i;
        const base = (site.phase === 1 ? 0.35 : site.phase === 3 ? 0.6 : 0.12) + (aimed ? 0.45 : 0);
        const h = HUES[i % HUES.length];
        const w = site.wrongT > 0 ? 0 : 1;
        gem.material.color.setRGB((h[0] * w + (1 - w) * 1.8) * (base + f * 1.6), (h[1] * w) * (base + f * 1.6), (h[2] * w) * (base + f * 1.6));
        gem.scale.setScalar(1 + f * 1.5 + (aimed ? 0.35 + Math.sin(time * 8) * 0.1 : 0));
        gem.position.y = site.stones[i].y + 2.05 + Math.sin(time * 1.5 + i) * 0.06;
        gem.rotation.y += dt;
      });
    }

    // beams converging on the monster
    if (this.strikeTarget) {
      const tgt = this.strikeTarget();
      for (const b of this.strikeBeams) {
        const from = b.userData.site.crownPos;
        _v.subVectors(tgt, from);
        const len = _v.length();
        b.position.copy(from).addScaledVector(_v, 0.5);
        b.quaternion.setFromUnitVectors(_up, _v.normalize());
        b.scale.set(1 + Math.sin(time * 40) * 0.25, len, 1 + Math.sin(time * 40) * 0.25);
      }
    }
  }

  // Data for the HUD.
  hud(player) {
    const s = this.current;
    if (!s) return null;
    if (s.phase === 1) return { mode: 'melody', input: s.puzzle.input, len: s.puzzle.seq.length, progress: s.progress };
    return { mode: player.hiding ? 'blocked' : 'charge', progress: s.progress };
  }
}
