import * as THREE from 'three';

/**
 * belizetriniOPNWRLD — robust renderer creation + WebGL context-loss handling (good-1+2).
 *
 * Why: the old code called `new THREE.WebGLRenderer({antialias, powerPreference:'high-performance'})`
 * once and, on ANY throw, painted "WebGL unavailable". three r170 only ever asks the canvas for
 * 'webgl2' and throws when that returns null, so a single refused attribute set (antialias / perf
 * caveat / memory pressure on iOS Safari) killed the game.
 *
 * WebGL1: three r163+ removed WebGL1 from WebGLRenderer — passing a WebGLRenderingContext throws
 * "WebGL 1 is not supported since r163" (public/vendor/three/three.module.js). A real WebGL1 path
 * would mean shipping a second, older three build, so instead we:
 *   1. retry WebGL2 with progressively relaxed attributes, each on a FRESH canvas (a canvas that
 *      handed out a context once is locked to it),
 *   2. if every attempt fails, probe WebGL1 only to explain WHY (WebGL1 works but WebGL2 does not ⇒
 *      old iOS / WebGL2 disabled), and show a clear in-page message with the reason + Retry button.
 */

export const ATTEMPTS = [
  { label: 'webgl2-default', attrs: { antialias: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false } },
  { label: 'webgl2-relaxed', attrs: { antialias: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false } },
  { label: 'webgl2-minimal', attrs: { antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false, stencil: false, depth: true, preserveDrawingBuffer: false } },
];

function freshCanvas(old) {
  const c = document.createElement('canvas');
  c.id = old.id;
  c.className = old.className;
  if (old.getAttribute('style')) c.setAttribute('style', old.getAttribute('style'));
  old.replaceWith(c);
  return c;
}

/** Explain why no WebGL2 context could be made (best-effort, on a throwaway canvas). */
export function diagnoseWebGL(creationErrors = []) {
  const out = { webgl2: false, webgl1: false, reasons: creationErrors.filter(Boolean) };
  try {
    const c = document.createElement('canvas');
    c.addEventListener('webglcontextcreationerror', (e) => e.statusMessage && out.reasons.push(e.statusMessage));
    out.webgl2 = !!c.getContext('webgl2');
  } catch (e) { out.reasons.push(String(e.message || e)); }
  try {
    const c = document.createElement('canvas');
    out.webgl1 = !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch (_) {}
  const ua = navigator.userAgent || '';
  const iosM = ua.match(/OS (\d+)_\d+(?:_\d+)? like Mac OS X/);
  out.ios = iosM ? +iosM[1] : null;
  if (!out.webgl2 && out.webgl1) {
    out.summary = out.ios && out.ios < 15
      ? `This iPhone/iPad runs iOS ${out.ios}; the game needs WebGL 2 (iOS 15 or newer).`
      : 'This browser only offers WebGL 1; the game needs WebGL 2.';
  } else if (!out.webgl2 && !out.webgl1) {
    out.summary = out.ios
      ? 'Safari refused to create any WebGL context. Lockdown Mode, Screen Time content limits or low memory can disable WebGL.'
      : 'The browser refused to create any WebGL context (hardware acceleration off, GPU blocklisted, or too many open 3D tabs).';
  } else {
    out.summary = 'WebGL 2 is available but refused the renderer’s settings (often memory pressure — close other tabs and retry).';
  }
  return out;
}

export function showGfxError(title, detail, extra = '') {
  document.getElementById('gfx-error')?.remove();
  const note = document.createElement('div');
  note.id = 'gfx-error';
  note.setAttribute('role', 'alert');
  note.style.cssText =
    'position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:#050510;color:#f72585;padding:2rem;text-align:center;font-family:sans-serif';
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  note.innerHTML =
    `<div style="max-width:30rem"><h1 style="font-size:1.4rem">belizetriniOPNWRLD</h1><p style="color:#fff">${esc(title)}</p>` +
    `<p style="color:#aab">${esc(detail)}</p>${extra ? `<p style="color:#667;font-size:.75rem">${esc(extra)}</p>` : ''}` +
    '<button type="button" id="gfx-retry" style="margin-top:1rem;padding:.7rem 1.4rem;border:0;border-radius:.5rem;background:#f72585;color:#fff;font-weight:700">Retry</button></div>';
  document.body.appendChild(note);
  note.querySelector('#gfx-retry')?.addEventListener('click', () => window.location.reload());
  return note;
}

/**
 * Create a WebGLRenderer, trying each attempt on a fresh canvas.
 * opts.antialias:false skips straight past the AA attempt (low quality presets).
 * Returns { renderer, canvas, attempt, tried } or throws after showing the in-page message.
 */
export function createRendererRobust(canvas, opts = {}) {
  const tried = [];
  const creationErrors = [];
  let list = ATTEMPTS;
  if (opts.antialias === false) list = ATTEMPTS.filter((a) => !a.attrs.antialias);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (i > 0 || canvas.__used) canvas = freshCanvas(canvas);
    canvas.__used = true;
    const onErr = (e) => creationErrors.push(e.statusMessage || '');
    canvas.addEventListener('webglcontextcreationerror', onErr);
    try {
      const renderer = new THREE.WebGLRenderer({ canvas, ...a.attrs });
      canvas.removeEventListener('webglcontextcreationerror', onErr);
      tried.push({ label: a.label, ok: true });
      renderer.__gfxAttempt = a.label;
      return { renderer, canvas, attempt: a.label, tried };
    } catch (err) {
      canvas.removeEventListener('webglcontextcreationerror', onErr);
      tried.push({ label: a.label, ok: false, error: String(err?.message || err) });
    }
  }
  const d = diagnoseWebGL(creationErrors);
  window.__GFX_DIAG__ = { tried, ...d };
  showGfxError('3D graphics could not start on this device.', d.summary,
    `Tried: ${tried.map((t) => t.label).join(', ')}${d.reasons.length ? ' · ' + d.reasons.join(' · ') : ''}`);
  const e = new Error('WebGL2 renderer could not be created: ' + d.summary);
  e.gfxHandled = true;
  throw e;
}

// ─── Standalone toast (visible on the title screen too, unlike the HUD toast) ───────
let _toastEl = null, _toastT = 0;
export function gfxToast(text, ms = 2600) {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.id = 'gfx-toast';
    _toastEl.style.cssText = 'position:fixed;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);z-index:250;' +
      'background:rgba(10,12,24,.86);color:#fff;font:600 14px/1.3 sans-serif;padding:.55rem 1rem;border-radius:999px;pointer-events:none;transition:opacity .25s';
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = text;
  _toastEl.style.opacity = '1';
  clearTimeout(_toastT);
  if (ms > 0) _toastT = setTimeout(() => { _toastEl.style.opacity = '0'; }, ms);
}

/**
 * Shader self-heal: any material whose program failed to compile/link on this GPU (diagnostics
 * runnable === false) is swapped for a plain MeshLambert/MeshBasic stand-in of the same colour, so a
 * driver quirk degrades one effect instead of blanking the frame. Returns the number healed.
 */
export function healShaderFailures(renderer, scene) {
  let healed = 0;
  const fallbackCache = new Map();
  const fallbackFor = (m) => {
    if (fallbackCache.has(m)) return fallbackCache.get(m);
    let f;
    if (m.userData?.outline || m.userData?.isOutline) {
      f = new THREE.MeshBasicMaterial({ color: 0x1d2433, side: THREE.BackSide });
      f.visible = false; // an outline hull without its shader would be a solid blob: hide it instead
    } else if (m.isShaderMaterial) {
      const c = m.uniforms?.uColor?.value || m.uniforms?.uTop?.value || m.uniforms?.uLit?.value;
      f = new THREE.MeshBasicMaterial({ color: c ? c.clone() : new THREE.Color(0x88aacc), side: m.side, fog: true });
      if (m.uniforms?.uTop) f.depthWrite = false;
    } else {
      f = new THREE.MeshLambertMaterial({ color: m.color ? m.color.clone() : 0xcccccc, map: m.map || null,
        transparent: m.transparent, opacity: m.opacity, side: m.side, vertexColors: m.vertexColors });
    }
    f.name = (m.name || m.type) + ':fallback';
    f.userData.fallbackOf = m.type;
    fallbackCache.set(m, f);
    return f;
  };
  const bad = (m) => {
    const p = renderer.properties.get(m)?.currentProgram;
    return !!(p && p.diagnostics && p.diagnostics.runnable === false);
  };
  scene.traverse((o) => {
    if (!o.material) return;
    if (Array.isArray(o.material)) {
      if (o.material.some(bad)) { o.material = o.material.map((m) => (bad(m) ? fallbackFor(m) : m)); healed++; }
    } else if (bad(o.material)) { o.material = fallbackFor(o.material); healed++; }
  });
  return healed;
}

/**
 * Context loss / restore. preventDefault on loss (required for the browser to ever restore), pause
 * the loop, and on restore let `onRestore` re-upload / re-apply state, then resume.
 * If no restore arrives (iOS sometimes never fires it), ask WEBGL_lose_context to restore; after
 * `giveUpMs` show the in-page message with a Reload button.
 */
export function watchContext(renderer, { onLost, onRestore, giveUpMs = 12000 } = {}) {
  const canvas = renderer.domElement;
  const state = { lost: false, losses: 0, restores: 0, lostAt: 0 };
  let kick = 0, giveUp = 0;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    state.lost = true; state.losses++; state.lostAt = performance.now();
    gfxToast('Graphics paused — restoring…', 0);
    onLost?.(e);
    clearTimeout(kick); clearTimeout(giveUp);
    kick = setTimeout(() => {
      if (!state.lost) return;
      try { renderer.getContext().getExtension('WEBGL_lose_context')?.restoreContext(); } catch (_) {}
    }, 2500);
    giveUp = setTimeout(() => {
      if (state.lost) showGfxError('Graphics were reset by the device and did not come back.', 'This happens on phones under memory pressure. Reload to continue.');
    }, giveUpMs);
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    state.lost = false; state.restores++;
    clearTimeout(kick); clearTimeout(giveUp);
    document.getElementById('gfx-error')?.remove();
    try { onRestore?.(); } finally { gfxToast('Graphics restored', 1800); }
  }, false);
  return state;
}

/**
 * Pointer lock that never throws: Safari returns a Promise that rejects (WrongDocumentError when the
 * window is unfocused, NotSupportedError on iOS) and older engines throw synchronously; either used
 * to surface as an uncaught error. Touch-only devices skip it entirely.
 */
export function safePointerLock(el) {
  try {
    if (!el?.requestPointerLock) return;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches;
    if (coarse) return;
    const p = el.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {}
}
