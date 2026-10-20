import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * belizetriniOPNWRLD — shared Wind Waker-style toon system (good-1+1).
 *
 *  - Banded gradient ramps (MeshToonMaterial.gradientMap) whose shadow level follows the sky state.
 *  - A soft banded rim/sky light injected with onBeforeCompile (one program per ramp, shared).
 *  - Inverted-hull outlines: a BackSide copy of the mesh (smoothed normals) pushed out along its
 *    normals in the vertex shader. Width is ~constant in pixels, capped per class so small meshes
 *    are never swallowed, and faded to zero with distance. Tiny / far owners get no outline draw.
 *  - Wind Waker sky: gradient dome + sun/moon disks (one shader) and puffy cel cloud cards
 *    (one InstancedMesh, billboarded in the vertex shader).
 *  - Stylised water: flat colour, gentle vertex wave, animated world-space foam bands at the shore
 *    and around piers (box SDFs + value noise, no textures).
 *
 * Kill switch: append ?toon=0 to the URL to get the pre-good-1+1 look (MeshStandard world, old sky).
 */

export const TOON_ON = (() => {
  try { return !/[?&]toon=0\b/.test(window.location.search); } catch (_) { return true; }
})();

// ─── Shared uniforms (one object each, referenced by every material) ─────────────
export const U = {
  uTime: { value: 0 },
  uRimColor: { value: new THREE.Color(0xbfe4ff) },
  uRimStrength: { value: 0.22 },
  uOutlineColor: { value: new THREE.Color(0x1d2433) },
};

// ─── Gradient ramps ────────────────────────────────────────────────────────────
function makeRamp(levels) {
  const data = new Uint8Array(levels.length * 4);
  const tex = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.userData.pattern = levels.slice();
  setRamp(tex, 1);
  return tex;
}
/** pattern entries: 's' shadow, 'm' mid, 'l' lit. shadow/mid levels scale with the sky state. */
function setRamp(tex, shadowLevel, midLevel) {
  const lv = { s: shadowLevel, m: midLevel ?? (shadowLevel + 1) / 2, l: 1 };
  const p = tex.userData.pattern;
  for (let i = 0; i < p.length; i++) {
    const v = Math.round(THREE.MathUtils.clamp(lv[p[i]] ?? 1, 0, 1) * 255);
    tex.image.data.set([v, v, v, 255], i * 4);
  }
  tex.needsUpdate = true;
}
// World: crisp 3-band (shadow / thin terminator band / lit). coord = N·L*0.5+0.5 over 5 texels.
export const RAMP_WORLD = makeRamp(['s', 's', 'm', 'l', 'l']);
// Characters: softer 3-band — a wider mid band so faces and skin never go hard black-and-white.
export const RAMP_SKIN = makeRamp(['s', 'm', 'm', 'm', 'l', 'l']);

// ─── Toon materials ────────────────────────────────────────────────────────────
function installRim(mat, key) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = U.uRimColor;
    shader.uniforms.uRimStrength = U.uRimStrength;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;')
      .replace(
        '#include <opaque_fragment>',
        [
          '{',
          '  float rimT = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);',
          '  float rimBand = smoothstep(0.7, 0.74, rimT);', // banded, not a soft Fresnel smear
          '  float skyFacing = 0.55 + 0.45 * clamp(normal.y, 0.0, 1.0);',
          '  outgoingLight += uRimColor * uRimStrength * rimBand * skyFacing * (0.35 + 0.65 * diffuseColor.rgb);',
          '}',
          '#include <opaque_fragment>',
        ].join('\n')
      );
  };
  mat.customProgramCacheKey = () => 'toonrim-' + key;
}

/** New toon material (flat albedo + banded ramp + rim). */
export function toonMaterial(color, opts = {}) {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: opts.ramp || RAMP_WORLD,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    map: opts.map || null,
    side: opts.side ?? THREE.FrontSide,
    vertexColors: !!opts.vertexColors,
  });
  if (opts.emissive != null) mat.emissive.set(opts.emissive);
  // Rim only on characters / vehicles (curved, small). On big flat walls and ground a view-angle rim
  // turns into a smeared gradient across the face, so world materials skip it (hemi light = sky fill).
  if (opts.rim) installRim(mat, opts.ramp === RAMP_SKIN ? 'skin' : 'world');
  mat.userData.toon = true;
  return mat;
}

const _convCache = new Map();
/** Convert a lit material (Standard/Physical/Phong/Lambert) to toon. Cached per source material. */
export function convertMaterial(src, opts = {}) {
  if (!src || src.userData?.toon) return src;
  if (!(src.isMeshStandardMaterial || src.isMeshPhongMaterial || src.isMeshLambertMaterial)) return src;
  const key = src.uuid + (opts.ramp === RAMP_SKIN ? ':s' : ':w');
  if (_convCache.has(key)) return _convCache.get(key);
  const color = src.color ? src.color.clone() : new THREE.Color(0xffffff);
  if (opts.recolor) opts.recolor(color, src);
  const m = toonMaterial(color, {
    rim: opts.rim ?? true,
    ramp: opts.ramp,
    transparent: src.transparent,
    opacity: src.opacity,
    map: src.map,
    side: src.side,
    vertexColors: src.vertexColors,
    emissive: src.emissive && src.emissive.getHex() ? src.emissive : null,
  });
  m.name = (src.name || '') + ':toon';
  _convCache.set(key, m);
  return m;
}

// ─── Inverted-hull outlines ────────────────────────────────────────────────────
// px = target width in pixels near the camera, max = cap in metres (keeps thin parts readable),
// minR = owners with a smaller bounding radius never get an outline, near/far = distance fade.
export const OUTLINE_CLASSES = {
  building: { px: 1.7, max: 0.07, minR: 0.6, near: 55, far: 150, minScreen: 0.012 },
  prop: { px: 1.3, max: 0.03, minR: 0.6, near: 25, far: 60, minScreen: 0.014 },
  vehicle: { px: 1.4, max: 0.028, minR: 0.25, near: 30, far: 70, minScreen: 0.01, maxPer: 5 },
  char: { px: 1.1, max: 0.011, minR: 0.06, near: 12, far: 38, minScreen: 0.004, maxPer: 18 },
};

const _outlineMats = {};
function outlineMaterial(klass, batched = false) {
  const mkey = klass + (batched ? ':b' : '');
  if (_outlineMats[mkey]) return _outlineMats[mkey];
  const c = OUTLINE_CLASSES[klass];
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uPxK: { value: c.px * 0.0024 }, // world width per metre of distance ≈ px at ~500 px viewport height, fov 60
    uMaxW: { value: c.max },
    uNear: { value: c.near },
    uFar: { value: c.far },
  }]);
  uniforms.uColor = U.uOutlineColor;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    side: THREE.BackSide,
    defines: batched ? { BATCHED_BOX: 1 } : {},
    vertexShader: /* glsl */`
      uniform float uPxK; uniform float uMaxW; uniform float uNear; uniform float uFar;
      varying float vFade;
      #ifdef BATCHED_BOX
        attribute vec3 aBoxMin; attribute vec3 aBoxMax;
      #endif
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        #ifdef BATCHED_BOX
          // Camera inside (or touching) this hull's owner: drop its hull, or the back faces would flood the view.
          if (all(greaterThan(cameraPosition, aBoxMin - 0.35)) && all(lessThan(cameraPosition, aBoxMax + 0.35))) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vFade = 0.0; return;
          }
        #endif
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vec3 wn = normalize(mat3(m) * normal);
        float d = distance(wp.xyz, cameraPosition);
        float fade = 1.0 - smoothstep(uNear, uFar, d);
        wp.xyz += wn * min(uPxK * d, uMaxW) * fade;
        vFade = fade;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vFade;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        if (vFade < 0.02) discard;
        gl_FragColor = vec4(uColor, 1.0);
        #include <fog_fragment>
      }`,
  });
  mat.userData.outline = true;
  _outlineMats[mkey] = mat;
  return mat;
}

const _hullGeo = new Map();
function hullGeometry(geo) {
  if (_hullGeo.has(geo.uuid)) return _hullGeo.get(geo.uuid);
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position'));
  if (geo.index) g.setIndex(geo.index);
  // Weld split vertices (box corners) so the pushed hull stays closed, then smooth normals.
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  _hullGeo.set(geo.uuid, g);
  return g;
}

const _outlines = []; // { line, owner, klass, r, static, wp }
const _stats = { outlines: 0, skippedTiny: 0, visible: 0 };
export function outlineStats() {
  const byClass = {};
  for (const e of _outlines) {
    const b = (byClass[e.klass] = byClass[e.klass] || { n: 0, vis: 0, tris: 0 });
    b.n++;
    if (e.line.visible) { b.vis++; const g = e.line.geometry; b.tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3 * (e.line.isInstancedMesh ? e.line.count : 1); }
  }
  return { ..._stats, registered: _outlines.length, byClass };
}

function ownerRadius(mesh) {
  const g = mesh.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  const s = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false);
  mesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  return g.boundingSphere.radius * Math.max(s.x, s.y, s.z);
}

/** Attach an inverted-hull outline to `mesh`. Returns the outline mesh or null when skipped. */
export function addOutline(mesh, klass = 'prop', opts = {}) {
  if (!TOON_ON || !mesh?.isMesh || mesh.userData.outlineMesh || mesh.userData.noOutline) return null;
  const c = OUTLINE_CLASSES[klass];
  const g = mesh.geometry;
  if (!g?.getAttribute('position')) return null;
  const r = mesh.isInstancedMesh ? Infinity : ownerRadius(mesh);
  if (!mesh.isInstancedMesh && r < (opts.minR ?? c.minR)) { _stats.skippedTiny++; return null; }
  const hg = hullGeometry(g);
  let line;
  if (mesh.isInstancedMesh) {
    line = new THREE.InstancedMesh(hg, outlineMaterial(klass), mesh.count);
    line.instanceMatrix = mesh.instanceMatrix; // share transforms
    line.frustumCulled = false;
  } else {
    line = new THREE.Mesh(hg, outlineMaterial(klass));
  }
  line.name = (mesh.name || 'mesh') + ':outline';
  line.userData.isOutline = true;
  line.raycast = () => {};
  line.renderOrder = mesh.renderOrder + 2; // after the front faces, so hull pixels behind them are depth-rejected
  mesh.add(line);
  mesh.userData.outlineMesh = line;
  _outlines.push({ line, owner: mesh, klass, r, isStatic: !!opts.isStatic, wp: null });
  _stats.outlines++;
  return line;
}

/**
 * Static world outlines, batched: every static mesh's hull is baked into world space and merged into
 * ONE mesh per class, so ~200 building/prop outlines cost 1-2 draw calls. Far fade stays per-vertex.
 * Returns the merged meshes (already added to `parent`).
 */
export function buildStaticOutlines(meshes, parent) {
  if (!TOON_ON) return [];
  const groups = {};
  for (const { mesh, klass } of meshes) {
    const c = OUTLINE_CLASSES[klass];
    if (ownerRadius(mesh) < c.minR) { _stats.skippedTiny++; continue; }
    mesh.updateWorldMatrix(true, false);
    const g = hullGeometry(mesh.geometry).clone();
    g.applyMatrix4(mesh.matrixWorld);
    g.computeBoundingBox();
    const n = g.getAttribute('position').count;
    const bmin = new Float32Array(n * 3), bmax = new Float32Array(n * 3);
    const { min, max } = g.boundingBox;
    for (let i = 0; i < n; i++) { bmin.set([min.x, min.y, min.z], i * 3); bmax.set([max.x, max.y, max.z], i * 3); }
    g.setAttribute('aBoxMin', new THREE.BufferAttribute(bmin, 3));
    g.setAttribute('aBoxMax', new THREE.BufferAttribute(bmax, 3));
    (groups[klass] = groups[klass] || []).push(g);
  }
  const out = [];
  for (const [klass, list] of Object.entries(groups)) {
    const merged = mergeGeometries(list, false);
    list.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const line = new THREE.Mesh(merged, outlineMaterial(klass, true));
    line.name = 'staticOutlines:' + klass;
    line.userData.isOutline = true;
    line.userData.batched = list.length;
    line.raycast = () => {};
    line.renderOrder = 2;
    line.matrixAutoUpdate = false;
    parent.add(line);
    _stats.outlines += list.length;
    _stats.batches = (_stats.batches || 0) + 1;
    out.push(line);
  }
  return out;
}

function isOutlinable(o) {
  if (!o.isMesh || o.userData.isOutline || o.userData.noOutline) return false;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  return mats.every((m) => m && m.userData?.toon && !m.transparent);
}

/**
 * Convert every lit material under `root` to toon, then outline what is big enough.
 * opts: { klass, ramp, outline (default true), isStatic, recolor, minR }
 */
export function toonify(root, opts = {}) {
  if (!TOON_ON || !root) return root;
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline) return;
    if (Array.isArray(o.material)) o.material = o.material.map((m) => convertMaterial(m, opts));
    else o.material = convertMaterial(o.material, opts);
    meshes.push(o);
  });
  if (opts.outline !== false) {
    const klass = opts.klass || 'prop';
    let cand = meshes.filter(isOutlinable);
    // Budget: per object only the N biggest parts carry a hull (silhouette-defining pieces).
    const maxPer = opts.maxPer ?? OUTLINE_CLASSES[klass].maxPer;
    if (maxPer && cand.length > maxPer) {
      const rr = new Map(cand.map((o) => [o, ownerRadius(o)]));
      cand.sort((a, b) => rr.get(b) - rr.get(a));
      _stats.skippedTiny += cand.length - maxPer;
      cand = cand.slice(0, maxPer);
    }
    for (const o of cand) addOutline(o, klass, opts);
  }
  return root;
}

/** Remove outline bookkeeping for a disposed subtree (character swaps). */
export function forgetOutlines(root) {
  if (!root) return;
  const set = new Set();
  root.traverse((o) => { if (o.userData?.isOutline) set.add(o); });
  for (let i = _outlines.length - 1; i >= 0; i--) {
    if (set.has(_outlines[i].line)) { _outlines.splice(i, 1); _stats.outlines--; }
  }
}

// ─── Wind Waker sky: gradient dome + sun / moon disks + cel cloud cards ───────────
export function createToonSky(scene) {
  const group = new THREE.Group();
  group.name = 'toonSky';
  const skyU = {
    uTop: { value: new THREE.Color(0x2f86d8) },
    uHorizon: { value: new THREE.Color(0xbfe0f4) },
    uBottom: { value: new THREE.Color(0xbfe0f4) },
    uSunDir: { value: new THREE.Vector3(0.2, 0.9, 0.1).normalize() },
    uSunColor: { value: new THREE.Color(0xfff6d8) },
    uSunVis: { value: 1 },
    uMoonDir: { value: new THREE.Vector3(-0.4, 0.8, 0.3).normalize() },
    uMoonVis: { value: 0 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyU,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true, // drawn LAST in the opaque pass: early-z skips every pixel the city covers
    fog: false,
    vertexShader: /* glsl */`
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
      varying vec3 vDir; varying vec3 vCol;
      void main() {
        vDir = normalize(position);
        float h = vDir.y;
        // Smooth Wind Waker gradient (per vertex; 32x24 dome is plenty): pale horizon -> saturated zenith.
        float t = pow(smoothstep(0.0, 0.75, h), 0.65);
        // (edge0 < edge1 always: smoothstep with reversed edges is undefined in GLSL ES and differs per driver)
        vCol = mix(mix(uHorizon, uTop, t), uBottom, 1.0 - smoothstep(-0.12, 0.0, h));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunVis;
      uniform vec3 uMoonDir; uniform float uMoonVis;
      varying vec3 vDir; varying vec3 vCol;
      void main() {
        vec3 col = vCol;
        // Sun: hard disk + two flat halo rings (cel steps, not a bloom smear). Cheap reject first.
        // Edges are chord distances |d - sunDir| (= sqrt(2(1-cos))) instead of cosines like 0.99955,
        // so they stay resolvable at any float precision (iOS-safe; same rings as good-1+1).
        if (uSunVis > 0.0 && dot(vDir, uSunDir) > 0.98) {
          float sq = length(normalize(vDir) - uSunDir);
          float disk = 1.0 - smoothstep(0.0300, 0.0361, sq);
          float in1 = 1.0 - smoothstep(0.0800, 0.0837, sq);
          float ring1 = in1 * (1.0 - disk);
          float ring2 = (1.0 - smoothstep(0.1649, 0.1673, sq)) * (1.0 - in1);
          col = mix(col, mix(col, uSunColor, 0.45), ring2 * uSunVis * 0.6);
          col = mix(col, mix(col, uSunColor, 0.75), ring1 * uSunVis);
          col = mix(col, vec3(1.0, 0.99, 0.94), disk * uSunVis);
        }
        if (uMoonVis > 0.0 && dot(vDir, uMoonDir) > 0.99) {
          vec3 d = normalize(vDir);
          float m1 = 1.0 - smoothstep(0.0245, 0.0300, length(d - uMoonDir));
          float m2 = 1.0 - smoothstep(0.0245, 0.0300, length(d - normalize(uMoonDir + vec3(0.012, 0.006, 0.0))));
          float moonGlow = 1.0 - smoothstep(0.1058, 0.1095, length(d - uMoonDir));
          col = mix(col, col + vec3(0.06, 0.08, 0.14), moonGlow * uMoonVis);
          col = mix(col, vec3(0.93, 0.95, 1.0), m1 * (1.0 - m2 * 0.85) * uMoonVis);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 24), skyMat);
  dome.name = 'toonSkyDome';
  dome.renderOrder = 1000;
  dome.frustumCulled = false;
  group.add(dome);

  // Clouds: N billboard cards in one draw. Shape = union of discs on a flat base, two-tone cel shading.
  const N = 26;
  const cloudU = {
    uLit: { value: new THREE.Color(0xffffff) },
    uShade: { value: new THREE.Color(0xc9dcf0) },
    uOpacity: { value: 1 },
    uTime: U.uTime,
  };
  const cGeo = new THREE.PlaneGeometry(1, 1);
  const seeds = new Float32Array(N);
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudU,
    transparent: false, // opaque + discard: hard cel edge, and it stays in the (renderOrder-sorted) opaque pass
    depthWrite: true, // so the dome (drawn right after, depth-tested) does not paint over the clouds
    depthTest: true,
    fog: false,
    vertexShader: /* glsl */`
      attribute float aSeed;
      varying vec2 vUv; varying float vSeed;
      uniform float uTime;
      void main() {
        vUv = uv; vSeed = aSeed;
        vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sx = length(instanceMatrix[0].xyz);
        float sy = length(instanceMatrix[1].xyz);
        // slow drift around the dome
        float a = uTime * 0.004 * (0.6 + aSeed);
        vec3 lc = c.xyz - modelMatrix[3].xyz;
        lc.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * lc.xz;
        c.xyz = modelMatrix[3].xyz + lc;
        vec4 mv = viewMatrix * c;
        mv.xy += position.xy * vec2(sx, sy);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uLit; uniform vec3 uShade; uniform float uOpacity;
      varying vec2 vUv; varying float vSeed;
      float disc(vec2 p, vec2 c, float r) { return r - length(p - c); }
      void main() {
        vec2 p = vUv * vec2(2.0, 1.0); // card is 2:1
        float s = vSeed * 6.2831;
        float f = -1.0;
        f = max(f, disc(p, vec2(0.55, 0.38), 0.26 + 0.04 * sin(s)));
        f = max(f, disc(p, vec2(0.92, 0.52), 0.34 + 0.05 * cos(s * 1.3)));
        f = max(f, disc(p, vec2(1.32, 0.46), 0.28 + 0.04 * sin(s * 2.1)));
        f = max(f, disc(p, vec2(1.62, 0.34), 0.2 + 0.03 * cos(s * 0.7)));
        f = max(f, disc(p, vec2(1.1, 0.68), 0.2 * fract(vSeed * 7.0) + 0.05));
        f = min(f, p.y - 0.18);                    // flat Wind Waker base
        f = min(f, min(p.x - 0.12, 1.88 - p.x));
        if (f <= 0.0) discard;
        // two-tone cel: lit cap, flat shaded underside band
        float lit = step(0.3 + 0.05 * sin(p.x * 5.0 + s), p.y);
        vec3 col = mix(uShade, uLit, lit);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const clouds = new THREE.InstancedMesh(cGeo, cloudMat, N);
  const dummy = new THREE.Object3D();
  let rnd = 1337;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rand() * 0.25;
    const rad = 300 + rand() * 60;
    const y = 45 + rand() * 95;
    const w = 70 + rand() * 70;
    dummy.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
    dummy.scale.set(w, w * 0.5, 1);
    dummy.updateMatrix();
    clouds.setMatrixAt(i, dummy.matrix);
    seeds[i] = rand();
  }
  cGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  clouds.instanceMatrix.needsUpdate = true;
  clouds.frustumCulled = false;
  clouds.renderOrder = 999; // before the dome, after the city
  clouds.name = 'toonClouds';
  group.add(clouds);
  scene.add(group);

  const _c = new THREE.Color();
  return {
    group, dome, clouds, skyU, cloudU,
    /** s = dayNight sample; sun/moon = lights */
    apply(s, sunPos, moonPos) {
      const day = THREE.MathUtils.smoothstep(s.sunI, 0.05, 1.2);
      const lowSun = THREE.MathUtils.clamp(1 - sunPos[1] / 60, 0, 1) * THREE.MathUtils.smoothstep(s.sunI, 0.1, 0.6);
      // Horizon band = fog colour (so the far city melts into it), warmed by a low sun at dawn/dusk.
      skyU.uHorizon.value.setHex(s.fogC).lerp(_c.setHex(s.sunC), 0.45 * lowSun);
      skyU.uBottom.value.setHex(s.fogC);
      // Zenith: the keyframe bg pushed deeper and more saturated; cooler violet-blue when the sun is low.
      _c.setHex(s.bg);
      const hsl = {}; _c.getHSL(hsl);
      skyU.uTop.value.setHSL(hsl.h, Math.min(1, hsl.s * 1.05 + 0.08), hsl.l * 0.82);
      skyU.uTop.value.lerp(_c.setHex(0x3b3f8c), 0.55 * lowSun);
      skyU.uSunDir.value.set(sunPos[0], sunPos[1], sunPos[2]).normalize();
      skyU.uSunColor.value.setHex(s.sunC);
      skyU.uSunVis.value = THREE.MathUtils.smoothstep(s.sunI, 0.1, 0.5);
      skyU.uMoonDir.value.copy(moonPos).normalize();
      skyU.uMoonVis.value = THREE.MathUtils.smoothstep(s.moonI, 0.05, 0.35);
      // Clouds: white at noon, sunset-tinted at dusk, dim slate at night.
      cloudU.uLit.value.setHex(0xffffff).lerp(_c.setHex(s.sunC), 0.35 * (1 - day) + 0.05).multiplyScalar(0.35 + 0.65 * day);
      cloudU.uShade.value.copy(skyU.uTop.value).lerp(_c.setHex(s.fogC), 0.55).lerp(_c.setHex(0xffffff), 0.35 * day);
      cloudU.uOpacity.value = 0.55 + 0.45 * day;
    },
    follow(camera) { group.position.copy(camera.position); },
  };
}

// ─── Stylised water ──────────────────────────────────────────────────────────────
const MAX_SHORE = 8;
/** shoreRects: [{minX,minZ,maxX,maxZ}] — land/piers the foam wraps around. */
export function createToonWaterMaterial(color, shoreRects = []) {
  const rects = [];
  for (let i = 0; i < MAX_SHORE; i++) {
    const r = shoreRects[i];
    rects.push(r ? new THREE.Vector4(r.minX, r.minZ, r.maxX, r.maxZ) : new THREE.Vector4(1e5, 1e5, 1e5, 1e5));
  }
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uColor: { value: new THREE.Color(color) },
    uDeep: { value: new THREE.Color(color) },
    uFoam: { value: new THREE.Color(0xffffff) },
    uRects: { value: rects },
    uCount: { value: Math.min(MAX_SHORE, shoreRects.length) },
  }]);
  uniforms.uTime = U.uTime;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec2 vXZ;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        wp.y += sin(wp.x * 0.16 + uTime * 1.1) * 0.05 + sin(wp.z * 0.23 + wp.x * 0.05 + uTime * 1.5) * 0.04;
        vXZ = wp.xz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform vec3 uDeep; uniform vec3 uFoam;
      uniform vec4 uRects[${MAX_SHORE}]; uniform int uCount; uniform float uTime;
      varying vec2 vXZ;
      #include <common>
      #include <fog_pars_fragment>
      float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
      }
      float sdBox(vec2 p, vec4 r) {
        vec2 c = (r.xy + r.zw) * 0.5; vec2 h = (r.zw - r.xy) * 0.5;
        vec2 q = abs(p - c) - h;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
      }
      void main() {
        float d = 1e4;
        for (int i = 0; i < ${MAX_SHORE}; i++) { if (i >= uCount) break; d = min(d, sdBox(vXZ, uRects[i])); }
        d = max(d, 0.0);
        float n = vnoise(vXZ * 0.18 + vec2(uTime * 0.05, uTime * 0.03));
        float n2 = vnoise(vXZ * 0.07 - vec2(uTime * 0.02, 0.0));
        // Flat shallow -> deep step (two tones, Wind Waker style).
        vec3 col = mix(uColor, uDeep, step(14.0 + n2 * 10.0, d));
        // Shore contact foam: a solid wobbling white rim.
        float rim = step(d, 1.4 + n * 1.6);
        // Travelling foam bands parallel to the shore, broken up by noise, fading out to sea.
        float wave = fract(d * 0.17 - uTime * 0.25 + n * 0.6);
        float bands = step(0.8, wave) * (1.0 - smoothstep(5.0, 17.0, d)) * step(0.3, n2 + n * 0.4);
        // Sparse open-water foam flecks (cell pattern).
        vec2 g = vXZ * 0.09 + vec2(uTime * 0.02, -uTime * 0.015);
        float fleck = step(0.93, vnoise(g * 3.1)) * step(0.55, vnoise(g * 0.7 + 3.0)) * smoothstep(10.0, 22.0, d);
        float foam = max(rim, max(bands, fleck * 0.8));
        col = mix(col, uFoam, foam);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.userData.toonWater = true;
  return mat;
}

// ─── Per-frame update ───────────────────────────────────────────────────────────
const _v = new THREE.Vector3();
const _lp = new THREE.Vector3();
const _box = new THREE.Box3();
const _inv = new THREE.Matrix4();
let _sky = null;
export function bindSky(sky) { _sky = sky; }

/** Distance/screen-size culling of outline draws + time uniform + sky follow. */
export function updateToon(camera, dt) {
  if (!TOON_ON) return;
  U.uTime.value += dt;
  if (_sky) _sky.follow(camera);
  const cp = camera.position;
  let vis = 0;
  for (const e of _outlines) {
    if (e.r === Infinity) { vis++; continue; }
    const c = OUTLINE_CLASSES[e.klass];
    if (e.isStatic) {
      if (!e.wp) { e.wp = new THREE.Vector3(); e.owner.getWorldPosition(e.wp); }
      _v.copy(e.wp);
    } else {
      _v.setFromMatrixPosition(e.owner.matrixWorld);
    }
    const d = Math.max(0.001, _v.distanceTo(cp) - e.r);
    let on = d < c.far && (e.r / (d + e.r)) > c.minScreen;
    if (on && _v.distanceTo(cp) < e.r + 0.5) {
      // Camera inside / grazing the owner (e.g. car camera clipping a van): hide its hull.
      const g = e.owner.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      _box.copy(g.boundingBox).expandByScalar(0.3);
      _lp.copy(cp).applyMatrix4(_inv.copy(e.owner.matrixWorld).invert());
      if (_box.containsPoint(_lp)) on = false;
    }
    e.line.visible = on;
    if (on) vis++;
  }
  _stats.visible = vis;
}

/** Called from the day/night apply(): ramp shadow level, rim and outline colours follow the sky. */
export function applyToonSkyState(s) {
  if (!TOON_ON) return;
  const day = THREE.MathUtils.smoothstep(s.sunI, 0.05, 1.3);
  setRamp(RAMP_WORLD, 0.42 + 0.1 * (1 - day), 0.72);
  setRamp(RAMP_SKIN, 0.55 + 0.08 * (1 - day), 0.8);
  const rim = U.uRimColor.value.setHex(s.hemiSky);
  rim.lerp(new THREE.Color(0xffffff), 0.35);
  U.uRimStrength.value = 0.12 + 0.16 * day;
  // Outline: a deep, slightly cool shade of the fog (never pure black).
  const oc = U.uOutlineColor.value.setHex(s.fogC);
  const hsl = {}; oc.getHSL(hsl);
  oc.setHSL(hsl.h, Math.min(0.45, hsl.s), 0.1 + 0.03 * day);
}
