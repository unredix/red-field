import * as THREE from 'three';
import { glowTexture } from './textures.js';

// Pooled spark bursts (one Points object) for claw hits and parries.
// Uses the game dt, so sparks hang in the air during hit-stop, then fly.
export class Sparks {
  constructor(scene, N = 80) {
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.tint = new Float32Array(N * 3);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.35, map: glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  // p: world position, n: count, speed: m/s, big: parry (white-purple) vs hit (purple)
  burst(p, n = 30, speed = 7, big = false) {
    for (let j = 0; j < n; j++) {
      const i = this.next++ % this.N;
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const v = speed * (0.4 + Math.random() * 0.8);
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel.set([Math.cos(a) * s * v, Math.abs(u) * v * 0.8 + 1.5, Math.sin(a) * s * v], i * 3);
      this.life[i] = 0.45 + Math.random() * 0.35;
      const w = big && Math.random() < 0.5;
      this.tint.set(w ? [1.6, 1.4, 1.8] : [1.1, 0.45, 1.9], i * 3);
    }
  }

  update(dt) {
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(this.life[i], 0) / 0.6;
      this.vel[i * 3 + 1] -= 12 * dt;
      for (let a = 0; a < 3; a++) {
        this.vel[i * 3 + a] *= 1 - 2.5 * dt;
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
        this.col[i * 3 + a] = this.tint[i * 3 + a] * k;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.col.fill(0); this.points.geometry.attributes.color.needsUpdate = true; }
}
