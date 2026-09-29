import * as THREE from 'three';
import { glowTexture } from './textures.js';

// The player's right arm (maps.png, right panel): dark claw with glowing
// purple veins. Rendered in its own scene on top of the world so it never
// clips into walls.
//  LMB  Slash: stuns the monster at close range (parry during its windup)
//  RMB  Lure:  throws a glowing orb the monster goes after
// Charges are shown by vein brightness; the veins pulse faster when the
// monster is near.

export const ARM_CONFIG = {
  maxCharges: 2,
  rechargeTime: 25,
  slashTime: 0.34,
  throwTime: 0.45,
  lureLife: 12,
  throwSpeed: 13,
};
const C = ARM_CONFIG;

const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

const glowMap = glowTexture('rgba(200,120,255,1)', 'rgba(120,40,255,0)');

// ---------------------------------------------------------------- lure orb
export class Lure {
  constructor(scene, world, pos, vel) {
    this.scene = scene;
    this.world = world;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.life = C.lureLife;
    this.active = true;
    this.dying = 0;

    this.group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 3.5) }));
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.glow.scale.set(1.2, 1.2, 1);
    this.light = new THREE.PointLight(0xa050ff, 5, 12, 1.6);
    this.group.add(core, this.glow, this.light);
    this.group.position.copy(this.pos);
    scene.add(this.group);
    this.onBounce = null;
  }

  _inside(p) {
    for (const b of this.world.near(p.x, p.z, p.x, p.z)) {
      if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) return true;
    }
    return false;
  }

  update(dt, time) {
    if (this.dying > 0) {
      this.dying -= dt;
      const k = Math.max(this.dying / 0.35, 0);
      this.glow.scale.setScalar(1.2 + (1 - k) * 4);
      this.glow.material.opacity = k;
      this.light.intensity = 12 * k;
      if (this.dying <= 0) this.scene.remove(this.group);
      return;
    }
    if (!this.active) return;
    this.life -= dt;
    if (this.life <= 0) { this.destroy(); return; }

    this.vel.y -= 14 * dt;
    for (const ax of ['x', 'y', 'z']) {
      this.pos[ax] += this.vel[ax] * dt;
      if (this._inside(this.pos)) {
        this.pos[ax] -= this.vel[ax] * dt;
        if (Math.abs(this.vel[ax]) > 2) this.onBounce?.(this.pos);
        this.vel[ax] *= -0.35;
        for (const o of ['x', 'y', 'z']) if (o !== ax) this.vel[o] *= 0.8;
      }
    }
    const g = this.world.groundHeight(this.pos.x, this.pos.z);
    if (Number.isFinite(g) && this.pos.y < g + 0.12) {
      this.pos.y = g + 0.12;
      if (Math.abs(this.vel.y) > 2) this.onBounce?.(this.pos);
      this.vel.y = Math.abs(this.vel.y) < 0.6 ? 0 : -this.vel.y * 0.35;
      this.vel.x *= 0.7; this.vel.z *= 0.7;
    }
    this.group.position.copy(this.pos);
    const fade = Math.min(this.life / 1.5, 1);
    const flick = 0.85 + Math.sin(time * 23) * 0.1 + Math.sin(time * 7.3) * 0.05;
    this.light.intensity = 5 * fade * flick;
    this.glow.material.opacity = fade;
  }

  destroy() {
    if (!this.active) return;
    this.active = false;
    this.dying = 0.35;
  }

  dispose() { this.scene.remove(this.group); this.active = false; }
}

// ---------------------------------------------------------------- arm view model
export class Arm {
  constructor(aspect) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.01, 10);
    this.scene.add(this.camera);

    this.scene.add(new THREE.HemisphereLight(0x6a1a20, 0x0a0206, 0.9));
    this.flashLight = new THREE.DirectionalLight(0xfff1dc, 2);
    this.flashLight.position.set(-0.5, 1, 1);
    this.scene.add(this.flashLight);
    this.veinLight = new THREE.PointLight(0xa040ff, 0.6, 1.2, 2);
    this.scene.add(this.veinLight);

    this.rig = new THREE.Group();
    this.camera.add(this.rig);
    this.base = new THREE.Vector3(0.27, -0.29, -0.62);
    this.rig.position.copy(this.base);

    this._build();
    this.reset();
  }

  _build() {
    const skin = new THREE.MeshStandardMaterial({ color: 0x1c1026, roughness: 0.35, metalness: 0.1, emissive: 0x10041a });
    this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.3, 1.2) });
    this.clawMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.5, 1.5) });

    const arm = new THREE.Group();
    arm.rotation.set(0.38, 0.16, 0.25); // points forward/left/up into the view
    arm.scale.setScalar(0.85);
    this.rig.add(arm);
    this.armGroup = arm;

    // forearm (runs along -z)
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.068, 0.55, 12), skin);
    fore.rotation.x = Math.PI / 2;
    fore.position.z = 0.05;
    arm.add(fore);

    // hand
    const hand = new THREE.Group();
    hand.position.z = -0.24;
    hand.rotation.x = 0.05;
    arm.add(hand);
    this.hand = hand;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.11), skin);
    palm.position.z = -0.04;
    hand.add(palm);

    // fingers with long glowing claws
    this.fingers = [];
    const segGeo = new THREE.CylinderGeometry(0.012, 0.015, 0.06, 6);
    segGeo.rotateX(Math.PI / 2); segGeo.translate(0, 0, -0.03);
    const clawGeo = new THREE.ConeGeometry(0.012, 0.13, 6);
    clawGeo.rotateX(-Math.PI / 2); clawGeo.translate(0, 0, -0.065);
    const fingerDefs = [[-0.035, -0.12, 0.15], [-0.012, -0.12, 0.05], [0.012, -0.12, -0.05], [0.035, -0.11, -0.15], [-0.055, -0.03, 0.9]];
    fingerDefs.forEach(([x, z, spread], i) => {
      const f = new THREE.Group();
      f.position.set(x, 0, z + 0.03);
      f.rotation.y = spread;
      if (i === 4) f.rotation.z = 0.6; // thumb
      const s1 = new THREE.Mesh(segGeo, skin);
      const k2 = new THREE.Group(); k2.position.z = -0.06;
      const s2 = new THREE.Mesh(segGeo, skin);
      const k3 = new THREE.Group(); k3.position.z = -0.06;
      const claw = new THREE.Mesh(clawGeo, this.clawMat);
      k3.add(claw); k2.add(s2, k3); f.add(s1, k2);
      hand.add(f);
      this.fingers.push({ f, k2, k3, thumb: i === 4 });
    });

    // veins
    const addVein = (pts, r) => {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, r, 5), this.glowMat);
      arm.add(m);
    };
    for (let v = 0; v < 5; v++) {
      const a0 = -0.6 + v * 0.55;
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const z = 0.3 - i * 0.08;
        const a = a0 + Math.sin(i * 1.3 + v) * 0.35;
        const r = z > -0.22 ? 0.052 + (z + 0.22) * 0.03 + 0.004 : 0.03;
        pts.push([Math.cos(a) * r * (z < -0.22 ? 1.6 : 1), Math.sin(a) * r * (z < -0.22 ? 0.5 : 1) + 0.004, z]);
      }
      addVein(pts, 0.0045);
    }
    // glow at the wrist
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 }));
    glow.scale.set(0.35, 0.35, 1);
    glow.position.set(0, 0.02, -0.22);
    arm.add(glow);
    this.glowSprite = glow;
  }

  reset() {
    this.charges = C.maxCharges;
    this.rechargeT = 0;
    this.action = null;
    this.swayX = 0; this.swayY = 0;
    this.prevYaw = null; this.prevPitch = 0;
    this.pulse = 0;
    this.fizzleT = 0;
    this.sprintK = 0;
    this.mantleK = 0;
  }

  // request = 'slash' | 'throw'; returns true if started. `free` slashes (striking
  // tower stones) don't use a charge.
  trigger(type, free = false) {
    if (this.action) return false;
    if (!free && this.charges < 1) { this.fizzleT = 0.4; return false; }
    if (!free) this.charges -= 1;
    this.action = { type, t: 0, fired: false, free };
    return true;
  }

  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  // ctx: { player, flashlightK (0..1), dangerK (0..1), onSlashHit(), onThrow() }
  update(dt, time, ctx) {
    const p = ctx.player;

    // recharge
    if (this.charges < C.maxCharges) {
      this.rechargeT += dt;
      if (this.rechargeT >= C.rechargeTime) { this.charges += 1; this.rechargeT = 0; }
    } else this.rechargeT = 0;

    // sway from mouse look
    if (this.prevYaw === null) { this.prevYaw = p.yaw; this.prevPitch = p.pitch; }
    let dYaw = p.yaw - this.prevYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2; if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = p.pitch - this.prevPitch;
    this.prevYaw = p.yaw; this.prevPitch = p.pitch;
    this.swayX = damp(this.swayX + dYaw * 0.35, 0, 9, dt);
    this.swayY = damp(this.swayY - dPitch * 0.35, 0, 9, dt);
    this.swayX = Math.max(-0.12, Math.min(0.12, this.swayX));
    this.swayY = Math.max(-0.12, Math.min(0.12, this.swayY));

    this.sprintK = damp(this.sprintK, p.sprinting && p.grounded ? 1 : 0, 8, dt);
    this.mantleK = damp(this.mantleK, p.mantle || p.wallRunning ? 1 : 0, 10, dt);
    this.hideK = damp(this.hideK || 0, p.hiding ? 1 : 0, 8, dt);

    const bobX = Math.sin(p.bobPhase) * 0.018 * p.bobAmount;
    const bobY = Math.sin(p.bobPhase * 2) * 0.014 * p.bobAmount;

    let ox = this.swayX + bobX, oy = this.swayY + bobY + p.landOffset * 0.4, oz = 0;
    let rx = Math.sin(p.bobPhase) * 0.18 * this.sprintK - 0.15 * this.sprintK, ry = 0, rz = 0;
    oy -= 0.04 * this.sprintK;
    oy += 0.12 * this.mantleK; rx -= 0.7 * this.mantleK; oz -= 0.05 * this.mantleK;
    oy -= 0.07 * this.hideK; oz += 0.06 * this.hideK; ox -= 0.03 * this.hideK; rx += 0.35 * this.hideK; // pulled in close
    let curl = 0.35 + 0.15 * Math.sin(time * 1.3); // idle finger twitch

    // actions
    const a = this.action;
    if (a) {
      a.t += dt;
      if (a.type === 'slash') {
        const s = a.t / C.slashTime;
        const w = smooth(0, 0.25, s) * (1 - smooth(0.25, 0.45, s));
        const sw = smooth(0.25, 0.5, s) * (1 - smooth(0.6, 1, s));
        ox += 0.12 * w - 0.42 * sw; oy += 0.08 * w + 0.06 * sw; oz -= 0.12 * sw;
        rz += 0.6 * w - 1.0 * sw; ry += -0.3 * w + 0.9 * sw;
        curl = 0.1 * (1 - w - sw) - 0.3 * (w + sw) + 0.35;
        if (!a.fired && s > 0.4) { a.fired = true; ctx.onSlashHit?.(a.free); }
        if (s >= 1) this.action = null;
      } else {
        const s = a.t / C.throwTime;
        const back = smooth(0, 0.4, s) * (1 - smooth(0.4, 0.55, s));
        const fwd = smooth(0.4, 0.6, s) * (1 - smooth(0.7, 1, s));
        oz += 0.15 * back - 0.25 * fwd; oy += 0.12 * back; rx += -0.7 * back + 0.35 * fwd;
        curl = 0.8 * back - 0.4 * fwd + 0.35 * (1 - back - fwd);
        if (!a.fired && s > 0.5) { a.fired = true; ctx.onThrow?.(); }
        if (s >= 1) this.action = null;
      }
    }
    if (this.fizzleT > 0) { this.fizzleT -= dt; ox += Math.sin(time * 60) * 0.004; }

    this.rig.position.set(this.base.x + ox, this.base.y + oy, this.base.z + oz);
    this.rig.rotation.set(rx, ry, rz);
    for (const F of this.fingers) {
      const c = F.thumb ? curl * 0.5 : curl;
      F.k2.rotation.x = -c * 0.9;
      F.k3.rotation.x = -c * 0.6;
    }

    // veins: brightness = charges, pulse = danger
    const danger = ctx.dangerK || 0;
    const rate = 1 + danger * 3.5;
    this.pulse += dt * rate * Math.PI * 2;
    const beat = Math.pow(Math.max(0, Math.sin(this.pulse)), 6) + 0.6 * Math.pow(Math.max(0, Math.sin(this.pulse - 0.6)), 6);
    const chargeLevel = (this.charges + (this.charges < C.maxCharges ? this.rechargeT / C.rechargeTime * 0.5 : 0)) / C.maxCharges;
    let k = 0.2 + 0.8 * chargeLevel + beat * (0.25 + danger * 0.9);
    if (this.fizzleT > 0) k *= Math.random() < 0.5 ? 0.2 : 1;
    this.glowMat.color.setRGB(0.55 * k, 0.2 * k, 1.1 * k);
    this.clawMat.color.setRGB(0.5 + 0.5 * k, 0.3 + 0.2 * k, 0.9 + 0.7 * k);
    this.glowSprite.material.opacity = 0.15 + 0.45 * k;
    this.veinLight.intensity = 0.5 * k;
    this.veinLight.position.copy(this.rig.position).add(new THREE.Vector3(0, 0.05, -0.2));

    this.flashLight.intensity = 2.2 * (ctx.flashlightK ?? 1);
  }

  // World-space spawn point / velocity for a thrown lure.
  throwFrom(mainCamera, playerVel) {
    const f = new THREE.Vector3(); mainCamera.getWorldDirection(f);
    const right = new THREE.Vector3().crossVectors(f, mainCamera.up).normalize();
    const pos = mainCamera.position.clone().addScaledVector(right, 0.25).addScaledVector(f, 0.4).add(new THREE.Vector3(0, -0.1, 0));
    const vel = f.clone().multiplyScalar(C.throwSpeed).add(new THREE.Vector3(0, 2.5, 0)).addScaledVector(playerVel, 0.5);
    return { pos, vel };
  }
}
