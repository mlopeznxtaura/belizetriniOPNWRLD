import * as THREE from 'three';

let _id = 1;

export class Vehicle {
  constructor(scene, opts = {}) {
    this.id = 'v' + _id++;
    this.scene = scene;
    this.yaw = opts.yaw || 0;
    this.speed = 0;
    this.maxSpeed = opts.maxSpeed || 28;
    this.accel = opts.accel || 18;
    this.brake = opts.brake || 35;
    this.turnRate = opts.turnRate || 2.2;
    this.friction = 8;
    this.occupied = false;
    this.throttle = 0;
    this.type = opts.type || 'car';

    this.mesh = new THREE.Group();
    this.mesh.position.copy(opts.position || new THREE.Vector3());
    this.mesh.position.y = 0;

    if (this.type === 'scooter') {
      this._buildScooter(opts.color || 0xff6b35);
      this.maxSpeed = 18;
      this.accel = 22;
      this.turnRate = 3.2;
    } else {
      this._buildCar(opts.color || 0x4361ee);
    }

    this.mesh.rotation.y = this.yaw;
    scene.add(this.mesh);
  }

  _buildCar(color) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.7, 4.2),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3 })
    );
    body.position.y = 0.55;
    body.castShadow = true;
    this.mesh.add(body);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.65, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.3 })
    );
    cabin.position.set(0, 1.15, -0.2);
    this.mesh.add(cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const positions = [
      [1.0, 0.35, 1.3], [-1.0, 0.35, 1.3],
      [1.0, 0.35, -1.3], [-1.0, 0.35, -1.3],
    ];
    for (const [x, y, z] of positions) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, y, z);
      this.mesh.add(w);
    }
    // headlights
    const hl = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.15, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0 })
    );
    hl.position.set(0.7, 0.55, -2.1);
    this.mesh.add(hl);
    const hl2 = hl.clone();
    hl2.position.x = -0.7;
    this.mesh.add(hl2);
  }

  _buildScooter(color) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.5, 1.8),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
    );
    body.position.y = 0.55;
    body.castShadow = true;
    this.mesh.add(body);
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6),
      new THREE.MeshStandardMaterial({ color: 0x333333 })
    );
    stem.position.set(0, 1.0, -0.6);
    this.mesh.add(stem);
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.15, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x222222 })
    );
    seat.position.set(0, 0.85, 0.2);
    this.mesh.add(seat);
    const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.12, 10);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    for (const z of [-0.7, 0.7]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(0, 0.28, z);
      this.mesh.add(w);
    }
  }

  control(keys, stick, dt) {
    let throttle = 0;
    let steer = 0;
    if (keys['KeyW'] || keys['ArrowUp']) throttle += 1;
    if (keys['KeyS'] || keys['ArrowDown']) throttle -= 0.6;
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
      // friction
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
    this.mesh.position.x += fx * this.speed * dt;
    this.mesh.position.z += fz * this.speed * dt;
    this.mesh.position.x = THREE.MathUtils.clamp(this.mesh.position.x, -130, 230);
    this.mesh.position.z = THREE.MathUtils.clamp(this.mesh.position.z, -80, 100);
    this.mesh.position.y = 0;
    this.mesh.rotation.y = this.yaw;
  }

  distanceTo(pos) {
    return this.mesh.position.distanceTo(pos);
  }
}

export function spawnFleet(scene, markers) {
  const list = [];
  // Mission scooter at Belikin docks
  list.push(
    new Vehicle(scene, {
      type: 'scooter',
      color: 0xff6b35,
      position: new THREE.Vector3(-93, 0, -26),
      yaw: Math.PI / 2,
    })
  );
  // Cars Belize
  const belizeCars = [
    [-65, 8, 0x4361ee], [-40, -5, 0xe63946], [-80, 15, 0xf4a261],
    [-55, 5, 0x2a9d8f], [-100, -20, 0x264653],
  ];
  for (const [x, z, c] of belizeCars) {
    list.push(new Vehicle(scene, { position: new THREE.Vector3(x, 0, z), color: c, yaw: Math.random() * Math.PI * 2 }));
  }
  // Cars Trinidad
  const triCars = [
    [130, 10, 0x9b5de5], [150, 25, 0x00bbf9], [165, -10, 0xfee440],
    [145, -25, 0xf15bb5], [180, -40, 0x00f5d4], [120, 40, 0xffffff],
  ];
  for (const [x, z, c] of triCars) {
    list.push(new Vehicle(scene, { position: new THREE.Vector3(x, 0, z), color: c, yaw: Math.random() * 6 }));
  }
  return list;
}

export function nearestVehicle(vehicles, pos, maxDist = 4) {
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
