/**
 * belizetriniOPNWRLD — procedural WebAudio (good-1+10). No audio files: everything is synthesized.
 *
 *  - engine loop pitched by speed / simulated rpm, one voice profile per vehicle type
 *    (sedan / van / scooter / plane / heli rotor thump)
 *  - footstep ticks (a short filtered-noise burst per step, new nodes per event)
 *  - police siren when wanted ≥ 1 and a pursuit unit is near (wail 1–3★, yelp 4–5★)
 *  - mission complete / fail stings
 *  - low tropical ambience bed: surf + breeze, birds by day, crickets by night (follows the clock)
 *
 * iOS rules: the AudioContext is created / unlocked inside the first touchend / pointerup / keydown /
 * click (and the START button) — a silent 1-sample buffer is played and resume() called in the gesture.
 * resume() again on visibilitychange (→ visible), pageshow, focus, and when the context reports
 * 'interrupted' / 'suspended' (calls, Siri, other apps). It is suspended while the page is hidden.
 * Mute toggle in the pause menu (localStorage 'bto.muted'); a one-time hint that the iPhone silent
 * switch mutes Web Audio. ?audio=0 disables it entirely.
 */
const LS_MUTE = 'bto.muted';
const LS_HINT = 'bto.audioHint';

const ENGINE = {
  sedan: { base: 48, span: 120, gears: 4, wave: 'sawtooth', cut: 900, vol: 0.16 },
  van: { base: 40, span: 95, gears: 4, wave: 'sawtooth', cut: 700, vol: 0.18 },
  scooter: { base: 95, span: 210, gears: 2, wave: 'square', cut: 1600, vol: 0.09 },
  plane: { base: 70, span: 160, gears: 1, wave: 'sawtooth', cut: 1400, vol: 0.14 },
  heli: { base: 38, span: 30, gears: 1, wave: 'sawtooth', cut: 420, vol: 0.2, thump: true },
};

export class GameAudio {
  constructor(game) {
    this.game = game;
    this.enabled = !/[?&]audio=0\b/.test(window.location.search);
    this.ctx = null;
    this.unlocked = false;
    this.muted = false;
    try { this.muted = localStorage.getItem(LS_MUTE) === '1'; } catch (_) {}
    this.nodesCreated = 0;
    this.events = { footstep: 0, sting: 0, chirp: 0, cricket: 0, unlock: 0, resume: 0, interrupted: 0 };
    this._stepT = 0; this._chirpT = 2; this._cricketT = 0;
    this._lastState = 'none';
    if (!this.enabled) return;
    this._onGesture = () => this.unlock();
    for (const ev of ['touchend', 'pointerup', 'keydown', 'click']) window.addEventListener(ev, this._onGesture, { capture: true, passive: true });
    const wake = () => this.resumeIfNeeded();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._suspendForHidden(); else wake();
    });
    window.addEventListener('pageshow', wake);
    window.addEventListener('focus', wake);
  }

  _n(node) { this.nodesCreated++; return node; }

  /** Create + unlock the context. Must run inside a user gesture (iOS). Safe to call repeatedly. */
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.enabled = false; return; }
        // Old iOS (webkitAudioContext) may reject the options bag: fall back to the bare constructor.
        try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { this.ctx = new AC(); }
        this.ctx.onstatechange = () => this._onState();
        this._build();
      }
      // iOS unlock: play a silent 1-sample buffer inside the gesture, then resume().
      const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this._n(this.ctx.createBufferSource());
      src.buffer = b; src.connect(this.ctx.destination); src.start(0);
      // Synchronous resume() inside the gesture: no await / promise hop before this call (iOS).
      if (this.ctx.state !== 'running') this._resume();
      if (!this.unlocked) {
        this.unlocked = true; this.events.unlock++;
        this._hintOnce();
      }
    } catch (e) { console.warn('[audio] unlock failed', e?.message || e); }
    if (this.unlocked && this.ctx?.state === 'running') this._dropGestureListeners();
  }

  /** resume() that tolerates old WebKit returning undefined instead of a Promise. */
  _resume() {
    try { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
  }

  _dropGestureListeners() {
    if (!this._onGesture) return;
    for (const ev of ['touchend', 'pointerup', 'keydown', 'click']) window.removeEventListener(ev, this._onGesture, { capture: true });
    // Keep one cheap listener: iOS may need a fresh gesture after an interruption.
    this._onGesture2 = () => { if (this.ctx && this.ctx.state !== 'running') this.unlock(); };
    for (const ev of ['touchend', 'pointerup', 'keydown']) window.addEventListener(ev, this._onGesture2, { capture: true, passive: true });
    this._onGesture = null;
  }

  _onState() {
    const s = this.ctx.state;
    this._lastState = s;
    if (s === 'interrupted') this.events.interrupted++;
    // iOS reports 'running' asynchronously after the gesture: drop the first-gesture listeners then.
    if (s === 'running' && this.unlocked) this._dropGestureListeners();
    // Interrupted (call, Siri, another app) or suspended by the OS while we are visible: try to come back.
    if ((s === 'interrupted' || s === 'suspended') && document.visibilityState === 'visible' && !this._hiddenSuspend) {
      clearTimeout(this._retry);
      this._retry = setTimeout(() => this.resumeIfNeeded(), 300);
    }
  }

  resumeIfNeeded() {
    if (!this.ctx || document.visibilityState === 'hidden') return;
    this._hiddenSuspend = false;
    if (this.ctx.state !== 'running') {
      this.events.resume++;
      this._resume();
    }
  }

  _suspendForHidden() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this._hiddenSuspend = true;
    try { const p = this.ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
  }

  setMuted(m) {
    this.muted = !!m;
    try { localStorage.setItem(LS_MUTE, this.muted ? '1' : '0'); } catch (_) {}
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  _hintOnce() {
    const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    if (!iOS) return;
    let shown = false;
    try { shown = localStorage.getItem(LS_HINT) === '1'; localStorage.setItem(LS_HINT, '1'); } catch (_) {}
    if (shown) return;
    this.hintShown = true;
    setTimeout(() => this.game.hud?.toast('Sound on 🔊 — no sound? Flip the iPhone silent switch off (it mutes web audio)', 5200), 1800);
  }

  // ─── graph ──────────────────────────────────────────────────────────────────
  _build() {
    const c = this.ctx;
    this.master = this._n(c.createGain());
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = this._n(c.createDynamicsCompressor());
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    // Shared noise buffer (2 s white).
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) { seed = (seed * 16807) % 2147483647; d[i] = seed / 1073741823.5 - 1; }

    // Engine voice: two detuned oscillators → lowpass → gain; a slow LFO for the heli thump.
    this.eng = { gain: this._n(c.createGain()), lp: this._n(c.createBiquadFilter()), o1: this._n(c.createOscillator()), o2: this._n(c.createOscillator()),
      thump: this._n(c.createGain()), lfo: this._n(c.createOscillator()), lfoAmt: this._n(c.createGain()) };
    const E = this.eng;
    E.gain.gain.value = 0; E.lp.type = 'lowpass'; E.lp.frequency.value = 800; E.lp.Q.value = 2;
    E.o1.type = 'sawtooth'; E.o2.type = 'square'; E.o2.detune.value = -1200 + 7;
    E.thump.gain.value = 1; E.lfo.frequency.value = 0; E.lfoAmt.gain.value = 0;
    E.lfo.connect(E.lfoAmt); E.lfoAmt.connect(E.thump.gain);
    E.o1.connect(E.lp); E.o2.connect(E.lp); E.lp.connect(E.thump); E.thump.connect(E.gain); E.gain.connect(this.master);
    E.o1.start(); E.o2.start(); E.lfo.start();

    // Siren: oscillator whose pitch is swept by an LFO (wail / yelp), through a bandpass.
    this.sir = { gain: this._n(c.createGain()), o: this._n(c.createOscillator()), lfo: this._n(c.createOscillator()), amt: this._n(c.createGain()), bp: this._n(c.createBiquadFilter()) };
    const S = this.sir;
    S.gain.gain.value = 0; S.o.type = 'triangle'; S.o.frequency.value = 900; S.lfo.frequency.value = 0.35; S.amt.gain.value = 320;
    S.bp.type = 'bandpass'; S.bp.frequency.value = 1000; S.bp.Q.value = 0.7;
    S.lfo.connect(S.amt); S.amt.connect(S.o.frequency); S.o.connect(S.bp); S.bp.connect(S.gain); S.gain.connect(this.master);
    S.o.start(); S.lfo.start();

    // Ambience bed: looped noise → lowpass "surf" with a slow swell, + bandpass "breeze".
    this.amb = { src: this._n(c.createBufferSource()), surf: this._n(c.createBiquadFilter()), surfG: this._n(c.createGain()),
      swell: this._n(c.createOscillator()), swellAmt: this._n(c.createGain()), breeze: this._n(c.createBiquadFilter()), breezeG: this._n(c.createGain()), bed: this._n(c.createGain()) };
    const A = this.amb;
    A.src.buffer = this.noise; A.src.loop = true;
    A.surf.type = 'lowpass'; A.surf.frequency.value = 420; A.surfG.gain.value = 0.05;
    A.swell.frequency.value = 0.09; A.swellAmt.gain.value = 0.035; A.swell.connect(A.swellAmt); A.swellAmt.connect(A.surfG.gain);
    A.breeze.type = 'bandpass'; A.breeze.frequency.value = 1800; A.breeze.Q.value = 0.6; A.breezeG.gain.value = 0.012;
    A.bed.gain.value = 0.0;
    A.src.connect(A.surf); A.surf.connect(A.surfG); A.surfG.connect(A.bed);
    A.src.connect(A.breeze); A.breeze.connect(A.breezeG); A.breezeG.connect(A.bed);
    A.bed.connect(this.master);
    A.src.start(); A.swell.start();
  }

  // ─── one-shot events (new nodes per event; they disconnect when done) ──────────
  footstep(intensity = 1) {
    if (!this._live()) return;
    const c = this.ctx, t = c.currentTime;
    const src = this._n(c.createBufferSource()), bp = this._n(c.createBiquadFilter()), g = this._n(c.createGain());
    src.buffer = this.noise;
    bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 500; bp.Q.value = 1.4;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * intensity, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.5, 0.09);
    src.onended = () => { src.disconnect(); bp.disconnect(); g.disconnect(); };
    this.events.footstep++;
  }

  /** 'complete' = rising major arpeggio; 'fail' = falling minor third. */
  sting(kind = 'complete') {
    if (!this._live()) return;
    const c = this.ctx, t0 = c.currentTime + 0.02;
    const notes = kind === 'fail' ? [[392, 0], [311.1, 0.22], [261.6, 0.44]] : [[523.3, 0], [659.3, 0.11], [784, 0.22], [1046.5, 0.36]];
    for (const [f, dt] of notes) {
      const o = this._n(c.createOscillator()), g = this._n(c.createGain());
      o.type = kind === 'fail' ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      const t = t0 + dt, dur = kind === 'fail' ? 0.32 : (dt > 0.3 ? 0.6 : 0.18);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === 'fail' ? 0.12 : 0.2, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.05);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    }
    this.events.sting++;
  }

  _chirp() {
    const c = this.ctx, t = c.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    const f0 = 2400 + Math.random() * 1600;
    for (let i = 0; i < n; i++) {
      const o = this._n(c.createOscillator()), g = this._n(c.createGain());
      const ts = t + i * 0.11;
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, ts); o.frequency.exponentialRampToValueAtTime(f0 * 1.5, ts + 0.06);
      g.gain.setValueAtTime(0.0001, ts); g.gain.exponentialRampToValueAtTime(0.03, ts + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.08);
      o.connect(g); g.connect(this.amb.bed); o.start(ts); o.stop(ts + 0.1);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    }
    this.events.chirp++;
  }

  _cricket() {
    const c = this.ctx, t = c.currentTime;
    const o = this._n(c.createOscillator()), g = this._n(c.createGain()), am = this._n(c.createOscillator()), amG = this._n(c.createGain());
    o.frequency.value = 4300 + Math.random() * 400;
    am.frequency.value = 38; amG.gain.value = 0.012;
    g.gain.value = 0;
    am.connect(amG); amG.connect(g.gain);
    g.gain.setValueAtTime(0, t);
    o.connect(g); g.connect(this.amb.bed);
    o.start(t); am.start(t); o.stop(t + 0.35); am.stop(t + 0.35);
    o.onended = () => { o.disconnect(); g.disconnect(); am.disconnect(); amG.disconnect(); };
    this.events.cricket++;
  }

  _live() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  // ─── per frame ──────────────────────────────────────────────────────────────
  update(dt) {
    if (!this.ctx) return;
    const g = this.game, c = this.ctx, t = c.currentTime;
    const playing = g.running && !g.paused;
    const P = g.player;
    // Engine.
    const E = this.eng;
    let eg = 0;
    if (playing && P.inVehicle && P.vehicle) {
      const v = P.vehicle, prof = ENGINE[v.type] || ENGINE.sedan;
      const sp = Math.min(1, Math.abs(v.speed || 0) / (v.maxSpeed || 30));
      let rpm;
      if (prof.gears > 1) { const gearPos = sp * prof.gears; const gi = Math.min(prof.gears - 1, Math.floor(gearPos)); rpm = 0.25 + 0.75 * (gearPos - gi) * (0.7 + 0.3 * (gi / prof.gears)); }
      else rpm = 0.3 + 0.7 * sp;
      if (v.isAir) rpm = 0.45 + 0.55 * Math.max(sp, v.collective ?? 0.5);
      const throttle = Math.abs(v.throttle || 0);
      const f = prof.base + prof.span * rpm;
      if (E.o1.type !== prof.wave) E.o1.type = prof.wave;
      E.o1.frequency.setTargetAtTime(f, t, 0.05);
      E.o2.frequency.setTargetAtTime(f, t, 0.05);
      E.lp.frequency.setTargetAtTime(prof.cut * (0.6 + 0.6 * rpm + 0.3 * throttle), t, 0.08);
      E.lfo.frequency.setTargetAtTime(prof.thump ? 11 + 7 * rpm : 0, t, 0.1);
      E.lfoAmt.gain.setTargetAtTime(prof.thump ? 0.85 : 0, t, 0.1);
      eg = prof.vol * (0.55 + 0.45 * Math.max(throttle, sp));
    }
    E.gain.gain.setTargetAtTime(eg, t, 0.08);
    this.engineGain = eg;
    // Footsteps: stride rate from ground speed.
    if (playing && !P.inVehicle) {
      const spd = P.groundSpeed ?? P._moveSpeed ?? 0;
      if (spd > 0.6) {
        this._stepT -= dt;
        if (this._stepT <= 0) { this.footstep(Math.min(1.2, 0.6 + spd / 8)); this._stepT = Math.max(0.24, 0.62 - spd * 0.05); }
      } else this._stepT = 0.05;
    }
    // Siren: wanted ≥ 1 and a pursuit unit within 80 m.
    const W = g.wantedSys;
    let sg = 0;
    if (playing && W && W.stars >= 1) {
      const pos = P.position;
      let dmin = Infinity;
      for (const u of W.units) {
        if (!u.mesh || u.kind === 'spikes') continue;
        const d = Math.hypot(u.mesh.position.x - pos.x, u.mesh.position.z - pos.z);
        if (d < dmin) dmin = d;
      }
      if (dmin < 80) sg = 0.07 * (1 - dmin / 80) + 0.02;
      const yelp = W.stars >= 4;
      this.sir.lfo.frequency.setTargetAtTime(yelp ? 3.2 : 0.35, t, 0.2);
      this.sir.amt.gain.setTargetAtTime(yelp ? 260 : 340, t, 0.2);
    }
    this.sir.gain.gain.setTargetAtTime(sg, t, 0.25);
    this.sirenGain = sg;
    // Ambience: day birds / night crickets, surf always.
    const hour = g.world?.dayNight?.hour ?? 14;
    const day = hour > 6 && hour < 18.5 ? 1 : 0;
    this.amb.bed.gain.setTargetAtTime(this._live() ? 1 : 0, t, 0.6);
    this.amb.breezeG.gain.setTargetAtTime(day ? 0.014 : 0.008, t, 1);
    if (this._live()) {
      if (day) { this._chirpT -= dt; if (this._chirpT <= 0) { this._chirp(); this._chirpT = 2 + Math.random() * 5; } }
      else { this._cricketT -= dt; if (this._cricketT <= 0) { this._cricket(); this._cricketT = 0.45 + Math.random() * 0.5; } }
    }
  }

  state() {
    return { enabled: this.enabled, state: this.ctx?.state || 'none', unlocked: this.unlocked, muted: this.muted, nodesCreated: this.nodesCreated,
      events: { ...this.events }, engineGain: +(this.engineGain || 0).toFixed(3), sirenGain: +(this.sirenGain || 0).toFixed(3), sampleRate: this.ctx?.sampleRate || 0 };
  }
}
