import * as THREE from 'three';
import { OUTLINE_CLASSES, setToonQuality, setShadingPath, SHADE } from './toon.js';

/**
 * belizetriniOPNWRLD — device quality presets (good-1+3).
 *
 *   ?quality=low|medium|high|ultra   one-off override (not saved)
 *   pause menu selector              saved in localStorage['bto.quality'] ('auto' or a preset)
 *
 * `high` is exactly the good-1+1/1+2 look (pixelRatio cap 1.5, AA, all outlines, 26 clouds, full foam,
 * 450 m far plane, 8 point lights, 18 character outline parts). Auto-detect never picks `ultra`.
 */
export const PRESETS = {
  low: {
    label: 'Low', pixelRatioCap: 1, antialias: false, shadows: false, outlines: 'dynamic', outlineDist: 0.5,
    clouds: 8, foam: 0, waterSeg: 0.25, far: 220, maxPointLights: 2, charOutlineParts: 6, vehicleOutlineParts: 2,
    lambert: true, blobShadows: true,
  },
  medium: {
    label: 'Medium', pixelRatioCap: 1.25, antialias: false, shadows: false, outlines: 'all', outlineDist: 0.75,
    clouds: 16, foam: 1, waterSeg: 0.5, far: 320, maxPointLights: 4, charOutlineParts: 10, vehicleOutlineParts: 3,
    lambert: true, blobShadows: true,
  },
  high: {
    label: 'High', pixelRatioCap: 1.5, antialias: true, shadows: false, outlines: 'all', outlineDist: 1,
    clouds: 26, foam: 2, waterSeg: 1, far: 450, maxPointLights: 8, charOutlineParts: 18, vehicleOutlineParts: 5,
    lambert: false, blobShadows: false,
  },
  ultra: {
    label: 'Ultra', pixelRatioCap: 2, antialias: true, shadows: true, shadowMapSize: 2048, outlines: 'all', outlineDist: 1.3,
    clouds: 40, foam: 2, waterSeg: 1, far: 600, maxPointLights: 8, charOutlineParts: 24, vehicleOutlineParts: 8,
    lambert: false, blobShadows: false,
  },
};
export const PRESET_ORDER = ['low', 'medium', 'high', 'ultra'];
const LS_KEY = 'bto.quality';

/** Read the GPU renderer string on a throwaway WebGL1 context, then release it right away. */
function probeGPU() {
  const out = { vendor: '', renderer: '', maxTex: 0 };
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const gl = c.getContext('webgl', { powerPreference: 'default', failIfMajorPerformanceCaveat: false });
    if (!gl) return out;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    out.vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
    out.renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    out.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // don't hold a context slot (iOS caps them)
  } catch (_) {}
  return out;
}

/** Auto-detect a preset from the device. Returns { preset, reason, info }. */
export function detectQuality() {
  const nav = navigator;
  const ua = nav.userAgent || '';
  const touch = 'ontouchstart' in window || (nav.maxTouchPoints || 0) > 0;
  const iPadOS = /Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1;
  const iOS = /iPhone|iPad|iPod/.test(ua) || iPadOS;
  const iPhone = /iPhone|iPod/.test(ua);
  const android = /Android/.test(ua);
  const mem = nav.deviceMemory || null; // Chrome/Android only
  const cores = nav.hardwareConcurrency || null;
  const dpr = window.devicePixelRatio || 1;
  const sw = Math.min(screen.width || 0, screen.height || 0);
  const sh = Math.max(screen.width || 0, screen.height || 0);
  const gpu = probeGPU();
  const r = gpu.renderer.toLowerCase();
  const software = /swiftshader|llvmpipe|softpipe|software|microsoft basic/.test(r);
  const integrated = /intel|uhd|iris|mali|adreno [1-5]\d\d|powervr|videocore/.test(r);
  const discrete = /nvidia|geforce|rtx|gtx|radeon|amd|apple m\d|apple gpu/.test(r) && !integrated;
  const info = { ua: ua.slice(0, 120), touch, iOS, iPhone, android, mem, cores, dpr, screen: [sw, sh], gpu: gpu.renderer, software };
  let preset, reason;
  if (software) { preset = 'low'; reason = 'software renderer'; }
  else if (iPhone) {
    // Small/older iPhones (SE / mini width ≤ 375 pt) or iOS < 16 → low; others medium. Never higher:
    // DPR 3 panels make fill-rate the bottleneck and Safari kills the page on memory pressure.
    const m = ua.match(/OS (\d+)_/);
    const iosMajor = m ? +m[1] : 0;
    if (sw <= 375 || (iosMajor && iosMajor < 16)) { preset = 'low'; reason = `iPhone small/old (${sw}pt, iOS ${iosMajor || '?'})`; }
    else { preset = 'medium'; reason = `iPhone (${sw}pt, iOS ${iosMajor || '?'})`; }
  } else if (iOS) { preset = 'medium'; reason = 'iPad'; }
  else if (android || (touch && sh < 1100)) {
    preset = (mem && mem <= 4) || (cores && cores <= 4) || /mali-[gt]?[1-7]\d|adreno [1-5]\d\d/.test(r) ? 'low' : 'medium';
    reason = `Android/touch (mem ${mem ?? '?'} GB, ${cores ?? '?'} cores)`;
  } else if (discrete) { preset = 'high'; reason = 'discrete GPU'; }
  else if (integrated) { preset = 'medium'; reason = 'integrated GPU'; }
  else if ((mem && mem <= 4) || (cores && cores < 4)) { preset = 'medium'; reason = 'small desktop (unknown GPU)'; }
  else { preset = 'high'; reason = 'desktop'; }
  return { preset, reason, info };
}

/** Resolve the active preset: URL override > saved choice > auto. */
export function resolveQuality() {
  const auto = detectQuality();
  let source = 'auto', name = auto.preset;
  let saved = null;
  try { saved = localStorage.getItem(LS_KEY); } catch (_) {}
  if (saved && PRESETS[saved]) { name = saved; source = 'saved'; }
  const m = /[?&]quality=(low|medium|high|ultra)\b/.exec(window.location.search);
  if (m) { name = m[1]; source = 'url'; }
  return { name, source, auto, saved: saved || 'auto', preset: PRESETS[name], shade: resolveShading(PRESETS[name], auto) };
}

/**
 * good-1+5 shading path, fixed for the life of the page (materials are built with it):
 *   ?shade=toon|lambert   override
 *   touch / iOS device    lambert (cheap mobile path, never live shadow maps)
 *   otherwise             the preset's `lambert` knob (low/medium yes, high/ultra no)
 * Blob/contact shadows: ?blobs=0|1 override, else on whenever the Lambert path is on or the preset asks.
 */
export function resolveShading(preset, auto) {
  const qs = window.location.search;
  const u = /[?&]shade=(toon|lambert)\b/.exec(qs);
  const mobile = !!(auto?.info?.touch || auto?.info?.iOS);
  let lambert, reason;
  if (u) { lambert = u[1] === 'lambert'; reason = 'url'; }
  else if (mobile) { lambert = true; reason = 'touch/iOS device'; }
  else { lambert = !!preset.lambert; reason = 'preset'; }
  const b = /[?&]blobs=([01])\b/.exec(qs);
  return { lambert, reason, mobile, blobs: b ? b[1] === '1' : null };
}

export function saveQualityChoice(choice) {
  try {
    if (choice === 'auto') localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, choice);
  } catch (_) {}
}

/** Settings that must be known before anything is toonified / built. */
export function applyPreBuild(q, shade) {
  if (shade) setShadingPath(shade.lambert);
  OUTLINE_CLASSES.char.maxPer = q.charOutlineParts;
  OUTLINE_CLASSES.vehicle.maxPer = q.vehicleOutlineParts;
  setToonQuality({ outlines: q.outlines, dist: q.outlineDist, clouds: q.clouds, foam: q.foam });
}

/**
 * Live controller: applies a preset to the running game and keeps the nearest-N point lights on.
 * Anti-aliasing and outline part budgets are fixed at context / character creation and apply on reload.
 */
export class QualityController {
  constructor(game, resolved) {
    this.game = game;
    this.name = resolved.name;
    this.source = resolved.source;
    this.auto = resolved.auto;
    this.q = resolved.preset;
    this._lightT = 0;
    this._v = new THREE.Vector3();
    this._shadowSetup = false;
    this._builtWith = { antialias: resolved.preset.antialias, charOutlineParts: resolved.preset.charOutlineParts };
    this.shade = resolved.shade || { lambert: SHADE.lambert, reason: 'n/a', mobile: false, blobs: null };
  }

  /** Apply everything that can change live. Returns a list of settings that need a reload. */
  apply(name) {
    if (name && PRESETS[name]) { this.name = name; this.q = PRESETS[name]; }
    const g = this.game, q = this.q;
    const r = g.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatioCap));
    g._onResize?.();
    const cam = g.player.camera;
    cam.far = q.far; cam.updateProjectionMatrix();
    g.world.dayNight.setDrawDistance?.(q.far);
    g.world.setDrawDistance?.(q.far, q.waterSeg); // good-1+11 ocean tile
    g.streamer?.setPreset(this.name); // good-1+11 chunk ring radius + build budget
    setToonQuality({ outlines: q.outlines, dist: q.outlineDist, clouds: q.clouds, foam: q.foam });
    // good-1+5: the Lambert (mobile) path never runs a live shadow map; blob decals stand in.
    this._setShadows(this.liveShadows, q.shadowMapSize || 1024);
    g.blobs?.setEnabled(this.blobsOn);
    this._lightT = 0; this.updateLights(true);
    document.documentElement.dataset.quality = this.name;
    const reload = [];
    if (!!q.lambert !== this.shade.lambert && !this.shade.mobile && this.shade.reason !== 'url') reload.push('shading');
    if (q.antialias !== this._builtWith.antialias) reload.push('anti-aliasing');
    if (q.charOutlineParts !== this._builtWith.charOutlineParts) reload.push('character outlines');
    return reload;
  }

  get liveShadows() { return !!this.q.shadows && !this.shade.lambert; }
  get blobsOn() { return this.shade.blobs ?? (this.shade.lambert || !!this.q.blobShadows); }

  /** good-1+5: on the mobile path nothing casts or receives (no shadow programs, no shadow pass). */
  stripShadowFlags() {
    let n = 0;
    this.game.scene.traverse((o) => { if (o.isMesh && (o.castShadow || o.receiveShadow)) { o.castShadow = false; o.receiveShadow = false; n++; } });
    return n;
  }

  _setShadows(on, size) {
    const g = this.game, r = g.renderer;
    const sun = g.world.dayNight.lights?.sun;
    if (!sun) return;
    if (on && !this._shadowSetup) {
      this._shadowSetup = true;
      g.scene.add(sun.target);
      const sc = sun.shadow.camera;
      sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 260;
      sc.updateProjectionMatrix();
      sun.shadow.bias = -0.0025;
      sun.shadow.normalBias = 0.12;
      // Casters: buildings, props, vehicles, characters. Receivers: everything lit.
      g.scene.traverse((o) => {
        if (!o.isMesh || o.userData?.isOutline) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!m || m.isShaderMaterial || m.isMeshBasicMaterial) return;
        o.receiveShadow = true;
        if (o.geometry?.type !== 'PlaneGeometry' && !o.userData?.noCast) o.castShadow = true;
      });
    }
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    if (r.shadowMap.enabled !== on) {
      r.shadowMap.enabled = on;
      r.shadowMap.type = THREE.PCFShadowMap;
      g.scene.traverse((o) => {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) m.needsUpdate = true;
      });
    }
    sun.castShadow = on;
  }

  /** Per frame: shadow camera follows the player; nearest-N point lights (count stays constant => no recompiles). */
  update(dt) {
    const g = this.game, q = this.q;
    if (this.liveShadows) {
      const sun = g.world.dayNight.lights.sun;
      const p = g.player.position;
      // dayNight.apply() records the sun direction; re-centre the light (and its shadow camera) on the player.
      this._v.copy(sun.userData.dir || sun.position).normalize();
      sun.target.position.set(p.x, 0, p.z);
      sun.position.set(p.x + this._v.x * 140, this._v.y * 140, p.z + this._v.z * 140);
      sun.target.updateMatrixWorld();
    }
    this._lightT -= dt;
    if (this._lightT <= 0) {
      this.updateLights();
      // Characters/vehicles load or swap after the preset was applied: keep them casting.
      if (this.shade.lambert) for (const root of [g.player.mesh, ...(g.vehicles || []).map((v) => v.mesh)]) {
        root?.traverse?.((o) => { if (o.isMesh && (o.castShadow || o.receiveShadow)) { o.castShadow = false; o.receiveShadow = false; } });
      }
      if (this.liveShadows) for (const root of [g.player.mesh, ...(g.vehicles || []).map((v) => v.mesh)]) {
        root?.traverse?.((o) => { if (o.isMesh && !o.userData?.isOutline && !o.castShadow) { o.castShadow = true; o.receiveShadow = true; } });
      }
    }
  }

  updateLights(force = false) {
    this._lightT = 0.5;
    const lights = this.game.world.realLights || [];
    const N = this.q.maxPointLights;
    if (!force && lights.length <= N && lights.every((l) => l.visible)) return;
    const cp = this.game.player.camera.position;
    const order = lights.map((l, i) => [i, l.position.distanceToSquared(cp)]).sort((a, b) => a[1] - b[1]);
    order.forEach(([i], rank) => { lights[i].visible = rank < N; });
  }

  stats() {
    const lights = this.game.world.realLights || [];
    return { name: this.name, source: this.source, auto: this.auto.preset, autoReason: this.auto.reason,
      pointLightsOn: lights.filter((l) => l.visible).length, ...this.q,
      shading: this.shade.lambert ? 'lambert' : 'toon', shadingReason: this.shade.reason, liveShadows: this.liveShadows, blobs: this.blobsOn };
  }
}
