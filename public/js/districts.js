import { WW, hash2, pick } from './kit.js';

/**
 * belizetriniOPNWRLD — streamed district layout (good-1+11).
 *
 * Pure data, generated deterministically at boot (no geometry): land pieces, water channels, roads
 * (split at chunk borders so every chunk owns its own road-graph segments), building lots, props,
 * bridges, docks and colliders. chunks.js turns a chunk's share of this into geometry when the player
 * comes near, and the far-LOD silhouettes are built from the same records.
 *
 * Axes: +x east, +z north (the good-1+1 core: Belize City west, causeway, Port of Spain east, sea south).
 * Fiction: real neighbourhood names / landmarks are stylised reads only, no real addresses or businesses.
 */
export const CHUNK = 160;

/** The good-1+1..+10 hand-built core (always resident, built by world.js). */
export const CORE_RECTS = [
  { minX: -160, maxX: 60, minZ: -105, maxZ: 115, id: 'coreBelize' },
  { minX: 45, maxX: 245, minZ: -95, maxZ: 105, id: 'corePOS' },
];

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const R = (minX, maxX, minZ, maxZ, extra = {}) => ({ minX, maxX, minZ, maxZ, ...extra });
const inside = (r, x, z, m = 0) => x >= r.minX - m && x <= r.maxX + m && z >= r.minZ - m && z <= r.maxZ + m;
const overlap = (a, b, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
function segDist(e, x, z) {
  const minX = Math.min(e.x0, e.x1), maxX = Math.max(e.x0, e.x1), minZ = Math.min(e.z0, e.z1), maxZ = Math.max(e.z0, e.z1);
  const dx = Math.max(minX - x, 0, x - maxX), dz = Math.max(minZ - z, 0, z - maxZ);
  return Math.hypot(dx, dz);
}
const contains = (outer, r, m = 0) => r.minX >= outer.minX + m && r.maxX <= outer.maxX - m && r.minZ >= outer.minZ + m && r.maxZ <= outer.maxZ - m;

/** Simple spatial hash of rects for overlap tests during layout. */
class RectHash {
  constructor(cell = 32) { this.cell = cell; this.m = new Map(); }
  _keys(r) {
    const c = this.cell, out = [];
    for (let i = Math.floor(r.minX / c); i <= Math.floor(r.maxX / c); i++) for (let j = Math.floor(r.minZ / c); j <= Math.floor(r.maxZ / c); j++) out.push(i + ',' + j);
    return out;
  }
  add(r) { for (const k of this._keys(r)) { let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); a.push(r); } }
  hits(r, m = 0) {
    const q = { minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m };
    for (const k of this._keys(q)) for (const o of this.m.get(k) || []) if (overlap(o, q)) return true;
    return false;
  }
}

// ─── Belize City expansion (good-1+11) ─────────────────────────────────────────
const CREEK = R(-600, 60, 170, 190, { id: 'creek', label: 'Haulover Creek' });
const CANAL = R(-266, -254, -105, 170, { id: 'canal', label: 'Collet Canal' });

function belizeExpansion() {
  const districts = [
    { id: 'belizeWest', label: 'Belize City · Canal Lanes', rect: R(-560, -160, -105, 330), style: 'lanes' },
    { id: 'belizeNorth', label: 'Belize City · Northside', rect: R(-160, 10, 115, 330), style: 'northside' },
    { id: 'fortGeorge', label: 'Fort George', rect: R(10, 120, 115, 330), style: 'fort' },
  ];
  const land = [
    R(-560, -266, -105, 170, { district: 'belizeWest' }),
    R(-254, -160, -105, 170, { district: 'belizeWest' }),
    R(-560, -160, 190, 330, { district: 'belizeWest' }),
    R(-160, 10, 115, 170, { district: 'belizeNorth' }),
    R(10, 60, 115, 170, { district: 'fortGeorge' }),
    R(-160, 10, 190, 330, { district: 'belizeNorth' }),
    R(10, 60, 190, 330, { district: 'fortGeorge' }),
    R(60, 120, 240, 320, { district: 'fortGeorge', ground: 'park' }),
  ];
  const channels = [CREEK, CANAL];
  const W = (z, x1, x2, w, extra) => ({ x1, z1: z, x2, z2: z, w, ...extra });
  const N = (x, z1, z2, w, extra) => ({ x1: x, z1, x2: x, z2, w, ...extra });
  const roads = [
    W(-60, -560, -150, 7), W(0, -560, -120, 9, { name: 'Western Hwy' }), W(60, -560, -150, 7), W(120, -560, -150, 7),
    W(140, -560, 50, 8, { name: 'Creek Rd' }), W(220, -560, 50, 8, { name: 'North Front' }), W(280, -560, 105, 8, { name: 'Marine Pde' }),
    N(-520, -95, 140, 6), N(-450, -95, 140, 6), N(-380, -95, 320, 7), N(-310, -95, 140, 6), N(-210, -95, 140, 6),
    N(-150, -95, 320, 8, { name: 'Freetown Rd' }), N(-100, 50, 140, 8), N(-100, 220, 320, 7),
    N(-60, 50, 320, 9, { name: 'Queen St' }), N(-20, 220, 320, 7), N(40, 140, 280, 8),
    N(-480, 220, 320, 6), N(-270, 220, 320, 6), N(-210, 220, 320, 6),
  ];
  // Explicit landmark buildings (reserve their footprint before lots are placed).
  const landmarks = [
    { kind: 'market', x: -38, z: 207, w: 18, d: 12, yaw: -Math.PI / 2, district: 'belizeNorth', name: 'Queen St market' },
    { kind: 'lighthouse', x: 104, z: 302, w: 6, d: 6, yaw: 0, district: 'fortGeorge', name: 'Fort George lighthouse' },
    { kind: 'terminal', x: 50, z: 206, w: 12, d: 8, yaw: -Math.PI / 2, district: 'fortGeorge', name: 'Water taxi terminal', color: 0x4fb3aa },
    { kind: 'chapel', x: -330, z: 30, w: 10, d: 16, yaw: Math.PI / 2, district: 'belizeWest' },
    { kind: 'warehouse', x: -240, z: -85, w: 16, d: 12, yaw: 0, district: 'belizeWest', color: 0xa39486 },
    { kind: 'warehouse', x: -282, z: -85, w: 14, d: 12, yaw: 0, district: 'belizeWest', color: 0xc9a46a },
  ];
  const reserved = [
    R(15, 56, 292, 326, { id: 'memorialPark' }), // Fort George green
    R(-70, -50, 192, 218, { id: 'swingPlaza' }), // stalls north of the swing bridge
  ];
  const docks = [
    { x: 76, z: 206, w: 32, d: 5, id: 'taxiPier' },
    { x: 88, z: 214, w: 5, d: 12, id: 'taxiPierT' },
    { x: -20, z: 333.5, w: 5, d: 14, id: 'northPier' },
  ];
  return { districts, land, channels, roads, landmarks, reserved, docks, swingX: -60 };
}

// Style per district: lot sizes, building kinds, density.
const STYLE = {
  lanes: { spacing: [11, 14], kinds: [['stilt', 0.86], ['shop', 0.1], ['warehouse', 0.04]], setback: 2.0 },
  northside: { spacing: [9, 12], kinds: [['shop', 0.72], ['colonial', 0.18], ['stilt', 0.1]], setback: 1.0 },
  fort: { spacing: [14, 17], kinds: [['colonial', 0.85], ['shop', 0.15]], setback: 3.0 },
  island: { spacing: [10, 13], kinds: [['stilt', 0.9], ['shop', 0.1]], setback: 1.5 },
  town: { spacing: [9, 12], kinds: [['shop', 0.6], ['stilt', 0.3], ['colonial', 0.1]], setback: 1.0 },
};

function lotFor(kind, rnd) {
  switch (kind) {
    case 'stilt': return { w: 6 + Math.floor(rnd() * 3), d: 6 + Math.floor(rnd() * 2), front: 3.4 };
    case 'shop': return { w: 7 + Math.floor(rnd() * 4), d: 8 + Math.floor(rnd() * 3), front: 2.4, floors: 2 + (rnd() < 0.35 ? 1 : 0) };
    case 'colonial': return { w: 10 + Math.floor(rnd() * 3), d: 9 + Math.floor(rnd() * 2), front: 1.4, floors: 2 };
    case 'warehouse': return { w: 12 + Math.floor(rnd() * 5), d: 10 + Math.floor(rnd() * 3), front: 0.4, h: 5 + rnd() * 2 };
    default: return { w: 7, d: 7, front: 1 };
  }
}
function chooseKind(kinds, rnd) {
  let r = rnd(), acc = 0;
  for (const [k, p] of kinds) { acc += p; if (r <= acc) return k; }
  return kinds[0][0];
}

/** Footprint rect of a building record in world space (body + front porch / stairs). */
export function footprint(b, withFront = true) {
  const f = withFront ? (b.front || 0) : 0;
  // local: x in [-w/2,w/2], z in [-d/2, d/2 + f]
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const pts = [[-b.w / 2, -b.d / 2], [b.w / 2, -b.d / 2], [b.w / 2, b.d / 2 + f], [-b.w / 2, b.d / 2 + f]];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [lx, lz] of pts) {
    const x = b.x + lx * c + lz * s, z = b.z - lx * s + lz * c;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}
/** Local (lx, lz) of a record → world. */
export function toWorld(b, lx, lz) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
}

/** Split an axis-aligned road at chunk borders (each piece is owned by one chunk). */
function splitRoad(r) {
  const out = [];
  const horiz = r.z1 === r.z2;
  const a = horiz ? Math.min(r.x1, r.x2) : Math.min(r.z1, r.z2);
  const b = horiz ? Math.max(r.x1, r.x2) : Math.max(r.z1, r.z2);
  let s = a;
  while (s < b) {
    const e = Math.min(b, (Math.floor(s / CHUNK) + 1) * CHUNK);
    out.push(horiz ? { ...r, x1: s, x2: e } : { ...r, z1: s, z2: e });
    s = e;
  }
  return out;
}
export const roadRect = (r, pad = 0) => ({
  minX: Math.min(r.x1, r.x2) - (r.z1 === r.z2 ? 0 : r.w / 2 + pad), maxX: Math.max(r.x1, r.x2) + (r.z1 === r.z2 ? 0 : r.w / 2 + pad),
  minZ: Math.min(r.z1, r.z2) - (r.z1 === r.z2 ? r.w / 2 + pad : 0), maxZ: Math.max(r.z1, r.z2) + (r.z1 === r.z2 ? r.w / 2 + pad : 0),
});

/**
 * Build the full layout. `parts` = list of region generators (belize expansion now, islands in +12).
 */
export function generateLayout(parts = [belizeExpansion()]) {
  const rnd = mulberry(0xB3112E);
  const L = {
    districts: [], land: [], channels: [], roads: [], roadsWhole: [], buildings: [], docks: [], bridges: [], reserved: [],
    props: { palm: [], stall: [], fence: [], lampPole: [], lampHead: [], boat: [], tank: [], bush: [], palapa: [], cart: [] },
    edges: [], colliders: [], reefs: [], extraWater: [], spawns: [],
  };
  for (const p of parts) {
    L.districts.push(...p.districts); L.land.push(...p.land); L.channels.push(...(p.channels || []));
    L.roadsWhole.push(...p.roads); L.docks.push(...(p.docks || [])); L.reserved.push(...(p.reserved || []));
    if (p.reefs) L.reefs.push(...p.reefs);
    if (p.spawns) L.spawns.push(...p.spawns);
    for (const lm of p.landmarks || []) L.buildings.push({ ...lm, front: lm.front ?? 1.5, landmark: true, color: lm.color ?? WW.white, roof: lm.roof ?? WW.roofRed, shutter: WW.trim });
  }
  const districtOf = (x, z) => L.districts.find((d) => inside(d.rect, x, z))?.id || null;
  const isLand = (x, z) => L.land.some((r) => inside(r, x, z));
  const inChannel = (x, z, m = 0) => L.channels.some((c) => inside(c, x, z, m));

  // Roads → bridges where they cross channels / sea, then split at chunk borders.
  for (const r of L.roadsWhole) {
    const horiz = r.z1 === r.z2;
    for (const c of L.channels) {
      let cross = null;
      if (horiz && r.z1 >= c.minZ && r.z1 <= c.maxZ && Math.min(r.x1, r.x2) <= c.minX && Math.max(r.x1, r.x2) >= c.maxX) cross = [c.minX, c.maxX];
      if (!horiz && r.x1 >= c.minX && r.x1 <= c.maxX && Math.min(r.z1, r.z2) <= c.minZ && Math.max(r.z1, r.z2) >= c.maxZ) cross = [c.minZ, c.maxZ];
      if (!cross) continue;
      const pad = 3;
      const swing = !horiz && r.x1 === parts[0].swingX && c.id === 'creek';
      const b = horiz
        ? { x1: cross[0] - pad, x2: cross[1] + pad, z1: r.z1, z2: r.z1, w: r.w, horiz, kind: 'beam', over: c.id }
        : { x1: r.x1, x2: r.x1, z1: cross[0] - pad, z2: cross[1] + pad, w: r.w, horiz, kind: swing ? 'swing' : (c.id === 'creek' ? 'truss' : 'beam'), over: c.id };
      b.cx = (b.x1 + b.x2) / 2; b.cz = (b.z1 + b.z2) / 2;
      b.rect = roadRect(b, 2.2);
      L.bridges.push(b);
    }
    for (const s of splitRoad(r)) L.roads.push(s);
  }

  // Occupancy hash: roads (+ sidewalks), channels, reserved, core, docks, landmarks.
  const occ = new RectHash(32);
  for (const r of L.roadsWhole) occ.add(roadRect(r, 1.8 + 0.6));
  for (const c of L.channels) occ.add(c);
  for (const r of L.reserved) occ.add(r);
  for (const r of CORE_RECTS) occ.add({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ });
  for (const d of L.docks) occ.add({ minX: d.x - d.w / 2, maxX: d.x + d.w / 2, minZ: d.z - d.d / 2, maxZ: d.z + d.d / 2 });
  for (const b of L.buildings) occ.add(footprint(b));

  // Lots along every road side.
  const styleOf = (id) => STYLE[L.districts.find((d) => d.id === id)?.style] || STYLE.lanes;
  for (const r of L.roadsWhole) {
    if (r.noLots) continue;
    const horiz = r.z1 === r.z2;
    const a = horiz ? Math.min(r.x1, r.x2) : Math.min(r.z1, r.z2);
    const b = horiz ? Math.max(r.x1, r.x2) : Math.max(r.z1, r.z2);
    for (const side of [-1, 1]) {
      let t = a + 6 + rnd() * 4;
      while (t < b - 6) {
        const px = horiz ? t : r.x1, pz = horiz ? r.z1 : t;
        const dist = districtOf(px, pz);
        const st = dist ? styleOf(dist) : null;
        if (!st) { t += 10; continue; }
        const kind = chooseKind(st.kinds, rnd);
        const lot = lotFor(kind, rnd);
        const off = r.w / 2 + 1.8 + 1.0 + st.setback + lot.front + lot.d / 2; // +1.0 clears the road occupancy pad
        // facing the road: local +z points back at the road
        let x, z, yaw;
        if (horiz) { x = t + lot.w / 2; z = r.z1 + side * off; yaw = side > 0 ? Math.PI : 0; }
        else { x = r.x1 + side * off; z = t + lot.w / 2; yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2; }
        const rec = { kind, x, z, w: lot.w, d: lot.d, front: lot.front, yaw, floors: lot.floors, h: lot.h, district: dist };
        const fp = footprint(rec);
        const onLand = L.land.some((lr) => contains(lr, fp, 1.0));
        if (onLand && !occ.hits(fp, 0.8)) {
          rec.color = kind === 'colonial' ? pick(WW.colonial, x, z) : kind === 'shop' ? pick(WW.shop, x, z, 2) : kind === 'warehouse' ? 0xa39486 : pick(WW.paints, x, z, 1);
          rec.roof = kind === 'colonial' ? pick([WW.roofRed, WW.roofGreen, WW.roofRed, WW.roofTeal], x, z, 3) : pick([WW.roofZinc, WW.roofRed, WW.roofTeal, WW.roofZinc, WW.roofBlue], x, z, 4);
          rec.shutter = pick([0x3f9e98, 0x4a78b0, 0xc2483a, 0x5a9a5a, 0xfbf7ef], x, z, 5);
          rec.awning = pick([0xf2607e, 0x4fb3aa, 0xf6d36b, 0xf28f6b, 0x7fb6e8], x, z, 6);
          if (kind === 'stilt') rec.stilt = 1.9 + hash2(x, z, 7) * 0.8;
          occ.add(fp);
          L.buildings.push(rec);
          t += lot.w + st.spacing[0] - lot.w * 0.5 + rnd() * (st.spacing[1] - st.spacing[0]);
        } else t += 3;
      }
    }
  }

  // Colliders: building bodies (walls), not the porches.
  for (const b of L.buildings) {
    const body = { ...b, d: b.kind === 'stilt' ? b.d : b.d, front: 0 };
    const fp = footprint(body, false);
    const pad = 0.15;
    L.colliders.push({ minX: fp.minX - pad, maxX: fp.maxX + pad, minZ: fp.minZ - pad, maxZ: fp.maxZ + pad, district: true });
  }

  // Props tied to buildings: water tanks + picket fences for stilt houses.
  for (const b of L.buildings) {
    if (b.kind !== 'stilt') continue;
    if (hash2(b.x, b.z, 11) < 0.65) {
      const [tx, tz] = toWorld(b, b.w / 2 + 1.1, -b.d / 2 + 1.0);
      L.props.tank.push({ x: tx, z: tz, yaw: b.yaw, s: 1 });
    }
    if (hash2(b.x, b.z, 12) < 0.7) {
      const fz = b.d / 2 + b.front + 1.2;
      for (const lx of [-b.w / 2 + 1.6, b.w / 2 - 1.6 - 2.0]) {
        const [fx, fzw] = toWorld(b, lx, fz);
        L.props.fence.push({ x: fx, z: fzw, yaw: b.yaw, s: 0.8 });
      }
    }
  }

  // Street lamps (every ~26 m, alternating sides, not at intersections or on bridges).
  for (const r of L.roadsWhole) {
    if (r.noLamps) continue;
    const horiz = r.z1 === r.z2;
    const a = horiz ? Math.min(r.x1, r.x2) : Math.min(r.z1, r.z2);
    const b = horiz ? Math.max(r.x1, r.x2) : Math.max(r.z1, r.z2);
    let i = 0;
    for (let t = a + 10; t < b - 6; t += 26, i++) {
      const side = i % 2 ? 1 : -1;
      const off = r.w / 2 + 1.3;
      const x = horiz ? t : r.x1 + side * off, z = horiz ? r.z1 + side * off : t;
      const rr = { minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 };
      if (L.roadsWhole.some((o) => o !== r && overlap(roadRect(o, 1.8), rr))) continue;
      if (L.bridges.some((bb) => overlap(bb.rect, rr, 1))) continue;
      if (!isLand(x, z) || inChannel(x, z, 1)) continue;
      if (CORE_RECTS.some((c) => inside(c, x, z, 2))) continue;
      // arm points toward the road
      const dx = horiz ? 0 : -side, dz = horiz ? -side : 0;
      const yaw = Math.atan2(-dz, dx); // local +x (the arm) points at the road
      L.props.lampPole.push({ x, z, yaw, s: 1 });
      L.props.lampHead.push({ x, z, yaw, s: 1 });
    }
  }

  // Market stalls in the swing-bridge plaza and along Queen St.
  for (const res of L.reserved) {
    if (res.id !== 'swingPlaza') continue;
    for (let z = res.minZ + 3; z < res.maxZ - 2; z += 4.2) {
      L.props.stall.push({ x: res.minX + 2.5, z, yaw: -Math.PI / 2, s: 1 });
      L.props.stall.push({ x: res.maxX - 2.5, z, yaw: Math.PI / 2, s: 1 });
    }
  }

  // Edges of every land piece: sea → beach strip; channel → stone seawall.
  for (const lr of L.land) {
    const sides = [
      { x0: lr.minX, z0: lr.minZ, x1: lr.maxX, z1: lr.minZ, nx: 0, nz: -1 },
      { x0: lr.maxX, z0: lr.minZ, x1: lr.maxX, z1: lr.maxZ, nx: 1, nz: 0 },
      { x0: lr.maxX, z0: lr.maxZ, x1: lr.minX, z1: lr.maxZ, nx: 0, nz: 1 },
      { x0: lr.minX, z0: lr.maxZ, x1: lr.minX, z1: lr.minZ, nx: -1, nz: 0 },
    ];
    for (const s of sides) {
      const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      const n = Math.max(1, Math.round(len / 10));
      let run = null;
      const flush = () => { if (run) { L.edges.push(run); run = null; } };
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const ax = s.x0 + (s.x1 - s.x0) * t0, az = s.z0 + (s.z1 - s.z0) * t0;
        const bx = s.x0 + (s.x1 - s.x0) * t1, bz = s.z0 + (s.z1 - s.z0) * t1;
        const mx = (ax + bx) / 2 + s.nx * 2, mz = (az + bz) / 2 + s.nz * 2;
        let type;
        if (isLand(mx, mz) || CORE_RECTS.some((c) => inside(c, mx, mz))) type = null;
        else if (inChannel(mx, mz)) type = 'wall';
        else type = lr.beach === false ? 'wall' : 'beach';
        if (run && run.type === type) { run.x1 = bx; run.z1 = bz; continue; }
        flush();
        if (type) run = { type, x0: ax, z0: az, x1: bx, z1: bz, nx: s.nx, nz: s.nz, district: lr.district, sand: lr.sand };
      }
      flush();
    }
  }

  // Palms: jittered grid over each land piece, avoiding everything occupied; denser on beaches.
  const propOcc = new RectHash(32);
  for (const b of L.buildings) propOcc.add(footprint(b));
  for (const r of L.roadsWhole) propOcc.add(roadRect(r, 1.9));
  for (const d of L.docks) propOcc.add({ minX: d.x - d.w / 2, maxX: d.x + d.w / 2, minZ: d.z - d.d / 2, maxZ: d.z + d.d / 2 });
  const free = (x, z, m) => !propOcc.hits({ minX: x - m, maxX: x + m, minZ: z - m, maxZ: z + m });
  for (const lr of L.land) {
    const dens = lr.palms ?? 0.22;
    const step = 9;
    for (let x = lr.minX + 3; x < lr.maxX - 2; x += step) for (let z = lr.minZ + 3; z < lr.maxZ - 2; z += step) {
      const jx = x + (hash2(x, z, 21) - 0.5) * 6, jz = z + (hash2(x, z, 22) - 0.5) * 6;
      if (!inside(lr, jx, jz, -1.5)) continue;
      const edge = Math.min(jx - lr.minX, lr.maxX - jx, jz - lr.minZ, lr.maxZ - jz);
      const nearSea = edge < 9 && L.edges.some((e) => e.type === 'beach' && segDist(e, jx, jz) < 9);
      const p = nearSea ? 0.75 : dens;
      if (hash2(jx, jz, 23) > p) continue;
      if (!free(jx, jz, 1.6)) continue;
      if (CORE_RECTS.some((c) => inside(c, jx, jz, 1))) continue;
      const s = 0.8 + hash2(jx, jz, 24) * 0.5;
      if (lr.mangrove && edge < 12 && hash2(jx, jz, 25) < 0.6) L.props.bush.push({ x: jx, z: jz, yaw: hash2(jx, jz, 26) * 6.28, s });
      else L.props.palm.push({ x: jx, z: jz, yaw: hash2(jx, jz, 26) * 6.28, s });
      propOcc.add({ minX: jx - 1, maxX: jx + 1, minZ: jz - 1, maxZ: jz + 1 });
    }
  }
  // Mangrove bushes along the west lagoon shore.
  for (const e of L.edges) {
    if (e.type !== 'beach' || !L.land.some((lr) => lr.mangrove && inside(lr, (e.x0 + e.x1) / 2 - e.nx, (e.z0 + e.z1) / 2 - e.nz))) continue;
    const len = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
    for (let t = 2; t < len; t += 5) {
      const f = t / len; const x = e.x0 + (e.x1 - e.x0) * f - e.nx * 2.5, z = e.z0 + (e.z1 - e.z0) * f - e.nz * 2.5;
      if (free(x, z, 1.2)) L.props.bush.push({ x, z, yaw: hash2(x, z, 31) * 6.28, s: 0.9 + hash2(x, z, 32) * 0.6 });
    }
  }

  // Moored boats along the channels (in the water, bow along the bank).
  for (const c of L.channels) {
    const alongX = c.maxX - c.minX > c.maxZ - c.minZ;
    const len = alongX ? c.maxX - c.minX : c.maxZ - c.minZ;
    for (let t = 8; t < len - 8; t += 9) {
      for (const side of [0, 1]) {
        if (hash2(t, side, c.minX) > 0.42) continue;
        const x = alongX ? c.minX + t : (side ? c.maxX - 1.6 : c.minX + 1.6);
        const z = alongX ? (side ? c.maxZ - 1.6 : c.minZ + 1.6) : c.minZ + t;
        const rr = { minX: x - 3, maxX: x + 3, minZ: z - 3, maxZ: z + 3 };
        if (L.bridges.some((b) => overlap(b.rect, rr, 3))) continue;
        const bx = alongX ? x : (side ? c.maxX + 2 : c.minX - 2), bz = alongX ? (side ? c.maxZ + 2 : c.minZ - 2) : z;
        if (!isLand(bx, bz)) continue;
        L.props.boat.push({ x, z, yaw: (alongX ? Math.PI / 2 : 0) + (hash2(x, z, 41) < 0.5 ? Math.PI : 0), s: alongX ? 1 : 0.8, color: pick(WW.paints, x, z, 42), water: true });
      }
    }
  }
  // Boats moored at the docks.
  for (const d of L.docks) {
    if (d.noBoats) continue;
    const alongX = d.w > d.d;
    const len = alongX ? d.w : d.d;
    for (let t = -len / 2 + 4; t < len / 2 - 2; t += 7) for (const side of [-1, 1]) {
      if (hash2(d.x + t, side, 51) > 0.55) continue;
      const x = alongX ? d.x + t : d.x + side * (d.w / 2 + 1.4);
      const z = alongX ? d.z + side * (d.d / 2 + 1.4) : d.z + t;
      if (isLand(x, z)) continue;
      L.props.boat.push({ x, z, yaw: alongX ? Math.PI / 2 : 0, s: 1, color: pick(WW.paints, x, z, 52), water: true });
    }
  }

  // World bounds = everything + margin.
  const all = [...L.land, ...CORE_RECTS];
  L.bounds = {
    minX: Math.min(...all.map((r) => r.minX)) - 30, maxX: Math.max(...all.map((r) => r.maxX)) + 30,
    minZ: Math.min(...all.map((r) => r.minZ)) - 30, maxZ: Math.max(...all.map((r) => r.maxZ)) + 30,
  };
  L.districtOf = districtOf;
  return L;
}

export const REGIONS = { belizeExpansion };
