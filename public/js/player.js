import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** localStorage key for selected playable character */
export const CHAR_KEY = 'belizetrini_char';

export const CHAR_PATHS = {
  male: '/assets/characters/male.glb',
  female: '/assets/characters/female.glb',
};

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
 * Third-person player — Quaternius Casual_Male / Casual_Female (CC0) with Idle/Walk.
 * Sunny-ref kitbash v2: Belize male (white tank, olive cargo, dog tags, backpack)
 * + Trinidad female (red crop, olive shorts, curly updo + headband, gold hoops).
 * Ground vehicles keep rider visible.
 */
export class Player {
  constructor(scene, spawn, world, opts = {}) {
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
    this._accessories = null;
    this._seated = false;

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
    if (next === this.charId && this.ready && this.model) return this._loadPromise;
    this.charId = next;
    this._loadPromise = this._loadCharacter();
    return this._loadPromise;
  }

  async _loadCharacter() {
    // Clear previous model
    if (this.model) {
      this.root.remove(this.model);
      this.model = null;
    }
    this.mixer = null;
    this.actions = {};
    this._currentAction = null;
    this._headBone = null;
    this._accessories = null;
    this.ready = false;

    if (!this._placeholder.parent) this.root.add(this._placeholder);
    this._placeholder.visible = true;

    const loader = new GLTFLoader();
    const primary = CHAR_PATHS[this.charId] || CHAR_PATHS.male;
    const urls = [
      primary,
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
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) {
            mat.side = THREE.FrontSide;
            mat.metalness = Math.min(mat.metalness ?? 0, 0.25);
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

    // Normalize scale — Quaternius / Mixamo vary
    const box = new THREE.Box3().setFromObject(this.model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetH = 1.8;
    const s = size.y > 0.01 ? targetH / size.y : 1;
    this.model.scale.setScalar(s);
    box.setFromObject(this.model);
    this.model.position.y = -box.min.y;

    this._applyPortraitLook(this.charId);

    this.root.remove(this._placeholder);
    this.root.add(this.model);

    // Animations — case-insensitive Idle/Walk
    this.mixer = new THREE.AnimationMixer(this.model);
    const clips = gltf.animations || [];
    const find = (...needles) =>
      clips.find((c) => needles.some((n) => c.name.toLowerCase().includes(n)));

    const idleClip = find('idle') || clips[0];
    const walkClip = clips.find((c) => /walk/i.test(c.name) && !/carry/i.test(c.name)) || find('walk');
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
      this.actions.idle.play();
      this._currentAction = this.actions.idle;
    } else if (this.actions.walk) {
      this.actions.walk.play();
      this._currentAction = this.actions.walk;
    }

    console.info('[player] loaded', this.charId, used, 'clips:', clips.map((c) => c.name).join(', '));
    this.ready = true;
  }

  /**
   * Kitbash v2 — match sunny pier refs (Belize male / Trinidad female).
   * FBX links in mockup are fake; Quaternius Casual bases + procedural accessories.
   */
  _applyPortraitLook(charId) {
    const skin = new THREE.Color(0x5a3320);
    const face = new THREE.Color(0x6b3d28);
    const hair = new THREE.Color(0x0a0806);
    const olive = new THREE.Color(0x5a6b3a); // cargo shorts
    const boots = new THREE.Color(0x8a6a42); // tan work boots
    const shirt = charId === 'female'
      ? new THREE.Color(0xc62828) // red sleeveless crop
      : new THREE.Color(0xf5f2ea); // white ribbed tank

    this.model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i].clone();
        mats[i] = m;
        const n = (m.name || o.name || '').toLowerCase();
        if (n.includes('skin')) {
          m.color.copy(skin);
          m.roughness = 0.68;
        } else if (n.includes('face')) {
          m.color.copy(face);
          m.roughness = 0.62;
        } else if (n.includes('hair')) {
          m.color.copy(hair);
          m.roughness = 0.95;
          // Female: hide stock hair under curly updo
          if (charId === 'female') m.visible = false;
        } else if (n.includes('shirt')) {
          m.color.copy(shirt);
          m.roughness = 0.78;
        } else if (n.includes('pants') || n.includes('belt')) {
          m.color.copy(olive);
          m.roughness = 0.88;
        } else if (n.includes('shoe') || n.includes('boot') || n.includes('sneaker')) {
          m.color.copy(boots);
          m.roughness = 0.9;
        }
      }
      o.material = Array.isArray(o.material) ? mats : mats[0];
    });

    const host = this._headBone || this.model;
    this._accessories = new THREE.Group();
    this._accessories.name = 'sunnyRefAccessories';

    // Backpack (both) — sits on torso, parented to model root so it rides with body
    const packHost = this.model;
    const packGroup = new THREE.Group();
    packGroup.name = 'backpack';
    const packMat = new THREE.MeshStandardMaterial({ color: 0x2a2e28, roughness: 0.9, metalness: 0.05 });
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x1a1c18, roughness: 0.92 });
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.18), packMat);
    pack.position.set(0, 1.28, -0.22);
    packGroup.add(pack);
    for (const sx of [-0.14, 0.14]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.03), strapMat);
      strap.position.set(sx, 1.35, -0.02);
      strap.rotation.x = 0.15;
      packGroup.add(strap);
    }
    packHost.add(packGroup);
    this._accessories.userData.packGroup = packGroup;

    if (charId === 'female') {
      // Voluminous curly updo
      const afroMat = new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 0.98, metalness: 0 });
      const bun = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), afroMat);
      bun.scale.set(1.35, 1.45, 1.3);
      bun.position.set(0, 0.22, -0.02);
      this._accessories.add(bun);
      for (const [x, y, z, r] of [
        [0.12, 0.14, 0.06, 0.1], [-0.12, 0.14, 0.06, 0.1],
        [0.0, 0.28, -0.06, 0.11], [0.1, 0.2, -0.1, 0.09], [-0.1, 0.2, -0.1, 0.09],
        [0.08, 0.1, 0.12, 0.08], [-0.08, 0.1, 0.12, 0.08],
        [0.0, 0.08, 0.14, 0.07], [0.14, 0.22, 0.0, 0.08], [-0.14, 0.22, 0.0, 0.08],
      ]) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), afroMat);
        puff.position.set(x, y, z);
        this._accessories.add(puff);
      }
      // Red/orange patterned headband
      const bandMat = new THREE.MeshStandardMaterial({ color: 0xe53935, roughness: 0.7, metalness: 0.05 });
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 18), bandMat);
      band.rotation.x = Math.PI / 2.05;
      band.position.set(0, 0.1, 0.02);
      this._accessories.add(band);
      const bandAccent = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.025, 0.04),
        new THREE.MeshStandardMaterial({ color: 0xff9800, roughness: 0.65 })
      );
      bandAccent.position.set(0.1, 0.1, 0.06);
      this._accessories.add(bandAccent);
      // Gold hoop earrings
      const hoopMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.3 });
      for (const sx of [-0.13, 0.13]) {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.006, 6, 14), hoopMat);
        hoop.rotation.y = Math.PI / 2;
        hoop.position.set(sx, -0.02, 0.02);
        this._accessories.add(hoop);
      }
      // Thin gold necklace pendant (on model)
      const neckMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.35 });
      const pendant = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), neckMat);
      pendant.position.set(0, 1.55, 0.14);
      packHost.add(pendant);
    } else {
      // Male: short hair kept; add slight beard silhouette + dog tags
      const beardMat = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.95 });
      const beard = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), beardMat);
      beard.scale.set(0.95, 0.55, 0.7);
      beard.position.set(0, -0.08, 0.06);
      this._accessories.add(beard);
      // Dog tags
      const tagMat = new THREE.MeshStandardMaterial({ color: 0xc0c4c8, metalness: 0.75, roughness: 0.4 });
      const chainMat = new THREE.MeshStandardMaterial({ color: 0x9a9ea2, metalness: 0.7, roughness: 0.45 });
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.006, 4, 16), chainMat);
      chain.rotation.x = Math.PI / 2.4;
      chain.position.set(0, 1.58, 0.08);
      packHost.add(chain);
      for (const ox of [-0.025, 0.025]) {
        const tag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.008), tagMat);
        tag.position.set(ox, 1.48, 0.14);
        tag.rotation.z = ox > 0 ? 0.15 : -0.1;
        packHost.add(tag);
      }
    }

    host.add(this._accessories);
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
    const skin = this._mat(0x6b3f2a, { roughness: 0.7 });
    const jeans = this._mat(0x5a6b3a, { roughness: 0.85 });
    const tee = this._mat(this.charId === 'female' ? 0xc62828 : 0xf5f2ea, { roughness: 0.7 });
    const shoe = this._mat(0x8a6a42, { roughness: 0.9 });
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

  _seatOffset(type) {
    if (type === 'scooter') return { x: 0, y: 0.52, z: 0.18, scale: 0.92, yaw: Math.PI };
    if (type === 'van') return { x: 0.42, y: 0.62, z: 0.25, scale: 0.95, yaw: Math.PI };
    // sedan default
    return { x: 0.38, y: 0.48, z: 0.12, scale: 0.95, yaw: Math.PI };
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
    this.root.position.set(seat.x, seat.y, seat.z);
    this.root.rotation.set(0, seat.yaw, 0);
    this.root.scale.setScalar(seat.scale);
    this._seated = true;

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
    this._lookAt.set(t.x, t.y + 1.55, t.z);
    this.camera.lookAt(this._lookAt);
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
