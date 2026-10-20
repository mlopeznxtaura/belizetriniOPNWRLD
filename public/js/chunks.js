import * as THREE from 'three';
import { CHUNK, footprint, roadRect, CORE_RECTS } from './districts.js';
import { KitBuilder, GeoBatcher, BUILDERS, propGeometries, UNIT, WW, hash2 } from './kit.js';
import { TOON_ON, TOON_Q, toonMaterial, makeBatchedOutline, releaseBatchedOutline } from './toon.js';

/**
 * belizetriniOPNWRLD — streaming chunk world (good-1+11).
 *
 * The world outside the hand-built core is a grid of CHUNK (160 m) chunks. Each chunk owns its share of
 * the district layout (districts.js): land, shore edges, road pieces, bridges, docks, buildings, props.
 *
 *  - LOAD / UNLOAD by player distance: a chunk is wanted while the distance from the player to its
 *    rectangle is below the preset's ring radius; it is dropped beyond radius + HYST (hysteresis).
 *  - ASYNC BUILD: a chunk is built by a generator that yields after every few buildings / prop types;
 *    the streamer steps it until the preset's per-frame budget (2.5–5 ms) is used, so no frame pays
 *    for a whole chunk. Nearest wanted chunk first.
 *  - PER-CHUNK BATCHING: one lit vertex-colour mesh + one unlit mesh + one InstancedMesh per prop type
 *    + two merged outline-hull meshes (building / prop class). ≈6–12 draws per chunk.
 *  - DISPOSAL: unloading disposes every geometry, instanced buffer and outline batch it created; shared
 *    prop geometries are reference counted and released when no chunk uses them, so
 *    renderer.info.memory returns to its baseline after the player leaves.
 *  - FAR LOD: per district one merged low mesh (ground, roads, building masses, palm blobs) shows every
 *    chunk that is not loaded; its index buffer is recomposed when the loaded set changes, so it stays
 *    ONE draw per district and never overlaps the detailed chunks.
 *  - Colliders and the road graph come from the layout at boot (not from loading), so collisions and
 *    pursuit routing are identical whether a chunk is loaded or not.
 */
export const RING = {
  //       load radius (m), build budget per frame (ms), detail radius (props + outline hulls, m)
  low: { load: 180, budget: 2.5, detail: 110 },
  medium: { load: 240, budget: 3, detail: 150 },
  high: { load: 330, budget: 4, detail: 200 },
  ultra: { load: 420, budget: 5, detail: 260 },
};
const HYST = 48;
const WATER_Y = -0.35;

const rectDist = (r, x, z) => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
const clip = (a, b) => {
  const r = { minX: Math.max(a.minX, b.minX), maxX: Math.min(a.maxX, b.maxX), minZ: Math.max(a.minZ, b.minZ), maxZ: Math.min(a.maxZ, b.maxZ) };
  return r.minX < r.maxX && r.minZ < r.maxZ ? r : null;
};
const keyOf = (x, z) => Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);

/** Uniform-grid collider index (district buildings), queried per entity per frame. */
export class ColliderGrid {
  constructor(list, cell = 32) {
    this.cell = cell; this.m = new Map(); this.all = list;
    for (const c of list) {
      for (let i = Math.floor(c.minX / cell); i <= Math.floor(c.maxX / cell); i++) for (let j = Math.floor(c.minZ / cell); j <= Math.floor(c.maxZ / cell); j++) {
        const k = i + ',' + j; let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); a.push(c);
      }
    }
    this._out = []; this._seen = new Set();
  }
  /** Colliders overlapping the box [x0..x1]×[z0..z1] (reused array). */
  query(x0, z0, x1, z1) {
    const c = this.cell, out = this._out, seen = this._seen;
    out.length = 0; seen.clear();
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const a = this.m.get(i + ',' + j); if (!a) continue;
      for (const o of a) if (!seen.has(o)) { seen.add(o); out.push(o); }
    }
    return out;
  }
}

/** Shared chunk materials (vertex colour, Wind Waker "few materials"). */
function makeMaterials() {
  const lit = TOON_ON ? toonMaterial(0xffffff, { vertexColors: true })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0.05 });
  lit.name = 'chunkLit';
  const unlit = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  unlit.name = 'chunkUnlit';
  return { lit, unlit };
}

export class ChunkStreamer {
  /**
   * @param scene THREE.Scene
   * @param layout districts.generateLayout() result
   * @param opts { preset: 'low'|'medium'|'high'|'ultra' }
   */
  constructor(scene, layout, opts = {}) {
    this.scene = scene;
    this.L = layout;
    this.mats = makeMaterials();
    this.props = propGeometries();
    this.propRefs = {};
    this.root = new THREE.Group(); this.root.name = 'chunks'; scene.add(this.root);
    this.chunks = new Map();
    this.queue = [];
    this.current = null;
    this.stats = { loads: 0, unloads: 0, aborted: 0, maxStepMs: 0, maxFrameMs: 0, lastFrameMs: 0, buildMs: [], frames: 0, loaded: 0, wanted: 0 };
    this.setPreset(opts.preset || 'high');
    this._acc = 0;
    this.hyst = HYST;
    this.enabled = !/[?&]chunks=0\b/.test(globalThis.location?.search || '');
    this._bucket();
    this.colliders = new ColliderGrid(layout.colliders);
    this._buildFarLOD();
  }

  setPreset(name) {
    this.preset = RING[name] ? name : 'high';
    this.ring = RING[this.preset];
  }

  // ─── Bucketing the layout into chunks ────────────────────────────────────────
  _chunk(k) {
    let c = this.chunks.get(k);
    if (!c) {
      const [i, j] = k.split(',').map(Number);
      c = { key: k, i, j, rect: { minX: i * CHUNK, maxX: (i + 1) * CHUNK, minZ: j * CHUNK, maxZ: (j + 1) * CHUNK },
        land: [], edges: [], roads: [], bridges: [], docks: [], buildings: [], props: {}, state: 'idle', group: null, n: 0, district: null };
      this.chunks.set(k, c);
    }
    return c;
  }
  _bucket() {
    const L = this.L;
    // land pieces clipped per chunk
    for (const lr of L.land) {
      for (let i = Math.floor(lr.minX / CHUNK); i <= Math.floor((lr.maxX - 1e-6) / CHUNK); i++) for (let j = Math.floor(lr.minZ / CHUNK); j <= Math.floor((lr.maxZ - 1e-6) / CHUNK); j++) {
        const c = this._chunk(i + ',' + j);
        const r = clip(lr, c.rect);
        if (r) { c.land.push({ ...r, src: lr }); c.n++; c.district = c.district || lr.district; }
      }
    }
    for (const e of L.edges) {
      // split edge runs at chunk borders
      const horiz = e.z0 === e.z1;
      const a = horiz ? Math.min(e.x0, e.x1) : Math.min(e.z0, e.z1), b = horiz ? Math.max(e.x0, e.x1) : Math.max(e.z0, e.z1);
      let s = a;
      while (s < b - 1e-6) {
        const t = Math.min(b, (Math.floor(s / CHUNK + 1e-9) + 1) * CHUNK);
        const piece = horiz ? { ...e, x0: s, x1: t } : { ...e, z0: s, z1: t };
        const c = this._chunk(keyOf(horiz ? (s + t) / 2 : e.x0 - e.nx * 0.5, horiz ? e.z0 - e.nz * 0.5 : (s + t) / 2));
        c.edges.push(piece); c.n++;
        s = t;
      }
    }
    for (const r of L.roads) { const c = this._chunk(keyOf((r.x1 + r.x2) / 2, (r.z1 + r.z2) / 2)); c.roads.push(r); c.n++; }
    for (const b of L.bridges) { const c = this._chunk(keyOf(b.cx, b.cz)); c.bridges.push(b); c.n++; }
    for (const d of L.docks) { const c = this._chunk(keyOf(d.x, d.z)); c.docks.push(d); c.n++; }
    for (const b of L.buildings) { const c = this._chunk(keyOf(b.x, b.z)); c.buildings.push(b); c.n++; c.district = c.district || b.district; }
    for (const [type, list] of Object.entries(L.props)) for (const p of list) {
      const c = this._chunk(keyOf(p.x, p.z)); (c.props[type] = c.props[type] || []).push(p); c.n++;
    }
    for (const c of this.chunks.values()) {
      if (!c.district) c.district = this.L.districtOf(c.rect.minX + CHUNK / 2, c.rect.minZ + CHUNK / 2) || 'sea';
    }
    this.contentChunks = [...this.chunks.values()].filter((c) => c.n > 0);
  }

  // ─── Per-frame update ────────────────────────────────────────────────────────
  update(dt, pos) {
    if (!this.enabled) return;
    const t0 = performance.now();
    this._acc -= dt;
    if (this._acc <= 0) { this._acc = 0.25; this._schedule(pos); }
    // async build within the frame budget
    const budget = this.ring.budget;
    while (performance.now() - t0 < budget) {
      if (!this.current) {
        const c = this.queue.shift();
        if (!c) break;
        this._begin(c);
      }
      const s0 = performance.now();
      const r = this.current.gen.next();
      const st = performance.now() - s0;
      this.current.ms += st;
      if (st > this.stats.maxStepMs) { this.stats.maxStepMs = st; this.stats.maxStepLabel = this._lastLabel + '→' + (r.value || 'finish'); }
      this._lastLabel = r.value || 'finish';
      if (r.done) this._finish(this.current);
    }
    const ft = performance.now() - t0;
    this.stats.lastFrameMs = ft;
    if (ft > this.stats.maxFrameMs) this.stats.maxFrameMs = ft;
    this.stats.frames++;
  }

  _schedule(pos) {
    const R = this.ring.load;
    let wanted = 0;
    for (const c of this.contentChunks) {
      const d = rectDist(c.rect, pos.x, pos.z);
      c.dist = d;
      if (d < R) {
        wanted++;
        if (c.state === 'idle') { c.state = 'queued'; this.queue.push(c); }
      } else if (d > R + this.hyst) {
        if (c.state === 'loaded') this._unload(c);
        else if (c.state === 'queued') { c.state = 'idle'; this.queue.splice(this.queue.indexOf(c), 1); }
        else if (c.state === 'building') this._abort(c);
      }
    }
    this.queue.sort((a, b) => a.dist - b.dist);
    this.stats.wanted = wanted;
    // Detail ring: instanced props + outline hulls only near the player (big tri saver on far chunks).
    const D = this.ring.detail;
    for (const c of this.contentChunks) {
      if (c.state !== 'loaded') continue;
      const on = c.dist < D;
      if (c.detailOn === on) continue;
      c.detailOn = on;
      this._detail(c, on);
    }
  }

  /** Synchronously load every chunk within `radius` of pos (capture tools / aerial map). */
  loadAround(pos, radius = Infinity) {
    for (const c of this.contentChunks) {
      if (rectDist(c.rect, pos.x, pos.z) > radius || c.state === 'loaded') continue;
      if (c.state === 'queued') this.queue.splice(this.queue.indexOf(c), 1);
      if (c.state === 'building') { this._abort(c); }
      this._begin(c);
      let r; do { r = this.current.gen.next(); } while (!r.done);
      this._finish(this.current);
    }
  }
  /** Unload everything (tests). */
  unloadAll() {
    if (this.current) this._abort(this.current.c);
    for (const c of this.contentChunks) { if (c.state === 'loaded') this._unload(c); if (c.state === 'queued') c.state = 'idle'; }
    this.queue.length = 0;
  }

  _begin(c) {
    c.state = 'building';
    this.current = { c, gen: this._build(c), ms: 0, parts: null };
  }
  _abort(c) {
    if (this.current?.c === c) { this.current.gen.return(); this._disposeParts(this.current.parts); this.current = null; }
    c.state = 'idle';
    this.stats.aborted++;
  }
  _finish(cur) {
    const c = cur.c;
    c.group = cur.parts.group;
    c.parts = cur.parts;
    this.root.add(c.group);
    c.state = 'loaded';
    c.detailOn = undefined; c.dist = c.dist ?? 0;
    const on = (c.dist ?? 0) < this.ring.detail;
    c.detailOn = on;
    this._detail(c, on);
    this.current = null;
    this.stats.loads++;
    this.stats.loaded++;
    this.stats.buildMs.push(+cur.ms.toFixed(2));
    if (this.stats.buildMs.length > 200) this.stats.buildMs.shift();
    this._farDirty(c.district);
  }
  _detail(c, on) {
    for (const im of c.parts.instanced) im.visible = on;
    if (c.parts.minor) c.parts.minor.visible = on;
    for (const l of c.parts.outlines) { l.userData.detailHidden = !on; l.visible = on && TOON_Q.outlines === 'all'; }
  }
  _unload(c) {
    this.root.remove(c.group);
    this._disposeParts(c.parts);
    c.group = null; c.parts = null;
    c.state = 'idle';
    this.stats.unloads++;
    this.stats.loaded--;
    this._farDirty(c.district);
  }
  _disposeParts(parts) {
    if (!parts) return;
    for (const g of parts.geos) g.dispose();
    for (const im of parts.instanced) { im.dispose(); this._propRelease(im.userData.propType); }
    for (const l of parts.outlines) releaseBatchedOutline(l);
    parts.geos.length = 0; parts.instanced.length = 0; parts.outlines.length = 0;
  }
  _propAcquire(type) { this.propRefs[type] = (this.propRefs[type] || 0) + 1; }
  _propRelease(type) {
    if (--this.propRefs[type] <= 0) { this.propRefs[type] = 0; this.props[type].geo.dispose(); } // GPU copy only; reusable
  }

  // ─── Chunk build (generator, yields between small steps) ─────────────────────
  *_build(c) {
    const parts = { group: new THREE.Group(), geos: [], instanced: [], outlines: [] };
    parts.group.name = 'chunk:' + c.key;
    this.current.parts = parts;
    const K = new KitBuilder({ outlines: TOON_ON });
    this._ground(K, c);
    yield 'ground';
    this._edges(K, c);
    yield 'edges';
    this._roads(K, c);
    yield 'roads';
    for (const b of c.bridges) { this._bridge(K, b); yield 'bridge'; }
    for (const d of c.docks) this._dock(K, d);
    let mark = K.prims;
    for (const b of c.buildings) {
      const f = BUILDERS[b.kind];
      if (!f) continue;
      if (b.kind === 'stilt' || b.kind === 'colonial') { const fp = footprint(b); K.lit.quad(fp.minX - 1, fp.minZ - 1, fp.maxX + 1, fp.maxZ + 1, 0.008, b.kind === 'stilt' ? WW.dirt : WW.grass2); }
      K.at(b.x, 0, b.z, b.yaw);
      f(K, b);
      if (K.prims - mark > 70) { mark = K.prims; yield 'buildings'; } // ~1-2 buildings per step
    }
    yield 'buildings';
    for (const [type, list] of Object.entries(c.props)) {
      if (!list.length) continue;
      parts.instanced.push(yield* this._instanced(K, type, list, parts.group));
      yield 'props:' + type;
    }
    // finalize: merged meshes + outline batches, one per step (each is a typed-array copy)
    const lit = K.lit.build();
    if (lit) { parts.geos.push(lit); const m = new THREE.Mesh(lit, this.mats.lit); m.matrixAutoUpdate = false; m.name = 'chunkLit'; parts.group.add(m); }
    yield 'mesh:lit';
    const minor = K.litMinor.build();
    if (minor) { parts.geos.push(minor); const m = new THREE.Mesh(minor, this.mats.lit); m.matrixAutoUpdate = false; m.name = 'chunkMinor'; parts.group.add(m); parts.minor = m; }
    const unlit = K.unlit.build();
    if (unlit) { parts.geos.push(unlit); const m = new THREE.Mesh(unlit, this.mats.unlit); m.matrixAutoUpdate = false; m.name = 'chunkUnlit'; parts.group.add(m); }
    yield 'mesh:minor+unlit';
    if (K.hull && !K.hull.empty) { const g = K.hull.build(); parts.outlines.push(makeBatchedOutline(g, 'building', parts.group)); }
    yield 'outline:building';
    if (K.hullProp && !K.hullProp.empty) { const g = K.hullProp.build(); parts.outlines.push(makeBatchedOutline(g, 'prop', parts.group)); }
    parts.group.updateMatrixWorld(true);
    parts.prims = K.prims;
  }

  *_instanced(K, type, list, group) {
    const P = this.props[type];
    const im = new THREE.InstancedMesh(P.geo, P.unlit ? this.mats.unlit : this.mats.lit, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (i && i % 48 === 0) yield 'props';
      q.setFromAxisAngle(up, o.yaw || 0);
      s.setScalar(o.s || 1);
      p.set(o.x, o.water ? WATER_Y + 0.12 : 0, o.z);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
      if (o.color != null) { im.setColorAt(i, col.setHex(o.color)); }
      if (P.outline && K.hullProp) K.instanceHull(P.geo, m);
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = 'props:' + type;
    im.userData.propType = type;
    this._propAcquire(type);
    group.add(im);
    return im;
  }

  _groundColor(lr) {
    const g = lr.src?.ground || lr.ground;
    return g === 'park' ? WW.grass2 : g === 'sand' ? WW.sand : WW.grass;
  }
  _ground(K, c) {
    for (const lr of c.land) K.lit.quad(lr.minX, lr.minZ, lr.maxX, lr.maxZ, 0, this._groundColor(lr));
  }
  _edges(K, c) {
    for (const e of c.edges) {
      const ix = -e.nx, iz = -e.nz; // inward
      const x0 = Math.min(e.x0, e.x1), x1 = Math.max(e.x0, e.x1), z0 = Math.min(e.z0, e.z1), z1 = Math.max(e.z0, e.z1);
      if (e.type === 'beach') {
        const w = 7;
        const qx0 = e.nx ? Math.min(e.x0, e.x0 + ix * w) : x0, qx1 = e.nx ? Math.max(e.x0, e.x0 + ix * w) : x1;
        const qz0 = e.nz ? Math.min(e.z0, e.z0 + iz * w) : z0, qz1 = e.nz ? Math.max(e.z0, e.z0 + iz * w) : z1;
        K.lit.quad(qx0, qz0, qx1, qz1, 0.012, e.sand ? WW.sandWet : WW.sand);
        K.lit.wall(e.x0, e.z0, e.x1, e.z1, -1.4, 0.012, e.nx, e.nz, WW.sandWet);
      } else {
        K.lit.wall(e.x0, e.z0, e.x1, e.z1, -1.4, 0.2, e.nx, e.nz, WW.seawall);
        // cap stones along the top
        const cx = (e.x0 + e.x1) / 2 + ix * 0.3, cz = (e.z0 + e.z1) / 2 + iz * 0.3;
        const len = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
        K.at(0, 0, 0, 0);
        K.box(cx, 0.12, cz, e.nx ? 0.6 : len, 0.24, e.nz ? 0.6 : len, WW.stone);
      }
    }
  }
  _roads(K, c) {
    const all = this.L.roadsWhole;
    for (const r of c.roads) {
      const horiz = r.z1 === r.z2;
      const a = horiz ? Math.min(r.x1, r.x2) : Math.min(r.z1, r.z2), b = horiz ? Math.max(r.x1, r.x2) : Math.max(r.z1, r.z2);
      const hw = r.w / 2, sw = 1.8;
      if (horiz) K.lit.quad(a, r.z1 - hw, b, r.z1 + hw, 0.02, WW.asphalt);
      else K.lit.quad(r.x1 - hw, a, r.x1 + hw, b, 0.02, WW.asphalt);
      // sidewalks with gaps where perpendicular roads cut through them
      for (const side of [-1, 1]) {
        const line = (horiz ? r.z1 : r.x1) + side * (hw + sw / 2);
        const gaps = [];
        for (const o of all) {
          const oh = o.z1 === o.z2;
          if (oh === horiz) continue;
          const oc = oh ? o.z1 : o.x1; // position along this road
          const lo = oh ? Math.min(o.x1, o.x2) : Math.min(o.z1, o.z2), hi = oh ? Math.max(o.x1, o.x2) : Math.max(o.z1, o.z2);
          if (line < lo - 0.5 || line > hi + 0.5) continue;
          gaps.push([oc - o.w / 2, oc + o.w / 2]);
        }
        gaps.sort((p, q) => p[0] - q[0]);
        let s = a;
        const emit = (s0, s1) => {
          if (s1 - s0 < 0.2) return;
          if (horiz) K.lit.quad(s0, line - sw / 2, s1, line + sw / 2, 0.05, WW.sidewalk);
          else K.lit.quad(line - sw / 2, s0, line + sw / 2, s1, 0.05, WW.sidewalk);
          // curb lip
          const ex = horiz ? null : line - side * sw / 2, ez = horiz ? line - side * sw / 2 : null;
          if (horiz) K.litMinor.wall(s0, ez, s1, ez, 0.02, 0.05, 0, -side, WW.curb);
          else K.litMinor.wall(ex, s0, ex, s1, 0.02, 0.05, -side, 0, WW.curb);
        };
        for (const [g0, g1] of gaps) { if (g1 <= s || g0 >= b) continue; emit(s, Math.max(s, g0)); s = Math.max(s, g1); }
        if (s < b) emit(s, b);
      }
      // centre dashes (wide roads), skipping crossings
      if (r.w >= 8) {
        for (let t = a + 1.5; t < b - 1.5; t += 5) {
          const px = horiz ? t : r.x1, pz = horiz ? r.z1 : t;
          if (all.some((o) => o !== r && (o.z1 === o.z2) !== horiz && Math.abs((o.z1 === o.z2 ? o.z1 : o.x1) - t) < o.w / 2 + 2
            && (o.z1 === o.z2 ? (px >= Math.min(o.x1, o.x2) - 1 && px <= Math.max(o.x1, o.x2) + 1) : (pz >= Math.min(o.z1, o.z2) - 1 && pz <= Math.max(o.z1, o.z2) + 1)))) continue;
          if (horiz) K.litMinor.quad(t, r.z1 - 0.11, t + 2.2, r.z1 + 0.11, 0.03, WW.lane);
          else K.litMinor.quad(r.x1 - 0.11, t, r.x1 + 0.11, t + 2.2, 0.03, WW.lane);
        }
      }
    }
  }
  _bridge(K, b) {
    const L = b.horiz ? b.x2 - b.x1 : b.z2 - b.z1;
    const W = b.w + 2 * 1.8 + 0.6;
    K.at(b.cx, 0, b.cz, b.horiz ? Math.PI / 2 : 0); // local z = along the bridge
    K.box(0, -0.2, 0, W, 0.42, L, b.kind === 'beam' ? WW.stone : WW.dark, { outline: 'prop' });
    // abutments + piers into the water
    for (const z of [-L / 2 + 1, L / 2 - 1]) K.box(0, -0.8, z, W + 0.6, 1.4, 2, WW.seawall);
    if (b.kind === 'beam') {
      for (const s of [-1, 1]) {
        K.box(s * (W / 2 - 0.2), 0.5, 0, 0.35, 0.9, L, WW.trim, { outline: 'prop' });
        for (let z = -L / 2 + 1; z <= L / 2 - 1; z += (L - 2) / 3) K.box(s * (W / 2 - 0.2), 0.6, z, 0.5, 1.15, 0.5, WW.stone);
      }
      return;
    }
    const col = b.kind === 'swing' ? WW.bridgeGreen : WW.steel;
    const H = b.kind === 'swing' ? 5.2 : 4.2;
    const n = Math.max(3, Math.round(L / 5));
    for (const s of [-1, 1]) {
      const x = s * (W / 2 - 0.15);
      K.box(x, 0.35, 0, 0.35, 0.7, L, col, { outline: 'prop' }); // bottom chord / rail
      K.box(x, H, 0, 0.35, 0.35, L - 4, col, { outline: 'prop' }); // top chord
      for (let i = 0; i <= n; i++) {
        const z = -L / 2 + 2 + (L - 4) * (i / n);
        K.box(x, H / 2 + 0.2, z, 0.25, H - 0.2, 0.25, col);
        if (i < n) {
          const z2 = -L / 2 + 2 + (L - 4) * ((i + 0.5) / n);
          const dz = (L - 4) / n, ang = Math.atan2(dz, H - 0.4);
          K.box(x, H / 2 + 0.2, z2, 0.18, Math.hypot(dz, H - 0.4), 0.18, col, { rx: i % 2 ? ang : -ang });
        }
      }
    }
    for (let i = 0; i <= n; i += 2) K.box(0, H, -L / 2 + 2 + (L - 4) * (i / n), W - 0.3, 0.25, 0.25, col); // portal ties
    if (b.kind === 'swing') {
      // pivot drum in the water + operator cabin + striped gates at both ends
      K.prim(UNIT.cyl8, 0, -1.0, 0, 7, 1.6, 7, WW.seawall, { outline: 'prop' });
      K.box(0, H + 1.4, 0, 3.2, 2.4, 3.0, WW.white, { outline: 'prop' });
      K.prim(UNIT.pyramid, 0, H + 3.1, 0, 4.0, 1.2, 3.8, WW.roofRed);
      K.box(0, H + 1.6, 1.52, 2.2, 0.9, 0.05, WW.glass, { unlit: true });
      for (const z of [-L / 2 - 0.6, L / 2 + 0.6]) for (const s of [-1, 1]) {
        K.box(s * (W / 2 - 0.3), 1.0, z, 0.4, 2.0, 0.4, WW.trim);
        K.box(s * (W / 2 - 0.3), 1.6, z, 0.42, 0.35, 0.42, WW.lighthouseRed);
      }
    }
  }
  _dock(K, d) {
    K.at(0, 0, 0, 0);
    K.box(d.x, 0.0, d.z, d.w, 0.24, d.d, WW.woodPale, { outline: 'prop' });
    const alongX = d.w > d.d;
    const len = alongX ? d.w : d.d;
    const n = Math.max(2, Math.round(len / 3.5));
    for (let i = 0; i <= n; i++) {
      const t = -len / 2 + len * (i / n);
      for (const s of [-1, 1]) {
        const x = alongX ? d.x + t : d.x + s * (d.w / 2 - 0.15), z = alongX ? d.z + s * (d.d / 2 - 0.15) : d.z + t;
        K.prim(UNIT.cyl6, x, -0.55, z, 0.3, 1.4, 0.3, WW.post);
        if (i % 2 === 0) K.prim(UNIT.cyl6, x, 0.3, z, 0.26, 0.4, 0.26, WW.woodDark);
      }
    }
  }

  // ─── Far LOD: one merged low mesh per district, chunks hidden by index recomposition ──
  _buildFarLOD() {
    this.far = new Map(); // district → { mesh, full, ranges: Map(key → [start, count]) }
    const byD = new Map();
    for (const c of this.contentChunks) { if (!byD.has(c.district)) byD.set(c.district, []); byD.get(c.district).push(c); }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    const put = (B, geo, x, y, z, sx, sy, sz, yaw, hex) => { Q.setFromAxisAngle(UP, yaw); M.compose(P.set(x, y, z), Q, S.set(sx, sy, sz)); B.add(geo, M, hex); };
    for (const [district, list] of byD) {
      const B = new GeoBatcher();
      const ranges = new Map();
      for (const c of list) {
        const start = B.ni;
        for (const lr of c.land) B.quad(lr.minX, lr.minZ, lr.maxX, lr.maxZ, 0, this._groundColor(lr));
        for (const e of c.edges) {
          if (e.type !== 'beach') continue;
          const w = 7, ix = -e.nx, iz = -e.nz;
          const x0 = Math.min(e.x0, e.x1), x1 = Math.max(e.x0, e.x1), z0 = Math.min(e.z0, e.z1), z1 = Math.max(e.z0, e.z1);
          B.quad(e.nx ? Math.min(e.x0, e.x0 + ix * w) : x0, e.nz ? Math.min(e.z0, e.z0 + iz * w) : z0, e.nx ? Math.max(e.x0, e.x0 + ix * w) : x1, e.nz ? Math.max(e.z0, e.z0 + iz * w) : z1, 0.012, WW.sand);
        }
        for (const r of c.roads) {
          const hw = r.w / 2 + 1.8;
          if (r.z1 === r.z2) B.quad(Math.min(r.x1, r.x2), r.z1 - hw, Math.max(r.x1, r.x2), r.z1 + hw, 0.02, WW.asphalt);
          else B.quad(r.x1 - hw, Math.min(r.z1, r.z2), r.x1 + hw, Math.max(r.z1, r.z2), 0.02, WW.asphalt);
        }
        for (const b of c.bridges) put(B, UNIT.box, b.cx, -0.2, b.cz, b.horiz ? b.x2 - b.x1 : b.w + 4, 0.42, b.horiz ? b.w + 4 : b.z2 - b.z1, 0, WW.dark);
        for (const d of c.docks) put(B, UNIT.box, d.x, 0, d.z, d.w, 0.24, d.d, 0, WW.woodPale);
        for (const b of c.buildings) {
          if (b.kind === 'lighthouse') { put(B, UNIT.cyl8, b.x, 9, b.z, 3.6, 18, 3.6, 0, WW.lighthouse); put(B, UNIT.cone6, b.x, 19, b.z, 3, 1.6, 3, 0, WW.lighthouseRed); continue; }
          const base = b.kind === 'stilt' ? (b.stilt || 2.2) : 0;
          const H = b.kind === 'stilt' ? 2.7 : b.kind === 'shop' ? (b.floors || 2) * 3 : b.kind === 'colonial' ? 6.5 : b.kind === 'market' ? 4.5 : b.kind === 'chapel' ? 6 : b.kind === 'terminal' ? 3.6 : (b.h || 6);
          put(B, UNIT.box, b.x, base + H / 2, b.z, b.w, H + (base ? 0.2 : 0), b.d, b.yaw, b.color);
          if (b.kind === 'shop') continue;
          put(B, b.kind === 'colonial' || b.kind === 'market' ? UNIT.pyramid : UNIT.prism, b.x, base + H, b.z, b.w + 0.8, 1.6, b.d + 0.8, b.yaw, b.roof);
          if (b.kind === 'chapel') put(B, UNIT.box, b.x, 5, b.z, 2.6, 10, 2.6, b.yaw, WW.white);
        }
        for (const p of c.props.palm || []) {
          put(B, UNIT.box, p.x, 2.6 * p.s, p.z, 0.3, 5.2 * p.s, 0.3, 0, WW.wood);
          put(B, UNIT.cone4, p.x, 5.6 * p.s, p.z, 3.2 * p.s, 1.1 * p.s, 3.2 * p.s, p.yaw, 0x3ea444);
        }
        for (const p of c.props.bush || []) put(B, UNIT.cone6, p.x, 0.9 * p.s, p.z, 2.2 * p.s, 1.8 * p.s, 2.2 * p.s, 0, 0x3e9a44);
        ranges.set(c.key, [start, B.ni - start]);
      }
      const geo = B.build();
      if (!geo) continue;
      const full = geo.index.array.slice();
      const mesh = new THREE.Mesh(geo, this.mats.lit);
      mesh.name = 'farLOD:' + district;
      mesh.matrixAutoUpdate = false;
      mesh.userData.farLOD = true;
      this.root.add(mesh);
      this.far.set(district, { mesh, full, ranges, dirty: false, tris: full.length / 3 });
    }
  }
  _farDirty(district) {
    const f = this.far.get(district);
    if (!f) return;
    const idx = f.mesh.geometry.index;
    let n = 0;
    for (const [key, [s, cnt]] of f.ranges) {
      if (this.chunks.get(key).state === 'loaded') continue;
      idx.array.set(f.full.subarray(s, s + cnt), n);
      n += cnt;
    }
    f.mesh.geometry.setDrawRange(0, n);
    f.mesh.visible = n > 0;
    idx.clearUpdateRanges?.();
    idx.addUpdateRange?.(0, n);
    idx.needsUpdate = true;
    f.visibleTris = n / 3;
  }

  /** Compile the chunk material variants up front (no shader hitch on the first chunk). */
  warmup(renderer, camera) {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
    const a = new THREE.InstancedMesh(geo, this.mats.lit, 1); a.setColorAt(0, new THREE.Color(1, 1, 1));
    g.add(new THREE.Mesh(geo, this.mats.lit), new THREE.Mesh(geo, this.mats.unlit), a, new THREE.InstancedMesh(geo, this.mats.lit, 1), new THREE.InstancedMesh(geo, this.mats.unlit, 1));
    g.position.set(camera.position.x, -500, camera.position.z);
    try { renderer.compile(g, camera, this.scene); } catch (_) {}
    for (const o of g.children) if (o.isInstancedMesh) o.dispose();
    geo.dispose();
  }

  /** Stats for tests / debug overlay. */
  info() {
    const loaded = this.contentChunks.filter((c) => c.state === 'loaded');
    let farTris = 0; for (const f of this.far.values()) farTris += f.visibleTris ?? f.tris;
    return {
      preset: this.preset, ring: this.ring.load, budget: this.ring.budget, chunks: this.contentChunks.length,
      loaded: loaded.map((c) => c.key), building: this.current?.c.key || null, queued: this.queue.length,
      loads: this.stats.loads, unloads: this.stats.unloads, aborted: this.stats.aborted,
      maxStepMs: +this.stats.maxStepMs.toFixed(2), maxStepLabel: this.stats.maxStepLabel, maxFrameMs: +this.stats.maxFrameMs.toFixed(2), lastFrameMs: +this.stats.lastFrameMs.toFixed(2),
      buildMs: this.stats.buildMs.slice(-20), farTris: Math.round(farTris), farMeshes: this.far.size,
    };
  }
  resetStats() { this.stats.maxStepMs = 0; this.stats.maxFrameMs = 0; this.stats.loads = 0; this.stats.unloads = 0; this.stats.aborted = 0; this.stats.buildMs = []; }
}
