import * as THREE from 'three';
import { flashlightCookie } from './textures.js';

// Hand-held flashlight: lags slightly behind the camera for a physical feel,
// casts shadows, projects a ring "cookie", and flickers now and then.
export class Flashlight {
  constructor(scene) {
    this.rig = new THREE.Object3D();
    scene.add(this.rig);

    this.baseIntensity = 160;
    this.light = new THREE.SpotLight(0xfff1dc, this.baseIntensity, 50, 0.46, 0.4, 1.15);
    this.light.position.set(0, 0, 0); // SpotLight defaults to (0,1,0)
    this.light.map = flashlightCookie();
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 0.1;
    this.light.shadow.camera.far = 35;
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.02;
    this.rig.add(this.light);

    this.target = new THREE.Object3D();
    this.target.position.set(0, 0, -1);
    this.rig.add(this.target);
    this.light.target = this.target;

    // Faint bounce so nearby surfaces outside the cone aren't pitch black.
    this.spill = new THREE.PointLight(0xffe6c8, 0.9, 6, 2);
    this.spill.position.set(0, 0, -0.6);
    this.rig.add(this.spill);

    this.on = true;
    this.offset = new THREE.Vector3(0.22, -0.2, -0.1); // right / down of the eye
    this.lagRate = 16;
    this.flickerT = 0;
    this.flickerMul = 1;
    this.nextFlicker = 8 + Math.random() * 15;
    this.switchT = 0; // brief dim when toggling
    this.onTime = 0;  // seconds continuously on (the monster notices long use)
    this.danger = 0;  // 0..1 monster proximity, set by the game; makes it flicker
    this._tmp = new THREE.Vector3();
  }

  toggle() {
    this.on = !this.on;
    this.switchT = 0.06;
    this.onTime = 0;
  }

  reset() {
    this.on = true;
    this.onTime = 0;
    this.flickerT = 0;
    this.flickerMul = 1;
  }

  update(dt, camera, time) {
    // follow camera with a little lag (rotation) but exact position
    this._tmp.copy(this.offset).applyQuaternion(camera.quaternion).add(camera.position);
    this.rig.position.copy(this._tmp);
    this.rig.quaternion.slerp(camera.quaternion, 1 - Math.exp(-this.lagRate * dt));

    if (this.on) this.onTime += dt;

    // random flicker bursts, much more frequent when the monster is near
    this.nextFlicker -= dt * (1 + this.danger * 8);
    if (this.nextFlicker <= 0) {
      this.flickerT = 0.25 + Math.random() * 0.5;
      this.nextFlicker = 10 + Math.random() * 20;
    }
    if (this.flickerT > 0) {
      this.flickerT -= dt;
      if (Math.random() < 0.35) this.flickerMul = Math.random() < 0.4 ? 0.05 : 0.4 + Math.random() * 0.6;
      if (this.flickerT <= 0) this.flickerMul = 1;
    }
    const hum = 1 + Math.sin(time * 37) * 0.01 + Math.sin(time * 91) * 0.008;

    this.switchT = Math.max(0, this.switchT - dt);
    const k = this.on && this.switchT <= 0 ? this.flickerMul * hum : 0;
    this.light.intensity = this.baseIntensity * k;
    this.spill.intensity = 0.9 * k;
  }
}
