import * as THREE from 'three';

export class Player {
  constructor(scene, spawn) {
    this.scene = scene;
    this.speed = 9;
    this.turnSpeed = 2.8;
    this.yaw = 0;
    this.pitch = 0.15;
    this.health = 100;
    this.inVehicle = false;
    this.vehicle = null;
    this.keys = Object.create(null);
    this.mobileStick = { x: 0, y: 0 };
    this.pointerLocked = false;

    // Capsule-ish low-poly character
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 0.9, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.7 })
    );
    body.position.y = 1.0;
    body.castShadow = true;
    this.mesh.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xc4a574 })
    );
    head.position.y = 1.85;
    this.mesh.add(head);
    this.mesh.position.copy(spawn);
    this.mesh.position.y = 0;
    scene.add(this.mesh);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    this.cameraOffset = new THREE.Vector3(0, 3.2, 7.5);
  }

  get position() {
    return this.inVehicle && this.vehicle
      ? this.vehicle.mesh.position
      : this.mesh.position;
  }

  bindInput(dom) {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    dom.addEventListener('click', () => {
      if (!this.pointerLocked) dom.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0018, -0.35, 0.55);
    });
  }

  enterVehicle(v) {
    this.inVehicle = true;
    this.vehicle = v;
    this.mesh.visible = false;
    v.occupied = true;
  }

  exitVehicle() {
    if (!this.vehicle) return;
    const v = this.vehicle;
    const exit = v.mesh.position.clone();
    exit.x += Math.sin(v.yaw + Math.PI / 2) * 2.2;
    exit.z += Math.cos(v.yaw + Math.PI / 2) * 2.2;
    this.mesh.position.copy(exit);
    this.mesh.position.y = 0;
    this.mesh.visible = true;
    this.yaw = v.yaw;
    v.occupied = false;
    v.throttle = 0;
    this.vehicle = null;
    this.inVehicle = false;
  }

  update(dt) {
    if (this.inVehicle && this.vehicle) {
      this.vehicle.control(this.keys, this.mobileStick, dt);
      this.vehicle.update(dt);
      this._updateCameraBehindCar(dt);
      return;
    }

    let mx = 0;
    let mz = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) mz -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) mz += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) mx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;
    mx += this.mobileStick.x;
    mz += this.mobileStick.y;

    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz) || 1;
      mx /= len;
      mz /= len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // Camera-relative: W is forward relative to yaw
      const fx = sin * mz + cos * mx; // wait: forward is -Z in cam space
      // yaw 0 looks down -Z; forward = (-sin(yaw), -cos(yaw))? 
      // Standard: yaw rotates around Y; forward = (sin(yaw), 0, cos(yaw)) if yaw=0 → +Z
      // Our camera sits behind looking at player; yaw decreases with mouse right.
      // Forward walk = direction camera faces horizontally.
      const forwardX = -Math.sin(this.yaw);
      const forwardZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);
      // mz negative = W = forward
      const dx = forwardX * -mz + rightX * mx;
      const dz = forwardZ * -mz + rightZ * mx;
      this.mesh.position.x += dx * this.speed * dt;
      this.mesh.position.z += dz * this.speed * dt;
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }

    this._clampBounds();
    this._updateCameraOrbit(dt);
  }

  _clampBounds() {
    const p = this.mesh.position;
    p.x = THREE.MathUtils.clamp(p.x, -130, 230);
    p.z = THREE.MathUtils.clamp(p.z, -80, 100);
    p.y = 0;
  }

  _updateCameraOrbit(dt) {
    const target = this.mesh.position;
    const dist = 7.5;
    const height = 3.0 + this.pitch * 4;
    const cx = target.x + Math.sin(this.yaw) * dist;
    const cz = target.z + Math.cos(this.yaw) * dist;
    const desired = new THREE.Vector3(cx, target.y + height, cz);
    this.camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    this.camera.lookAt(target.x, target.y + 1.4, target.z);
  }

  _updateCameraBehindCar(dt) {
    const v = this.vehicle;
    const dist = 10;
    const height = 4.2;
    const cx = v.mesh.position.x + Math.sin(v.yaw) * dist;
    const cz = v.mesh.position.z + Math.cos(v.yaw) * dist;
    const desired = new THREE.Vector3(cx, v.mesh.position.y + height, cz);
    this.camera.position.lerp(desired, 1 - Math.pow(0.0008, dt));
    this.camera.lookAt(
      v.mesh.position.x - Math.sin(v.yaw) * 2,
      v.mesh.position.y + 1.5,
      v.mesh.position.z - Math.cos(v.yaw) * 2
    );
    this.yaw = v.yaw; // sync for exit
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
  }

  heal(n = 100) {
    this.health = Math.min(100, this.health + n);
  }
}
