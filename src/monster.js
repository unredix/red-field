import * as THREE from 'three';
import { glowTexture } from './textures.js';
import { buildMonsterModel } from './monsterModel.js';

// The drum beast (monster.png): AI + procedural animation. The model itself is
// built in monsterModel.js (swap for a GLB later and keep the named parts).

export const MONSTER_CONFIG = {
  scale: 1.5,             // model scale (placeholder was built at 1.0)
  radius: 1.5,            // body circle for obstacle collision
  stepOver: 0.9,          // obstacles lower than this don't block it
  bodyTop: 3.6,           // ...nor ones floating higher than this
  wanderSpeed: 3.0,
  investigateSpeed: 6.0,
  searchSpeed: 4.5,
  trackSpeed: 5.0,
  chaseSpeedStart: 7.8,   // player sprint is 8.2
  chaseSpeedEnd: 10.5,
  chaseRampTime: 300,     // seconds of survival to reach full speed
  enragedBonus: 0.8,
  turnRate: 2.4,          // rad/s while moving
  accel: 7,

  flashRange: 40,
  sightRange: 10,
  sightRangeCrouch: 5,    // player in the hide stance (light off) out in the open
  sightRangeSprint: 13,
  hiddenRange: 3,         // hiding in tall grass
  decay: 0.12,
  investigateAt: 0.35,
  chaseAt: 0.8,
  loseTime: 4,
  searchTime: 8,

  smellDelay: 12,         // seconds without seeing you before it starts sniffing
  smellRange: 16,         // notices scent this close
  faintSmellRange: 7,     // scent left while hidden in tall grass
  scentMaxAge: 60,        // older scent is too faint
  trackStep: 8,           // jumps ahead along the trail up to this far

  attackRange: 5.0,       // head to player (horizontal)
  reachHeight: 6.5,       // can bite players standing this high above its feet (rears up)
  windup: 0.6,
  windupTrack: 0.45,      // fraction of the windup it keeps turning toward you
  lungeTime: 0.3,
  lungeSpeed: 14,
  biteRange: 3.0,         // head centre to player centre
  biteAngle: 40,          // degrees
  recover: 1.2,

  stunTime: 2.5,
  parryStunTime: 4,
  enragedTime: 10,
  slashRange: 4.5,
  lureRange: 50,
  tearTime: 3,
  dyingTime: 2.6,          // struck by the towers before it collapses
};
const C = MONSTER_CONFIG;
const DEG = Math.PI / 180;

const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();

// ---------------------------------------------------------------- monster
export class Monster {
  constructor(scene, world, spawn) {
    this.scene = scene;
    this.world = world;
    this.spawnPoint = spawn.clone();
    this.model = buildMonsterModel();
    const m = this.model;
    m.root.scale.setScalar(C.scale);
    scene.add(m.root);
    this._initRig();

    this.pos = new THREE.Vector3();
    this.lastKnown = new THREE.Vector3();
    this.stimulus = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.path = null;
    // body boxes the player collides with
    this.bodyBox = new THREE.Box3();
    this.headBox = new THREE.Box3();
    world.dynamicColliders.push(this.bodyBox, this.headBox);

    // hooks (audio / game)
    this.onStep = null;   // (pos, intensity)
    this.onRoar = null;   // (pos)
    this.onCymbal = null; // (pos)
    this.onKill = null;   // ()
    this.onStunned = null; // (parry)
    this.onSniff = null;  // (pos)
    this.onCollapse = null; // () when the towers finish it off
    this.reset();
  }

  reset() {
    this.pos.copy(this.spawnPoint);
    this.pos.y = this.ground(this.pos.x, this.pos.z);
    this.yaw = Math.PI;
    this.speed = 0;
    this.turnVel = 0;
    this.awareness = 0;
    this.state = 'WANDER';
    this.stateT = 0;
    this.attackPhase = null;
    this.path = null;
    this.repathT = 0;
    this.waitT = 1;
    this.lostT = 0;
    this.searchT = 0;
    this.stunT = 0;
    this.enragedT = 0;
    this.sniffT = 0;
    this.sniffCheckT = 0;
    this.trackPt = null;
    this.trackEpoch = 0;
    this.rear = 0;
    this.bodyPitch = 0;
    this.stuckT = 0;
    this.detourT = 0;
    this.detour = null;
    this.losT = 0;
    this.los = false;
    this.sees = false;
    this.litT = 0;
    this.gait = 0;
    this.jawOpen = 0;
    this.headPitch = 0;
    this.headYaw = 0;
    this.eyeBoost = 0;
    this.lure = null;
    this._setGoal(this.pos);
    this.model.eyeLight.color.setHex(0xff2010);
    this.model.eyeLight.distance = 9;
    this.idle = null;
    this.feedTarget = null;
    this.feedClose = false;
    if (this.rig) this.rig.snap = true; // feet re-plant after teleports
    this._updateBoxes();
  }

  ground(x, z) { const g = this.world.groundHeight(x, z); return Number.isFinite(g) ? g : 0; }
  get forward() { return _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  headWorld(out) { return this.model.headCenter.getWorldPosition(out); }

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    this.path = null;
    this.repathT = 0;
  }

  _setGoal(p) {
    if (this.goal.distanceToSquared(p) > 1.5 * 1.5 || !this.path) this.repathT = 0;
    this.goal.copy(p);
  }

  chaseSpeed(time) {
    const t = Math.min(time / C.chaseRampTime, 1);
    return C.chaseSpeedStart + (C.chaseSpeedEnd - C.chaseSpeedStart) * t + (this.enragedT > 0 ? C.enragedBonus : 0);
  }

  // ---------------------------------------------------------------- perception
  _perceive(dt, ctx) {
    const { player, flashlight, camera } = ctx;
    this.headWorld(_eye);
    _pt.copy(player.pos); _pt.y += player.height * 0.75;
    const d = _eye.distanceTo(_pt);

    this.losT -= dt;
    if (this.losT <= 0) { this.los = this.world.lineOfSight(_eye, _pt); this.losT = 0.1; }

    let gain = 0;
    let seen = false;
    const flashOn = flashlight.on;
    if (this.los && player.alive) {
      if (flashOn && d < C.flashRange) {
        gain += (1 - d / C.flashRange) * 1.2 + 0.1;
        this.stimulus.copy(player.pos);
        seen = true;
        // is the player shining the light right at us?
        _v.set(this.pos.x, this.pos.y + 1.8, this.pos.z).sub(camera.position);
        const dist = _v.length();
        camera.getWorldDirection(_pt);
        if (dist < 35 && _v.dot(_pt) / dist > Math.cos(flashlight.light.angle * 0.9)) {
          gain += 3;
          if (this.litT <= 0 && this.state !== 'CHASE' && this.state !== 'ATTACK') this.onRoar?.(this.pos);
          this.litT = 3;
        }
      }
      const range = player.sprinting ? C.sightRangeSprint : player.hiding ? C.sightRangeCrouch : C.sightRange;
      if (!player.hidden && d < range) { gain += (1 - d / range) * 1.5 + 0.3; seen = true; }
      else if (player.hidden && d < C.hiddenRange) { gain += 2; seen = true; }
    }
    this.litT -= dt;

    for (const n of this.world.noises) {
      const nd = Math.hypot(n.pos.x - this.pos.x, n.pos.z - this.pos.z);
      if (nd < n.radius) {
        this.awareness += 0.3 * (1 - nd / n.radius) + 0.05;
        this.stimulus.copy(n.pos);
      }
    }

    if (gain > 0) this.awareness += gain * dt * (this.enragedT > 0 ? 1.5 : 1);
    else this.awareness -= C.decay * dt;
    this.awareness = Math.min(Math.max(this.awareness, 0), 1);

    this.sees = seen;
    if (seen) { this.lastKnown.copy(player.pos); this.lostT = 0; } else this.lostT += dt;

    // lure orb: brighter than any flashlight
    const lure = ctx.lure;
    this.lure = null;
    if (lure && lure.active) {
      const ld = _eye.distanceTo(lure.pos);
      if (ld < C.lureRange && this.world.lineOfSight(_eye, lure.pos)) this.lure = lure;
    }
    return d;
  }

  // ---------------------------------------------------------------- movement
  _followGoal(speed, dt, repathEvery = 0.6) {
    this.repathT -= dt;
    if (this.repathT <= 0 || !this.path) {
      this.path = this.world.findPath(this.pos, this.goal) || [this.goal.clone()];
      this.repathT = repathEvery;
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z) < 1.8) this.path.shift();
    const wp = this.path[0];
    const dist = Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z);

    // stuck against something: back off sideways for a moment, then re-plan
    if (this.stuckT > 0.8 && this.detourT <= 0) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const a = this.yaw + side * (Math.PI * 0.6 + Math.random() * 0.5);
      const tx = this.pos.x + Math.sin(a) * 6, tz = this.pos.z + Math.cos(a) * 6;
      this.detour = this.world.nav ? this.world.nearestWalkable(tx, tz) : new THREE.Vector3(tx, 0, tz);
      this.detourT = 1.4;
      this.stuckT = 0;
    }
    if (this.detourT > 0) {
      this.detourT -= dt;
      this._steer(this.detour.x, this.detour.z, speed, dt, 1.6);
      if (Math.hypot(this.detour.x - this.pos.x, this.detour.z - this.pos.z) < 1.5) this.detourT = 0;
      if (this.detourT <= 0) this.path = null; // re-plan from the new spot
      return dist;
    }

    // goal itself unreachable (e.g. you're on a rock): stop at the closest point and face it
    const atEnd = this.path.length === 1 && Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 1.2;
    if (atEnd && dist > 2.2) this._steer(this.goal.x, this.goal.z, 0, dt, 1.5);
    else this._steer(wp.x, wp.z, dist < 2.2 ? 0 : speed, dt);
    return dist;
  }

  _steer(tx, tz, speed, dt, turnMul = 1) {
    const desired = Math.atan2(tx - this.pos.x, tz - this.pos.z);
    const diff = wrapAngle(desired - this.yaw);
    const maxTurn = C.turnRate * turnMul * dt;
    const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
    this.yaw = wrapAngle(this.yaw + turn);
    this.turnVel = turn / Math.max(dt, 1e-4);
    const target = speed * Math.max(0.2, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
    this.speed = damp(this.speed, target, C.accel, dt);
  }

  _move(dt) {
    const f = this.forward;
    const x0 = this.pos.x, z0 = this.pos.z;
    this.pos.x += f.x * this.speed * dt;
    this.pos.z += f.z * this.speed * dt;
    // push out of static obstacles (circle vs box in XZ)
    const r = C.radius;
    const g = this.pos.y;
    for (const b of this.world.near(this.pos.x - r, this.pos.z - r, this.pos.x + r, this.pos.z + r)) {
      // it crashes straight through anything smaller than the player (see World.markSmall)
      if (b.small || b.max.y < g + C.stepOver || b.min.y > g + C.bodyTop) continue;
      const cx = Math.max(b.min.x, Math.min(this.pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(this.pos.z, b.max.z));
      const dx = this.pos.x - cx, dz = this.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          this.pos.x += (dx / d) * (r - d);
          this.pos.z += (dz / d) * (r - d);
        } else {
          this.pos.x -= f.x * r; this.pos.z -= f.z * r;
        }
      }
    }
    this.pos.y = this.ground(this.pos.x, this.pos.z);
    const moved = Math.hypot(this.pos.x - x0, this.pos.z - z0);
    if (this.speed > 1.2 && moved < this.speed * dt * 0.3) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 0.5);
  }

  _pickWanderPoint(player) {
    const b = this.world.nav;
    let x, z;
    if (Math.random() < 0.6 && player) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 14;
      x = player.pos.x + Math.cos(a) * r; z = player.pos.z + Math.sin(a) * r;
    } else if (b) {
      x = b.minX + Math.random() * b.cols * b.cell; z = b.minZ + Math.random() * b.rows * b.cell;
    } else {
      x = this.pos.x + (Math.random() - 0.5) * 30; z = this.pos.z + (Math.random() - 0.5) * 30;
    }
    const p = this.world.nav ? this.world.nearestWalkable(x, z) : new THREE.Vector3(x, 0, z);
    this._setGoal(p);
  }

  // ---------------------------------------------------------------- smell
  // Freshest scent point within smellRange that isn't too old.
  _sniffForTrail() {
    const sc = this.world.scent, now = this.world.time;
    for (let i = sc.length - 1; i >= 0; i--) {
      const p = sc[i];
      if (now - p.t > C.scentMaxAge) break;
      const r = p.faint ? C.faintSmellRange : C.smellRange;
      if ((p.x - this.pos.x) ** 2 + (p.z - this.pos.z) ** 2 < r * r) return p;
    }
    return null;
  }

  // Next point along the trail: the newest one within trackStep of the current.
  _nextScent(cur) {
    const sc = this.world.scent;
    for (let i = sc.length - 1; i >= 0; i--) {
      const p = sc[i];
      if (p.t <= cur.t) break;
      if ((p.x - cur.x) ** 2 + (p.z - cur.z) ** 2 < C.trackStep * C.trackStep) return p;
    }
    return null;
  }

  // ---------------------------------------------------------------- game events
  // The towers strike it down.
  kill() {
    if (this.state === 'DYING' || this.state === 'DEAD') return;
    this._setState('DYING');
    this.attackPhase = null;
    this.speed = 0;
    this.bodyBox.makeEmpty();
    this.headBox.makeEmpty();
  }

  get dead() { return this.state === 'DYING' || this.state === 'DEAD'; }

  // Something loud happened at `pos` (a tower waking up).
  alert(pos, amount = 0.6) {
    if (this.dead || this.state === 'ATTACK' || this.state === 'STUNNED' || this.state === 'TEAR') return;
    this.awareness = Math.max(this.awareness, amount);
    this.stimulus.copy(pos);
    this.lastKnown.copy(pos);
    if (this.state !== 'CHASE') this._setState('INVESTIGATE');
    this.onRoar?.(this.pos);
  }

  // ---------------------------------------------------------------- abilities used by the player
  // Returns 'parry' | 'stun' | null
  receiveSlash(origin, dir) {
    if (this.state === 'STUNNED') return null;
    this.headWorld(_v);
    const toHead = _v.sub(origin);
    const d = toHead.length();
    // also allow hitting the chest when very close
    const bodyD = Math.hypot(this.pos.x - origin.x, this.pos.z - origin.z);
    if ((d > C.slashRange || toHead.dot(dir) / d < 0.5) && bodyD > 3.2) return null;
    const parry = this.state === 'ATTACK' && this.attackPhase === 'windup';
    this._setState('STUNNED');
    this.stunT = parry ? C.parryStunTime : C.stunTime;
    this.attackPhase = null;
    this.speed = 0;
    this.onStunned?.(parry);
    return parry ? 'parry' : 'stun';
  }

  // ---------------------------------------------------------------- main update
  update(dt, ctx) {
    const { player } = ctx;
    if (this.state === 'FEED') {
      this.stateT += dt;
      this.speed = 0;
      this._animate(dt, ctx);
      return 0;
    }
    if (this.dead) {
      this.stateT += dt;
      if (this.state === 'DYING' && this.stateT > C.dyingTime) { this.state = 'DEAD'; this.stateT = 0; this.onCollapse?.(); }
      this.speed = 0;
      this._animate(dt, ctx);
      return Infinity;
    }
    this.stateT += dt;
    this.enragedT -= dt;

    const busy = this.state === 'ATTACK' || this.state === 'STUNNED' || this.state === 'TEAR';
    const dPlayer = this._perceive(dt, ctx);
    this.headWorld(_eye);
    const hx = player.pos.x - _eye.x, hz = player.pos.z - _eye.z;
    const headDist = Math.hypot(hx, hz);
    const toPlayerYaw = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    const facingDiff = Math.abs(wrapAngle(toPlayerYaw - this.yaw));

    if (!busy && this.lure && this.state !== 'LURED') this._setState('LURED');

    const canAttack = player.alive && this.sees && headDist < C.attackRange && facingDiff < 70 * DEG &&
      player.pos.y - this.pos.y < C.reachHeight;

    // lost you for a while -> start sniffing for your trail
    this.sniffCheckT -= dt;
    if ((this.state === 'WANDER' || this.state === 'SEARCH' || this.state === 'INVESTIGATE') &&
        this.lostT > C.smellDelay && this.sniffCheckT <= 0) {
      this.sniffCheckT = 1;
      const p = this._sniffForTrail();
      if (p) {
        this.trackPt = p;
        this.trackEpoch = this.world.scentEpoch;
        this._setState('TRACK');
        this.sniffT = 0;
      }
    }

    switch (this.state) {
      case 'WANDER': {
        this.waitT -= dt;
        if (this.waitT <= 0) {
          const dist = this._followGoal(C.wanderSpeed, dt, 1.5);
          if (dist < 2.3) {
            this.waitT = 1.5 + Math.random() * 2.5;
            this._pickWanderPoint(player);
            const types = ['sniff', 'listen', 'shiver'];
            this.idle = { type: types[Math.floor(Math.random() * types.length)], t: 0, dur: this.waitT, side: Math.random() < 0.5 ? -1 : 1 };
          }
        } else this.speed = damp(this.speed, 0, 5, dt);
        if (this.awareness > C.chaseAt) this._setState('CHASE');
        else if (this.awareness > C.investigateAt) this._setState('INVESTIGATE');
        break;
      }
      case 'INVESTIGATE': {
        this._setGoal(this.stimulus);
        const dist = this._followGoal(C.investigateSpeed, dt, 0.8);
        if (canAttack) this._startAttack(player);
        else if (this.awareness > C.chaseAt) this._setState('CHASE');
        else if (dist < 2.5 || this.stateT > 15) { this.lastKnown.copy(this.stimulus); this._startSearch(); }
        else if (this.awareness < 0.1) this._setState('WANDER');
        break;
      }
      case 'CHASE': {
        this._setGoal(this.sees ? player.pos : this.lastKnown);
        this._followGoal(this.chaseSpeed(ctx.time), dt, 0.4);
        if (canAttack) this._startAttack(player);
        else if (!this.sees && this.lostT > C.loseTime) this._startSearch();
        break;
      }
      case 'SEARCH': {
        this.searchT -= dt;
        const dist = this._followGoal(C.searchSpeed, dt, 1);
        if (dist < 2.5) {
          const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6;
          this._setGoal(this.world.nav ? this.world.nearestWalkable(this.lastKnown.x + Math.cos(a) * r, this.lastKnown.z + Math.sin(a) * r)
            : new THREE.Vector3(this.lastKnown.x + Math.cos(a) * r, 0, this.lastKnown.z + Math.sin(a) * r));
        }
        if (canAttack) this._startAttack(player);
        else if (this.awareness > C.chaseAt && this.sees) this._setState('CHASE');
        else if (this.searchT <= 0) { this._setState('WANDER'); this._pickWanderPoint(player); this.waitT = 0.5; }
        break;
      }
      case 'LURED': {
        if (!this.lure || !this.lure.active) { this.lastKnown.copy(this.goal); this._startSearch(); break; }
        this._setGoal(this.lure.pos);
        const d = Math.hypot(this.lure.pos.x - _eye.x, this.lure.pos.z - _eye.z);
        this._followGoal(this.chaseSpeed(ctx.time) * 0.9, dt, 0.5);
        if (d < 3.5 || Math.hypot(this.lure.pos.x - this.pos.x, this.lure.pos.z - this.pos.z) < 3.2) {
          this.lure.destroy();
          this.lastKnown.copy(this.lure.pos);
          this._setState('TEAR');
          this.onRoar?.(this.pos);
        }
        break;
      }
      case 'TRACK': {
        this.sniffT -= dt;
        if (this.sniffT <= 0) { this.sniffT = 1.4; this.onSniff?.(this.pos); }
        const sc = this.world.scent;
        const lost = this.trackEpoch !== this.world.scentEpoch || !sc.length || this.trackPt.t < sc[0].t;
        if (lost) { this.lastKnown.set(this.trackPt.x, 0, this.trackPt.z); this._startSearch(); break; }
        if (Math.hypot(this.trackPt.x - this.pos.x, this.trackPt.z - this.pos.z) < 3) {
          const next = this._nextScent(this.trackPt);
          if (next) this.trackPt = next;
          else { // end of the trail: you were right here
            this.lastKnown.set(this.trackPt.x, 0, this.trackPt.z);
            this.lostT = C.smellDelay - 4; // sniff again soon
            this._startSearch();
            break;
          }
        }
        _v.set(this.trackPt.x, 0, this.trackPt.z);
        this._setGoal(_v);
        this._followGoal(C.trackSpeed, dt, 0.8);
        if (canAttack) this._startAttack(player);
        else if (this.sees) { this.awareness = Math.max(this.awareness, C.chaseAt + 0.05); this._setState('CHASE'); }
        break;
      }
      case 'TEAR': {
        this.speed = damp(this.speed, 0, 8, dt);
        if (this.stateT > C.tearTime) { this.awareness = Math.min(this.awareness, 0.5); this._startSearch(); }
        break;
      }
      case 'ATTACK': this._updateAttack(dt, player); break;
      case 'STUNNED': {
        this.speed = damp(this.speed, 0, 10, dt);
        this.stunT -= dt;
        if (this.stunT <= 0) {
          this.awareness = 1;
          this.enragedT = C.enragedTime;
          this.lastKnown.copy(player.pos);
          this._setState('CHASE');
          this.onRoar?.(this.pos);
        }
        break;
      }
    }

    this._move(dt);
    this._updateBoxes();
    this._animate(dt, ctx);
    return dPlayer;
  }

  _startSearch() {
    this._setState('SEARCH');
    this.searchT = C.searchTime;
    this._setGoal(this.lastKnown);
  }

  _startAttack(player) {
    this._setState('ATTACK');
    this.attackPhase = 'windup';
    // rear up on the hind legs for targets standing on rocks
    this.rear = player ? Math.min(Math.max((player.pos.y - this.pos.y - 1.0) / 3, 0), 1) : 0;
    this.onCymbal?.(this.pos);
    this.onRoar?.(this.pos);
  }

  _updateAttack(dt, player) {
    const t = this.stateT;
    if (this.attackPhase === 'windup') {
      this.speed = damp(this.speed, 0, 12, dt);
      if (t < C.windup * C.windupTrack) this._steer(player.pos.x, player.pos.z, 0, dt, 2.2); // then commits to a direction
      if (t >= C.windup) { this.attackPhase = 'lunge'; this.stateT = 0; }
    } else if (this.attackPhase === 'lunge') {
      this.speed = C.lungeSpeed;
      this.headWorld(_eye);
      _pt.copy(player.pos); _pt.y += player.height * 0.5;
      const f = this.forward;
      _v.set(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z).normalize();
      const ang = Math.acos(Math.max(-1, Math.min(1, _v.dot(f))));
      if (player.alive && _eye.distanceTo(_pt) < C.biteRange + this.rear * 0.8 && ang < C.biteAngle * DEG) {
        this.onKill?.();
        this.attackPhase = 'recover';
        this.stateT = 0;
      } else if (t >= C.lungeTime) { this.attackPhase = 'recover'; this.stateT = 0; }
    } else {
      this.speed = damp(this.speed, 0, 6, dt);
      if (t >= C.recover) {
        this.attackPhase = null;
        if (this.awareness > 0.5) this._setState('CHASE'); else this._startSearch();
      }
    }
  }

  _updateBoxes() {
    const f = this.forward;
    const y = this.pos.y;
    const S = C.scale;
    this.bodyBox.min.set(this.pos.x - 0.9 * S, y + 0.8 * S, this.pos.z - 0.9 * S);
    this.bodyBox.max.set(this.pos.x + 0.9 * S, y + 2.7 * S, this.pos.z + 0.9 * S);
    const hx = this.pos.x + f.x * 3.2 * S, hz = this.pos.z + f.z * 3.2 * S;
    const lift = this.state === 'ATTACK' ? this.rear * 1.5 * S : 0;
    this.headBox.min.set(hx - 0.75 * S, y + 1.4 * S + lift, hz - 0.75 * S);
    this.headBox.max.set(hx + 0.75 * S, y + 3.2 * S + lift, hz + 0.75 * S);
  }

  // ---------------------------------------------------------------- procedural animation
  _initRig() {
    const m = this.model;
    this.rig = {
      feet: m.legs.map((L) => ({
        L, front: L.front,
        // resting foot spot in root space (unit scale)
        home: new THREE.Vector3(L.side * (L.front ? 1.05 : 0.95), 0, L.front ? 0.95 : -1.0),
        planted: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), cur: new THREE.Vector3(),
        t: 1, dur: 0.4, stepping: false, pair: 0,
      })),
      neckBase: m.neck.map((n) => n.rotation.x),
      headBase: m.headPivot.rotation.x,
      tailVel: m.tail.map(() => 0),
      pendVel: m.pendulums.map(() => 0),
      dip: 0, dipVel: 0, bend: 0, snap: true, lastYaw: 0,
    };
    // diagonal gait pairs: (front right, hind left) and (front left, hind right)
    const f = this.rig.feet;
    f[0].pair = 0; f[3].pair = 0; f[1].pair = 1; f[2].pair = 1;
    this._buildDust();
  }

  // ---- dust puffs (one Points object, pooled)
  _buildDust() {
    const N = 72;
    const geo = new THREE.BufferGeometry();
    const d = this.dust = { N, pos: new Float32Array(N * 3), col: new Float32Array(N * 3), vel: new Float32Array(N * 3), life: new Float32Array(N), k: new Float32Array(N), next: 0 };
    geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(d.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.3, map: glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    d.points = new THREE.Points(geo, mat);
    d.points.frustumCulled = false;
    this.scene.add(d.points);
  }

  _spawnDust(p, n, k) {
    const d = this.dust;
    for (let j = 0; j < n; j++) {
      const i = d.next++ % d.N;
      const a = Math.random() * Math.PI * 2;
      d.pos[i * 3] = p.x + Math.cos(a) * 0.3; d.pos[i * 3 + 1] = p.y + 0.1; d.pos[i * 3 + 2] = p.z + Math.sin(a) * 0.3;
      d.vel[i * 3] = Math.cos(a) * (0.6 + Math.random()); d.vel[i * 3 + 1] = 0.4 + Math.random() * 0.8; d.vel[i * 3 + 2] = Math.sin(a) * (0.6 + Math.random());
      d.life[i] = 1; d.k[i] = k;
    }
  }

  _updateDust(dt) {
    const d = this.dust;
    for (let i = 0; i < d.N; i++) {
      if (d.life[i] <= 0) continue;
      d.life[i] -= dt * 1.1;
      d.vel[i * 3] *= 0.94; d.vel[i * 3 + 1] = d.vel[i * 3 + 1] * 0.94 - 0.2 * dt; d.vel[i * 3 + 2] *= 0.94;
      for (let a = 0; a < 3; a++) d.pos[i * 3 + a] += d.vel[i * 3 + a] * dt;
      const l = Math.max(d.life[i], 0) * d.k[i];
      d.col[i * 3] = 0.11 * l; d.col[i * 3 + 1] = 0.05 * l; d.col[i * 3 + 2] = 0.035 * l;
    }
    d.points.geometry.attributes.position.needsUpdate = true;
    d.points.geometry.attributes.color.needsUpdate = true;
  }

  // ---- foot planting: feet stay put on the ground and step when the body carries them too far
  _updateFeet(dt, sf) {
    const R = this.rig, S = C.scale, root = this.model.root;
    const fw = this.forward, fx = fw.x, fz = fw.z;
    const spd = this.dead ? 0 : this.speed;
    const stepDur = Math.max(0.2, Math.min(0.5, 0.5 - spd * 0.022));
    for (const f of R.feet) {
      _v3.copy(f.home);
      root.localToWorld(_v3);
      _v3.y = this.ground(_v3.x, _v3.z);
      if (R.snap || f.planted.distanceTo(_v3) > 8 * S) {
        f.planted.copy(_v3); f.cur.copy(_v3); f.stepping = false; f.t = 1;
        continue;
      }
      if (f.stepping) {
        f.t += dt / f.dur;
        const k = Math.min(f.t, 1), e = k * k * (3 - 2 * k);
        f.cur.lerpVectors(f.from, f.to, e);
        f.cur.y += Math.sin(Math.PI * k) * (0.28 + sf * 0.25) * S;
        if (f.t >= 1) { f.stepping = false; f.planted.copy(f.to); f.cur.copy(f.to); this._footDown(f); }
      } else {
        const lead = spd * stepDur * 0.9; // land ahead of the resting spot
        const px = _v3.x + fx * lead, pz = _v3.z + fz * lead;
        const d = Math.hypot(px - f.planted.x, pz - f.planted.z);
        const thr = spd > 0.3 ? 0.2 * S + lead : 0.3 * S;
        const blocked = R.feet.some((o) => o.pair !== f.pair && o.stepping && o.t < 0.55);
        const overstretched = (f.L.reach || 0) > 1.0;
        if (((d > thr && (!blocked || d > thr * 2.2)) || overstretched) && !this.dead) {
          f.from.copy(f.planted); f.to.set(px, this.ground(px, pz), pz); f.t = 0; f.dur = stepDur; f.stepping = true;
        }
        f.cur.copy(f.planted);
      }
    }
    R.snap = false;
  }

  _footDown(f) {
    const k = 0.35 + Math.min(this.speed / (7 * C.scale), 1) * 0.65;
    this.rig.dipVel -= (f.front ? 0.3 : 0.45) * k;
    this._spawnDust(f.cur, f.front ? 3 : 5, k);
    if (!f.front || this.speed > 4) this.onStep?.(f.cur, k * (f.front ? 0.7 : 1));
  }

  // Two-bone IK in the leg's local plane. tgt is in the leg parent's space.
  _ik(L, tgt, kneeForward) {
    const [L1, L2] = L.L;
    const dx = tgt.x - L.hip.position.x, dy = tgt.y - L.hip.position.y, dz = tgt.z - L.hip.position.z;
    const splay = Math.atan2(dx, -dy);
    const h = Math.hypot(dx, dy), f = dz;
    const raw = Math.hypot(h, f);
    L.reach = raw / (L1 + L2); // > 1 means the foot is out of reach (it should step)
    const D = Math.min(Math.max(raw, Math.abs(L1 - L2) + 0.05), (L1 + L2) * 0.999);
    const phi = Math.atan2(f, h);
    const a = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))));
    const b = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2))));
    if (kneeForward) { L.hip.rotation.set(-(phi + a), 0, splay); L.knee.rotation.x = Math.PI - b; }
    else { L.hip.rotation.set(-(phi - a), 0, splay); L.knee.rotation.x = -(Math.PI - b); }
  }

  _solveFoot(f, rearing) {
    const m = this.model, L = f.L, S = C.scale;
    const META_TILT = 0.4;
    if (rearing && f.front) {
      // paws raised in the air
      _v4.set(L.hip.position.x, L.hip.position.y - 0.55, L.hip.position.z + 0.6);
    } else {
      _v4.copy(f.cur);
      if (L.ankle) {
        // the ankle sits above and slightly behind the toe
        const fw = this.forward;
        _v4.y += (L.L[2] * Math.cos(META_TILT) + 0.11) * S;
        _v4.x -= fw.x * L.L[2] * Math.sin(META_TILT) * S;
        _v4.z -= fw.z * L.L[2] * Math.sin(META_TILT) * S;
      } else _v4.y += 0.11 * S;
      L.parent.worldToLocal(_v4);
    }
    this._ik(L, _v4, !f.front);
    const chain = m.body.rotation.x + (L.front ? m.chest.rotation.x : 0) + L.hip.rotation.x + L.knee.rotation.x;
    if (L.ankle) {
      L.ankle.rotation.x = -META_TILT - chain;
      L.foot.rotation.x = META_TILT;
    } else L.foot.rotation.x = -chain;
  }

  // Head-on "feeding" for the death jumpscare: it stares at `target` with its jaw wide.
  feed(target) {
    this._setState('FEED');
    this.feedTarget = target;
    this.feedClose = false;
    this.attackPhase = null;
    this.speed = 0;
  }

  _animate(dt, ctx) {
    const m = this.model, R = this.rig, S = C.scale;
    const t = ctx.time;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    m.root.updateMatrixWorld(true);

    const st = this.state;
    const dying = st === 'DYING', deadNow = st === 'DEAD', stunned = st === 'STUNNED', feeding = st === 'FEED';
    const collapse = deadNow ? Math.min(this.stateT / 1.2, 1) : 0;
    const sf = Math.min(this.speed / (7 * S), 1.3);
    const turn = dt > 0 ? wrapAngle(this.yaw - R.lastYaw) / dt : 0;
    R.lastYaw = this.yaw;

    // idle behaviours while standing around
    if (this.idle) {
      this.idle.t += dt;
      if (st !== 'WANDER' || this.speed > 0.6 || this.idle.t > this.idle.dur) this.idle = null;
    }
    const idle = this.idle;
    const idleEnv = idle ? Math.sin(Math.PI * Math.min(idle.t / idle.dur, 1)) : 0;

    // ---- feet
    this._updateFeet(dt, sf);

    // ---- body: height/pitch/roll from where the feet stand, plus the state's pose
    const F = R.feet;
    const rel = (f) => (f.cur.y - this.pos.y) / S;
    const frontY = (rel(F[0]) + rel(F[1])) / 2, hindY = (rel(F[2]) + rel(F[3])) / 2;
    const rightY = (rel(F[0]) + rel(F[2])) / 2, leftY = (rel(F[1]) + rel(F[3])) / 2;
    const terrainPitch = Math.atan2(hindY - frontY, 2.0);
    let roll = Math.atan2(rightY - leftY, 1.8) * 0.7;
    let posePitch = 0, poseLift = 0, shake = 0;
    const rearing = st === 'ATTACK' && this.rear > 0 && (this.attackPhase === 'windup' || this.attackPhase === 'lunge');
    if (st === 'ATTACK') {
      if (this.attackPhase === 'windup') {
        if (this.rear > 0) { posePitch = -0.55 * this.rear; poseLift = 1.0 * this.rear; }
        else { const c = Math.min(this.stateT / (C.windup * 0.6), 1); posePitch = 0.12 * c; poseLift = -0.32 * c; } // coil
      } else if (this.attackPhase === 'lunge') {
        posePitch = this.rear > 0 ? -0.3 * this.rear : -0.1;
        poseLift = this.rear > 0 ? 0.9 * this.rear : 0.15;
      } else { posePitch = 0.05; poseLift = -0.1; }
    }
    if (st === 'TRACK') posePitch = 0.1;
    if (stunned) { poseLift = -0.35; shake = Math.sin(t * 6) * 0.08; }
    if (feeding) { posePitch = 0.08; poseLift = -0.12; }
    if (dying) { posePitch = -0.35; poseLift = 0.45; shake = Math.sin(t * 38) * 0.06; }
    if (deadNow) { posePitch = 0.12 * collapse; poseLift = -1.05 * collapse; roll += 0.25 * collapse; }
    if (idle?.type === 'shiver') shake += Math.sin(t * 42) * 0.05 * idleEnv;

    R.dipVel += (-R.dip * 120 - R.dipVel * 14) * dt;
    R.dip += R.dipVel * dt;
    const breathe = Math.sin(t * 1.7) * 0.03;
    this.bodyPitch = damp(this.bodyPitch, terrainPitch + posePitch, 8, dt);
    m.body.rotation.x = this.bodyPitch;
    m.body.rotation.z = damp(m.body.rotation.z, roll + shake - turn * 0.04 * sf, 8, dt);
    m.body.position.y = damp(m.body.position.y, m.bodyY + (frontY + hindY) / 2 + poseLift + R.dip + breathe, 12, dt);
    R.bend = damp(R.bend, Math.max(-0.3, Math.min(0.3, turn * 0.12)), 5, dt); // spine bends into turns
    m.chest.rotation.y = R.bend;
    m.chest.rotation.x = Math.sin(t * 1.7 + 0.5) * 0.02;

    // ---- legs
    m.root.updateMatrixWorld(true);
    for (const f of F) this._solveFoot(f, rearing);

    // ---- head, jaw, eyes
    let jaw = 0.08 + Math.max(0, Math.sin(t * 0.9)) * 0.06;
    let hp = 0, eye = 0, headRoll = 0, yawExtra = 0;
    if (st === 'CHASE') { jaw = 0.25 + Math.sin(t * 8) * 0.08; eye = 0.4; }
    if (st === 'ATTACK') {
      if (this.attackPhase === 'windup') { jaw = 0.95; hp = this.rear > 0 ? -0.45 : -0.3 + Math.sin(t * 30) * 0.03; eye = 1.5; }
      else if (this.attackPhase === 'lunge') { jaw = 0.1; hp = 0.35; eye = 1.5; }
      else { jaw = 0.3; hp = 0.1; }
    }
    if (st === 'TEAR') { jaw = 0.5 + Math.sin(t * 14) * 0.45; hp = 0.5; }
    if (st === 'TRACK') { hp = 0.45 + Math.sin(t * 9) * 0.05; jaw = 0.12; }
    if (stunned) { jaw = 0.7; hp = 0.45 + Math.sin(t * 5) * 0.1; eye = -0.7; headRoll = Math.sin(t * 5) * 0.12; }
    if (idle?.type === 'sniff') { hp = -0.45 * idleEnv + Math.sin(t * 22) * 0.04 * idleEnv; }
    if (idle?.type === 'listen') { headRoll = 0.32 * idle.side * idleEnv; yawExtra = 0.5 * idle.side * idleEnv; }
    if (this.litT > 0) eye = Math.max(eye, 0.8);
    if (dying) { jaw = 1 + Math.sin(t * 25) * 0.1; hp = -0.6 + shake; }
    if (deadNow) { jaw = 0.75; hp = 0.55; }

    let lookYaw;
    const lookAt = feeding ? this.feedTarget : ctx.player?.pos;
    if (feeding && lookAt) {
      m.headCenter.getWorldPosition(_v3);
      const yawTo = Math.atan2(lookAt.x - this.pos.x, lookAt.z - this.pos.z);
      lookYaw = Math.max(-1.1, Math.min(1.1, wrapAngle(yawTo - this.yaw)));
      hp = -Math.atan2(lookAt.y - _v3.y, Math.hypot(lookAt.x - _v3.x, lookAt.z - _v3.z)) * 0.8;
      jaw = this.feedClose ? 0 : 1.25 + Math.sin(t * 30) * 0.05;
      eye = 2.2;
      headRoll = Math.sin(t * 35) * 0.05;
    } else if (this.awareness > 0.3 && !stunned && !dying && !deadNow && lookAt) {
      lookYaw = Math.max(-0.6, Math.min(0.6, wrapAngle(Math.atan2(lookAt.x - this.pos.x, lookAt.z - this.pos.z) - this.yaw)));
    } else lookYaw = Math.sin(t * 0.4) * 0.3 + yawExtra;

    this.jawOpen = damp(this.jawOpen, jaw, feeding && this.feedClose ? 45 : st === 'ATTACK' ? 20 : 8, dt);
    this.headPitch = damp(this.headPitch, hp, 12, dt);
    this.headYaw = damp(this.headYaw, lookYaw, feeding ? 10 : 4, dt);
    this.eyeBoost = damp(this.eyeBoost, eye, 6, dt);
    m.jaw.rotation.x = this.jawOpen * 0.9;
    // neck carries part of the turn/pitch (and lags), the head stays steady while the body bobs
    m.neck[0].rotation.y = damp(m.neck[0].rotation.y, this.headYaw * 0.3, 5, dt);
    m.neck[1].rotation.y = damp(m.neck[1].rotation.y, this.headYaw * 0.3, 6, dt);
    m.neck[0].rotation.x = damp(m.neck[0].rotation.x, R.neckBase[0] + this.headPitch * 0.2, 6, dt);
    m.neck[1].rotation.x = damp(m.neck[1].rotation.x, R.neckBase[1] + this.headPitch * 0.2, 7, dt);
    m.headPivot.rotation.y = this.headYaw * 0.4;
    m.headPivot.rotation.x = R.headBase + this.headPitch * 0.6 - this.bodyPitch * 0.6;
    m.headPivot.rotation.z = damp(m.headPivot.rotation.z, headRoll, 8, dt);

    // tongue lolls when hunting, flicks when sniffing
    const hunting = st === 'CHASE' || feeding;
    const flick = st === 'TRACK' || idle?.type === 'sniff';
    m.tongue[0].rotation.x = damp(m.tongue[0].rotation.x, flick ? -0.1 + Math.sin(t * 18) * 0.25 : hunting ? 0.35 + Math.sin(t * 5) * 0.08 : 0.05, 10, dt);
    m.tongue[1].rotation.x = damp(m.tongue[1].rotation.x, hunting ? 0.35 + Math.sin(t * 6 + 1) * 0.12 : 0.1, 8, dt);
    m.drool.rotation.x = -m.jaw.rotation.x - m.headPivot.rotation.x * 0.5 + Math.sin(t * 2.3) * 0.12;
    m.drool.rotation.z = Math.sin(t * 1.7) * 0.1 - turn * 0.02;
    m.drool.scale.y = 1 + this.jawOpen * 0.5;

    // eyes (and the tower-beam glow while dying)
    if (dying || deadNow) {
      const eyeK = dying ? 2 + Math.sin(t * 20) : Math.max(0, 1 - collapse * 1.5);
      m.eyeLight.color.setHex(0xa040ff);
      m.eyeLight.distance = 30;
      m.eyeLight.intensity = dying ? 40 + Math.sin(t * 30) * 15 : 40 * Math.max(0, 1 - collapse);
      for (const e of m.eyes) e.scale.setScalar(0.55 * Math.min(eyeK, 2));
    } else {
      const eyeK = 1 + this.eyeBoost;
      m.eyeLight.intensity = 1.5 * Math.max(0.2, eyeK);
      for (const e of m.eyes) e.scale.setScalar(0.55 * Math.max(0.3, Math.min(eyeK, 2.2)));
    }
    // glowing seams pulse with its heartbeat (faster when it's hunting)
    const beat = Math.pow(Math.max(0, Math.sin(t * (2.2 + this.awareness * 3))), 8);
    m.fleshMat.emissiveIntensity = dying ? 1.2 : deadNow ? 0.55 * (1 - collapse) : 0.42 + beat * 0.4;

    // ---- tail: spring chain; rosaries swing on it
    m.tail.forEach((seg, i) => {
      const target = deadNow ? 0.05 * i : Math.sin(t * 2.2 - i * 0.7) * 0.08 * (0.4 + sf) - turn * 0.05 + (dying ? Math.sin(t * 12 - i) * 0.15 : 0);
      R.tailVel[i] += ((target - seg.rotation.y) * (60 - i * 6) - R.tailVel[i] * 7) * dt;
      seg.rotation.y += R.tailVel[i] * dt;
      seg.rotation.x = damp(seg.rotation.x, deadNow ? 0.22 : 0.07 + Math.sin(t * 1.3 - i * 0.5) * 0.03 + R.dip * 0.3, 6, dt);
    });
    m.pendulums.forEach((p, i) => {
      const tv = R.tailVel[Math.min(2 + i * 2, R.tailVel.length - 1)];
      R.pendVel[i] += ((-tv * 0.5 - p.rotation.z) * 30 - R.pendVel[i] * 2.5) * dt;
      p.rotation.z += R.pendVel[i] * dt;
      p.rotation.x = damp(p.rotation.x, -this.bodyPitch - sf * 0.3, 4, dt);
    });

    this._updateDust(dt);
  }
}
