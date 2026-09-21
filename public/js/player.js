import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Third-person player — Quaternius Casual_Male GLB (CC0) with Idle/Walk clips.
 * Falls back to a higher-fidelity procedural figure if the asset fails to load.
 */
export class Player {
  constructor(scene, spawn, world) {
    this.scene = scene;
    this.world = world || null;
    this.speed = 9;
    this.runMul = 1.55;
    this.yaw = 0;
    this.pitch = 0.08;
    this.health = 100;
    this.inVehicle = false;
    this.vehicle = null;
    this.keys = Object.create(null);
    this.mobileStick = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.radius = 0.4;
    this.ready = false;
    this._moveAmt = 0;
    this._anim = 'idle';

    this.root = new THREE.Group();
    this.root.position.copy(spawn);
    this.root.position.y = 0;
    scene.add(this.root);

    this.mesh = this.root; // alias for older call sites
    this.model = null;
    this.mixer = null;
    this.actions = {};
    this._currentAction = null;

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 450);
    this._camPos = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();

    // Temporary stand-in until GLB loads (hidden once ready)
    this._placeholder = this._makePlaceholder();
    this.root.add(this._placeholder);

    this._loadPromise = this._loadCharacter();
  }

  get position() {
    return this.inVehicle && this.vehicle
      ? this.vehicle.mesh.position
      : this.root.position;
  }

  async whenReady() {
    return this._loadPromise;
  }

  async _loadCharacter() {
    const loader = new GLTFLoader();
    const urls = [
      '/assets/characters/player.glb',
      '/assets/characters/soldier_mixamo.glb',
    ];
    let gltf = null;
    let used = '';
    for (const url of urls) {
      try {
        gltf = await loader.loadAsync(url);
        used = url;
        break;
      } catch (err) {
        console.warn('[player] failed to load', url, err);
      }
    }

    if (!gltf) {
      console.warn('[player] GLB unavailable — using procedural hi-fi fallback');
      this.root.remove(this._placeholder);
      this.model = this._makeHiFiProcedural();
      this.root.add(this.model);
      this.ready = true;
      return;
    }

    this.model = gltf.scene;
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
        if (o.material) {
          o.material.side = THREE.FrontSide;
          o.material.metalness = Math.min(o.material.metalness ?? 0, 0.25);
        }
      }
    });

    // Normalize scale — Quaternius / Mixamo vary
    const box = new THREE.Box3().setFromObject(this.model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetH = 1.8;
    const s = size.y > 0.01 ? targetH / size.y : 1;
    this.model.scale.setScalar(s);
    // Feet on ground
    box.setFromObject(this.model);
    this.model.position.y = -box.min.y;

    this.root.remove(this._placeholder);
    this.root.add(this.model);

    // Animations
    this.mixer = new THREE.AnimationMixer(this.model);
    const clips = gltf.animations || [];
    const find = (...needles) =>
      clips.find((c) => needles.some((n) => c.name.toLowerCase().includes(n)));

    const idleClip = find('idle') || clips[0];
    const walkClip = find('walk') && !find('walk')?.name.toLowerCase().includes('carry')
      ? clips.find((c) => /walk/i.test(c.name) && !/carry/i.test(c.name))
      : find('walk');
    const runClip = find('run') || null;

    if (idleClip) this.actions.idle = this.mixer.clipAction(idleClip);
    if (walkClip) this.actions.walk = this.mixer.clipAction(walkClip);
    if (runClip) this.actions.run = this.mixer.clipAction(runClip);

    // Prefer idle
    if (this.actions.idle) {
      this.actions.idle.play();
      this._currentAction = this.actions.idle;
    } else if (this.actions.walk) {
      this.actions.walk.play();
      this._currentAction = this.actions.walk;
    }

    console.info('[player] loaded', used, 'clips:', clips.map((c) => c.name).join(', '));
    this.ready = true;
  }

  _fadeTo(name, duration = 0.2) {
    const next = this.actions[name];
    if (!next || next === this._currentAction) {
      // If requesting run but no run clip, use walk faster
      if (name === 'run' && !this.actions.run && this.actions.walk) {
        this.actions.walk.timeScale = 1.65;
        if (this._currentAction !== this.actions.walk) {
          this._fadeTo('walk', duration);
        }
        this._anim = 'run';
        return;
      }
      if (name === 'walk' && this.actions.walk) this.actions.walk.timeScale = 1.0;
      return;
    }
    next.reset();
    next.setEffectiveTimeScale(name === 'run' && !this.actions.run ? 1.65 : 1);
    next.setEffectiveWeight(1);
    next.fadeIn(duration);
    next.play();
    if (this._currentAction) this._currentAction.fadeOut(duration);
    this._currentAction = next;
    this._anim = name;
    if (this.actions.walk && name === 'walk') this.actions.walk.timeScale = 1.0;
  }

  _mat(color, extras = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: extras.roughness ?? 0.65,
      metalness: extras.metalness ?? 0.08,
    });
  }

  /** Temporary loading marker */
  _makePlaceholder() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.3, 1.6, 8),
      this._mat(0x2a9d8f)
    );
    m.position.y = 0.8;
    g.add(m);
    return g;
  }

  /** Higher-fidelity procedural fallback (tapered limbs, shoes, hair volume, face) */
  _makeHiFiProcedural() {
    const g = new THREE.Group();
    const skin = this._mat(0xc4a574, { roughness: 0.7 });
    const jeans = this._mat(0x1d3557, { roughness: 0.85 });
    const tee = this._mat(0x2a9d8f, { roughness: 0.7 });
    const shoe = this._mat(0x1a1a1a, { roughness: 0.9 });
    const hair = this._mat(0x1a120c, { roughness: 0.95 });

    // Tapered legs via lathe-ish stacked boxes
    for (const sx of [-0.13, 0.13]) {
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.42, 8), jeans);
      thigh.position.set(sx, 0.95, 0);
      g.add(thigh);
      const calf = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8), jeans);
      calf.position.set(sx, 0.55, 0);
      g.add(calf);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.34), shoe);
      boot.position.set(sx, 0.1, 0.04);
      g.add(boot);
    }

    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.22, 10), jeans);
    hips.position.set(0, 1.18, 0);
    g.add(hips);

    // Shaped torso (wider chest)
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.55, 10), tee);
    torso.position.set(0, 1.5, 0);
    g.add(torso);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), tee);
    chest.scale.set(1.15, 0.7, 0.85);
    chest.position.set(0, 1.62, 0.02);
    g.add(chest);

    for (const sx of [-0.32, 0.32]) {
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.32, 8), tee);
      upper.position.set(sx, 1.55, 0);
      g.add(upper);
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.3, 8), skin);
      lower.position.set(sx, 1.25, 0);
      g.add(lower);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), skin);
      hand.position.set(sx, 1.08, 0);
      g.add(hand);
    }

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), skin);
    neck.position.set(0, 1.82, 0);
    g.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
    head.scale.set(0.95, 1.05, 0.9);
    head.position.set(0, 2.02, 0);
    g.add(head);

    // Hair volume
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8), hair);
    hairCap.scale.set(1.05, 0.7, 1.05);
    hairCap.position.set(0, 2.1, -0.01);
    g.add(hairCap);

    // Face planes
    const eyeW = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
    const eyeP = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    for (const sx of [-0.05, 0.05]) {
      const eye = new THREE.Mesh(new THREE.CircleGeometry(0.025, 8), eyeW);
      eye.position.set(sx, 2.04, 0.13);
      g.add(eye);
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.012, 6), eyeP);
      pupil.position.set(sx, 2.04, 0.135);
      g.add(pupil);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 4), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.98, 0.14);
    g.add(nose);

    return g;
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
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0016, -0.25, 0.45);
    });
  }

  enterVehicle(v) {
    this.inVehicle = true;
    this.vehicle = v;
    this.root.visible = false;
    v.occupied = true;
    if (this.mixer) this.mixer.stopAllAction();
  }

  exitVehicle() {
    if (!this.vehicle) return;
    const v = this.vehicle;
    const exit = v.mesh.position.clone();
    exit.x += Math.sin(v.yaw + Math.PI / 2) * 2.4;
    exit.z += Math.cos(v.yaw + Math.PI / 2) * 2.4;
    this.root.position.copy(exit);
    this.root.position.y = 0;
    if (this.world?.resolveCollision) {
      this.world.resolveCollision(this.root.position, this.radius);
    }
    this.root.visible = true;
    this.yaw = v.yaw;
    v.occupied = false;
    v.throttle = 0;
    this.vehicle = null;
    this.inVehicle = false;
    if (this.actions.idle) {
      this._currentAction = null;
      this._fadeTo('idle', 0.05);
    }
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);

    if (this.inVehicle && this.vehicle) {
      this.vehicle.control(this.keys, this.mobileStick, dt);
      this.vehicle.update(dt);
      this._camCar(dt);
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

    const sprint = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
    let moving = false;

    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz) || 1;
      mx /= len;
      mz /= len;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      const dx = fx * -mz + rx * mx;
      const dz = fz * -mz + rz * mx;
      const spd = this.speed * (sprint ? this.runMul : 1);
      this.root.position.x += dx * spd * dt;
      this.root.position.z += dz * spd * dt;
      // Face move direction
      this.root.rotation.y = Math.atan2(dx, dz);
      moving = true;
      this._moveAmt = spd;
    } else {
      this._moveAmt = 0;
    }

    if (this.mixer) {
      if (!moving) this._fadeTo('idle');
      else if (sprint) this._fadeTo('run');
      else this._fadeTo('walk');
    }

    if (this.world?.resolveCollision) {
      this.world.resolveCollision(this.root.position, this.radius);
    } else {
      this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -140, 240);
      this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -90, 110);
      this.root.position.y = 0;
    }

    this._camOrbit(dt);
  }

  _camOrbit(dt) {
    const t = this.root.position;
    const dist = 5.8;
    const height = 2.4 + this.pitch * 3.2;
    const desired = new THREE.Vector3(
      t.x + Math.sin(this.yaw) * dist,
      t.y + height,
      t.z + Math.cos(this.yaw) * dist
    );
    this.camera.position.lerp(desired, 1 - Math.pow(0.0009, dt));
    // Look at upper chest / head — frames a real character
    this._lookAt.set(t.x, t.y + 1.55, t.z);
    this.camera.lookAt(this._lookAt);
  }

  _camCar(dt) {
    const v = this.vehicle;
    const dist = 9.5;
    const height = 3.6;
    const desired = new THREE.Vector3(
      v.mesh.position.x + Math.sin(v.yaw) * dist,
      v.mesh.position.y + height,
      v.mesh.position.z + Math.cos(v.yaw) * dist
    );
    this.camera.position.lerp(desired, 1 - Math.pow(0.0008, dt));
    this.camera.lookAt(
      v.mesh.position.x - Math.sin(v.yaw) * 2,
      v.mesh.position.y + 1.2,
      v.mesh.position.z - Math.cos(v.yaw) * 2
    );
    this.yaw = v.yaw;
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
  }

  heal(n = 100) {
    this.health = Math.min(100, this.health + n);
  }
}
