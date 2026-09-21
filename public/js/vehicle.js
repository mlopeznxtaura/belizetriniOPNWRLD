import * as THREE from 'three';

let _id = 1;

const TUNE = {
  sedan: { maxSpeed: 30, accel: 17, turnRate: 2.1, brake: 38 },
  scooter: { maxSpeed: 18, accel: 22, turnRate: 3.4, brake: 28 },
  van: { maxSpeed: 24, accel: 13, turnRate: 1.7, brake: 32 },
};

/**
 * Readable low-poly vehicle kits — windshield, wheels, bumpers, body panels.
 * Not featureless boxes.
 */
export class Vehicle {
  constructor(scene, opts = {}) {
    this.id = 'v' + _id++;
    this.scene = scene;
    this.world = opts.world || null;
    this.yaw = opts.yaw || 0;
    this.speed = 0;
    this.type = opts.type || 'sedan';
    const t = TUNE[this.type] || TUNE.sedan;
    this.maxSpeed = t.maxSpeed;
    this.accel = t.accel;
    this.brake = t.brake;
    this.turnRate = t.turnRate;
    this.friction = 8;
    this.occupied = false;
    this.throttle = 0;
    this.radius = this.type === 'scooter' ? 0.7 : this.type === 'van' ? 1.4 : 1.15;

    this.mesh = new THREE.Group();
    this.mesh.position.copy(opts.position || new THREE.Vector3());
    this.mesh.position.y = 0;

    if (this.type === 'scooter') this._buildScooter(opts.color || 0xff6b35);
    else if (this.type === 'van') this._buildVan(opts.color || 0xd4a373);
    else this._buildSedan(opts.color || 0x4361ee);

    this.mesh.rotation.y = this.yaw;
    scene.add(this.mesh);
  }

  _paint(color, extras = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: extras.roughness ?? 0.45,
      metalness: extras.metalness ?? 0.35,
    });
  }

  _glass() {
    return new THREE.MeshStandardMaterial({
      color: 0x88c0d0,
      roughness: 0.15,
      metalness: 0.6,
      transparent: true,
      opacity: 0.45,
    });
  }

  _dark() {
    return this._paint(0x1a1a22, { roughness: 0.7, metalness: 0.4 });
  }

  _buildSedan(color) {
    const bodyMat = this._paint(color, { roughness: 0.4, metalness: 0.4 });
    const dark = this._dark();
    const glass = this._glass();

    // Lower body
    const rocker = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.35, 4.2), bodyMat);
    rocker.position.y = 0.45;
    this.mesh.add(rocker);

    // Hood
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.18, 1.15), bodyMat);
    hood.position.set(0, 0.72, -1.35);
    this.mesh.add(hood);

    // Cabin base
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 1.85), bodyMat);
    cabin.position.set(0, 0.95, 0.05);
    this.mesh.add(cabin);

    // Roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 1.5), bodyMat);
    roof.position.set(0, 1.3, 0.05);
    this.mesh.add(roof);

    // Trunk
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.2, 0.85), bodyMat);
    trunk.position.set(0, 0.75, 1.55);
    this.mesh.add(trunk);

    // Windshield (angled via thin box)
    const ws = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.55, 0.06), glass);
    ws.position.set(0, 1.05, -0.85);
    ws.rotation.x = -0.45;
    this.mesh.add(ws);

    // Rear window
    const rw = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.06), glass);
    rw.position.set(0, 1.1, 0.95);
    rw.rotation.x = 0.4;
    this.mesh.add(rw);

    // Side windows
    for (const sx of [-0.86, 0.86]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 1.4), glass);
      sw.position.set(sx, 1.05, 0.05);
      this.mesh.add(sw);
    }

    // Bumpers
    const fb = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.22, 0.28), dark);
    fb.position.set(0, 0.32, -2.15);
    this.mesh.add(fb);
    const rb = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.22, 0.28), dark);
    rb.position.set(0, 0.32, 2.15);
    this.mesh.add(rb);

    // Grille
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.08), dark);
    grille.position.set(0, 0.5, -2.2);
    this.mesh.add(grille);

    // Mirrors
    for (const sx of [-0.95, 0.95]) {
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.2), dark);
      mir.position.set(sx, 1.0, -0.7);
      this.mesh.add(mir);
    }

    // Wheel arches (fender flares)
    for (const [x, z] of [[0.95, 1.3], [-0.95, 1.3], [0.95, -1.3], [-0.95, -1.3]]) {
      const arch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 0.7), bodyMat);
      arch.position.set(x, 0.4, z);
      this.mesh.add(arch);
    }

    this._addWheels([
      [0.92, 0.32, 1.35], [-0.92, 0.32, 1.35],
      [0.92, 0.32, -1.35], [-0.92, 0.32, -1.35],
    ], 0.33);
    this._addLights(0.62, 0.52, -2.22, 2.2);
  }

  _buildVan(color) {
    const bodyMat = this._paint(color, { roughness: 0.55, metalness: 0.25 });
    const dark = this._dark();
    const glass = this._glass();

    // Tall box body with bevel tip
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.7, 4.4), bodyMat);
    body.position.y = 1.15;
    this.mesh.add(body);

    // Cab nose
    const nose = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 0.6), bodyMat);
    nose.position.set(0, 0.85, -2.0);
    this.mesh.add(nose);

    // Windshield
    const ws = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.7, 0.08), glass);
    ws.position.set(0, 1.45, -2.15);
    ws.rotation.x = -0.25;
    this.mesh.add(ws);

    // Side glass row
    for (const sx of [-1.04, 1.04]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 1.2), glass);
      sw.position.set(sx, 1.45, -1.4);
      this.mesh.add(sw);
    }

    // Sliding door seam
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.4, 0.05), dark);
    seam.position.set(1.04, 1.1, 0.2);
    this.mesh.add(seam);

    // Roof rails
    for (const sx of [-0.55, 0.55]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 3.6), dark);
      rail.position.set(sx, 2.05, 0.1);
      this.mesh.add(rail);
    }

    // Bumper
    const fb = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.28, 0.3), dark);
    fb.position.set(0, 0.38, -2.35);
    this.mesh.add(fb);

    this._addWheels([
      [0.98, 0.35, 1.45], [-0.98, 0.35, 1.45],
      [0.98, 0.35, -1.45], [-0.98, 0.35, -1.45],
    ], 0.37);
    this._addLights(0.7, 0.7, -2.4, 2.25);
  }

  _buildScooter(color) {
    const bodyMat = this._paint(color, { roughness: 0.4, metalness: 0.35 });
    const dark = this._dark();
    const chrome = this._paint(0xaaaaaa, { roughness: 0.3, metalness: 0.8 });

    // Floor deck
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 1.25), dark);
    deck.position.set(0, 0.38, 0.05);
    this.mesh.add(deck);

    // Body / engine cover
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.7), bodyMat);
    cover.position.set(0, 0.62, 0.35);
    this.mesh.add(cover);

    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.55), dark);
    seat.position.set(0, 0.88, 0.25);
    this.mesh.add(seat);

    // Front shield / fairing
    const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.12), bodyMat);
    fairing.position.set(0, 0.95, -0.5);
    fairing.rotation.x = -0.2;
    this.mesh.add(fairing);

    // Fork / stem
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.85, 8), chrome);
    stem.position.set(0, 1.0, -0.55);
    stem.rotation.x = 0.25;
    this.mesh.add(stem);

    // Handlebars
    const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), chrome);
    bars.rotation.z = Math.PI / 2;
    bars.position.set(0, 1.4, -0.7);
    this.mesh.add(bars);
    for (const sx of [-0.35, 0.35]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), dark);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(sx, 1.4, -0.7);
      this.mesh.add(grip);
    }

    // Headlight housing
    const hlHouse = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.12), dark);
    hlHouse.position.set(0, 1.05, -0.7);
    this.mesh.add(hlHouse);
    const hl = new THREE.Mesh(
      new THREE.CircleGeometry(0.07, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0 })
    );
    hl.position.set(0, 1.05, -0.77);
    this.mesh.add(hl);

    // Wheels with discs + tires
    const tire = this._paint(0x111111, { roughness: 0.95, metalness: 0.05 });
    const rim = chrome;
    for (const z of [-0.62, 0.68]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 12), tire);
      w.rotation.z = Math.PI / 2;
      w.position.set(0, 0.28, z);
      this.mesh.add(w);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.13, 10), rim);
      r.rotation.z = Math.PI / 2;
      r.position.set(0, 0.28, z);
      this.mesh.add(r);
    }
  }

  _addWheels(positions, radius) {
    const tire = this._paint(0x111111, { roughness: 0.95, metalness: 0.05 });
    const rim = this._paint(0xcccccc, { roughness: 0.35, metalness: 0.7 });
    const hub = this._paint(0x444444, { roughness: 0.5, metalness: 0.5 });
    for (const [x, y, z] of positions) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.26, 12), tire);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, y, z);
      this.mesh.add(w);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, 0.28, 10), rim);
      r.rotation.z = Math.PI / 2;
      r.position.set(x, y, z);
      this.mesh.add(r);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.25, radius * 0.25, 0.3, 8), hub);
      h.rotation.z = Math.PI / 2;
      h.position.set(x, y, z);
      this.mesh.add(h);
    }
  }

  _addLights(ox, y, fz, rz) {
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
    const tlMat = new THREE.MeshBasicMaterial({ color: 0xff2244 });
    for (const x of [ox, -ox]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.1), hlMat);
      hl.position.set(x, y, fz);
      this.mesh.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.08), tlMat);
      tl.position.set(x, y, rz);
      this.mesh.add(tl);
    }
  }

  control(keys, stick, dt) {
    let throttle = 0;
    let steer = 0;
    if (keys['KeyW'] || keys['ArrowUp']) throttle += 1;
    if (keys['KeyS'] || keys['ArrowDown']) throttle -= 0.65;
    if (keys['KeyA'] || keys['ArrowLeft']) steer += 1;
    if (keys['KeyD'] || keys['ArrowRight']) steer -= 1;
    throttle += -stick.y;
    steer += -stick.x;
    const braking = keys['Space'] || keys['brake'];

    if (braking) {
      this.speed = THREE.MathUtils.damp(this.speed, 0, this.brake * 0.15, dt);
    } else {
      this.speed += throttle * this.accel * dt;
      this.speed = THREE.MathUtils.clamp(this.speed, -this.maxSpeed * 0.4, this.maxSpeed);
      if (Math.abs(throttle) < 0.1) {
        this.speed = THREE.MathUtils.damp(this.speed, 0, this.friction * 0.08, dt);
      }
    }

    const turnFactor = THREE.MathUtils.clamp(Math.abs(this.speed) / 8, 0, 1);
    this.yaw += steer * this.turnRate * turnFactor * Math.sign(this.speed || 1) * dt;
    this.throttle = throttle;
  }

  update(dt) {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const prevX = this.mesh.position.x;
    const prevZ = this.mesh.position.z;
    this.mesh.position.x += fx * this.speed * dt;
    this.mesh.position.z += fz * this.speed * dt;

    if (this.world?.resolveCollision) {
      this.world.resolveCollision(this.mesh.position, this.radius);
      if (
        Math.abs(this.mesh.position.x - (prevX + fx * this.speed * dt)) > 0.01 ||
        Math.abs(this.mesh.position.z - (prevZ + fz * this.speed * dt)) > 0.01
      ) {
        this.speed *= 0.55;
      }
    } else {
      this.mesh.position.x = THREE.MathUtils.clamp(this.mesh.position.x, -140, 240);
      this.mesh.position.z = THREE.MathUtils.clamp(this.mesh.position.z, -90, 110);
    }

    this.mesh.position.y = 0;
    this.mesh.rotation.y = this.yaw;
  }

  distanceTo(pos) {
    return this.mesh.position.distanceTo(pos);
  }
}

export function spawnFleet(scene, markers, world) {
  const list = [];
  const add = (opts) => {
    opts.world = world;
    list.push(new Vehicle(scene, opts));
  };

  // Mission scooter at Belikin docks
  const dock = markers?.belikinDocks || new THREE.Vector3(-106, 0, -34);
  add({
    type: 'scooter',
    color: 0xff6b35,
    position: new THREE.Vector3(dock.x + 2, 0, dock.z + 2),
    yaw: Math.PI / 2,
  });

  const belize = [
    { type: 'sedan', x: -70, z: 6, c: 0x4361ee, yaw: 0 },
    { type: 'sedan', x: -48, z: -4, c: 0xe63946, yaw: Math.PI / 2 },
    { type: 'scooter', x: -58, z: -10, c: 0x00f5d4, yaw: 0 },
    { type: 'van', x: -85, z: 8, c: 0xd4a373, yaw: -0.3 },
    { type: 'sedan', x: -95, z: -20, c: 0x2a9d8f, yaw: Math.PI },
    { type: 'sedan', x: -35, z: 8, c: 0x264653, yaw: 0.2 },
  ];
  for (const v of belize) {
    add({ type: v.type, color: v.c, position: new THREE.Vector3(v.x, 0, v.z), yaw: v.yaw });
  }

  const pos = [
    { type: 'sedan', x: 125, z: 6, c: 0x9b5de5, yaw: 0 },
    { type: 'sedan', x: 148, z: 20, c: 0x00bbf9, yaw: Math.PI / 2 },
    { type: 'van', x: 162, z: -8, c: 0xe8e8e8, yaw: -0.4 },
    { type: 'scooter', x: 138, z: -20, c: 0xf15bb5, yaw: Math.PI },
    { type: 'sedan', x: 175, z: -40, c: 0x457b9d, yaw: 0.5 },
    { type: 'sedan', x: 118, z: 32, c: 0x1d3557, yaw: Math.PI },
    { type: 'van', x: 190, z: -20, c: 0x6d6875, yaw: -Math.PI / 2 },
  ];
  for (const v of pos) {
    add({ type: v.type, color: v.c, position: new THREE.Vector3(v.x, 0, v.z), yaw: v.yaw });
  }

  return list;
}

export function nearestVehicle(vehicles, pos, maxDist = 4.5) {
  let best = null;
  let bestD = maxDist;
  for (const v of vehicles) {
    if (v.occupied) continue;
    const d = v.distanceTo(pos);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}
