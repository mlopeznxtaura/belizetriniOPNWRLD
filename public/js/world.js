import * as THREE from 'three';

/** Map layout: Belize (west, x < 0) and Trinidad/POS (east, x > 80) connected by bridge road */
export const MAP = {
  belizeCenter: new THREE.Vector3(-60, 0, 0),
  trinidadCenter: new THREE.Vector3(140, 0, 20),
  bridgeZ: 0,
  waterY: -0.4,
};

const PALETTE = {
  asphalt: 0x1a1a28,
  asphaltLine: 0xf0e68c,
  wood: 0x5c3a21,
  woodRoof: 0x3d2817,
  concrete: 0x3a3a48,
  neonPink: 0xf72585,
  neonCyan: 0x00f5d4,
  neonPurple: 0x7b2cbf,
  market: 0xc9a227,
  dock: 0x4a3728,
  grass: 0x1a3a28,
  sand: 0x8b7355,
  water: 0x0a3048,
  buildingNight: [0x1e1e32, 0x252540, 0x2a2040, 0x1a2838, 0x302030],
  windowLit: 0xffeaa7,
  palmTrunk: 0x4a3020,
  palmLeaf: 0x1d6b3a,
};

function box(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 })
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addStreetLight(group, x, z, color = PALETTE.neonCyan) {
  const pole = box(0.15, 4.5, 0.15, 0x222230, x, 2.25, z);
  group.add(pole);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 8),
    new THREE.MeshBasicMaterial({ color })
  );
  lamp.position.set(x, 4.6, z);
  group.add(lamp);
  const light = new THREE.PointLight(color, 1.2, 28, 2);
  light.position.set(x, 4.4, z);
  group.add(light);
}

function addPalm(group, x, z) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.25, 4, 6),
    new THREE.MeshStandardMaterial({ color: PALETTE.palmTrunk, roughness: 1 })
  );
  trunk.position.set(x, 2, z);
  trunk.castShadow = true;
  group.add(trunk);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 2.2, 4),
      new THREE.MeshStandardMaterial({ color: PALETTE.palmLeaf, roughness: 0.9 })
    );
    leaf.position.set(x, 4.2, z);
    leaf.rotation.z = Math.PI / 2.2;
    leaf.rotation.y = (i / 5) * Math.PI * 2;
    group.add(leaf);
  }
}

function addBuilding(group, x, z, w, d, floors, color, woodStyle = false) {
  const h = floors * 2.6 + 1;
  const matColor = woodStyle ? PALETTE.wood : color;
  const b = box(w, h, d, matColor, x, h / 2, z);
  group.add(b);
  // roof
  const roofH = woodStyle ? 0.8 : 0.4;
  const roof = box(w + 0.4, roofH, d + 0.4, woodStyle ? PALETTE.woodRoof : 0x151520, x, h + roofH / 2, z);
  group.add(roof);
  // lit windows
  const winMat = new THREE.MeshBasicMaterial({ color: PALETTE.windowLit });
  for (let f = 0; f < floors; f++) {
    for (let side = 0; side < 2; side++) {
      if (Math.random() > 0.35) {
        const wx = side === 0 ? x + w / 2 + 0.05 : x - w / 2 - 0.05;
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.9), winMat);
        win.position.set(wx, 1.2 + f * 2.6, z + (Math.random() - 0.5) * (d * 0.5));
        win.rotation.y = side === 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(win);
      }
    }
  }
  return b;
}

function addRoadSegment(group, x, z, len, rotY = 0, width = 8) {
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(width, len),
    new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.95 })
  );
  road.rotation.x = -Math.PI / 2;
  road.rotation.z = rotY;
  road.position.set(x, 0.02, z);
  road.receiveShadow = true;
  group.add(road);
  // center line
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(0.25, len * 0.9),
    new THREE.MeshBasicMaterial({ color: PALETTE.asphaltLine })
  );
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = rotY;
  line.position.set(x, 0.03, z);
  group.add(line);
}

function addWater(group, x, z, w, d) {
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({
      color: PALETTE.water,
      roughness: 0.2,
      metalness: 0.6,
      transparent: true,
      opacity: 0.85,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(x, MAP.waterY, z);
  group.add(water);
}

/**
 * Build the open world into `scene`. Returns markers for missions / AI.
 */
export function buildWorld(scene) {
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  // Ground planes
  const groundBelize = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: PALETTE.grass, roughness: 1 })
  );
  groundBelize.rotation.x = -Math.PI / 2;
  groundBelize.position.set(-40, 0, 0);
  groundBelize.receiveShadow = true;
  root.add(groundBelize);

  const groundTri = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180),
    new THREE.MeshStandardMaterial({ color: 0x1a2830, roughness: 1 })
  );
  groundTri.rotation.x = -Math.PI / 2;
  groundTri.position.set(140, 0, 10);
  groundTri.receiveShadow = true;
  root.add(groundTri);

  // Water — Caribbean / Haulover Creek strip between districts + south coast
  addWater(root, 40, -90, 320, 80);
  addWater(root, -80, 40, 60, 40); // creek / docks water
  addWater(root, -40, -35, 50, 25);

  // —— Belize City district ——
  // Main E-W road through Belize toward bridge
  addRoadSegment(root, -40, 0, 120, Math.PI / 2, 10);
  // N-S Queen Street style
  addRoadSegment(root, -50, 0, 80, 0, 8);
  addRoadSegment(root, -70, 10, 50, 0, 7);
  // Dock road
  addRoadSegment(root, -90, -20, 40, Math.PI / 2, 7);

  // Wooden houses / waterfront
  const woodPositions = [
    [-75, -15, 6, 5, 1], [-68, -18, 5, 4, 1], [-82, -12, 7, 5, 2],
    [-60, 25, 6, 6, 1], [-55, 30, 5, 5, 1], [-45, 28, 8, 5, 2],
    [-95, 5, 6, 8, 1], [-100, -5, 5, 5, 1],
  ];
  for (const [x, z, w, d, fl] of woodPositions) {
    addBuilding(root, x, z, w, d, fl, PALETTE.wood, true);
  }

  // Market stalls Queen Street
  for (let i = 0; i < 8; i++) {
    const sx = -52 + (i % 2) * 4;
    const sz = -20 + Math.floor(i / 2) * 6;
    const stall = box(3, 2.2, 2.5, PALETTE.market, sx, 1.1, sz);
    root.add(stall);
    const canopy = box(3.4, 0.15, 2.8, PALETTE.neonPink, sx, 2.3, sz);
    root.add(canopy);
  }

  // Belikin docks (piers)
  const pier1 = box(40, 0.4, 6, PALETTE.dock, -95, 0.2, -28);
  root.add(pier1);
  const pier2 = box(25, 0.4, 5, PALETTE.dock, -110, 0.2, -18);
  root.add(pier2);
  // crates
  for (let i = 0; i < 6; i++) {
    root.add(box(1.5, 1.5, 1.5, 0x6b4423, -85 - i * 3, 0.95, -28));
  }

  // Bridge Belize → Trinidad
  addRoadSegment(root, 40, 0, 90, Math.PI / 2, 10);
  const bridgeDeck = box(90, 0.5, 12, 0x2a2a38, 40, 0.4, 0);
  root.add(bridgeDeck);
  // bridge rails
  root.add(box(90, 1.2, 0.3, 0x00f5d4, 40, 1.2, 5.5));
  root.add(box(90, 1.2, 0.3, 0x00f5d4, 40, 1.2, -5.5));

  // —— Port of Spain / Trinidad ——
  addRoadSegment(root, 120, 0, 100, Math.PI / 2, 10);
  addRoadSegment(root, 140, 20, 80, 0, 9);
  addRoadSegment(root, 160, 0, 60, 0, 8);
  addRoadSegment(root, 130, 40, 50, Math.PI / 2, 8);

  // Downtown blocks
  const downtown = [
    [110, 15, 10, 12, 4], [125, 18, 12, 10, 5], [140, 12, 9, 11, 3],
    [155, 20, 11, 9, 4], [170, 15, 10, 10, 6], [115, -15, 8, 10, 3],
    [135, -20, 12, 8, 4], [150, -12, 9, 9, 5], [165, -18, 10, 11, 3],
    [180, 5, 8, 8, 4], [145, 45, 10, 10, 3], [160, 50, 9, 8, 2],
  ];
  for (const [x, z, w, d, fl] of downtown) {
    const col = PALETTE.buildingNight[Math.floor(Math.random() * PALETTE.buildingNight.length)];
    addBuilding(root, x, z, w, d, fl, col, false);
  }

  // Port warehouses
  root.add(box(20, 8, 14, 0x3a3540, 180, 4, -40));
  root.add(box(16, 7, 12, 0x353040, 200, 3.5, -35));
  root.add(box(18, 9, 10, 0x403548, 190, 4.5, -55));
  // neon signs
  const neonSign = new THREE.Mesh(
    new THREE.BoxGeometry(8, 1.5, 0.2),
    new THREE.MeshBasicMaterial({ color: PALETTE.neonPink })
  );
  neonSign.position.set(140, 12, 12);
  root.add(neonSign);

  // Hillside (safehouse area west-north Belize)
  for (let i = 0; i < 5; i++) {
    const hx = -30 - i * 8;
    const hz = 50 + i * 3;
    addBuilding(root, hx, hz, 7, 6, 1 + (i % 2), PALETTE.wood, true);
  }
  // Safehouse marker building
  const safe = addBuilding(root, -20, 70, 10, 8, 2, 0x2a4050, false);
  safe.userData.isSafehouse = true;

  // Palm trees
  const palms = [
    [-90, -10], [-100, 10], [-40, 20], [-55, -30], [-20, -10],
    [20, 8], [50, -8], [100, 30], [150, -30], [170, 40],
    [-70, 40], [130, 60], [90, -20], [-110, -25],
  ];
  for (const [x, z] of palms) addPalm(root, x, z);

  // Street lights
  for (let x = -100; x <= 200; x += 25) {
    addStreetLight(root, x, 4, x < 40 ? PALETTE.neonCyan : PALETTE.neonPurple);
    addStreetLight(root, x, -4, x < 40 ? PALETTE.neonPink : PALETTE.neonCyan);
  }
  for (let z = -40; z <= 60; z += 20) {
    addStreetLight(root, -50, z, PALETTE.neonCyan);
    addStreetLight(root, 140, z, PALETTE.neonPink);
  }

  // Ambient + moon
  const amb = new THREE.AmbientLight(0x304060, 0.45);
  scene.add(amb);
  const moon = new THREE.DirectionalLight(0xa0c0ff, 0.55);
  moon.position.set(-40, 80, 30);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.near = 10;
  moon.shadow.camera.far = 250;
  moon.shadow.camera.left = -120;
  moon.shadow.camera.right = 120;
  moon.shadow.camera.top = 120;
  moon.shadow.camera.bottom = -120;
  scene.add(moon);

  // Hemisphere for tropical night fill
  scene.add(new THREE.HemisphereLight(0x1a2040, 0x0a1810, 0.35));

  // Fog
  scene.fog = new THREE.FogExp2(0x050518, 0.008);
  scene.background = new THREE.Color(0x050518);

  // Stars (simple points)
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 400; i++) {
    starPos.push((Math.random() - 0.5) * 600, 40 + Math.random() * 120, (Math.random() - 0.5) * 600);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6 })));

  const markers = {
    belikinDocks: new THREE.Vector3(-95, 0, -28),
    queenMarket: new THREE.Vector3(-50, 0, -10),
    hauloverBoat: new THREE.Vector3(-80, 0, 35),
    posDowntown: new THREE.Vector3(140, 0, 20),
    warehouse: new THREE.Vector3(190, 0, -45),
    safehouse: new THREE.Vector3(-20, 0, 70),
    spawn: new THREE.Vector3(-70, 0, 5),
  };

  // Visual mission blips (glowing cylinders)
  const blipMats = {};
  for (const [key, pos] of Object.entries(markers)) {
    if (key === 'spawn') continue;
    const blip = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.15, 16),
      new THREE.MeshBasicMaterial({ color: 0x00f5d4, transparent: true, opacity: 0.55 })
    );
    blip.position.copy(pos);
    blip.position.y = 0.1;
    blip.userData.markerKey = key;
    blip.visible = false;
    root.add(blip);
    blipMats[key] = blip;
  }

  return { root, markers, blips: blipMats, palette: PALETTE };
}

export function districtAt(x) {
  return x < 40 ? 'belize' : 'trinidad';
}

export function districtLabel(d) {
  return d === 'trinidad' ? 'Port of Spain' : 'Belize City';
}
