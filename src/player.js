import * as THREE from 'three';

// All tunables in one place. Speeds in m/s, times in seconds.
export const PLAYER_CONFIG = {
  radius: 0.3,
  standHeight: 1.8,
  crouchHeight: 1.0,
  eyeFromTop: 0.12,
  stepHeight: 0.45,

  walkSpeed: 4.4,
  sprintSpeed: 8.2,
  crouchSpeed: 2.3,
  groundAccel: 14,     // Quake-style: accel * wishSpeed per second
  airAccel: 2.8,
  friction: 8,
  stopSpeed: 1.5,

  gravity: 22,
  jumpVelocity: 7.2,
  coyoteTime: 0.12,
  jumpBuffer: 0.14,

  hideFriction: 14,    // how fast you stop when you drop into the hide stance

  wallProbe: 0.2,
  wallRunMinSpeed: 4.5,
  wallRunMaxTime: 1.5,
  wallRunGravity: 5,
  wallRunMaxFall: 1.5,
  wallRunEntryUp: 3,
  wallJumpUp: 6.8,
  wallJumpOut: 6.5,
  wallJumpCooldown: 0.2,

  mantleReach: 0.55,   // how far above head you can grab a ledge
  mantleTime: 0.32,

  staminaDuration: 5.5, // seconds of continuous sprint
  staminaRegen: 3.5,    // seconds to refill from empty
  staminaRecover: 0.35, // fraction required after exhaustion

  mouseSensitivity: 0.0022,
  baseFov: 76,
  maxFovBoost: 12,
  fovSpeedRef: 11,     // speed that gives the full FOV boost
};

const C = PLAYER_CONFIG;
const SKIN = 0.001;
const EPS = 1e-4;
const DEG = Math.PI / 180;

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

const _box = new THREE.Box3();
const _box2 = new THREE.Box3();
const _p = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();

export class Player {
  constructor(camera, world, input, spawn, yaw = 0) {
    this.camera = camera;
    this.world = world;
    this.colliders = world.colliders;
    this.input = input;
    this.spawnPoint = spawn.clone();
    this.spawnYaw = yaw;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.onFootstep = null; // hook for audio later: (intensity) => {}
    this.onLand = null;     // (impactSpeed) => {}
    this.allowRespawnKey = false; // R = back to spawn (test map only)
    this.respawn();
  }

  respawn() {
    this.pos.copy(this.spawnPoint);
    this.vel.set(0, 0, 0);
    this.yaw = this.spawnYaw;
    this.pitch = 0;
    this.height = C.standHeight;
    this.crouched = false;
    this.hiding = false;   // holding C on the ground: rooted, flashlight off
    this.grounded = false;
    this.coyote = 0;
    this.jumpBufferT = 0;
    this.wallRunning = false;
    this.wallRunTime = 0;
    this.wallSide = 0;
    this.wallJumpCd = 0;
    this.stamina = 1;
    this.exhausted = false;
    this.sprinting = false;
    this.mantle = null;
    this.hidden = false;   // crouched in tall grass
    this.wading = false;   // in the blood pool
    this.alive = true;

    // camera effect state
    this.eyeHeight = C.standHeight - C.eyeFromTop;
    this.stepOffset = 0;
    this.landOffset = 0;
    this.landVel = 0;
    this.landPitch = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.roll = 0;
    this.fov = C.baseFov;
    this.trauma = 0;   // camera shake 0..1 (see addShake)
    this.shakeT = 0;
  }

  // Camera shake (monster footsteps, roars). Stacks up to 1 and decays.
  addShake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  // ------------------------------------------------------------------ collision helpers
  _makeBox(pos, height, out) {
    out.min.set(pos.x - C.radius, pos.y, pos.z - C.radius);
    out.max.set(pos.x + C.radius, pos.y + height, pos.z + C.radius);
    return out;
  }

  _hit(box) {
    for (const c of this.world.near(box.min.x, box.min.z, box.max.x, box.max.z)) {
      if (box.max.x > c.min.x + EPS && box.min.x < c.max.x - EPS &&
          box.max.y > c.min.y + EPS && box.min.y < c.max.y - EPS &&
          box.max.z > c.min.z + EPS && box.min.z < c.max.z - EPS) return c;
    }
    for (const c of this.world.dynamicColliders) {
      if (box.intersectsBox(c)) return c;
    }
    return null;
  }

  // Highest terrain point under the player's footprint.
  _terrainAt(pos) {
    const w = this.world;
    if (!w.heightFn) return -Infinity;
    const r = C.radius * 0.7;
    return Math.max(
      w.heightFn(pos.x, pos.z),
      w.heightFn(pos.x + r, pos.z + r), w.heightFn(pos.x - r, pos.z + r),
      w.heightFn(pos.x + r, pos.z - r), w.heightFn(pos.x - r, pos.z - r),
    );
  }

  _free(pos, height) { return !this._hit(this._makeBox(pos, height, _box2)); }

  _moveHorizontal(axis, amount, canStep) {
    if (amount === 0) return false;
    this.pos[axis] += amount;
    for (let i = 0; i < 4; i++) {
      const c = this._hit(this._makeBox(this.pos, this.height, _box));
      if (!c) return false;
      // Step up small ledges (stairs) while on the ground.
      if (canStep) {
        const step = c.max.y - this.pos.y;
        if (step > 0 && step <= C.stepHeight) {
          _p.copy(this.pos); _p.y = c.max.y;
          if (this._free(_p, this.height)) {
            this.pos.y = c.max.y;
            this.stepOffset -= step;
            continue;
          }
        }
      }
      this.pos[axis] = amount > 0 ? c.min[axis] - C.radius - SKIN : c.max[axis] + C.radius + SKIN;
      this.vel[axis] = 0;
      return true;
    }
    return true;
  }

  _moveVertical(amount) {
    const res = { landed: false, bonk: false };
    if (amount === 0) return res;
    this.pos.y += amount;
    for (let i = 0; i < 4; i++) {
      const c = this._hit(this._makeBox(this.pos, this.height, _box));
      if (!c) break;
      if (amount < 0) { this.pos.y = c.max.y; res.landed = true; }
      else { this.pos.y = c.min.y - this.height - SKIN; res.bonk = true; }
    }
    const g = this._terrainAt(this.pos);
    if (this.pos.y < g) {
      this.pos.y = g;
      if (amount < 0) res.landed = true;
    }
    return res;
  }

  // Returns the wall the player is touching (air only): { nx, nz } normal pointing away from wall.
  _probeWall() {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let best = null, bestScore = -Infinity;
    for (const [dx, dz] of dirs) {
      this._makeBox(this.pos, this.height, _box);
      _box.min.x += dx * C.wallProbe; _box.max.x += dx * C.wallProbe;
      _box.min.z += dz * C.wallProbe; _box.max.z += dz * C.wallProbe;
      _box.min.y += 0.3; _box.max.y -= 0.2; // ignore floor & ceiling contact
      if (!this._hit(_box)) continue;
      // Prefer the wall we're moving into / beside, not behind us.
      const score = Math.abs(dx * _right.x + dz * _right.z); // prefer side walls
      if (score > bestScore) { bestScore = score; best = { nx: -dx, nz: -dz }; }
    }
    return best;
  }

  _tryMantle() {
    const reachTop = this.pos.y + this.height + C.mantleReach;
    const px = this.pos.x + _fwd.x * (C.radius + 0.2);
    const pz = this.pos.z + _fwd.z * (C.radius + 0.2);
    _box.min.set(px - 0.12, this.pos.y + 0.25, pz - 0.12);
    _box.max.set(px + 0.12, reachTop, pz + 0.12);

    let ledge = -Infinity;
    for (const c of this.world.near(_box.min.x, _box.min.z, _box.max.x, _box.max.z)) {
      if (_box.max.x > c.min.x && _box.min.x < c.max.x &&
          _box.max.y > c.min.y && _box.min.y < c.max.y &&
          _box.max.z > c.min.z && _box.min.z < c.max.z) {
        if (c.max.y > reachTop) return false; // wall too tall
        ledge = Math.max(ledge, c.max.y);
      }
    }
    if (ledge === -Infinity || ledge - this.pos.y < 0.6) return false;

    // Space above current spot to climb, and space on the ledge to crouch.
    _p.set(this.pos.x, ledge + SKIN, this.pos.z);
    if (!this._free(_p, C.crouchHeight)) return false;
    const to = new THREE.Vector3(
      this.pos.x + _fwd.x * (C.radius * 2 + 0.25), ledge + SKIN, this.pos.z + _fwd.z * (C.radius * 2 + 0.25));
    if (!this._free(to, C.crouchHeight)) return false;

    // crouch for the climb (feet stay put, eye drops a bit = natural dip)
    if (!this.crouched) { this.crouched = true; this.height = C.crouchHeight; }
    this.mantle = {
      t: 0,
      dur: C.mantleTime * (0.7 + 0.3 * Math.min((ledge - this.pos.y) / 2, 1.5)),
      from: this.pos.clone(),
      to,
      exitSpeed: Math.max(Math.hypot(this.vel.x, this.vel.z) * 0.5, 2.5),
    };
    this.vel.set(0, 0, 0);
    this.wallRunning = false;
    return true;
  }

  _updateMantle(dt) {
    const m = this.mantle;
    m.t += dt / m.dur;
    const t = Math.min(m.t, 1);
    // up first, then forward
    const up = Math.min(t / 0.65, 1);
    const fw = Math.max((t - 0.35) / 0.65, 0);
    const ease = (x) => 1 - (1 - x) * (1 - x);
    this.pos.y = m.from.y + (m.to.y - m.from.y) * ease(up);
    this.pos.x = m.from.x + (m.to.x - m.from.x) * ease(fw);
    this.pos.z = m.from.z + (m.to.z - m.from.z) * ease(fw);
    if (m.t >= 1) {
      this.pos.copy(m.to);
      this.vel.set(_fwd.x * m.exitSpeed, 0, _fwd.z * m.exitSpeed);
      this.grounded = true;
      this.mantle = null;
    }
  }

  // ------------------------------------------------------------------ movement helpers
  _friction(amount, dt) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < 1e-4) { this.vel.x = this.vel.z = 0; return; }
    const control = Math.max(speed, C.stopSpeed);
    const newSpeed = Math.max(speed - control * amount * dt, 0);
    const k = newSpeed / speed;
    this.vel.x *= k; this.vel.z *= k;
  }

  _accelerate(wish, wishSpeed, accel, dt) {
    if (wishSpeed <= 0) return;
    const current = this.vel.x * wish.x + this.vel.z * wish.z;
    const add = wishSpeed - current;
    if (add <= 0) return;
    const a = Math.min(accel * wishSpeed * dt, add);
    this.vel.x += wish.x * a;
    this.vel.z += wish.z * a;
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    const inp = this.input;

    // look
    const { dx, dy } = inp.consumeMouse();
    this.yaw -= dx * C.mouseSensitivity;
    this.pitch -= dy * C.mouseSensitivity;
    this.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, this.pitch));

    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.allowRespawnKey && inp.justPressed('KeyR')) { this.respawn(); return; }

    if (this.mantle) {
      this._updateMantle(dt);
      this._updateCamera(dt, 0, 0);
      return;
    }

    const fwdIn = (inp.action('forward') ? 1 : 0) - (inp.action('back') ? 1 : 0);
    const strafeIn = (inp.action('right') ? 1 : 0) - (inp.action('left') ? 1 : 0);
    _wish.set(0, 0, 0).addScaledVector(_fwd, fwdIn).addScaledVector(_right, strafeIn);
    if (_wish.lengthSq() > 0) _wish.normalize();

    this.coyote -= dt;
    this.jumpBufferT -= dt;
    this.wallJumpCd -= dt;
    if (inp.actionPressed('jump')) this.jumpBufferT = C.jumpBuffer;

    // ---- hide stance: hold C on the ground -> crouch, stop, light off
    const crouchHeld = inp.action('hide');
    this.hiding = crouchHeld && this.grounded;
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);

    const wantCrouch = this.hiding;
    const diff = C.standHeight - C.crouchHeight;
    if (wantCrouch && !this.crouched) {
      this.crouched = true;
      this.height = C.crouchHeight;
    } else if (!wantCrouch && this.crouched) {
      _p.copy(this.pos);
      if (!this.grounded) {
        _p.y -= diff; // extend legs downward in the air if there's room
        if (this._free(_p, C.standHeight)) {
          this.pos.y -= diff; this.eyeHeight += diff;
          this.crouched = false; this.height = C.standHeight;
        } else if (this._free(this.pos, C.standHeight)) {
          this.crouched = false; this.height = C.standHeight;
        }
      } else if (this._free(this.pos, C.standHeight)) {
        this.crouched = false; this.height = C.standHeight;
      }
    }

    // ---- sprint & stamina
    this.sprinting = inp.action('sprint') && fwdIn > 0 && !this.crouched && !this.exhausted;
    if (this.hiding) { _wish.set(0, 0, 0); this.jumpBufferT = 0; }
    if (this.sprinting && hSpeed > 1 && this.grounded) {
      this.stamina -= dt / C.staminaDuration;
      if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
    } else if (!this.sprinting) {
      this.stamina = Math.min(1, this.stamina + dt / C.staminaRegen);
      if (this.exhausted && this.stamina >= C.staminaRecover) this.exhausted = false;
    }

    // ---- walls
    const wall = this.grounded ? null : this._probeWall();
    const fwdDotN = wall ? _fwd.x * wall.nx + _fwd.z * wall.nz : 0;
    let alongSpeed = 0;
    if (wall) {
      const into = this.vel.x * wall.nx + this.vel.z * wall.nz;
      alongSpeed = Math.hypot(this.vel.x - wall.nx * into, this.vel.z - wall.nz * into);
    }
    if (wall && fwdIn > 0 && alongSpeed > C.wallRunMinSpeed && this.wallRunTime < C.wallRunMaxTime &&
        Math.abs(fwdDotN) < 0.8 && !this.crouched) {
      if (!this.wallRunning) {
        this.wallRunning = true;
        if (this.vel.y < 0) this.vel.y *= 0.25;
        else this.vel.y = Math.min(this.vel.y, C.wallRunEntryUp);
      }
      this.wallRunTime += dt;
      this.wallSide = _right.x * wall.nx + _right.z * wall.nz > 0 ? -1 : 1; // -1 wall on left
    } else {
      this.wallRunning = false;
    }

    // ---- jump
    let jumped = false;
    if (this.jumpBufferT > 0) {
      if (this.grounded || this.coyote > 0) {
        this.vel.y = C.jumpVelocity;
        jumped = true;
      } else if (wall && this.wallJumpCd <= 0) {
        const into = this.vel.x * wall.nx + this.vel.z * wall.nz;
        if (into < 0) { this.vel.x -= wall.nx * into; this.vel.z -= wall.nz * into; }
        this.vel.x += wall.nx * C.wallJumpOut + _wish.x * 1.5;
        this.vel.z += wall.nz * C.wallJumpOut + _wish.z * 1.5;
        this.vel.y = Math.max(this.vel.y, C.wallJumpUp);
        this.wallJumpCd = C.wallJumpCooldown;
        this.wallRunning = false;
        this.wallRunTime = 0; // new wall, new run
        jumped = true;
      }
      if (jumped) { this.jumpBufferT = 0; this.coyote = 0; this.grounded = false; }
    }

    // ---- accelerate
    this.wading = this.world.inPool(this.pos.x, this.pos.z) && this.pos.y < this._terrainAt(this.pos) + 0.3;
    let wishSpeed = this.crouched ? C.crouchSpeed : this.sprinting ? C.sprintSpeed : C.walkSpeed;
    if (this.wading) wishSpeed *= 0.6;
    if (this.grounded && !jumped) {
      this._friction(this.hiding ? C.hideFriction : C.friction, dt);
      if (!this.hiding) this._accelerate(_wish, wishSpeed, C.groundAccel, dt);
    } else if (this.wallRunning) {
      // glue velocity to the wall plane and keep speed up
      const n = wall;
      const into = this.vel.x * n.nx + this.vel.z * n.nz;
      this.vel.x -= n.nx * into; this.vel.z -= n.nz * into;
      this.vel.x -= n.nx * 0.5; this.vel.z -= n.nz * 0.5; // slight stick
      const along = Math.hypot(this.vel.x, this.vel.z);
      const target = Math.max(along, C.sprintSpeed * 0.95);
      if (along > 0.01) { this.vel.x *= target / along; this.vel.z *= target / along; }
    } else {
      this._accelerate(_wish, Math.max(wishSpeed, C.walkSpeed), C.airAccel, dt);
    }

    // ---- gravity
    if (this.wallRunning && !jumped) {
      this.vel.y = Math.max(this.vel.y - C.wallRunGravity * dt, -C.wallRunMaxFall);
    } else {
      this.vel.y -= C.gravity * dt;
    }

    // ---- integrate with sub-steps
    const vyBefore = this.vel.y;
    const wasGrounded = this.grounded;
    this.grounded = false;
    const mx = this.vel.x * dt, my = this.vel.y * dt, mz = this.vel.z * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my), Math.abs(mz)) / 0.2));
    let landed = false;
    for (let s = 0; s < steps; s++) {
      this._moveHorizontal('x', mx / steps, wasGrounded && !jumped);
      this._moveHorizontal('z', mz / steps, wasGrounded && !jumped);
      const r = this._moveVertical(landed ? 0 : my / steps);
      if (r.landed) { landed = true; this.vel.y = 0; }
      if (r.bonk && this.vel.y > 0) this.vel.y = 0;
    }

    // Snap down when walking off stairs/small drops so we don't "float".
    if (!landed && wasGrounded && !jumped) {
      const y0 = this.pos.y;
      const r = this._moveVertical(-C.stepHeight);
      if (r.landed) { landed = true; this.vel.y = 0; this.stepOffset += y0 - this.pos.y; }
      else this.pos.y = y0;
    }

    if (landed) {
      this.grounded = true;
      this.coyote = C.coyoteTime;
      this.wallRunTime = 0;
      this.wallRunning = false;
      if (!wasGrounded) {
        const impact = -vyBefore;
        this.landVel -= Math.min(impact * 0.14, 2.2);
        this.landPitch = -Math.min(impact * 0.004, 0.05);
        this.onLand?.(impact);
      }
    }

    // fell out of the world
    if (this.pos.y < -30) this.respawn();

    this.hidden = this.hiding && this.world.inGrass(this.pos.x, this.pos.z);

    this._updateCamera(dt, fwdIn, strafeIn);

    // auto-mantle: in the air, pushing forward into a ledge
    if (!this.grounded && fwdIn > 0 && this.vel.y < 5) this._tryMantle();
  }

  // ------------------------------------------------------------------ camera feel
  _updateCamera(dt, fwdIn, strafeIn) {
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);

    this.eyeHeight = damp(this.eyeHeight, this.height - C.eyeFromTop, 12, dt);
    this.stepOffset = damp(this.stepOffset, 0, 14, dt);

    // landing spring
    this.landVel += (-this.landOffset * 170 - this.landVel * 16) * dt;
    this.landOffset += this.landVel * dt;
    this.landPitch = damp(this.landPitch, 0, 6, dt);

    // head bob
    const bobbing = this.grounded && !this.mantle && hSpeed > 0.5;
    this.bobAmount = damp(this.bobAmount, bobbing ? Math.min(hSpeed / C.sprintSpeed, 1.2) : 0, 8, dt);
    if (bobbing) {
      const stepsPerSec = 1.2 + hSpeed * 0.18;
      const prev = Math.sin(this.bobPhase * 2);
      this.bobPhase += dt * Math.PI * stepsPerSec;
      const now = Math.sin(this.bobPhase * 2);
      if (prev > -0.95 && now <= -0.95) this.onFootstep?.(hSpeed / C.sprintSpeed);
    }
    const bobY = Math.sin(this.bobPhase * 2) * 0.05 * this.bobAmount;
    const bobX = Math.sin(this.bobPhase) * 0.04 * this.bobAmount;

    // roll: strafe lean, wall-run tilt
    let targetRoll = -strafeIn * 1.2 * DEG;
    if (this.wallRunning) targetRoll = this.wallSide * -12 * DEG;
    this.roll = damp(this.roll, targetRoll, this.wallRunning ? 8 : 10, dt);

    // fov kick with speed
    const speedT = Math.min(Math.max((hSpeed - C.walkSpeed) / (C.fovSpeedRef - C.walkSpeed), 0), 1);
    this.fov = damp(this.fov, C.baseFov + speedT * C.maxFovBoost - (this.hiding ? 4 : 0), 6, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // shake: smooth noise scaled by trauma squared
    this.trauma = Math.max(0, this.trauma - dt * 1.3);
    this.shakeT += dt;
    const sh = this.trauma * this.trauma, st = this.shakeT;
    const sx = (Math.sin(st * 47) + Math.sin(st * 23.3)) * 0.05 * sh;
    const sy = (Math.sin(st * 41) + Math.sin(st * 19.7)) * 0.05 * sh;
    this.camera.position.set(
      this.pos.x + _right.x * (bobX + sx),
      this.pos.y + this.eyeHeight + this.stepOffset + this.landOffset + bobY + sy,
      this.pos.z + _right.z * (bobX + sx),
    );
    this.camera.rotation.set(
      this.pitch + this.landPitch + bobY * 0.15 + Math.sin(st * 37) * 0.03 * sh,
      this.yaw + Math.sin(st * 29) * 0.02 * sh,
      this.roll + Math.sin(st * 31) * 0.04 * sh, 'YXZ');
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  get state() {
    if (this.mantle) return 'mantle';
    if (this.wallRunning) return 'wallrun';
    if (!this.grounded) return 'air';
    if (this.hiding) return 'hide';
    if (this.crouched) return 'crouch';
    if (this.sprinting) return 'sprint';
    return this.speed > 0.5 ? 'walk' : 'idle';
  }
}
