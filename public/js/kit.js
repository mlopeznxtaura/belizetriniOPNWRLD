import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * belizetriniOPNWRLD — streamed-district kit (good-1+11).
 *
 * Everything a streamed chunk draws is emitted as primitives (unit box / prism / cylinder / cone /
 * quad) into a GeoBatcher, which writes transformed positions, normals and per-vertex colours straight
 * into typed arrays. One chunk = one lit merged mesh + one unlit merged mesh (windows, lamp heads) +
 * one merged outline hull mesh + one InstancedMesh per prop type. That is the good-1+4 batching idea
 * taken to its end: Wind Waker style "few materials" (colour lives in the vertices), so a chunk costs
 * ~6-10 draw calls whatever it contains.
 *
 * Shared unit geometries are never disposed (they are tiny and their hulls are cached once).
 */

// ─── Shared unit primitives ──────────────────────────────────────────────────────
function prismGeometry() {
  // Gable roof: x -0.5..0.5, y 0..1, ridge along z (-0.5..0.5). Flat normals.
  const p = [], n = [];
  const tri = (a, b, c) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), vc = new THREE.Vector3(...c);
    const nn = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)).normalize();
    for (const v of [va, vb, vc]) { p.push(v.x, v.y, v.z); n.push(nn.x, nn.y, nn.z); }
  };
  const L = [-0.5, 0, -0.5], R = [0.5, 0, -0.5], T = [0, 1, -0.5];
  const L2 = [-0.5, 0, 0.5], R2 = [0.5, 0, 0.5], T2 = [0, 1, 0.5];
  tri(L, T, R); tri(L2, R2, T2); // gables
  tri(L, L2, T2); tri(L, T2, T); // left slope
  tri(R, T, T2); tri(R, T2, R2); // right slope
  tri(L, R, R2); tri(L, R2, L2); // bottom
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  return g;
}
function strip(g) {
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', g.getAttribute('position'));
  o.setAttribute('normal', g.getAttribute('normal'));
  if (g.index) o.setIndex(g.index);
  return o;
}
export const UNIT = {
  box: strip(new THREE.BoxGeometry(1, 1, 1)),
  prism: prismGeometry(),
  cyl6: strip(new THREE.CylinderGeometry(0.5, 0.5, 1, 6)),
  cyl8: strip(new THREE.CylinderGeometry(0.5, 0.5, 1, 8)),
  cone4: strip(new THREE.ConeGeometry(0.5, 1, 4)),
  cone6: strip(new THREE.ConeGeometry(0.5, 1, 6)),
  pyramid: strip(new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4)),
};
for (const g of Object.values(UNIT)) { g.computeBoundingBox(); g.computeBoundingSphere(); g.userData.shared = true; }

const _hulls = new Map();
/** Welded, smooth-normal hull of a shared geometry (cached; inverted-hull outlines). */
export function hullOf(geo) {
  let h = _hulls.get(geo);
  if (h) return h;
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position'));
  if (geo.index) g.setIndex(geo.index);
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  g.computeBoundingBox();
  _hulls.set(geo, g);
  return g;
}

// ─── Growable typed-array batcher ────────────────────────────────────────────────
const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

export class GeoBatcher {
  constructor({ colors = true, box = false, cap = 4096 } = {}) {
    this.colors = colors; this.box = box;
    this.cap = cap; this.icap = cap * 2;
    this.pos = new Float32Array(cap * 3); this.nrm = new Float32Array(cap * 3);
    this.col = colors ? new Float32Array(cap * 3) : null;
    this.bmin = box ? new Float32Array(cap * 3) : null; this.bmax = box ? new Float32Array(cap * 3) : null;
    this.idx = new Uint32Array(this.icap);
    this.nv = 0; this.ni = 0;
  }
  _grow(nv, ni) {
    if (this.nv + nv > this.cap) {
      let c = this.cap; while (this.nv + nv > c) c *= 2;
      const g = (a) => { if (!a) return a; const b = new Float32Array(c * 3); b.set(a); return b; };
      this.pos = g(this.pos); this.nrm = g(this.nrm); this.col = g(this.col); this.bmin = g(this.bmin); this.bmax = g(this.bmax);
      this.cap = c;
    }
    if (this.ni + ni > this.icap) {
      let c = this.icap; while (this.ni + ni > c) c *= 2;
      const b = new Uint32Array(c); b.set(this.idx); this.idx = b; this.icap = c;
    }
  }
  /** Append `geo` transformed by `m` with colour `hex` (multiplies an existing colour attribute). */
  add(geo, m, hex = 0xffffff, boxMin = null, boxMax = null) {
    const P = geo.getAttribute('position'), N = geo.getAttribute('normal'), C = geo.getAttribute('color');
    const I = geo.index;
    const nv = P.count, ni = I ? I.count : nv;
    this._grow(nv, ni);
    _nm.getNormalMatrix(m);
    const base = this.nv;
    const e = m.elements, ne = _nm.elements;
    _c.setHex(hex);
    for (let i = 0; i < nv; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const o = (base + i) * 3;
      this.pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      this.pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      this.pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = N.getX(i), b = N.getY(i), c = N.getZ(i);
      let nx = ne[0] * a + ne[3] * b + ne[6] * c, ny = ne[1] * a + ne[4] * b + ne[7] * c, nz = ne[2] * a + ne[5] * b + ne[8] * c;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      this.nrm[o] = nx; this.nrm[o + 1] = ny; this.nrm[o + 2] = nz;
      if (this.col) {
        if (C) { this.col[o] = C.getX(i) * _c.r; this.col[o + 1] = C.getY(i) * _c.g; this.col[o + 2] = C.getZ(i) * _c.b; }
        else { this.col[o] = _c.r; this.col[o + 1] = _c.g; this.col[o + 2] = _c.b; }
      }
      if (this.box) {
        this.bmin[o] = boxMin.x; this.bmin[o + 1] = boxMin.y; this.bmin[o + 2] = boxMin.z;
        this.bmax[o] = boxMax.x; this.bmax[o + 1] = boxMax.y; this.bmax[o + 2] = boxMax.z;
      }
    }
    if (I) for (let i = 0; i < ni; i++) this.idx[this.ni + i] = base + I.getX(i);
    else for (let i = 0; i < ni; i++) this.idx[this.ni + i] = base + i;
    this.nv += nv; this.ni += ni;
  }
  /** Flat up-facing quad on the XZ plane. */
  quad(x0, z0, x1, z1, y, hex) {
    this._grow(4, 6);
    const b = this.nv, o = b * 3;
    const P = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1];
    this.pos.set(P, o);
    for (let i = 0; i < 4; i++) { this.nrm[o + i * 3] = 0; this.nrm[o + i * 3 + 1] = 1; this.nrm[o + i * 3 + 2] = 0; }
    if (this.col) { _c.setHex(hex); for (let i = 0; i < 4; i++) { this.col[o + i * 3] = _c.r; this.col[o + i * 3 + 1] = _c.g; this.col[o + i * 3 + 2] = _c.b; } }
    this.idx.set([b, b + 2, b + 1, b, b + 3, b + 2], this.ni);
    this.nv += 4; this.ni += 6;
  }
  /** Vertical wall quad from (x0,z0) to (x1,z1), y from y0 to y1, facing normal (nx,nz). */
  wall(x0, z0, x1, z1, y0, y1, nx, nz, hex) {
    this._grow(4, 6);
    const b = this.nv, o = b * 3;
    this.pos.set([x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0], o);
    for (let i = 0; i < 4; i++) { this.nrm[o + i * 3] = nx; this.nrm[o + i * 3 + 1] = 0; this.nrm[o + i * 3 + 2] = nz; }
    if (this.col) { _c.setHex(hex); for (let i = 0; i < 4; i++) { this.col[o + i * 3] = _c.r; this.col[o + i * 3 + 1] = _c.g; this.col[o + i * 3 + 2] = _c.b; } }
    // winding so the face points along (nx, nz)
    const cross = (x1 - x0) * nz - (z1 - z0) * nx; // >0 → counter-clockwise seen from the normal side
    if (cross < 0) this.idx.set([b, b + 1, b + 2, b, b + 2, b + 3], this.ni);
    else this.idx.set([b, b + 2, b + 1, b, b + 3, b + 2], this.ni);
    this.nv += 4; this.ni += 6;
  }
  get empty() { return this.ni === 0; }
  build() {
    if (!this.ni) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, this.nv * 3), 3));
    if (this.col) g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.nv * 3), 3));
    if (this.box) {
      g.setAttribute('aBoxMin', new THREE.BufferAttribute(this.bmin.slice(0, this.nv * 3), 3));
      g.setAttribute('aBoxMax', new THREE.BufferAttribute(this.bmax.slice(0, this.nv * 3), 3));
    }
    const idx = this.nv > 65535 ? this.idx.slice(0, this.ni) : Uint16Array.from(this.idx.subarray(0, this.ni));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/**
 * Builder context for one chunk: lit + unlit colour batches, an outline hull batch, and a current
 * object transform (each building / prop is authored in local space, +z = its front / street side).
 */
const _box3 = new THREE.Box3();
const _t = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
export class KitBuilder {
  constructor({ outlines = true } = {}) {
    this.lit = new GeoBatcher();
    this.litMinor = new GeoBatcher(); // small / thin parts (rails, posts, stairs, shutters): near-detail only
    this.unlit = new GeoBatcher();
    this.hull = outlines ? new GeoBatcher({ colors: false, box: true }) : null;
    this.hullProp = outlines ? new GeoBatcher({ colors: false, box: true }) : null;
    this.obj = new THREE.Matrix4();
    this.prims = 0;
  }
  /** Set the object transform: position + yaw. */
  at(x, y, z, yaw = 0) { this.obj.makeRotationY(yaw).setPosition(x, y, z); return this; }
  _mat(cx, cy, cz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    _q.setFromEuler(_e.set(rx, ry, rz));
    _t.compose(_p.set(cx, cy, cz), _q, _s.set(sx, sy, sz));
    return _m.multiplyMatrices(this.obj, _t);
  }
  /** Primitive at local centre (cx,cy,cz), size (sx,sy,sz). opts: { unlit, outline: 'building'|'prop', rx, ry, rz } */
  prim(geo, cx, cy, cz, sx, sy, sz, hex, o = null) {
    const m = this._mat(cx, cy, cz, sx, sy, sz, o?.rx || 0, o?.ry || 0, o?.rz || 0);
    let dst = this.lit;
    if (o?.unlit) dst = this.unlit;
    else if (!o?.major) {
      const a = sx < sy ? (sy < sz ? [sx, sy, sz] : sx < sz ? [sx, sz, sy] : [sz, sx, sy]) : (sx < sz ? [sy, sx, sz] : sy < sz ? [sy, sz, sx] : [sz, sy, sx]);
      if (a[2] < 1.3 || a[1] < 0.25) dst = this.litMinor;
    }
    dst.add(geo, m, hex);
    this.prims++;
    if (o?.outline && this.hull) {
      const hg = hullOf(geo);
      _box3.copy(geo.boundingBox).applyMatrix4(m);
      (o.outline === 'building' ? this.hull : this.hullProp).add(hg, m, 0, _box3.min, _box3.max);
    }
  }
  box(cx, cy, cz, sx, sy, sz, hex, o) { this.prim(UNIT.box, cx, cy, cz, sx, sy, sz, hex, o); }
  /** Bake one instance hull (InstancedMesh props) in world space. */
  instanceHull(geo, m) {
    if (!this.hullProp) return;
    _box3.copy(geo.boundingBox).applyMatrix4(m);
    this.hullProp.add(hullOf(geo), m, 0, _box3.min, _box3.max);
  }
}

// ─── Colour helpers ──────────────────────────────────────────────────────────────
export function hash2(x, z, s = 0) {
  const r = Math.sin(x * 12.9898 + z * 78.233 + s * 37.719) * 43758.5453;
  return r - Math.floor(r);
}
export function pick(arr, x, z, s = 0) { return arr[Math.floor(hash2(x, z, s) * arr.length) % arr.length]; }

/** Wind Waker palette for the streamed districts (bright flat albedos, few hues). */
export const WW = {
  grass: 0x62b04a, grass2: 0x6dba52, dirt: 0xc9a46a, sand: 0xeedc9e, sandWet: 0xd8c286,
  asphalt: 0x4c5260, sidewalk: 0xa39d90, curb: 0xbdb6a6, lane: 0xf4e7a6, stone: 0xb9b2a2, seawall: 0xd8d0bc,
  wood: 0xb07a42, woodDark: 0x7a5232, woodPale: 0xd6b07a, post: 0x8a6a48,
  trim: 0xfbf7ef, white: 0xf6f1e6, dark: 0x3c3f4c, door: 0x5a3a2a, glass: 0xfff0b8, lamp: 0xffd27a,
  roofRed: 0xc2483a, roofTeal: 0x3f9e98, roofZinc: 0xaab4bc, roofGreen: 0x5a9a5a, roofBlue: 0x4a78b0,
  tank: 0x2c3036, tankBlue: 0x3a6fb0,
  steel: 0x6f8f8a, bridgeGreen: 0x4f8f7a, rail: 0xfbf7ef, lighthouse: 0xf8f4ea, lighthouseRed: 0xd9443a,
  paints: [0xf2a7b8, 0x6fd0c4, 0xf6d36b, 0xa8d66b, 0xb7a6e6, 0xf28f6b, 0x7fb6e8, 0xf2e3c0, 0x8acaa8, 0xf27c6a],
  colonial: [0xf6f1e6, 0xf2e3c0, 0xe8eef2, 0xf6e7d6],
  shop: [0xf2e3c0, 0x4fb3aa, 0xf27c6a, 0x7088ac, 0x8acaa8, 0xe4cea0, 0xf2a7b8, 0xf6d36b],
};

// ─── Buildings (local space: footprint centred on origin, +z = street front) ──────
/** Raised wooden stilt house: posts, deck, painted walls, zinc gable roof, front stairs, shutters, tank. */
export function stiltHouse(K, b) {
  const { w, d } = b;
  const stilt = b.stilt ?? 2.2;
  const wallH = 2.7;
  const paint = b.color;
  const roof = b.roof;
  // posts
  const px = w / 2 - 0.25, pz = d / 2 - 0.25;
  for (const sx of [-px, 0, px]) for (const sz of [-pz, pz]) K.box(sx, stilt / 2, sz, 0.26, stilt, 0.26, WW.post, { major: true });
  // floor deck (wider at the front = veranda)
  K.box(0, stilt + 0.1, 0.5, w + 0.3, 0.2, d + 1.4, WW.woodDark, { outline: 'prop' });
  // walls
  K.box(0, stilt + 0.2 + wallH / 2, -0.2, w, wallH, d - 0.6, paint, { outline: 'building' });
  // trim band + corner boards
  K.box(0, stilt + 0.3, -0.2, w + 0.06, 0.2, d - 0.54, WW.trim);
  for (const sx of [-w / 2, w / 2]) K.box(sx, stilt + 0.2 + wallH / 2, d / 2 - 0.5, 0.14, wallH, 0.14, WW.trim);
  // roof
  const ry = stilt + 0.2 + wallH;
  K.prim(UNIT.prism, 0, ry, 0.1, w + 0.9, 1.5 + w * 0.06, d + 0.9, roof, { outline: 'building' });
  // veranda rail
  K.box(0, stilt + 0.75, d / 2 + 0.75, w + 0.2, 0.08, 0.08, WW.trim);
  for (let i = 0; i <= 4; i++) K.box(-w / 2 - 0.05 + (w + 0.1) * (i / 4), stilt + 0.5, d / 2 + 0.75, 0.08, 0.6, 0.08, WW.trim);
  // veranda posts holding the roof overhang
  for (const sx of [-w / 2 + 0.1, w / 2 - 0.1]) K.box(sx, stilt + 0.2 + wallH / 2, d / 2 + 0.75, 0.12, wallH, 0.12, WW.trim);
  // door + windows with shutters on the front wall
  const fz = d / 2 - 0.5 + 0.03;
  K.box(0, stilt + 1.2, fz, 0.9, 1.9, 0.06, WW.door);
  for (const sx of [-w * 0.3, w * 0.3]) {
    K.box(sx, stilt + 1.5, fz, 0.8, 0.9, 0.05, WW.glass, { unlit: true });
    K.box(sx - 0.55, stilt + 1.5, fz + 0.02, 0.28, 1.0, 0.05, b.shutter);
    K.box(sx + 0.55, stilt + 1.5, fz + 0.02, 0.28, 1.0, 0.05, b.shutter);
  }
  // side window
  K.box(w / 2 + 0.03, stilt + 1.5, -0.4, 0.05, 0.8, 0.9, WW.glass, { unlit: true });
  // front stairs (4 steps down to the yard)
  const run = 1.9, L = Math.hypot(run, stilt), th = -Math.atan2(run, stilt);
  for (const sx of [-0.52, 0.52]) K.box(w * 0.32 + sx, stilt / 2, d / 2 + 1.25 + run / 2, 0.1, L, 0.22, WW.woodDark, { rx: th });
  for (let i = 0; i < 4; i++) {
    const t = (i + 1) / 5;
    K.box(w * 0.32, stilt * (1 - t), d / 2 + 1.25 + t * run, 1.0, 0.12, 0.42, WW.woodPale);
  }
}

/** Two-storey colonial house: white walls, double veranda with posts, hip roof. */
export function colonialHouse(K, b) {
  const { w, d } = b;
  const H = 3.0;
  const floors = b.floors || 2;
  const body = b.color;
  K.box(0, 0.25, 0, w + 0.4, 0.5, d + 0.4, WW.stone);
  K.box(0, 0.5 + (H * floors) / 2, -0.4, w, H * floors, d - 0.8, body, { outline: 'building' });
  for (let f = 0; f < floors; f++) {
    const y = 0.5 + f * H;
    // veranda floor + rail on the upper floor
    if (f > 0) {
      K.box(0, y, d / 2 + 0.3, w + 0.2, 0.18, 1.6, WW.woodPale);
      K.box(0, y + 0.55, d / 2 + 1.05, w + 0.2, 0.08, 0.08, WW.trim);
      for (let i = 0; i <= 6; i++) K.box(-w / 2 + w * (i / 6), y + 0.3, d / 2 + 1.05, 0.07, 0.5, 0.07, WW.trim);
    }
    // windows (tall, louvred shutters)
    const n = Math.max(2, Math.floor(w / 2.4));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 1.2 + i * ((w - 2.4) / Math.max(1, n - 1));
      K.box(x, y + 1.5, d / 2 - 0.77, 0.8, 1.5, 0.05, WW.glass, { unlit: true });
      K.box(x, y + 1.5, d / 2 - 0.74, 1.15, 1.7, 0.03, b.shutter);
    }
  }
  // veranda posts, full height
  for (let i = 0; i <= 3; i++) K.box(-w / 2 + 0.1 + (w - 0.2) * (i / 3), 0.5 + (H * floors) / 2, d / 2 + 1.0, 0.18, H * floors, 0.18, WW.trim);
  // hip roof over walls + veranda
  K.prim(UNIT.pyramid, 0, 0.5 + H * floors + 1.0, 0, w + 1.2, 2.0, d + 1.6, b.roof, { outline: 'building' });
}

/** Northside shop house: painted concrete, flat roof + parapet, overhanging wooden balcony, awning, signage band. */
export function shopHouse(K, b) {
  const { w, d } = b;
  const floors = b.floors || 2;
  const H = 3.0;
  const h = floors * H;
  K.box(0, h / 2, 0, w, h, d, b.color, { outline: 'building' });
  K.box(0, h + 0.3, 0, w + 0.2, 0.6, d + 0.2, WW.trim);
  // ground floor: shutters / shop front + awning
  K.box(0, 1.2, d / 2 + 0.03, w * 0.8, 2.2, 0.05, WW.dark);
  K.box(0, 2.6, d / 2 + 0.6, w * 0.9, 0.12, 1.3, b.awning, { rx: 0.12 });
  // upper floors: balcony on posts, windows
  for (let f = 1; f < floors; f++) {
    const y = f * H;
    K.box(0, y, d / 2 + 0.8, w * 0.9, 0.16, 1.6, WW.woodPale, { outline: 'prop' });
    K.box(0, y + 0.55, d / 2 + 1.55, w * 0.9, 0.08, 0.08, WW.trim);
    for (let i = 0; i <= 5; i++) K.box(-w * 0.45 + w * 0.9 * (i / 5), y + 0.3, d / 2 + 1.55, 0.06, 0.5, 0.06, WW.trim);
    const n = Math.max(2, Math.floor(w / 2.4));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 1.1 + i * ((w - 2.2) / Math.max(1, n - 1));
      K.box(x, y + 1.4, d / 2 + 0.03, 0.75, 1.2, 0.05, WW.glass, { unlit: true });
    }
  }
  if (floors > 1) for (const sx of [-w * 0.45, w * 0.45]) K.box(sx, H / 2, d / 2 + 1.55, 0.14, H, 0.14, WW.trim);
  // side windows
  for (let f = 0; f < floors; f++) K.box(w / 2 + 0.03, f * H + 1.5, 0, 0.05, 1.0, 0.9, WW.glass, { unlit: true });
}

/** Open market hall: columns, big hip roof (the market by the swing bridge). */
export function marketHall(K, b) {
  const { w, d } = b;
  K.box(0, 0.15, 0, w, 0.3, d, WW.stone);
  const nx = Math.max(3, Math.round(w / 4)), nz = Math.max(2, Math.round(d / 4));
  for (let i = 0; i <= nx; i++) for (const sz of [-d / 2 + 0.3, d / 2 - 0.3]) K.box(-w / 2 + 0.3 + (w - 0.6) * (i / nx), 2.3, sz, 0.35, 4.0, 0.35, WW.white);
  for (let j = 1; j < nz; j++) for (const sx of [-w / 2 + 0.3, w / 2 - 0.3]) K.box(sx, 2.3, -d / 2 + 0.3 + (d - 0.6) * (j / nz), 0.35, 4.0, 0.35, WW.white);
  K.box(0, 4.4, 0, w + 0.6, 0.3, d + 0.6, WW.trim, { outline: 'building' });
  K.prim(UNIT.pyramid, 0, 5.5, 0, w + 1.6, 2.2, d + 1.6, WW.roofRed, { outline: 'building' });
  // stall counters inside
  for (let i = 0; i < nx; i++) K.box(-w / 2 + 2 + (w - 4) * (i / Math.max(1, nx - 1)), 0.75, 0, 1.6, 0.9, d * 0.5, pick(WW.paints, i, w));
}

/** Low warehouse / boat shed. */
export function warehouse(K, b) {
  const { w, d } = b;
  const h = b.h || 6;
  K.box(0, h / 2, 0, w, h, d, b.color, { outline: 'building' });
  K.prim(UNIT.prism, 0, h, 0, w + 0.6, 1.6, d + 0.6, WW.roofZinc, { outline: 'building' });
  K.box(0, h * 0.35, d / 2 + 0.04, w * 0.45, h * 0.7, 0.08, WW.dark);
}

/** Small church: white nave + bell tower. */
export function chapel(K, b) {
  const { w, d } = b;
  K.box(0, 3, -0.5, w, 6, d - 1, WW.white, { outline: 'building' });
  K.prim(UNIT.prism, 0, 6, -0.5, w + 0.6, 2.6, d - 0.4, WW.roofRed, { outline: 'building' });
  K.box(0, 5, d / 2 - 0.6, 2.6, 10, 2.6, WW.white, { outline: 'building' });
  K.prim(UNIT.pyramid, 0, 11.2, d / 2 - 0.6, 3.0, 2.4, 3.0, WW.roofRed, { outline: 'prop' });
  K.box(0, 2, d / 2 + 0.72, 1.4, 3.0, 0.06, WW.door);
  K.box(0, 7.5, d / 2 + 0.71, 0.9, 1.2, 0.05, WW.glass, { unlit: true });
}

/** Fort George lighthouse: white tapered tower, red gallery + lantern. */
export function lighthouse(K, b) {
  K.prim(UNIT.cyl8, 0, 1, 0, 6, 2, 6, WW.stone, { outline: 'building' });
  K.prim(UNIT.cyl8, 0, 9, 0, 3.4, 14, 3.4, WW.lighthouse, { outline: 'building' });
  K.prim(UNIT.cyl8, 0, 16.3, 0, 4.4, 0.4, 4.4, WW.lighthouseRed);
  K.prim(UNIT.cyl8, 0, 17.4, 0, 2.2, 1.8, 2.2, WW.lamp, { unlit: true });
  K.prim(UNIT.cone6, 0, 19.0, 0, 3.0, 1.6, 3.0, WW.lighthouseRed, { outline: 'prop' });
  for (const y of [5, 9, 13]) K.box(0, y, 1.71, 0.5, 0.9, 0.05, WW.glass, { unlit: true });
}

/** Water-taxi terminal: wooden hall on the dock with a big sign roof. */
export function terminal(K, b) {
  const { w, d } = b;
  K.box(0, 1.8, 0, w, 3.6, d, b.color || 0x4fb3aa, { outline: 'building' });
  K.prim(UNIT.prism, 0, 3.6, 0, w + 1.6, 2.0, d + 2.4, WW.roofRed, { outline: 'building' });
  K.box(0, 1.2, d / 2 + 0.04, w * 0.6, 2.4, 0.06, WW.dark);
  K.box(0, 4.6, d / 2 + 1.25, w * 0.7, 0.9, 0.12, WW.trim);
}

export const BUILDERS = { stilt: stiltHouse, colonial: colonialHouse, shop: shopHouse, market: marketHall, warehouse, chapel, lighthouse, terminal };

// ─── Instanced prop geometries (vertex-coloured, shared across chunks) ────────────
function colorize(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(hex);
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
function partsGeometry(parts) {
  // parts: [geo, hex, matrix]
  const b = new GeoBatcher();
  for (const [geo, hex, m] of parts) b.add(geo, m, hex);
  const g = b.build();
  g.userData.shared = true;
  return g;
}
const M = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

let _props = null;
/** The shared prop geometries (built on first use). Unit-height ~ real metres. */
export function propGeometries() {
  if (_props) return _props;
  const palmParts = [
    [UNIT.cyl6, WW.wood, M(0, 1.2, 0, 0.36, 2.4, 0.36)],
    [UNIT.cyl6, WW.wood, M(0.12, 3.3, 0, 0.3, 2.0, 0.3, 0, 0, -0.12)],
    [UNIT.cyl6, WW.wood, M(0.32, 5.0, 0, 0.26, 1.6, 0.26, 0, 0, -0.22)],
    [UNIT.cone4, 0x6b4a2a, M(0.42, 5.75, 0, 0.5, 0.4, 0.5)],
  ];
  for (let k = 0; k < 7; k++) palmParts.push([UNIT.cone4, k % 2 ? 0x3ea444 : 0x4cb64a, null]);
  // Fix leaf orientation: cone points along +y; rotate to lie outward and droop.
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const m = new THREE.Matrix4().makeTranslation(0.42, 5.7, 0)
      .multiply(new THREE.Matrix4().makeRotationY(-a))
      .multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 - 0.35))
      .multiply(new THREE.Matrix4().makeTranslation(0, 1.3, 0))
      .multiply(new THREE.Matrix4().makeScale(0.6, 2.7, 0.16));
    palmParts[4 + k][2] = m;
  }
  const palm = partsGeometry(palmParts);

  const stall = partsGeometry([
    [UNIT.box, 0xeab84c, M(0, 0.55, 0, 2.4, 1.1, 1.6)],
    [UNIT.box, WW.woodDark, M(-1.1, 1.3, 0.75, 0.08, 2.6, 0.08)], [UNIT.box, WW.woodDark, M(1.1, 1.3, 0.75, 0.08, 2.6, 0.08)],
    [UNIT.box, WW.woodDark, M(-1.1, 1.3, -0.75, 0.08, 2.6, 0.08)], [UNIT.box, WW.woodDark, M(1.1, 1.3, -0.75, 0.08, 2.6, 0.08)],
    [UNIT.box, 0xf2607e, M(-0.7, 2.62, 0, 0.7, 0.1, 2.0, 0.1)], [UNIT.box, 0xfbf7ef, M(0, 2.62, 0, 0.7, 0.1, 2.0, 0.1)], [UNIT.box, 0xf2607e, M(0.7, 2.62, 0, 0.7, 0.1, 2.0, 0.1)],
    [UNIT.box, 0xf28f6b, M(-0.6, 1.2, 0.1, 0.5, 0.3, 0.5)], [UNIT.box, 0xa8d66b, M(0.1, 1.2, -0.1, 0.5, 0.3, 0.5)], [UNIT.box, 0xf6d36b, M(0.7, 1.2, 0.1, 0.5, 0.3, 0.5)],
  ]);

  const fenceParts = [
    [UNIT.box, WW.trim, M(0, 0.45, 0, 4.0, 0.08, 0.06)], [UNIT.box, WW.trim, M(0, 0.85, 0, 4.0, 0.08, 0.06)],
  ];
  for (let i = 0; i < 6; i++) fenceParts.push([UNIT.box, WW.trim, M(-1.8 + i * 0.72, 0.55, 0, 0.12, 1.1, 0.05)]);
  const fence = partsGeometry(fenceParts);

  const lampPole = partsGeometry([
    [UNIT.cyl6, WW.dark, M(0, 2.4, 0, 0.14, 4.8, 0.14)],
    [UNIT.box, WW.dark, M(0.45, 4.75, 0, 0.9, 0.08, 0.08)],
  ]);
  const lampHead = partsGeometry([[UNIT.box, WW.lamp, M(0.85, 4.6, 0, 0.5, 0.18, 0.4)]]);

  // Panga / skiff: tapered hull (box + bow wedge), thwarts, outboard. Hull white → instanceColor paints it.
  const boat = partsGeometry([
    [UNIT.box, 0xffffff, M(0, 0.35, 0.4, 1.6, 0.6, 4.0)],
    [UNIT.box, 0xffffff, M(0, 0.35, -1.6, 1.13, 0.6, 1.13, 0, Math.PI / 4, 0)],
    [UNIT.box, 0x7a5232, M(0, 0.62, 0.4, 1.4, 0.06, 3.6)],
    [UNIT.box, 0xd6b07a, M(0, 0.7, 0.2, 1.5, 0.1, 0.35)], [UNIT.box, 0xd6b07a, M(0, 0.7, 1.4, 1.5, 0.1, 0.35)],
    [UNIT.box, 0x3c3f4c, M(0, 0.75, 2.5, 0.4, 0.7, 0.4)],
    [UNIT.box, 0xfbf7ef, M(0, 0.68, 0.4, 1.66, 0.08, 4.04)],
  ]);

  // Black water tank on a timber stand (the Belize rooftop / yard tank).
  const tank = partsGeometry([
    [UNIT.box, WW.post, M(-0.55, 1.0, -0.55, 0.16, 2.0, 0.16)], [UNIT.box, WW.post, M(0.55, 1.0, -0.55, 0.16, 2.0, 0.16)],
    [UNIT.box, WW.post, M(-0.55, 1.0, 0.55, 0.16, 2.0, 0.16)], [UNIT.box, WW.post, M(0.55, 1.0, 0.55, 0.16, 2.0, 0.16)],
    [UNIT.box, WW.woodDark, M(0, 2.05, 0, 1.4, 0.12, 1.4)],
    [UNIT.cyl8, WW.tank, M(0, 2.85, 0, 1.3, 1.5, 1.3)],
    [UNIT.cyl8, 0x4a4f58, M(0, 3.65, 0, 0.5, 0.16, 0.5)],
  ]);

  // Mangrove / sea-grape bush: two lumpy cones.
  const bush = partsGeometry([
    [UNIT.cone6, 0x3e9a44, M(0, 0.9, 0, 2.2, 1.8, 2.2)],
    [UNIT.cone6, 0x4cae4a, M(0.6, 0.7, 0.4, 1.6, 1.4, 1.6)],
  ]);

  // Beach umbrella / palapa.
  const palapa = partsGeometry([
    [UNIT.cyl6, WW.wood, M(0, 1.2, 0, 0.16, 2.4, 0.16)],
    [UNIT.cone6, 0xd9b45a, M(0, 2.6, 0, 3.2, 1.0, 3.2)],
  ]);

  // Golf cart (island lanes, static decoration).
  const cart = partsGeometry([
    [UNIT.box, 0xffffff, M(0, 0.55, 0, 1.2, 0.45, 2.2)],
    [UNIT.box, 0x3c3f4c, M(0, 0.85, 0.3, 1.1, 0.35, 0.5)],
    [UNIT.box, 0xfbf7ef, M(0, 1.85, 0, 1.3, 0.08, 2.0)],
    [UNIT.box, 0x3c3f4c, M(-0.55, 1.3, -0.8, 0.06, 1.1, 0.06)], [UNIT.box, 0x3c3f4c, M(0.55, 1.3, -0.8, 0.06, 1.1, 0.06)],
    [UNIT.box, 0x3c3f4c, M(-0.55, 1.3, 0.8, 0.06, 1.1, 0.06)], [UNIT.box, 0x3c3f4c, M(0.55, 1.3, 0.8, 0.06, 1.1, 0.06)],
    [UNIT.cyl8, 0x222222, M(-0.6, 0.25, -0.7, 0.45, 0.2, 0.45, 0, 0, Math.PI / 2)], [UNIT.cyl8, 0x222222, M(0.6, 0.25, -0.7, 0.45, 0.2, 0.45, 0, 0, Math.PI / 2)],
    [UNIT.cyl8, 0x222222, M(-0.6, 0.25, 0.7, 0.45, 0.2, 0.45, 0, 0, Math.PI / 2)], [UNIT.cyl8, 0x222222, M(0.6, 0.25, 0.7, 0.45, 0.2, 0.45, 0, 0, Math.PI / 2)],
  ]);

  _props = {
    palm: { geo: palm, outline: true },
    stall: { geo: stall, outline: true },
    fence: { geo: fence, outline: false },
    lampPole: { geo: lampPole, outline: false },
    lampHead: { geo: lampHead, outline: false, unlit: true },
    boat: { geo: boat, outline: true },
    tank: { geo: tank, outline: true },
    bush: { geo: bush, outline: false },
    palapa: { geo: palapa, outline: true },
    cart: { geo: cart, outline: true },
  };
  for (const p of Object.values(_props)) { p.geo.computeBoundingBox(); p.geo.computeBoundingSphere(); }
  return _props;
}
