import { PRESETS, PRESET_ORDER } from './quality.js';
import { setToonQuality, TOON_Q } from './toon.js';

/**
 * belizetriniOPNWRLD — adaptive frame-rate governor (good-1+6).
 *
 * Measures the real frame interval (rolling 1 s window) against a target (60 fps desktop; 30 fps on
 * touch / iOS by default — ?fps=30|60 or localStorage 'bto.fps' override; ?gov=0 disables) and walks
 * one quality ladder, cheapest-looking cut first:
 *
 *   1. pixel ratio, 0.25 at a time, down to the preset's floor (PR_FLOOR)
 *   2. outline fade distance ×0.6
 *   3. clouds halved
 *   4. water foam detail → 0
 *   5. the next lower preset tier (low is the bottom); pixel ratio / outline cuts stay applied
 *
 * Hysteresis so it never thrashes: step DOWN after the window average sits above 1.2× budget for
 * 1.0 s; step UP only after it sits below 0.72× budget for 5 s (more for tier steps); 1.5 s cooldown
 * after every step; if a step up is undone within 8 s, the up-delay doubles (up to 60 s).
 * Level 0 is always exactly the chosen preset; the governor never saves anything.
 */
const PR_FLOOR = { low: 0.6, medium: 0.75, high: 1, ultra: 1 };
const DOWN_RATIO = 1.2, UP_RATIO = 0.72, DOWN_HOLD = 1.0, UP_HOLD = 5, COOLDOWN = 1.5;

export class FpsGovernor {
  constructor(game, quality) {
    this.game = game;
    this.quality = quality;
    const qs = window.location.search;
    this.enabled = !/[?&]gov=0\b/.test(qs);
    const mobile = !!(quality.shade?.mobile || quality.auto?.info?.touch || quality.auto?.info?.iOS);
    let saved = null;
    try { saved = +localStorage.getItem('bto.fps') || null; } catch (_) {}
    const u = /[?&]fps=(\d+)\b/.exec(qs);
    this.target = u ? +u[1] : (saved || (mobile ? 30 : 60));
    this.base = quality.name;
    this.level = 0;
    this._buildLadder();
    this._win = new Float32Array(90); this._wi = 0; this._wn = 0; this._sum = 0;
    this._over = 0; this._under = 0; this._cool = 0; this._upDelay = UP_HOLD;
    this._lastUpAt = -1e9; this.t = 0;
    this.timeline = [];
    this.avgMs = 0;
    this.lastAction = 'start';
  }

  /** Re-base on a new user-chosen preset (pause menu); resets to level 0. */
  rebase(name) {
    this.base = name; this.level = 0; this._upDelay = UP_HOLD; this._over = this._under = 0; this._cool = COOLDOWN;
    this._buildLadder();
  }

  setTarget(fps, save = false) {
    this.target = fps;
    if (save) { try { localStorage.setItem('bto.fps', String(fps)); } catch (_) {} }
  }

  _buildLadder() {
    const dpr = window.devicePixelRatio || 1;
    const P = PRESETS[this.base];
    const top = Math.min(dpr, P.pixelRatioCap);
    const steps = [];
    for (let pr = top - 0.25; pr >= Math.min(top, PR_FLOOR[this.base]) - 1e-6; pr -= 0.25) steps.push({ kind: 'pixelRatio', pr: +pr.toFixed(2) });
    if (steps.length && steps[steps.length - 1].pr > PR_FLOOR[this.base] + 1e-6 && top > PR_FLOOR[this.base]) steps.push({ kind: 'pixelRatio', pr: PR_FLOOR[this.base] });
    steps.push({ kind: 'outlines', dist: 0.6 });
    steps.push({ kind: 'clouds', mul: 0.5 });
    steps.push({ kind: 'foam', foam: 0 });
    for (let i = PRESET_ORDER.indexOf(this.base) - 1; i >= 0; i--) steps.push({ kind: 'tier', tier: PRESET_ORDER[i] });
    this.steps = steps;
  }

  /** The settings for a ladder level (cumulative). */
  settingsAt(level) {
    const dpr = window.devicePixelRatio || 1;
    let tier = this.base;
    let pr = Math.min(dpr, PRESETS[tier].pixelRatioCap), distMul = 1, cloudMul = 1, foam = null;
    for (let i = 0; i < level; i++) {
      const s = this.steps[i];
      if (s.kind === 'pixelRatio') pr = s.pr;
      else if (s.kind === 'outlines') distMul = s.dist;
      else if (s.kind === 'clouds') cloudMul = s.mul;
      else if (s.kind === 'foam') foam = 0;
      else if (s.kind === 'tier') { tier = s.tier; pr = Math.min(pr, PRESETS[tier].pixelRatioCap, dpr); }
    }
    const P = PRESETS[tier];
    pr = Math.max(Math.min(PR_FLOOR[tier], dpr), Math.min(pr, P.pixelRatioCap, dpr));
    return { tier, pixelRatio: +pr.toFixed(2), outlineDist: +(P.outlineDist * distMul).toFixed(3),
      clouds: Math.round(P.clouds * cloudMul), foam: foam ?? P.foam };
  }

  _apply(level, why) {
    const prev = this.settingsAt(this.level);
    this.level = level;
    const s = this.settingsAt(level);
    const g = this.game, q = this.quality;
    if (s.tier !== q.name) q.apply(s.tier); // live preset knobs (far plane, lights, clouds...)
    g.renderer.setPixelRatio(s.pixelRatio);
    g._onResize?.();
    setToonQuality({ dist: s.outlineDist, clouds: s.clouds, foam: s.foam });
    this.lastAction = why;
    const ev = { t: +this.t.toFixed(2), action: why, level, avgMs: +this.avgMs.toFixed(2), from: prev, to: s };
    this.timeline.push(ev);
    if (this.timeline.length > 200) this.timeline.shift();
  }

  /** Call once per frame with the real (unclamped) frame interval in seconds. */
  update(frameSec) {
    if (!this.enabled || !(frameSec > 0)) return;
    this.t += frameSec;
    const ms = Math.min(frameSec * 1000, 250); // a tab switch / GC hitch counts, but capped
    if (this._wn === this._win.length) this._sum -= this._win[this._wi]; else this._wn++;
    this._win[this._wi] = ms; this._sum += ms; this._wi = (this._wi + 1) % this._win.length;
    // Window ≈ the last second of frames (but at least 20 samples).
    const n = Math.min(this._wn, Math.max(20, Math.round(1000 / Math.max(this._sum / this._wn, 1))));
    let s = 0;
    for (let i = 1; i <= n; i++) s += this._win[(this._wi - i + this._win.length) % this._win.length];
    this.avgMs = s / n;
    if (this._wn < 20) return;
    const budget = 1000 / this.target;
    this._cool = Math.max(0, this._cool - frameSec);
    if (this.avgMs > budget * DOWN_RATIO) { this._over += frameSec; this._under = 0; }
    else if (this.avgMs < budget * UP_RATIO) { this._under += frameSec; this._over = 0; }
    else { this._over = Math.max(0, this._over - frameSec); this._under = 0; }
    if (this._cool > 0) return;
    if (this._over >= DOWN_HOLD && this.level < this.steps.length) {
      if (this.t - this._lastUpAt < 8) this._upDelay = Math.min(60, this._upDelay * 2); // undone step up: back off
      this._apply(this.level + 1, 'down:' + this.steps[this.level].kind);
      this._over = 0; this._cool = COOLDOWN;
    } else if (this.level > 0) {
      const next = this.steps[this.level - 1];
      const need = this._upDelay * (next.kind === 'tier' ? 1.6 : 1);
      if (this._under >= need) {
        this._apply(this.level - 1, 'up:' + next.kind);
        this._lastUpAt = this.t; this._under = 0; this._cool = COOLDOWN;
      }
    }
  }

  state() {
    const s = this.settingsAt(this.level);
    return { enabled: this.enabled, targetFps: this.target, avgMs: +this.avgMs.toFixed(2), fps: this.avgMs ? +(1000 / this.avgMs).toFixed(1) : 0,
      level: this.level, maxLevel: this.steps.length, base: this.base, ...s, lastAction: this.lastAction, upDelay: this._upDelay,
      steps: this.timeline.length };
  }
}

/** ?debug=1 overlay: fps, budget, governor level and current knobs. */
export function mountDebugOverlay(game) {
  if (!/[?&]debug=1\b/.test(window.location.search)) return null;
  const el = document.createElement('div');
  el.id = 'debug-overlay';
  el.style.cssText = 'position:fixed;left:6px;bottom:calc(env(safe-area-inset-bottom,0px) + 168px);z-index:60;font:11px/1.35 ui-monospace,Menlo,monospace;' +
    'color:#e8fff6;background:rgba(10,16,30,.72);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre;max-width:60vw';
  document.body.appendChild(el);
  let acc = 0;
  return {
    el,
    update(dt) {
      acc += dt; if (acc < 0.25) return; acc = 0;
      const s = game.governor?.state(); if (!s) return;
      const r = game.renderer.info.render;
      const ws = game.wantedSys?.state?.();
      el.textContent = `${s.fps} fps  ${s.avgMs} ms  target ${s.targetFps}${s.enabled ? '' : ' (gov off)'}\n` +
        `gov L${s.level}/${s.maxLevel}  ${s.base}→${s.tier}  pr ${s.pixelRatio}\n` +
        `outl ×${s.outlineDist} clouds ${s.clouds} foam ${s.foam}\n` +
        `last ${s.lastAction}  calls ${r.calls}  tris ${r.triangles}\n` +
        `shade ${game.quality?.shade?.lambert ? 'lambert' : 'toon'}  blobs ${game.blobs?.mesh.count ?? 0}` +
        (ws ? `\nwanted ${ws.stars}★ heat ${ws.heat} seen ${ws.seen ? 'Y' : 'n'} units ${ws.units}` : '');
    },
  };
}
