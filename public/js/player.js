import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ProceduralRig, SEAT_POSES } from './char_rig.js';
import { CHAR_RIG_DATA } from './char_rig_data.js';

/** localStorage key for selected playable character */
export const CHAR_KEY = 'belizetrini_char';

export const CHAR_PATHS = {
  male: '/assets/characters/male.glb',
  female: '/assets/characters/female.glb',
};

/**
 * build_characters v3 turnaround trimeshes face local +Z; root.rotation.y = atan2(dx, dz)
 * already aligns local +Z with movement — no extra mesh yaw. (Prior simulated kit faced -Z / used PI.)
 */
export const MODEL_YAW_OFFSET = 0;

/**
 * On-foot movement tuning (world m/s, m/s^2, rad/s). W walks, Shift sprints with the run cycle.
 * Walk speed is capped where a planted-foot walk cycle still looks like walking; sprint keeps
 * the old on-foot cruising pace.
 */
export const MOVE = {
  walkSpeed: 2.6,
  sprintSpeed: 9.0,
  accelWalk: 9,
  accelSprint: 12,
  decel: 14,
  turnRateWalk: 11,
  turnRateSprint: 6.5,
};

const _clamp = THREE.MathUtils.clamp;
const _lerp = THREE.MathUtils.lerp;
const _damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const _wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const _toward = (cur, target, maxStep) =>
  Math.abs(target - cur) <= maxStep ? target : cur + Math.sign(target - cur) * maxStep;

export function getStoredChar() {
  try {
    const v = localStorage.getItem(CHAR_KEY);
    return v === 'female' ? 'female' : 'male';
  } catch (_) {
    return 'male';
  }
}

export function setStoredChar(id) {
  const v = id === 'female' ? 'female' : 'male';
  try { localStorage.setItem(CHAR_KEY, v); } catch (_) {}
  return v;
}

/**
 * Third-person player — Marco build_characters iter2 Belizean male / Trinidadian female GLBs.
 * The GLBs have no skins or clips: ProceduralRig (char_rig.js) regroups the part meshes under
 * joint pivots and drives idle / walk / run / seated poses procedurally.
 * MODEL_YAW_OFFSET=0 (faces +Z). Ground vehicles keep the rider visible, seated facing forward.
 */
export class Player {
  constructor(scene, spawn, world, opts = {}) {
    this.scene = scene;
    this.world = world || null;
    this.speed = MOVE.walkSpeed; // compat: base on-foot speed
    this.yaw = 0; // camera yaw (mouse); movement input is relative to it
    this.heading = 0; // character facing (radians, forward = (sin, cos))
    this.groundSpeed = 0; // actual on-foot speed after collisions (drives the gait)
    this._moveSpeed = 0; // commanded speed along heading (accelerated)
    this._accel = 0;
    this._turnRate = 0;
    this._mouseIdle = 10;
    this._camTarget = new THREE.Vector3();
    this._camInit = false;
    this._tmpPos = new THREE.Vector3();
    this.rig = null;
    this._seatPoseCur = null;
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
    this.charId = opts.charId === 'female' ? 'female' : (opts.charId === 'male' ? 'male' : getStoredChar());

    this.root = new THREE.Group();
    this.root.position.copy(spawn);
    this.root.position.y = 0;
    scene.add(this.root);

    this.mesh = this.root;
    this.model = null;
    this.mixer = null;
    this.actions = {};
    this._currentAction = null;
    this._headBone = null;
    this._seated = false;
    /** Monotonic load id — stale async GLB loads must not add a second mesh. */
    this._loadGen = 0;

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 450);
    this._camPos = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();

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

  async setCharacter(id) {
    const next = setStoredChar(id);
    // Same selection: do not bump _loadGen (avoids constructor + char-select init race).
    if (next === this.charId) {
      if (this.ready && this.model) return this._loadPromise;
      if (this._loadPromise) return this._loadPromise;
    }
    this.charId = next;
    this._loadPromise = this._loadCharacter();
    return this._loadPromise;
  }

  /** Remove + dispose a character Object3D (geometry/materials). */
  _disposeObject(obj) {
    if (!obj) return;
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) mat.dispose?.();
      }
    });
  }

  _detachAndDispose(obj) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    this._disposeObject(obj);
  }

  /** Drop every non-placeholder child so raced loads cannot leave a ghost mesh. */
  _clearRootModels() {
    const keep = this._placeholder;
    const doomed = this.root.children.filter((c) => c !== keep);
    for (const c of doomed) {
      this.root.remove(c);
      this._disposeObject(c);
    }
  }

  async _loadCharacter() {
    const gen = ++this._loadGen;
    const wantChar = this.charId;

    // Tear down prior mesh + any orphaned race leftovers immediately.
    this._detachAndDispose(this.model);
    this.model = null;
    this._clearRootModels();
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.actions = {};
    this._currentAction = null;
    this._headBone = null;
    this.rig = null;
    this.ready = false;

    if (!this._placeholder.parent) this.root.add(this._placeholder);
    this._placeholder.visible = true;

    const loader = new GLTFLoader();
    // Only the selected gender is primary. Fallbacks are male Soldier aliases —
    // never load female.glb when male is selected (and vice-versa for primary).
    const primary = CHAR_PATHS[wantChar] || CHAR_PATHS.male;
    const urls = wantChar === 'female'
      ? [primary]
      : [primary, '/assets/characters/player.glb', '/assets/characters/soldier_mixamo.glb'];
    let gltf = null;
    let used = '';
    for (const url of urls) {
      if (gen !== this._loadGen) return;
      try {
        gltf = await loader.loadAsync(url);
        used = url;
        break;
      } catch (err) {
        console.warn('[player] failed to load', url, err);
      }
    }

    // Stale load (newer setCharacter / constructor race won) — discard.
    if (gen !== this._loadGen) {
      if (gltf?.scene) this._disposeObject(gltf.scene);
      return;
    }

    if (!gltf) {
      console.warn('[player] GLB unavailable — using procedural hi-fi fallback');
      this._clearRootModels();
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
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) {
            mat.side = THREE.FrontSide;
            this._ensureStockMaterial(mat);
          }
        }
      }
      if (o.isBone && /^head$/i.test(o.name)) this._headBone = o;
    });
    if (!this._headBone) {
      this.model.traverse((o) => {
        if (o.isBone && /head/i.test(o.name) && !/end/i.test(o.name) && !this._headBone) {
          this._headBone = o;
        }
      });
    }

    // Clip-less Marco GLBs: regroup part meshes under joint pivots for procedural animation.
    const hasClips = (gltf.animations || []).some((c) => !/t[\s_-]?pose/i.test(c.name));
    if (!hasClips) {
      this.rig = ProceduralRig.create(this.model, CHAR_RIG_DATA[wantChar]);
      if (this.rig) {
        console.info('[player] procedural rig', wantChar, this.rig.stats, 'fillers', this.rig.fillers.join(' '));
      }
    }

    // Some Mixamo exports land Z-up; rotate to Y-up before height normalize.
    let box = new THREE.Box3().setFromObject(this.model);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.z >= size.y && size.z >= size.x) {
      this.model.rotation.x = -Math.PI / 2;
      box = new THREE.Box3().setFromObject(this.model);
      box.getSize(size);
    }
    const targetH = 1.8;
    const s = size.y > 0.01 ? targetH / size.y : 1;
    this.model.scale.setScalar(s);
    // Face movement direction (Mixamo forward ≠ Three.js +Z)
    this.model.rotation.y = MODEL_YAW_OFFSET;
    box.setFromObject(this.model);
    this.model.position.y = -box.min.y;

    if (gen !== this._loadGen) {
      this._disposeObject(this.model);
      this.model = null;
      return;
    }

    this._clearRootModels();
    this.root.remove(this._placeholder);
    this.root.add(this.model);

    // Animations — Idle/Walk; never treat TPose as idle (bind-pose ghost).
    this.mixer = new THREE.AnimationMixer(this.model);
    const clips = gltf.animations || [];
    const isTPose = (c) => /t[\s_-]?pose/i.test(c.name);
    const find = (...needles) =>
      clips.find(
        (c) => !isTPose(c) && needles.some((n) => c.name.toLowerCase().includes(n))
      );

    const idleClip =
      find('idle') ||
      clips.find((c) => !isTPose(c)) ||
      null;
    const walkClip =
      clips.find((c) => /walk/i.test(c.name) && !/carry/i.test(c.name) && !isTPose(c)) ||
      find('walk');
    const runClip = find('run') || null;
    const sitClip = find('sit');

    if (idleClip) this.actions.idle = this.mixer.clipAction(idleClip);
    if (walkClip) this.actions.walk = this.mixer.clipAction(walkClip);
    if (runClip) this.actions.run = this.mixer.clipAction(runClip);
    if (sitClip) {
      this.actions.sit = this.mixer.clipAction(sitClip);
      this.actions.sit.setLoop(THREE.LoopOnce, 1);
      this.actions.sit.clampWhenFinished = true;
    }

    if (this.actions.idle) {
      this.actions.idle.reset().play();
      this._currentAction = this.actions.idle;
    } else if (this.actions.walk) {
      this.actions.walk.reset().play();
      this._currentAction = this.actions.walk;
    } else {
      // No clips: ProceduralRig animates it (or it stays static if the names did not map).
      if (!this.rig) console.info('[player] no clips and no rig — static mesh', used);
      this.model.visible = true;
    }
    if (this.rig && this.inVehicle && this._seatPoseCur) this.rig.snapSeated(this._seatPoseCur);

    // One more race check after wiring.
    if (gen !== this._loadGen) {
      this._detachAndDispose(this.model);
      this.model = null;
      this.mixer = null;
      this.actions = {};
      this._currentAction = null;
      return;
    }

    console.info('[player] loaded', this.charId, used, 'clips:', clips.map((c) => c.name).join(', '));
    this.ready = true;
  }


  /**
   * Preserve authored Caribbean skin/cloth colors. Only clamp runaway metalness and
   * fix texture colorSpace — do not recolor to Quaternius beige.
   */
  _ensureStockMaterial(mat) {
    if (!mat) return;
    mat.metalness = Math.min(mat.metalness ?? 0, 0.08);
    if (mat.roughness == null) mat.roughness = 0.7;
    if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
  }

  _fadeTo(name, duration = 0.2) {
    const next = this.actions[name];
    if (!next || next === this._currentAction) {
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

  _makeHiFiProcedural() {
    const g = new THREE.Group();
    // Neutral casual fallback only if GLB fails — not poster-matching kitbash
    const skin = this._mat(0xc68642, { roughness: 0.7 });
    const jeans = this._mat(this.charId === 'female' ? 0x3d4a6b : 0x2f4a7a, { roughness: 0.85 });
    const tee = this._mat(this.charId === 'female' ? 0xe8a0b0 : 0x5a8f6a, { roughness: 0.7 });
    const shoe = this._mat(0x222222, { roughness: 0.9 });
    const hair = this._mat(0x1a120c, { roughness: 0.95 });

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

    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8), hair);
    hairCap.scale.set(1.05, 0.7, 1.05);
    hairCap.position.set(0, 2.1, -0.01);
    g.add(hairCap);

    return g;
  }

  /**
   * Rider placement in vehicle-body space. Vehicles face -Z and the character faces +Z,
   * so yaw = PI seats the rider facing forward. hipY = seat height for the hips joint;
   * y is the old standing-rider fallback when there is no rig.
   */
  _seatOffset(type) {
    if (type === 'scooter') {
      return { x: 0, z: 0.04, hipY: 1.03, y: 0.52, scale: 0.92, yaw: Math.PI, pose: SEAT_POSES.scooter };
    }
    if (type === 'van') {
      return { x: 0.42, z: -1.2, hipY: 0.98, y: 0.62, scale: 0.95, yaw: Math.PI, pose: SEAT_POSES.car };
    }
    // sedan default
    return { x: 0.38, z: 0.18, hipY: 0.42, y: 0.48, scale: 0.95, yaw: Math.PI, pose: SEAT_POSES.car };
  }

  /** World units per model unit (drives stride length). */
  _rigScale() {
    return (this.model?.scale.x || 1) * (this.root.scale.x || 1);
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
      this._mouseIdle = 0;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0016, -0.25, 0.45);
    });
  }

  enterVehicle(v) {
    this.inVehicle = true;
    this.vehicle = v;
    v.occupied = true;

    // Air craft: hide rider (cockpit). Ground: keep visible seated on vehicle.
    if (v.isAir) {
      this.root.visible = false;
      if (this.mixer) this.mixer.stopAllAction();
      this._seated = false;
      return;
    }

    this.root.visible = true;
    // Detach from scene, parent to vehicle body so lean follows
    if (this.root.parent) this.root.parent.remove(this.root);
    const host = v.body || v.mesh;
    host.add(this.root);

    const seat = this._seatOffset(v.type);
    this.root.rotation.set(0, seat.yaw, 0);
    this.root.scale.setScalar(seat.scale);
    let y = seat.y;
    if (this.rig && this.model) {
      // Put the hips joint on the seat.
      y = seat.hipY - seat.scale * (this.model.position.y + this.model.scale.y * this.rig.hipsHeight());
      this.rig.snapSeated(seat.pose);
    }
    this.root.position.set(seat.x, y, seat.z);
    this._seatPoseCur = seat.pose;
    this._seated = true;
    this._moveSpeed = 0;
    this.groundSpeed = 0;

    if (this.actions.sit) {
      this._fadeTo('sit', 0.08);
    } else if (this.actions.idle) {
      this._fadeTo('idle', 0.08);
    }
  }

  exitVehicle() {
    if (!this.vehicle) return;
    const v = this.vehicle;
    const exit = v.mesh.position.clone();
    const side = v.isAir ? 3.2 : 2.4;
    exit.x += Math.sin(v.yaw + Math.PI / 2) * side;
    exit.z += Math.cos(v.yaw + Math.PI / 2) * side;
    exit.y = 0;

    // Unparent back to scene
    if (this.root.parent) this.root.parent.remove(this.root);
    this.scene.add(this.root);
    this.root.scale.setScalar(1);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = true;
    this.root.position.copy(exit);
    this.root.position.y = 0;
    this._seated = false;

    if (this.world?.resolveCollision) {
      this.world.resolveCollision(this.root.position, this.radius);
    }
    this.yaw = v.yaw;
    // Vehicle forward is (-sin yaw, -cos yaw); character forward is (sin h, cos h).
    this.heading = _wrap(v.yaw + Math.PI);
    this.root.rotation.y = this.heading;
    this._moveSpeed = 0;
    this.groundSpeed = 0;
    this._seatPoseCur = null;
    if (this.rig) this.rig.snapSeated(null);
    this._camInit = false;
    v.occupied = false;
    v.throttle = 0;
    if (typeof v.park === 'function') v.park();
    if (v.isAir && v.mesh.position.y < 3) {
      v.mesh.position.y = 0;
      v.velocity.set(0, 0, 0);
      v.pitch = 0;
      v.body.rotation.x = 0;
      v.body.rotation.z = 0;
    }
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
      if (this.rig && !this.vehicle.isAir) {
        this.rig.update(dt, { speed: 0, scale: this._rigScale(), seated: this._seatPoseCur });
      }
      this._camCar(dt);
      return;
    }

    // --- input (relative to camera yaw) ---
    let mx = 0;
    let mz = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) mz -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) mz += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) mx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;
    const keyboard = mx !== 0 || mz !== 0;
    const stickMag = Math.min(1, Math.hypot(this.mobileStick.x, this.mobileStick.y));
    mx += this.mobileStick.x;
    mz += this.mobileStick.y;
    const sprint = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);

    let targetSpeed = 0;
    let turnRate = 0;
    if (Math.hypot(mx, mz) > 0.08) {
      const len = Math.hypot(mx, mz);
      const nx = mx / len;
      const nz = mz / len;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      const dx = fx * -nz + rx * nx;
      const dz = fz * -nz + rz * nx;
      const want = Math.atan2(dx, dz);

      if (sprint) targetSpeed = MOVE.sprintSpeed;
      else if (keyboard) targetSpeed = MOVE.walkSpeed;
      else if (stickMag <= 0.75) targetSpeed = (stickMag / 0.75) * MOVE.walkSpeed;
      else targetSpeed = _lerp(MOVE.walkSpeed, MOVE.sprintSpeed, (stickMag - 0.75) / 0.25);

      // Smooth, rate-limited turn toward the move direction; slow down in sharp turns.
      const diff = _wrap(want - this.heading);
      const sprintK = _clamp((this._moveSpeed - MOVE.walkSpeed) / (MOVE.sprintSpeed - MOVE.walkSpeed), 0, 1);
      const maxRate = _lerp(MOVE.turnRateWalk, MOVE.turnRateSprint, sprintK);
      const step = _clamp(diff * (1 - Math.exp(-16 * dt)), -maxRate * dt, maxRate * dt);
      this.heading = _wrap(this.heading + step);
      turnRate = dt > 0 ? step / dt : 0;
      const sharp = _clamp((Math.abs(diff) - 0.6) / 1.8, 0, 1);
      targetSpeed *= _lerp(1, 0.35, sharp * sharp * (3 - 2 * sharp));
    }

    // --- acceleration / deceleration along heading ---
    const prev = this._moveSpeed;
    const rate = targetSpeed > prev
      ? (targetSpeed > MOVE.walkSpeed + 0.1 ? MOVE.accelSprint : MOVE.accelWalk)
      : MOVE.decel;
    this._moveSpeed = _toward(prev, targetSpeed, rate * dt);

    const hx = Math.sin(this.heading);
    const hz = Math.cos(this.heading);
    const before = this._tmpPos.copy(this.root.position);
    this.root.position.x += hx * this._moveSpeed * dt;
    this.root.position.z += hz * this._moveSpeed * dt;

    if (this.world?.resolveCollision) {
      this.world.resolveCollision(this.root.position, this.radius);
    } else {
      this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -140, 240);
      this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -90, 110);
      this.root.position.y = 0;
    }

    // Actual ground speed along the facing (walls slow the gait instead of moonwalking).
    const along = dt > 0
      ? ((this.root.position.x - before.x) * hx + (this.root.position.z - before.z) * hz) / dt
      : 0;
    const actual = Math.max(0, along);
    if (this._moveSpeed > 0.5 && actual < this._moveSpeed * 0.6) this._moveSpeed = actual;
    this.groundSpeed = _damp(this.groundSpeed, actual, 30, dt);
    this._accel = _damp(this._accel, dt > 0 ? (this._moveSpeed - prev) / dt : 0, 8, dt);
    this._turnRate = _damp(this._turnRate, turnRate, 10, dt);
    this._moveAmt = this.groundSpeed;
    this.root.rotation.y = this.heading;

    if (this.rig) {
      this.rig.update(dt, {
        speed: this.groundSpeed,
        scale: this._rigScale(),
        turnRate: this._turnRate,
        accel: this._accel,
        seated: null,
      });
    }

    if (this.mixer) {
      const moving = this.groundSpeed > 0.3;
      if (!moving) this._fadeTo('idle');
      else if (this.groundSpeed > MOVE.walkSpeed + 0.5) this._fadeTo('run');
      else this._fadeTo('walk');
    }

    this._camOrbit(dt);
  }

  /**
   * Follow camera: damped target + position; drifts back behind the character while moving
   * (after ~1 s without mouse input), pulls back a little and widens FOV when sprinting.
   */
  _camOrbit(dt) {
    const t = this.root.position;
    let snap = false;
    if (!this._camInit || this._camTarget.distanceToSquared(t) > 400) {
      this._camTarget.copy(t);
      this._camInit = true;
      snap = true;
    } else {
      const k = 1 - Math.exp(-12 * dt);
      this._camTarget.x += (t.x - this._camTarget.x) * k;
      this._camTarget.y += (t.y - this._camTarget.y) * k;
      this._camTarget.z += (t.z - this._camTarget.z) * k;
    }

    this._mouseIdle += dt;
    const behind = _wrap(this.heading + Math.PI);
    const diff = _wrap(behind - this.yaw);
    if (this._mouseIdle > 0.9 && this.groundSpeed > 0.6 && Math.abs(diff) < 2.4) {
      const k = 1.8 * _clamp(this.groundSpeed / MOVE.sprintSpeed, 0.25, 1);
      this.yaw = _wrap(this.yaw + diff * (1 - Math.exp(-k * dt)));
    }

    const runK = this.rig
      ? this.rig.runW
      : _clamp((this.groundSpeed - MOVE.walkSpeed) / (MOVE.sprintSpeed - MOVE.walkSpeed), 0, 1);
    const c = this._camTarget;
    const dist = 5.8 + 0.8 * runK;
    const height = 2.4 + this.pitch * 3.2;
    const desired = new THREE.Vector3(
      c.x + Math.sin(this.yaw) * dist,
      c.y + height,
      c.z + Math.cos(this.yaw) * dist
    );
    if (snap) this.camera.position.copy(desired);
    else this.camera.position.lerp(desired, 1 - Math.exp(-9 * dt));
    this._lookAt.set(c.x, c.y + 1.55, c.z);
    this.camera.lookAt(this._lookAt);

    const fov = 60 + 4 * runK;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = _damp(this.camera.fov, fov, 4, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  _camCar(dt) {
    const v = this.vehicle;
    const air = !!v.isAir;
    const dist = air ? 16 : 9.5;
    const height = air ? 7.5 + Math.min(v.mesh.position.y * 0.08, 4) : 3.6;
    const desired = new THREE.Vector3(
      v.mesh.position.x + Math.sin(v.yaw) * dist,
      v.mesh.position.y + height,
      v.mesh.position.z + Math.cos(v.yaw) * dist
    );
    this.camera.position.lerp(desired, 1 - Math.pow(air ? 0.0012 : 0.0008, dt));
    this.camera.lookAt(
      v.mesh.position.x - Math.sin(v.yaw) * (air ? 4 : 2),
      v.mesh.position.y + (air ? 1.0 : 1.2),
      v.mesh.position.z - Math.cos(v.yaw) * (air ? 4 : 2)
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
