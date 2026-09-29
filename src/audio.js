// All sounds are synthesized with WebAudio, so there are no asset files yet.
// Swap any method for sample playback later.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.heartPhase = 0;
  }

  // Must be called from a user gesture (click).
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 6); }
    this.distCurve = curve;

    this._ambient();
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }
  get now() { return this.ctx.currentTime; }

  setListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position;
    const f = camera.getWorldDirection(this._f || (this._f = camera.position.clone()));
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  // ---------------------------------------------------------------- building blocks
  _out(pos, ref = 4) {
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1.2;
    p.maxDistance = 120;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y + 1.5; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y + 1.5, pos.z);
    p.connect(this.master);
    return p;
  }

  _env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _noise(t, dur, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.connect(dest);
    s.start(t, Math.random() * 1.5, dur + 0.1);
    return s;
  }

  _osc(type, freq, t, dur, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  // ---------------------------------------------------------------- monster
  drum(pos, vol = 1) {
    if (!this.ready) return;
    const t = this.now, out = this._out(pos, 5);
    const g = this.ctx.createGain(); g.connect(out);
    this._env(g, t, 0.004, 0.9 * vol, 0.45);
    const o = this._osc('sine', 120, t, 0.5, g);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    const ng = this.ctx.createGain(); this._env(ng, t, 0.002, 0.25 * vol, 0.06);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
    lp.connect(ng); ng.connect(out);
    this._noise(t, 0.1, lp);
  }

  roar(pos, big = false) {
    if (!this.ready) return;
    const t = this.now, dur = big ? 2.2 : 1.5, out = this._out(pos, 8);
    const g = this.ctx.createGain(); g.connect(out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.15);
    g.gain.setValueAtTime(0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(1600, t + 0.3);
    lp.frequency.exponentialRampToValueAtTime(350, t + dur);
    lp.connect(g);
    const ws = this.ctx.createWaveShaper(); ws.curve = this.distCurve; ws.connect(lp);
    const pre = this.ctx.createGain(); pre.gain.value = 0.35; pre.connect(ws);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 7;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 4; lfo.connect(lfoG); lfo.start(t); lfo.stop(t + dur);
    for (const f of [55, 57.5, 82.4, 110]) { // power chord + detune
      const o = this._osc('sawtooth', f, t, dur, pre);
      lfoG.connect(o.frequency);
      o.frequency.setValueAtTime(f, t + dur * 0.6);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + dur);
    }
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.8;
    const ng = this.ctx.createGain(); ng.gain.value = 0.5; bp.connect(ng); ng.connect(pre);
    this._noise(t, dur, bp);
  }

  cymbal(pos, vol = 1) {
    if (!this.ready) return;
    const t = this.now, out = this._out(pos, 6);
    const g = this.ctx.createGain(); g.connect(out);
    this._env(g, t, 0.003, 0.6 * vol, 1.6);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 8500; bp.Q.value = 3; bp.gain.value = 12;
    hp.connect(bp); bp.connect(g);
    this._noise(t, 1.7, hp);
  }

  sniff(pos) {
    if (!this.ready) return;
    const t = this.now, out = this._out(pos, 6);
    for (const [dt, len] of [[0, 0.22], [0.3, 0.18], [0.55, 0.35]]) {
      const g = this.ctx.createGain(); g.connect(out);
      this._env(g, t + dt, 0.06, 0.35, len);
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(700, t + dt);
      bp.frequency.linearRampToValueAtTime(1400, t + dt + len);
      bp.connect(g);
      this._noise(t + dt, len + 0.1, bp);
    }
  }

  clang(parry) {
    if (!this.ready) return;
    const t = this.now;
    const g = this.ctx.createGain(); g.connect(this.master);
    this._env(g, t, 0.002, parry ? 0.5 : 0.35, 1.3);
    for (const f of [523, 1340, 2270, 3150]) this._osc('sine', f * (parry ? 1 : 0.8), t, 1.4, g);
    const ng = this.ctx.createGain(); this._env(ng, t, 0.001, 0.4, 0.08); ng.connect(this.master);
    this._noise(t, 0.1, ng);
  }

  bite() {
    if (!this.ready) return;
    const t = this.now;
    const g = this.ctx.createGain(); g.connect(this.master);
    this._env(g, t, 0.002, 1.0, 0.5);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.connect(g);
    this._noise(t, 0.5, lp);
    this.drum(null, 1.3);
    this.roar(null, true);
  }

  // ---------------------------------------------------------------- death jumpscare
  // In-your-face scream: rising distorted chord, a shriek and guitar-feedback squeal.
  scream() {
    if (!this.ready) return;
    const t = this.now, dur = 1.5;
    const g = this.ctx.createGain(); g.connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.05);
    g.gain.setValueAtTime(0.9, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.6);
    bp.connect(g);
    const ws = this.ctx.createWaveShaper(); ws.curve = this.distCurve; ws.connect(bp);
    const pre = this.ctx.createGain(); pre.gain.value = 0.4; pre.connect(ws);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 13;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 18; lfo.connect(lfoG); lfo.start(t); lfo.stop(t + dur);
    for (const f of [220, 311, 440, 587]) {
      const o = this._osc('sawtooth', f, t, dur, pre);
      o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.7);
      lfoG.connect(o.frequency);
    }
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const ng = this.ctx.createGain(); ng.gain.value = 0.6; hp.connect(ng); ng.connect(g);
    this._noise(t, dur, hp);
    const fb = this.ctx.createGain(); fb.connect(this.master); this._env(fb, t + 0.1, 0.2, 0.12, 1.1);
    const sq = this._osc('sine', 1760, t + 0.1, 1.3, fb);
    sq.frequency.exponentialRampToValueAtTime(2700, t + 1.2);
    this.cymbal(null, 1.2);
  }

  // Jaws closing: bone crunches, a wet squelch and a deep thud.
  crunch() {
    if (!this.ready) return;
    const t = this.now;
    for (const [dt, v] of [[0, 1], [0.06, 0.8], [0.14, 0.9], [0.22, 0.5]]) {
      const g = this.ctx.createGain(); g.connect(this.master);
      this._env(g, t + dt, 0.002, v, 0.06);
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800 + Math.random() * 1500; lp.connect(g);
      this._noise(t + dt, 0.1, lp);
    }
    const sq = this.ctx.createGain(); sq.connect(this.master); this._env(sq, t + 0.05, 0.02, 0.5, 0.35);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 550; bp.Q.value = 2; bp.connect(sq);
    this._noise(t + 0.05, 0.4, bp);
    const th = this.ctx.createGain(); th.connect(this.master); this._env(th, t, 0.004, 1.2, 0.5);
    const o = this._osc('sine', 95, t, 0.55, th); o.frequency.exponentialRampToValueAtTime(35, t + 0.4);
  }

  heartOnce(vol = 0.6) {
    if (!this.ready) return;
    const t = this.now;
    for (const [dt, v] of [[0, 1], [0.17, 0.6]]) {
      const g = this.ctx.createGain(); g.connect(this.master);
      this._env(g, t + dt, 0.01, vol * v, 0.16);
      const o = this._osc('sine', 60, t + dt, 0.22, g);
      o.frequency.exponentialRampToValueAtTime(36, t + dt + 0.16);
    }
  }

  flatline() {
    if (!this.ready) return;
    const t = this.now;
    const g = this.ctx.createGain(); g.connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.03);
    g.gain.setValueAtTime(0.1, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    this._osc('sine', 1000, t, 3, g);
  }

  // ---------------------------------------------------------------- towers
  // Pipe-organ tone: fundamental + a few harmonics.
  organNote(pos, freq, dur = 0.7, vol = 0.35) {
    if (!this.ready) return;
    const t = this.now, out = this._out(pos, 10);
    const g = this.ctx.createGain(); g.connect(out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500; lp.connect(g);
    for (const [mul, type, amp] of [[1, 'sine', 1], [2, 'triangle', 0.35], [3, 'sine', 0.2], [4, 'square', 0.04]]) {
      const ag = this.ctx.createGain(); ag.gain.value = amp; ag.connect(lp);
      this._osc(type, freq * mul, t, dur, ag);
    }
  }

  organChord(pos, big = false) {
    const base = big ? 55 : 110;
    for (const m of [1, 1.5, 2, 2.52, 3]) this.organNote(pos, base * m, big ? 5 : 2.8, big ? 0.3 : 0.2);
  }

  wrongNote(pos) {
    if (!this.ready) return;
    const t = this.now, out = this._out(pos, 12);
    const g = this.ctx.createGain(); g.connect(out);
    this._env(g, t, 0.005, 0.5, 0.9);
    const ws = this.ctx.createWaveShaper(); ws.curve = this.distCurve; ws.connect(g);
    const pre = this.ctx.createGain(); pre.gain.value = 0.3; pre.connect(ws);
    for (const f of [233, 247, 311]) this._osc('sawtooth', f, t, 1, pre);
    this.clang(false);
  }

  // Continuous drone for a charging tower. Returns { set(level 0..1), stop() }.
  towerHum(pos) {
    if (!this.ready) return { set() {}, stop() {} };
    const t = this.now, out = this._out(pos, 12);
    const g = this.ctx.createGain(); g.gain.value = 0.0001; g.connect(out);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.connect(g);
    const oscs = [55, 82.5, 110.3, 164.8].map((f, i) => {
      const o = this.ctx.createOscillator(); o.type = i % 2 ? 'sawtooth' : 'triangle'; o.frequency.value = f; o.connect(lp); o.start(t); return o;
    });
    return {
      set: (level) => {
        const now = this.now;
        g.gain.setTargetAtTime(0.03 + level * 0.22, now, 0.3);
        lp.frequency.setTargetAtTime(250 + level * 1600, now, 0.3);
      },
      stop: () => {
        const now = this.now;
        g.gain.setTargetAtTime(0.0001, now, 0.25);
        for (const o of oscs) o.stop(now + 1.5);
      },
    };
  }

  // ---------------------------------------------------------------- player
  step(intensity, wading) {
    if (!this.ready) return;
    const t = this.now;
    const g = this.ctx.createGain(); g.connect(this.master);
    this._env(g, t, 0.005, 0.06 + intensity * 0.1, wading ? 0.3 : 0.12);
    const f = this.ctx.createBiquadFilter();
    f.type = wading ? 'bandpass' : 'lowpass';
    f.frequency.value = wading ? 900 : 350 + Math.random() * 300;
    f.Q.value = wading ? 1.5 : 0.7;
    f.connect(g);
    this._noise(t, 0.35, f);
  }

  land(impact) {
    if (!this.ready || impact < 4) return;
    const t = this.now;
    const g = this.ctx.createGain(); g.connect(this.master);
    this._env(g, t, 0.004, Math.min(0.1 + impact * 0.02, 0.4), 0.2);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; f.connect(g);
    this._noise(t, 0.25, f);
  }

  click() {
    if (!this.ready) return;
    const t = this.now;
    const g = this.ctx.createGain(); g.connect(this.master);
    this._env(g, t, 0.001, 0.12, 0.03);
    this._osc('square', 2400, t, 0.04, g);
  }

  whoosh() {
    if (!this.ready) return;
    const t = this.now;
    const g = this.ctx.createGain(); g.connect(this.master);
    this._env(g, t, 0.03, 0.35, 0.22);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(3000, t + 0.2);
    bp.connect(g);
    this._noise(t, 0.3, bp);
  }

  chime(pos, vol = 1) {
    if (!this.ready) return;
    const t = this.now, out = this._out(pos, 3);
    const g = this.ctx.createGain(); g.connect(out);
    this._env(g, t, 0.005, 0.18 * vol, 1.2);
    for (const f of [880, 1318, 1760]) this._osc('sine', f + Math.random() * 6, t, 1.3, g);
  }

  deny() {
    if (!this.ready) return;
    const t = this.now;
    const g = this.ctx.createGain(); g.connect(this.master);
    this._env(g, t, 0.005, 0.08, 0.15);
    this._osc('square', 90, t, 0.2, g);
  }

  // ---------------------------------------------------------------- loops
  _ambient() {
    const ctx = this.ctx, t = ctx.currentTime;
    const drone = ctx.createGain(); drone.gain.value = 0.05; drone.connect(this.master);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140; lp.connect(drone);
    for (const f of [41.2, 41.7, 61.8]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); }
    const wind = ctx.createGain(); wind.gain.value = 0.035; wind.connect(this.master);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6; bp.connect(wind);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true; src.connect(bp); src.start(t);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lfoG = ctx.createGain(); lfoG.gain.value = 250; lfo.connect(lfoG); lfoG.connect(bp.frequency); lfo.start(t);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.13;
    const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.02; lfo2.connect(lfo2G); lfo2G.connect(wind.gain); lfo2.start(t);
  }

  // danger 0..1 (monster proximity/chase); call every frame
  update(dt, danger) {
    if (!this.ready) return;
    if (danger < 0.05) { this.heartPhase = 0; return; }
    const bpm = 60 + danger * 90;
    this.heartPhase += dt * bpm / 60;
    if (this.heartPhase >= 1) {
      this.heartPhase -= 1;
      const t = this.now, vol = Math.pow(danger, 1.4) * 0.7;
      for (const [dt2, v] of [[0, 1], [0.17, 0.6]]) {
        const g = this.ctx.createGain(); g.connect(this.master);
        this._env(g, t + dt2, 0.01, vol * v + 0.0002, 0.14);
        const o = this._osc('sine', 62, t + dt2, 0.2, g);
        o.frequency.exponentialRampToValueAtTime(38, t + dt2 + 0.15);
      }
    }
  }
}
