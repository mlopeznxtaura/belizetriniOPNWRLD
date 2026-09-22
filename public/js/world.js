import * as THREE from 'three';

/**
 * belizetriniOPNWRLD — Iteration A city builder
 * Explicit road graph (Belize west + Port of Spain east + causeway),
 * building kit, instanced curb props, day↔night tropical atmosphere.
 */

export const MAP = {
  belizeCenter: new THREE.Vector3(-60, 0, 0),
  trinidadCenter: new THREE.Vector3(140, 0, 10),
  bridgeZ: 0,
  waterY: -0.35,
  bounds: { minX: -140, maxX: 240, minZ: -90, maxZ: 110 },
};

const PALETTE = {
  asphalt: 0x16161f,
  sidewalk: 0x2a2a34,
  lane: 0xc9b86a,
  curb: 0x3a3a44,
  grassBelize: 0x1e3a28,
  grassPOS: 0x1a2e28,
  sand: 0x8a6e48,
  water: 0x0a4a5c,
  palmTrunk: 0x4a3020,
  palmLeaf: 0x1a5c32,
  neonPink: 0xf72585,
  neonCyan: 0x00f5d4,
  neonPurple: 0x9b5de5,
  neonAmber: 0xffb703,
  windowLit: 0xffe6a0,
  wood: 0x5c3a21,
  woodRoof: 0x3d2817,
  concrete: 0x3a3a48,
  concreteDark: 0x2a2a38,
  warehouse: 0x3a3540,
  market: 0xc9a227,
  colonial: 0xc4b59a,
  gasCanopy: 0xe63946,
};

/** Shared materials — one per role, never explode per-building mats */
function makeMats() {
  const std = (color, extras = {}) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: extras.roughness ?? 0.88,
      metalness: extras.metalness ?? 0.05,
      ...extras,
    });
  return {
    asphalt: std(PALETTE.asphalt, { roughness: 0.97 }),
    sidewalk: std(PALETTE.sidewalk, { roughness: 0.95 }),
    lane: new THREE.MeshBasicMaterial({ color: PALETTE.lane }),
    curb: std(PALETTE.curb),
    grassB: std(PALETTE.grassBelize, { roughness: 1 }),
    grassT: std(PALETTE.grassPOS, { roughness: 1 }),
    sand: std(PALETTE.sand, { roughness: 1 }),
    water: std(PALETTE.water, {
      roughness: 0.25,
      metalness: 0.55,
      transparent: true,
      opacity: 0.88,
    }),
    wood: std(PALETTE.wood),
    woodRoof: std(PALETTE.woodRoof),
    concrete: std(PALETTE.concrete),
    concreteDark: std(PALETTE.concreteDark),
    warehouse: std(PALETTE.warehouse, { roughness: 0.9 }),
    market: std(PALETTE.market),
    colonial: std(PALETTE.colonial, { roughness: 0.8 }),
    gasCanopy: std(PALETTE.gasCanopy),
    neonPink: new THREE.MeshBasicMaterial({ color: PALETTE.neonPink }),
    neonCyan: new THREE.MeshBasicMaterial({ color: PALETTE.neonCyan }),
    neonPurple: new THREE.MeshBasicMaterial({ color: PALETTE.neonPurple }),
    neonAmber: new THREE.MeshBasicMaterial({ color: PALETTE.neonAmber }),
    window: new THREE.MeshBasicMaterial({ color: PALETTE.windowLit }),
    palmTrunk: std(PALETTE.palmTrunk, { roughness: 1 }),
    palmLeaf: std(PALETTE.palmLeaf, { roughness: 0.95 }),
    metalDark: std(0x1a1a22, { metalness: 0.4, roughness: 0.6 }),
    bin: std(0x2d6a4f),
    barrel: std(0xb5651d),
    stallCanopy: new THREE.MeshBasicMaterial({ color: 0xf72585 }),
    roofFlat: std(0x12121a),
    steeple: std(0xd4c4a8),
    // Tropical night paint variants — cream / teal / coral / slate / mint (no yellow boxes)
    paintCream: std(0xd2c2a4, { roughness: 0.9 }),
    paintTeal: std(0x2f6f6a, { roughness: 0.88 }),
    paintCoral: std(0xc45c56, { roughness: 0.88 }),
    paintSlate: std(0x3a4555, { roughness: 0.9 }),
    paintMint: std(0x4a7c6f, { roughness: 0.88 }),
    paintSand: std(0xb8a88a, { roughness: 0.92 }),
    trimWhite: std(0xe8e0d4, { roughness: 0.85 }),
    lampHead: new THREE.MeshBasicMaterial({ color: 0xffcc66 }),
  };
}

// ─── Road graph data ───────────────────────────────────────────────
/** Axis-aligned road segments: { x1,z1,x2,z2, w } — w = asphalt width */
const ROADS = [
  // Belize City grid
  { x1: -120, z1: 0, x2: 0, z2: 0, w: 10 }, // Queen / main EW toward bridge
  { x1: -100, z1: 30, x2: -20, z2: 30, w: 8 },
  { x1: -100, z1: -30, x2: -20, z2: -30, w: 8 },
  { x1: -100, z1: -50, x2: -60, z2: -50, w: 7 }, // dock approach
  { x1: -100, z1: -50, x2: -100, z2: 50, w: 8 }, // waterfront NS
  { x1: -80, z1: -50, x2: -80, z2: 50, w: 8 },
  { x1: -60, z1: -50, x2: -60, z2: 50, w: 9 }, // Queen Street NS
  { x1: -40, z1: -40, x2: -40, z2: 45, w: 8 },
  { x1: -20, z1: -35, x2: -20, z2: 40, w: 7 },
  // Causeway / bridge
  { x1: 0, z1: 0, x2: 80, z2: 0, w: 12, bridge: true },
  // Port of Spain grid
  { x1: 80, z1: 0, x2: 210, z2: 0, w: 10 },
  { x1: 90, z1: 35, x2: 200, z2: 35, w: 8 },
  { x1: 90, z1: -35, x2: 200, z2: -35, w: 8 },
  { x1: 100, z1: -55, x2: 100, z2: 55, w: 8 },
  { x1: 120, z1: -55, x2: 120, z2: 55, w: 9 },
  { x1: 140, z1: -55, x2: 140, z2: 60, w: 9 }, // Ariapita-ish
  { x1: 160, z1: -55, x2: 160, z2: 55, w: 8 },
  { x1: 180, z1: -55, x2: 180, z2: 45, w: 8 },
  { x1: 200, z1: -40, x2: 200, z2: 30, w: 7 },
  { x1: 110, z1: -55, x2: 190, z2: -55, w: 8 }, // waterfront warehouses
];

/**
 * Building placements: [x, z, w, d, floors, kit]
 * kit: concrete|wood|market|warehouse|neon|church|gas|shop
 */
const BLOCKS = [
  // —— Belize waterfront / wood ——
  [-110, -18, 7, 6, 1, 'wood'],
  [-110, -8, 6, 5, 1, 'wood'],
  [-110, 8, 7, 6, 2, 'wood'],
  [-110, 20, 6, 5, 1, 'wood'],
  [-110, 35, 8, 6, 1, 'wood'],
  [-90, -18, 6, 5, 1, 'wood'],
  [-90, 12, 7, 6, 2, 'concrete'],
  [-90, 28, 6, 5, 1, 'wood'],
  [-90, 42, 7, 6, 1, 'wood'],
  // Queen Street market row
  [-68, -18, 10, 4, 1, 'market'],
  [-68, -8, 10, 4, 1, 'market'],
  [-52, -18, 8, 4, 1, 'market'],
  [-52, -8, 8, 4, 1, 'shop'],
  [-68, 12, 8, 6, 2, 'concrete'],
  [-68, 28, 7, 5, 2, 'wood'],
  [-52, 12, 7, 6, 2, 'neon'],
  [-52, 28, 8, 5, 1, 'shop'],
  [-52, 42, 7, 6, 1, 'wood'],
  // Mid Belize
  [-30, -18, 8, 7, 2, 'concrete'],
  [-30, -8, 7, 5, 1, 'shop'],
  [-30, 12, 9, 7, 3, 'neon'],
  [-30, 28, 8, 6, 2, 'concrete'],
  [-30, 42, 7, 5, 1, 'wood'],
  [-10, -18, 7, 6, 2, 'concrete'],
  [-10, 12, 8, 7, 2, 'gas'],
  [-10, 28, 7, 6, 1, 'shop'],
  // Church / colonial nod Belize
  [-75, 8, 10, 8, 2, 'church'],
  // Safehouse hill
  [-25, 65, 10, 8, 2, 'neon'],
  [-40, 62, 7, 6, 1, 'wood'],
  [-15, 58, 6, 5, 1, 'wood'],
  // —— Bridge approach POS ——
  [95, 12, 10, 8, 3, 'neon'],
  [95, -12, 9, 7, 2, 'concrete'],
  [95, 28, 8, 6, 2, 'shop'],
  [95, -28, 8, 6, 2, 'concrete'],
  // Downtown POS
  [115, 12, 12, 10, 4, 'neon'],
  [115, -12, 11, 9, 3, 'concrete'],
  [115, 28, 10, 8, 3, 'neon'],
  [115, -28, 9, 7, 2, 'shop'],
  [115, 48, 8, 7, 2, 'concrete'],
  [135, 12, 11, 10, 5, 'neon'],
  [135, -12, 10, 9, 4, 'concrete'],
  [135, 28, 10, 8, 3, 'neon'],
  [135, -28, 9, 8, 3, 'shop'],
  [135, 48, 9, 7, 2, 'concrete'],
  [155, 12, 10, 9, 4, 'neon'],
  [155, -12, 11, 8, 3, 'concrete'],
  [155, 28, 9, 7, 3, 'shop'],
  [155, -28, 8, 7, 2, 'gas'],
  [155, 48, 8, 6, 2, 'concrete'],
  [175, 12, 10, 8, 3, 'neon'],
  [175, -12, 9, 8, 4, 'concrete'],
  [175, 28, 8, 7, 2, 'shop'],
  [175, 8, 12, 6, 1, 'market'],
  // Colonial / church POS
  [145, 55, 12, 10, 2, 'church'],
  // Warehouses waterfront
  [125, -48, 18, 12, 1, 'warehouse'],
  [150, -48, 16, 12, 1, 'warehouse'],
  [175, -48, 20, 14, 1, 'warehouse'],
  [195, -30, 14, 12, 1, 'warehouse'],
  [195, -10, 12, 10, 2, 'warehouse'],
  [195, 15, 10, 8, 3, 'neon'],
];

/** Curb prop seeds: type + positions along roads (filled at build) */
const PROP_TYPES = ['bin', 'barrel', 'stall', 'palm', 'light'];

function roadToMeshParams(r) {
  const dx = r.x2 - r.x1;
  const dz = r.z2 - r.z1;
  const len = Math.hypot(dx, dz) || 1;
  const cx = (r.x1 + r.x2) / 2;
  const cz = (r.z1 + r.z2) / 2;
  const rotY = Math.atan2(dx, dz); // align length along local Z
  return { cx, cz, len, rotY, w: r.w, bridge: !!r.bridge };
}

function addCollider(colliders, x, z, w, d, pad = 0.15) {
  colliders.push({
    minX: x - w / 2 - pad,
    maxX: x + w / 2 + pad,
    minZ: z - d / 2 - pad,
    maxZ: z + d / 2 + pad,
  });
}

function resolveAABB(pos, radius, colliders) {
  let { x, z } = pos;
  for (const c of colliders) {
    const nearestX = THREE.MathUtils.clamp(x, c.minX, c.maxX);
    const nearestZ = THREE.MathUtils.clamp(z, c.minZ, c.maxZ);
    const dx = x - nearestX;
    const dz = z - nearestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      if (distSq < 1e-8) {
        // push out along shortest axis
        const left = x - c.minX;
        const right = c.maxX - x;
        const up = z - c.minZ;
        const down = c.maxZ - z;
        const m = Math.min(left, right, up, down);
        if (m === left) x = c.minX - radius;
        else if (m === right) x = c.maxX + radius;
        else if (m === up) z = c.minZ - radius;
        else z = c.maxZ + radius;
      } else {
        const dist = Math.sqrt(distSq);
        const push = (radius - dist) / dist;
        x += dx * push;
        z += dz * push;
      }
    }
  }
  pos.x = x;
  pos.z = z;
}

export { resolveAABB };

function buildBuilding(group, mats, colliders, x, z, w, d, floors, kit) {
  const h = kit === 'warehouse' ? 7 + floors * 1.5 : floors * 2.55 + 0.8;
  let bodyMat = mats.concrete;
  let roofMat = mats.roofFlat;
  let extra = null;

  switch (kit) {
    case 'wood':
      bodyMat = mats.wood;
      roofMat = mats.woodRoof;
      break;
    case 'market':
      bodyMat = mats.market;
      roofMat = mats.stallCanopy;
      break;
    case 'warehouse':
      bodyMat = mats.warehouse;
      roofMat = mats.metalDark;
      break;
    case 'neon':
      bodyMat = mats.concreteDark;
      break;
    case 'church':
      bodyMat = mats.colonial;
      roofMat = mats.steeple;
      break;
    case 'gas':
      bodyMat = mats.concrete;
      break;
    case 'shop':
      bodyMat = mats.concrete;
      break;
    default:
      bodyMat = mats.concrete;
  }

  // Tropical paint on concrete / shop / neon shells — never flat yellow boxes
  if (kit === 'concrete' || kit === 'shop' || kit === 'neon') {
    const paints = [mats.paintCream, mats.paintTeal, mats.paintCoral, mats.paintSlate, mats.paintMint, mats.paintSand];
    const idx = Math.abs(Math.floor(x * 3 + z * 7)) % paints.length;
    bodyMat = paints[idx];
  }

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
  body.position.set(x, h / 2, z);
  body.castShadow = false;
  body.receiveShadow = true;
  group.add(body);
  addCollider(colliders, x, z, w, d);

  // Front façade trim / baseboard for silhouette
  if (kit !== 'market') {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.08, 0.35, 0.12),
      mats.trimWhite || mats.concreteDark
    );
    base.position.set(x, 0.18, z + d / 2 + 0.05);
    group.add(base);
  }

  // Front window grid (street-facing) — readable at night
  if (kit !== 'warehouse' && kit !== 'market' && kit !== 'gas') {
    const cols = Math.max(2, Math.floor(w / 2.2));
    for (let f = 0; f < Math.max(1, floors); f++) {
      for (let c = 0; c < cols; c++) {
        if ((f + c + Math.floor(x)) % 4 === 0) continue;
        const wx = x - w / 2 + 0.8 + c * ((w - 1.6) / Math.max(1, cols - 1));
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), mats.window);
        win.position.set(wx, 1.25 + f * 2.55, z + d / 2 + 0.06);
        group.add(win);
        // Dark frame
        const frame = new THREE.Mesh(
          new THREE.BoxGeometry(0.58, 0.78, 0.04),
          mats.metalDark
        );
        frame.position.set(wx, 1.25 + f * 2.55, z + d / 2 + 0.03);
        group.add(frame);
      }
    }
  }

  // Mid-rise balcony on neon / concrete 2+ floors
  if ((kit === 'neon' || kit === 'concrete') && floors >= 2) {
    const balc = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.55, 0.1, 0.9),
      mats.concreteDark
    );
    balc.position.set(x, 2.6, z + d / 2 + 0.4);
    group.add(balc);
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.55, 0.35, 0.06),
      mats.metalDark
    );
    rail.position.set(x, 2.85, z + d / 2 + 0.8);
    group.add(rail);
  }

  // Roof
  if (kit === 'wood' || kit === 'church') {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.6, 0.7, d + 0.6),
      roofMat
    );
    roof.position.set(x, h + 0.35, z);
    group.add(roof);
  } else if (kit === 'market') {
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.8, 0.12, d + 0.6),
      mats.stallCanopy
    );
    canopy.position.set(x, h + 0.2, z);
    group.add(canopy);
  } else {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.2, 0.35, d + 0.2),
      roofMat
    );
    roof.position.set(x, h + 0.18, z);
    group.add(roof);
  }

  // Porch for wood
  if (kit === 'wood') {
    const porch = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.7, 0.12, 1.4),
      mats.wood
    );
    porch.position.set(x, 0.2, z + d / 2 + 0.6);
    group.add(porch);
    const postGeo = new THREE.BoxGeometry(0.12, 2.2, 0.12);
    for (const sx of [-w * 0.28, w * 0.28]) {
      const post = new THREE.Mesh(postGeo, mats.wood);
      post.position.set(x + sx, 1.2, z + d / 2 + 1.1);
      group.add(post);
    }
  }

  // Neon strip
  if (kit === 'neon') {
    const neon = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.7, 0.35, 0.12),
      Math.random() > 0.5 ? mats.neonPink : mats.neonCyan
    );
    neon.position.set(x, h * 0.65, z + d / 2 + 0.08);
    group.add(neon);
  }

  // Gas canopy
  if (kit === 'gas') {
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(w + 4, 0.2, d + 3),
      mats.gasCanopy
    );
    canopy.position.set(x, 4.2, z + d / 2 + 2);
    group.add(canopy);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 4.2, 6),
      mats.metalDark
    );
    pole.position.set(x, 2.1, z + d / 2 + 2);
    group.add(pole);
  }

  // Shop awning
  if (kit === 'shop') {
    const awn = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.9, 0.1, 1.2),
      mats.neonAmber
    );
    awn.position.set(x, 2.4, z + d / 2 + 0.5);
    group.add(awn);
  }

  // Church steeple
  if (kit === 'church') {
    const steeple = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 5, 2.2),
      mats.steeple
    );
    steeple.position.set(x, h + 2.5, z);
    group.add(steeple);
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(1.4, 2.5, 4),
      mats.woodRoof
    );
    tip.position.set(x, h + 6.2, z);
    group.add(tip);
  }

  // Warehouse loading bay stripe
  if (kit === 'warehouse') {
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.4, h * 0.55, 0.15),
      mats.metalDark
    );
    door.position.set(x, h * 0.3, z + d / 2 + 0.05);
    group.add(door);
  }

  // Lit windows (shared material)
  const floorsCount = Math.max(1, floors);
  for (let f = 0; f < floorsCount; f++) {
    if (kit === 'warehouse' || kit === 'market') continue;
    for (let side = 0; side < 2; side++) {
      if ((f + side + Math.floor(x + z)) % 3 === 0) continue;
      const wx = side === 0 ? x + w / 2 + 0.04 : x - w / 2 - 0.04;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.8), mats.window);
      win.position.set(wx, 1.3 + f * 2.55, z + ((f % 2) - 0.5) * d * 0.25);
      win.rotation.y = side === 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(win);
    }
  }

  return { h, kit };
}

function buildRoads(group, mats, roads) {
  const laneInstances = [];
  for (const r of roads) {
    const { cx, cz, len, rotY, w, bridge } = roadToMeshParams(r);

    // Asphalt
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(w, len + 0.5),
      mats.asphalt
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.rotation.z = rotY;
    asphalt.position.set(cx, bridge ? 0.45 : 0.02, cz);
    asphalt.receiveShadow = true;
    group.add(asphalt);

    // Sidewalks (both sides)
    const sw = 1.8;
    for (const side of [-1, 1]) {
      const off = (w / 2 + sw / 2) * side;
      const sx = cx + Math.cos(rotY) * off;
      const sz = cz - Math.sin(rotY) * off;
      const walk = new THREE.Mesh(
        new THREE.PlaneGeometry(sw, len + 0.5),
        mats.sidewalk
      );
      walk.rotation.x = -Math.PI / 2;
      walk.rotation.z = rotY;
      walk.position.set(sx, bridge ? 0.48 : 0.04, sz);
      walk.receiveShadow = true;
      group.add(walk);
    }

    // Center lane dashes — collect for later merge as thin planes
    const dashLen = 2.2;
    const gap = 2.8;
    const n = Math.floor(len / (dashLen + gap));
    const dirX = Math.sin(rotY);
    const dirZ = Math.cos(rotY);
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + dashLen / 2 + i * (dashLen + gap);
      laneInstances.push({
        x: cx + dirX * t,
        z: cz + dirZ * t,
        rotY,
        y: bridge ? 0.47 : 0.035,
      });
    }

    if (bridge) {
      // Deck thickness + rails
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(w + 1, 0.5, len),
        mats.concreteDark
      );
      deck.rotation.y = rotY;
      deck.position.set(cx, 0.2, cz);
      group.add(deck);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.25, 1.1, len),
          mats.neonCyan
        );
        rail.rotation.y = rotY;
        const ox = Math.cos(rotY) * (w / 2 + 0.4) * side;
        const oz = -Math.sin(rotY) * (w / 2 + 0.4) * side;
        rail.position.set(cx + ox, 0.9, cz + oz);
        group.add(rail);
      }
    }
  }

  // Instanced lane dashes
  if (laneInstances.length) {
    const dashGeo = new THREE.PlaneGeometry(0.22, 2.0);
    const dashMesh = new THREE.InstancedMesh(dashGeo, mats.lane, laneInstances.length);
    const dummy = new THREE.Object3D();
    laneInstances.forEach((d, i) => {
      dummy.position.set(d.x, d.y, d.z);
      dummy.rotation.set(-Math.PI / 2, 0, d.rotY);
      dummy.updateMatrix();
      dashMesh.setMatrixAt(i, dummy.matrix);
    });
    dashMesh.instanceMatrix.needsUpdate = true;
    group.add(dashMesh);
  }

  // Intersection pads at major crossings
  const crossings = [
    [-100, 0], [-80, 0], [-60, 0], [-40, 0], [-20, 0],
    [-100, 30], [-80, 30], [-60, 30], [-40, 30],
    [-100, -30], [-80, -30], [-60, -30], [-40, -30],
    [0, 0], [80, 0],
    [100, 0], [120, 0], [140, 0], [160, 0], [180, 0],
    [100, 35], [120, 35], [140, 35], [160, 35], [180, 35],
    [100, -35], [120, -35], [140, -35], [160, -35], [180, -35],
    [120, -55], [140, -55], [160, -55], [180, -55],
  ];
  for (const [ix, iz] of crossings) {
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      mats.asphalt
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(ix, 0.025, iz);
    pad.receiveShadow = true;
    group.add(pad);
  }
}

function scatterPropsAlongRoads(roads) {
  const bins = [];
  const barrels = [];
  const stalls = [];
  const palms = [];
  const lights = [];

  for (const r of roads) {
    if (r.bridge) {
      // sparse lights on bridge only
      const { cx, cz, len, rotY, w } = roadToMeshParams(r);
      const dirX = Math.sin(rotY);
      const dirZ = Math.cos(rotY);
      const sideX = Math.cos(rotY);
      const sideZ = -Math.sin(rotY);
      for (let t = -len / 2 + 10; t < len / 2; t += 18) {
        lights.push({
          x: cx + dirX * t + sideX * (w / 2 + 1.2),
          z: cz + dirZ * t + sideZ * (w / 2 + 1.2),
          color: 'cyan',
        });
      }
      continue;
    }

    const { cx, cz, len, rotY, w } = roadToMeshParams(r);
    const dirX = Math.sin(rotY);
    const dirZ = Math.cos(rotY);
    const sideX = Math.cos(rotY);
    const sideZ = -Math.sin(rotY);
    const curb = w / 2 + 1.1;

    for (let t = -len / 2 + 4; t < len / 2 - 4; t += 7) {
      const bx = cx + dirX * t;
      const bz = cz + dirZ * t;
      const side = (Math.floor(t / 7) % 2 === 0) ? 1 : -1;
      const px = bx + sideX * curb * side;
      const pz = bz + sideZ * curb * side;
      const roll = Math.abs(Math.sin(px * 12.9898 + pz * 78.233) * 43758.5453);
      const frac = roll - Math.floor(roll);

      if (frac < 0.22) bins.push({ x: px, z: pz });
      else if (frac < 0.38) barrels.push({ x: px, z: pz });
      else if (frac < 0.48 && Math.abs(r.x1 + r.x2) / 2 < 0) {
        // market stalls denser in Belize
        stalls.push({ x: px, z: pz, rot: rotY + (side > 0 ? 0 : Math.PI) });
      } else if (frac < 0.62) palms.push({ x: px + sideX * side * 1.5, z: pz + sideZ * side * 1.5 });

      // streetlights every ~14m on alternating sides
      if (Math.floor(t / 7) % 2 === 0) {
        lights.push({
          x: bx + sideX * (curb + 0.4) * side,
          z: bz + sideZ * (curb + 0.4) * side,
          color: bx < 40 ? (side > 0 ? 'cyan' : 'pink') : (side > 0 ? 'purple' : 'cyan'),
        });
      }
    }
  }

  // Extra palms near water / hills
  const extraPalms = [
    [-115, -40], [-105, -42], [-95, -38], [-50, -55], [-30, -52],
    [20, -12], [40, 10], [60, -10], [90, 50], [150, 70], [200, 40],
    [-20, 80], [-50, 75], [170, -70],
  ];
  for (const [x, z] of extraPalms) palms.push({ x, z });

  return { bins, barrels, stalls, palms, lights };
}

function addInstancedProps(group, mats, scatters, realLights) {
  const dummy = new THREE.Object3D();

  // Bins
  if (scatters.bins.length) {
    const geo = new THREE.BoxGeometry(0.55, 0.85, 0.55);
    const mesh = new THREE.InstancedMesh(geo, mats.bin, scatters.bins.length);
    scatters.bins.forEach((p, i) => {
      dummy.position.set(p.x, 0.42, p.z);
      dummy.rotation.set(0, (p.x + p.z) * 0.1, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // Barrels
  if (scatters.barrels.length) {
    const geo = new THREE.CylinderGeometry(0.35, 0.38, 0.9, 8);
    const mesh = new THREE.InstancedMesh(geo, mats.barrel, scatters.barrels.length);
    scatters.barrels.forEach((p, i) => {
      dummy.position.set(p.x, 0.45, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // Market stall boxes + canopies
  if (scatters.stalls.length) {
    const bodyGeo = new THREE.BoxGeometry(2.4, 1.6, 1.8);
    const bodyMesh = new THREE.InstancedMesh(bodyGeo, mats.market, scatters.stalls.length);
    const canGeo = new THREE.BoxGeometry(2.8, 0.1, 2.1);
    const canMesh = new THREE.InstancedMesh(canGeo, mats.stallCanopy, scatters.stalls.length);
    scatters.stalls.forEach((p, i) => {
      dummy.position.set(p.x, 0.8, p.z);
      dummy.rotation.set(0, p.rot || 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 1.7;
      dummy.updateMatrix();
      canMesh.setMatrixAt(i, dummy.matrix);
    });
    bodyMesh.instanceMatrix.needsUpdate = true;
    canMesh.instanceMatrix.needsUpdate = true;
    group.add(bodyMesh);
    group.add(canMesh);
  }

  // Palms — trunk + 4 leaf instances
  if (scatters.palms.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.22, 4.2, 6);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, mats.palmTrunk, scatters.palms.length);
    const leafGeo = new THREE.ConeGeometry(0.2, 2.4, 4);
    const leafMesh = new THREE.InstancedMesh(leafGeo, mats.palmLeaf, scatters.palms.length * 4);
    let li = 0;
    scatters.palms.forEach((p, i) => {
      dummy.position.set(p.x, 2.1, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);
      for (let k = 0; k < 4; k++) {
        dummy.position.set(p.x, 4.3, p.z);
        dummy.rotation.set(0.3, (k / 4) * Math.PI * 2, Math.PI / 2.4);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        leafMesh.setMatrixAt(li++, dummy.matrix);
      }
    });
    trunkMesh.instanceMatrix.needsUpdate = true;
    leafMesh.instanceMatrix.needsUpdate = true;
    group.add(trunkMesh);
    group.add(leafMesh);
  }

  // Streetlights: pole + arm + rectangular fixture (NO neon spheres)
  if (scatters.lights.length) {
    const n = scatters.lights.length;
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 4.8, 6);
    const poleMesh = new THREE.InstancedMesh(poleGeo, mats.metalDark, n);
    const armGeo = new THREE.BoxGeometry(0.08, 0.08, 0.9);
    const armMesh = new THREE.InstancedMesh(armGeo, mats.metalDark, n);
    const headGeo = new THREE.BoxGeometry(0.45, 0.18, 0.55);
    const headMesh = new THREE.InstancedMesh(headGeo, mats.lampHead || mats.neonAmber, n);
    scatters.lights.forEach((p, i) => {
      const side = (i % 2 === 0) ? 1 : -1;
      dummy.position.set(p.x, 2.4, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleMesh.setMatrixAt(i, dummy.matrix);
      // Arm sticks toward street
      dummy.position.set(p.x + side * 0.35, 4.7, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      armMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x + side * 0.7, 4.55, p.z);
      dummy.updateMatrix();
      headMesh.setMatrixAt(i, dummy.matrix);
    });
    poleMesh.instanceMatrix.needsUpdate = true;
    armMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    group.add(poleMesh);
    group.add(armMesh);
    group.add(headMesh);

    // Budget realtime lights — pick key locations
    const keyLights = [
      { x: -60, z: 0, c: PALETTE.neonCyan, i: 1.4, d: 32 },
      { x: -90, z: -30, c: PALETTE.neonAmber, i: 1.1, d: 28 },
      { x: -50, z: -12, c: PALETTE.neonPink, i: 1.2, d: 26 },
      { x: 40, z: 0, c: PALETTE.neonCyan, i: 1.3, d: 40 },
      { x: 140, z: 0, c: PALETTE.neonPurple, i: 1.5, d: 36 },
      { x: 140, z: 35, c: PALETTE.neonPink, i: 1.1, d: 28 },
      { x: 170, z: -48, c: PALETTE.neonAmber, i: 1.0, d: 30 },
      { x: -20, z: 65, c: PALETTE.neonCyan, i: 0.9, d: 24 },
    ];
    for (const L of keyLights) {
      const pl = new THREE.PointLight(L.c, L.i, L.d, 2);
      pl.position.set(L.x, 5.2, L.z);
      realLights.push(pl);
      group.add(pl);
    }
  }
}


/**
 * Time-of-day clock — lerps sun↔dusk↔night.
 * Full cycle ~5 real minutes. Default start = 14:00 (bright afternoon).
 * Night sky stays navy (not pure black); sky dome fills upper frustum.
 * Pass renderer so setClearColor tracks TOD every frame.
 */
export function createDayNight(scene, realLights = [], mats = null, renderer = null) {
  const ambient = new THREE.AmbientLight(0xffe8c8, 0.7);
  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3d6a32, 0.95);
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.35);
  sun.position.set(55, 95, 35);
  sun.castShadow = false;
  const moon = new THREE.DirectionalLight(0x9eb6ff, 0.05);
  moon.position.set(-50, 90, 40);
  moon.castShadow = false;
  scene.add(ambient);
  scene.add(hemi);
  scene.add(sun);
  scene.add(moon);

  // Large inward sky dome — fog:false so FogExp2 never flattens upper view to a black slab
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x5cb8e8,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 20), skyMat);
  skyDome.name = 'skyDome';
  skyDome.renderOrder = -1000;
  scene.add(skyDome);

  // Stars — fade out in daytime (fog:false so they stay visible at night)
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 350; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(0.15 + Math.random() * 0.85); // upper hemisphere bias
    const r = 420;
    starPos.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.1,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -999;
  scene.add(stars);

  scene.fog = new THREE.FogExp2(0xb8d4f0, 0.0018);
  scene.background = new THREE.Color(0x5cb8e8);
  if (renderer) renderer.setClearColor(0x5cb8e8, 1);

  const street = realLights.map((l) => ({ light: l, base: l.intensity }));

  // Keyframes: dusk/night bg lifted to navy — never a pure-black upper slab.
  // Daytime fog softened; night fog moderate so neon stays readable.
  const KEYS = [
    {
      h: 0,
      ambC: 0x2a3a58, ambI: 0.52,
      hemiSky: 0x2a3868, hemiGnd: 0x0c2018, hemiI: 0.68,
      sunC: 0x9eb6ff, sunI: 0.02, sunPos: [-40, 70, 30],
      moonC: 0x9eb6ff, moonI: 0.45,
      fogC: 0x1a2848, fogD: 0.0042, bg: 0x1a2a50,
      streetMul: 1.15, stars: 1, water: 0x082838,
    },
    {
      h: 5.5,
      ambC: 0x5a4870, ambI: 0.5,
      hemiSky: 0xff7a40, hemiGnd: 0x2a2818, hemiI: 0.75,
      sunC: 0xff8a40, sunI: 0.55, sunPos: [-70, 18, 40],
      moonC: 0x9eb6ff, moonI: 0.12,
      fogC: 0x5a4060, fogD: 0.0032, bg: 0x6a5080,
      streetMul: 0.7, stars: 0.35, water: 0x1a3a48,
    },
    {
      h: 7.5,
      ambC: 0xffe0b8, ambI: 0.68,
      hemiSky: 0x7ec8ff, hemiGnd: 0x4a7a38, hemiI: 0.95,
      sunC: 0xffe8c0, sunI: 1.2, sunPos: [-50, 45, 30],
      moonC: 0x9eb6ff, moonI: 0,
      fogC: 0xc8dff0, fogD: 0.0020, bg: 0x6ab8e0,
      streetMul: 0.12, stars: 0, water: 0x1a7a8c,
    },
    {
      h: 12,
      ambC: 0xfff0e0, ambI: 0.82,
      hemiSky: 0x6ec8ff, hemiGnd: 0x4a8a3a, hemiI: 1.1,
      sunC: 0xfff8ee, sunI: 1.6, sunPos: [20, 110, 10],
      moonC: 0x9eb6ff, moonI: 0,
      fogC: 0xb8d8f0, fogD: 0.0016, bg: 0x4aa8e0,
      streetMul: 0.05, stars: 0, water: 0x1a8a9c,
    },
    {
      h: 14,
      ambC: 0xffeed8, ambI: 0.8,
      hemiSky: 0x70c8ff, hemiGnd: 0x4a8a38, hemiI: 1.08,
      sunC: 0xfff4e0, sunI: 1.5, sunPos: [40, 95, 15],
      moonC: 0x9eb6ff, moonI: 0,
      fogC: 0xc0daf0, fogD: 0.0017, bg: 0x52b0e4,
      streetMul: 0.06, stars: 0, water: 0x1a8898,
    },
    {
      h: 16.5,
      ambC: 0xffd8a8, ambI: 0.74,
      hemiSky: 0xffb060, hemiGnd: 0x4a6a30, hemiI: 0.98,
      sunC: 0xffc070, sunI: 1.35, sunPos: [70, 48, 25],
      moonC: 0x9eb6ff, moonI: 0,
      fogC: 0xe8c8a0, fogD: 0.0020, bg: 0xe09858,
      streetMul: 0.1, stars: 0, water: 0x1a6a7c,
    },
    {
      h: 18.75,
      ambC: 0xffa070, ambI: 0.55,
      hemiSky: 0xff8060, hemiGnd: 0x2a2818, hemiI: 0.8,
      sunC: 0xff7040, sunI: 0.75, sunPos: [80, 14, 20],
      moonC: 0x9eb6ff, moonI: 0.1,
      fogC: 0x7a5868, fogD: 0.0030, bg: 0x8a6080,
      streetMul: 0.55, stars: 0.25, water: 0x0a3a48,
    },
    {
      h: 20.5,
      ambC: 0x2a3a58, ambI: 0.54,
      hemiSky: 0x2a3868, hemiGnd: 0x0c2018, hemiI: 0.7,
      sunC: 0x9eb6ff, sunI: 0.02, sunPos: [-40, 70, 30],
      moonC: 0x9eb6ff, moonI: 0.42,
      fogC: 0x1c2a48, fogD: 0.0040, bg: 0x1e3058,
      streetMul: 1.1, stars: 0.95, water: 0x082838,
    },
    {
      h: 24,
      ambC: 0x2a3a58, ambI: 0.52,
      hemiSky: 0x2a3868, hemiGnd: 0x0c2018, hemiI: 0.68,
      sunC: 0x9eb6ff, sunI: 0.02, sunPos: [-40, 70, 30],
      moonC: 0x9eb6ff, moonI: 0.45,
      fogC: 0x1a2848, fogD: 0.0042, bg: 0x1a2a50,
      streetMul: 1.15, stars: 1, water: 0x082838,
    },
  ];

  const _cA = new THREE.Color();
  const _cB = new THREE.Color();
  const _cOut = new THREE.Color();

  function sample(hour) {
    let h = ((hour % 24) + 24) % 24;
    let i0 = 0;
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (h >= KEYS[i].h && h <= KEYS[i + 1].h) {
        i0 = i;
        break;
      }
    }
    const a = KEYS[i0];
    const b = KEYS[i0 + 1];
    const span = b.h - a.h || 1;
    const t = THREE.MathUtils.clamp((h - a.h) / span, 0, 1);
    const smooth = t * t * (3 - 2 * t);
    const lerpN = (x, y) => x + (y - x) * smooth;
    const lerpCol = (ca, cb) => {
      _cA.setHex(ca);
      _cB.setHex(cb);
      return _cOut.copy(_cA).lerp(_cB, smooth).getHex();
    };
    return {
      ambC: lerpCol(a.ambC, b.ambC),
      ambI: lerpN(a.ambI, b.ambI),
      hemiSky: lerpCol(a.hemiSky, b.hemiSky),
      hemiGnd: lerpCol(a.hemiGnd, b.hemiGnd),
      hemiI: lerpN(a.hemiI, b.hemiI),
      sunC: lerpCol(a.sunC, b.sunC),
      sunI: lerpN(a.sunI, b.sunI),
      sunPos: [
        lerpN(a.sunPos[0], b.sunPos[0]),
        lerpN(a.sunPos[1], b.sunPos[1]),
        lerpN(a.sunPos[2], b.sunPos[2]),
      ],
      moonC: lerpCol(a.moonC, b.moonC),
      moonI: lerpN(a.moonI, b.moonI),
      fogC: lerpCol(a.fogC, b.fogC),
      fogD: lerpN(a.fogD, b.fogD),
      bg: lerpCol(a.bg, b.bg),
      streetMul: lerpN(a.streetMul, b.streetMul),
      stars: lerpN(a.stars, b.stars),
      water: lerpCol(a.water, b.water),
    };
  }

  let hour = 14; // bright afternoon — first load obviously sunny
  const CYCLE_SEC = 5 * 60; // ~5 min full day
  let paused = false;

  function apply() {
    const s = sample(hour);
    ambient.color.setHex(s.ambC);
    ambient.intensity = s.ambI;
    hemi.color.setHex(s.hemiSky);
    hemi.groundColor.setHex(s.hemiGnd);
    hemi.intensity = s.hemiI;
    sun.color.setHex(s.sunC);
    sun.intensity = s.sunI;
    sun.position.set(s.sunPos[0], s.sunPos[1], s.sunPos[2]);
    moon.color.setHex(s.moonC);
    moon.intensity = s.moonI;
    if (scene.fog) {
      scene.fog.color.setHex(s.fogC);
      scene.fog.density = s.fogD;
    }
    if (scene.background && scene.background.isColor) {
      scene.background.setHex(s.bg);
    }
    skyMat.color.setHex(s.bg);
    if (renderer) renderer.setClearColor(s.bg, 1);
    starMat.opacity = s.stars;
    stars.visible = s.stars > 0.02;
    for (const st of street) {
      st.light.intensity = st.base * s.streetMul;
    }
    if (mats?.water?.color) mats.water.color.setHex(s.water);
  }

  apply();

  return {
    get hour() { return hour; },
    setHour(h) {
      hour = ((h % 24) + 24) % 24;
      apply();
    },
    /** Bind WebGLRenderer later so clear color tracks TOD */
    bindRenderer(r) {
      renderer = r;
      if (renderer && scene.background && scene.background.isColor) {
        renderer.setClearColor(scene.background.getHex(), 1);
      }
    },
    pause(p) { paused = !!p; },
    togglePause() { paused = !paused; return paused; },
    /** Advance clock; dt in real seconds */
    update(dt) {
      if (!paused) {
        hour = (hour + (dt / CYCLE_SEC) * 24) % 24;
      }
      apply();
    },
    /** HH:MM game clock */
    clockString() {
      const h = Math.floor(hour) % 24;
      const m = Math.floor((hour % 1) * 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    },
    /** sun | half | moon for HUD icon */
    phaseIcon() {
      if (hour >= 6.5 && hour < 17.5) return '☀';
      if ((hour >= 5.5 && hour < 6.5) || (hour >= 17.5 && hour < 19.5)) return '🌤';
      return '☾';
    },
    lights: { ambient, hemi, sun, moon, stars, skyDome },
  };
}

/**
 * Build the open world into `scene`.
 * Returns markers, blips, colliders for gameplay.
 */
export function buildWorld(scene) {
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  const mats = makeMats();
  const colliders = [];
  const realLights = [];

  // Ground
  const groundB = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), mats.grassB);
  groundB.rotation.x = -Math.PI / 2;
  groundB.position.set(-50, 0, 5);
  groundB.receiveShadow = true;
  root.add(groundB);

  const groundT = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mats.grassT);
  groundT.rotation.x = -Math.PI / 2;
  groundT.position.set(145, 0, 5);
  groundT.receiveShadow = true;
  root.add(groundT);

  // Water — south coast + creek pockets
  const waterSouth = new THREE.Mesh(new THREE.PlaneGeometry(400, 90), mats.water);
  waterSouth.rotation.x = -Math.PI / 2;
  waterSouth.position.set(40, MAP.waterY, -95);
  root.add(waterSouth);

  const creek = new THREE.Mesh(new THREE.PlaneGeometry(55, 35), mats.water);
  creek.rotation.x = -Math.PI / 2;
  creek.position.set(-95, MAP.waterY, 5);
  root.add(creek);

  // Dock piers
  const pierMat = mats.wood;
  const pier1 = new THREE.Mesh(new THREE.BoxGeometry(36, 0.35, 5.5), pierMat);
  pier1.position.set(-108, 0.2, -38);
  root.add(pier1);
  const pier2 = new THREE.Mesh(new THREE.BoxGeometry(22, 0.35, 4.5), pierMat);
  pier2.position.set(-118, 0.2, -28);
  root.add(pier2);
  // Crates on pier
  for (let i = 0; i < 5; i++) {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.4, 1.4),
      mats.woodRoof
    );
    crate.position.set(-100 - i * 3.5, 0.9, -38);
    root.add(crate);
  }

  // Roads + intersections + lane marks
  buildRoads(root, mats, ROADS);

  // Buildings
  for (const [x, z, w, d, floors, kit] of BLOCKS) {
    buildBuilding(root, mats, colliders, x, z, w, d, floors, kit);
  }

  // Curb props (instanced)
  const scatters = scatterPropsAlongRoads(ROADS);
  addInstancedProps(root, mats, scatters, realLights);

  // Atmosphere — time-of-day (default 14:00 afternoon)
  const dayNight = createDayNight(scene, realLights, mats);

  const markers = {
    belikinDocks: new THREE.Vector3(-108, 0, -36),
    queenMarket: new THREE.Vector3(-60, 0, -12),
    hauloverBoat: new THREE.Vector3(-95, 0, 20),
    posDowntown: new THREE.Vector3(140, 0, 8),
    warehouse: new THREE.Vector3(175, 0, -48),
    safehouse: new THREE.Vector3(-25, 0, 65),
    spawn: new THREE.Vector3(-72, 0, 4),
  };

  const blips = {};
  for (const [key, pos] of Object.entries(markers)) {
    if (key === 'spawn') continue;
    const blip = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.15, 0.12, 16),
      new THREE.MeshBasicMaterial({
        color: 0x00f5d4,
        transparent: true,
        opacity: 0.55,
      })
    );
    blip.position.copy(pos);
    blip.position.y = 0.12;
    blip.userData.markerKey = key;
    blip.visible = false;
    root.add(blip);
    blips[key] = blip;
  }

  return {
    root,
    markers,
    blips,
    colliders,
    roads: ROADS,
    palette: PALETTE,
    mats,
    dayNight,
    resolveCollision(pos, radius = 0.45) {
      resolveAABB(pos, radius, colliders);
      const b = MAP.bounds;
      pos.x = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
      pos.z = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
      pos.y = 0;
    },
  };
}

export function districtAt(x) {
  return x < 40 ? 'belize' : 'trinidad';
}

export function districtLabel(d) {
  return d === 'trinidad' ? 'Port of Spain' : 'Belize City';
}
