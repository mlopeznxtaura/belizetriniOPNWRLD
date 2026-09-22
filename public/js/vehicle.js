import * as THREE from 'three';

let _id = 1;

/**
 * Tunables — ground: grip = lateral friction (higher = less slip).
 * Air: climbRate / gravity / stall for plane; collective hover for heli.
 */
const TUNE = {
  sedan: {
    maxSpeed: 30, accel: 17, brake: 40, turnRate: 2.1,
    grip: 14, rollAmt: 0.14, drag: 2.2, reverseMul: 0.42, isAir: false,
  },
  scooter: {
    maxSpeed: 18, accel: 22, brake: 30, turnRate: 3.4,
    grip: 5.5, rollAmt: 0.42, drag: 2.8, reverseMul: 0.35, isAir: false,
  },
  van: {
    maxSpeed: 24, accel: 13, brake: 34, turnRate: 1.7,
    grip: 11, rollAmt: 0.09, drag: 2.6, reverseMul: 0.38, isAir: false,
  },
  plane: {
    maxSpeed: 52, accel: 16, brake: 10, turnRate: 1.15,
    pitchRate: 0.95, climbAssist: 0.35, gravity: 24, stallSpeed: 11,
    minAlt: 0, maxAlt: 80, takeoffLift: 14, isAir: true,
  },
  heli: {
    maxSpeed: 26, accel: 12, brake: 14, turnRate: 2.05,
    pitchRate: 1.05, climbRate: 15, strafe: 11, gravity: 20,
    hoverCollective: 0.52, minAlt: 0, maxAlt: 70, isAir: true,
  },
};

const TYPE_LABEL = {
  sedan: 'Sedan',
  scooter: 'Scooter',
  van: 'Van',
  plane: 'Plane',
  heli: 'Helicopter',
};

/**
 * Readable low-poly vehicle kits — ground + air.
 * Shared enter/exit via F; velocity-vector physics (no physics engine dep).
 */
export class Vehicle {
  constructor(scene, opts = {}) {
    this.id = 'v' + _id++;
    this.scene = scene;
    this.world = opts.world || null;
    this.yaw = opts.yaw || 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0; // longitudinal scalar (compat + HUD)
    this.velocity = new THREE.Vector3();
    this.type = opts.type || 'sedan';
    const t = TUNE[this.type] || TUNE.sedan;
    this.tune = t;
    this.maxSpeed = t.maxSpeed;
    this.accel = t.accel;
    this.brake = t.brake;
    this.turnRate = t.turnRate;
    this.isAir = !!t.isAir;
    this.occupied = false;
    this.throttle = 0;
    this.steer = 0;
    this.collective = t.hoverCollective || 0;
    this._rotorSpin = 0;
    this._propSpin = 0;
    this._bodyLean = 0;
    this.radius =
      this.type === 'scooter' ? 0.7 :
      this.type === 'van' ? 1.4 :
      this.type === 'plane' ? 2.4 :
      this.type === 'heli' ? 2.0 : 1.15;

    this.mesh = new THREE.Group();
    this.mesh.position.copy(opts.position || new THREE.Vector3());
    this.mesh.position.y = opts.position?.y ?? 0;

    // Visual sub-groups for lean / rotor
    this.body = new THREE.Group();
    this.mesh.add(this.body);
    this.rotor = null;
    this.tailRotor = null;
    this.prop = null;

    const color = opts.color;
    if (this.type === 'scooter') this._buildScooter(color ?? 0xff6b35);
    else if (this.type === 'van') this._buildVan(color ?? 0xd4a373);
    else if (this.type === 'plane') this._buildPlane(color ?? 0xe8e8e8);
    else if (this.type === 'heli') this._buildHeli(color ?? 0x2a9d8f);
    else this._buildSedan(color ?? 0x4361ee);

    this.mesh.rotation.y = this.yaw;
    scene.add(this.mesh);
  }

  get label() {
    return TYPE_LABEL[this.type] || 'Vehicle';
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
    const g = this.body;

    const rocker = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.35, 4.2), bodyMat);
    rocker.position.y = 0.45;
    g.add(rocker);

    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.18, 1.15), bodyMat);
    hood.position.set(0, 0.72, -1.35);
    g.add(hood);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 1.85), bodyMat);
    cabin.position.set(0, 0.95, 0.05);
    g.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 1.5), bodyMat);
    roof.position.set(0, 1.3, 0.05);
    g.add(roof);

    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.2, 0.85), bodyMat);
    trunk.position.set(0, 0.75, 1.55);
    g.add(trunk);

    const ws = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.55, 0.06), glass);
    ws.position.set(0, 1.05, -0.85);
    ws.rotation.x = -0.45;
    g.add(ws);

    const rw = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.06), glass);
    rw.position.set(0, 1.1, 0.95);
    rw.rotation.x = 0.4;
    g.add(rw);

    for (const sx of [-0.86, 0.86]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 1.4), glass);
      sw.position.set(sx, 1.05, 0.05);
      g.add(sw);
    }

    const fb = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.22, 0.28), dark);
    fb.position.set(0, 0.32, -2.15);
    g.add(fb);
    const rb = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.22, 0.28), dark);
    rb.position.set(0, 0.32, 2.15);
    g.add(rb);

    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.08), dark);
    grille.position.set(0, 0.5, -2.2);
    g.add(grille);

    for (const sx of [-0.95, 0.95]) {
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.2), dark);
      mir.position.set(sx, 1.0, -0.7);
      g.add(mir);
    }

    for (const [x, z] of [[0.95, 1.3], [-0.95, 1.3], [0.95, -1.3], [-0.95, -1.3]]) {
      const arch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 0.7), bodyMat);
      arch.position.set(x, 0.4, z);
      g.add(arch);
    }

    this._addWheels(g, [
      [0.92, 0.32, 1.35], [-0.92, 0.32, 1.35],
      [0.92, 0.32, -1.35], [-0.92, 0.32, -1.35],
    ], 0.33);
    this._addLights(g, 0.62, 0.52, -2.22, 2.2);
  }

  _buildVan(color) {
    const bodyMat = this._paint(color, { roughness: 0.55, metalness: 0.25 });
    const dark = this._dark();
    const glass = this._glass();
    const g = this.body;

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.7, 4.4), bodyMat);
    body.position.y = 1.15;
    g.add(body);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 0.6), bodyMat);
    nose.position.set(0, 0.85, -2.0);
    g.add(nose);

    const ws = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.7, 0.08), glass);
    ws.position.set(0, 1.45, -2.15);
    ws.rotation.x = -0.25;
    g.add(ws);

    for (const sx of [-1.04, 1.04]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 1.2), glass);
      sw.position.set(sx, 1.45, -1.4);
      g.add(sw);
    }

    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.4, 0.05), dark);
    seam.position.set(1.04, 1.1, 0.2);
    g.add(seam);

    for (const sx of [-0.55, 0.55]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 3.6), dark);
      rail.position.set(sx, 2.05, 0.1);
      g.add(rail);
    }

    const fb = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.28, 0.3), dark);
    fb.position.set(0, 0.38, -2.35);
    g.add(fb);

    this._addWheels(g, [
      [0.98, 0.35, 1.45], [-0.98, 0.35, 1.45],
      [0.98, 0.35, -1.45], [-0.98, 0.35, -1.45],
    ], 0.37);
    this._addLights(g, 0.7, 0.7, -2.4, 2.25);
  }

  _buildScooter(color) {
    const bodyMat = this._paint(color, { roughness: 0.4, metalness: 0.35 });
    const dark = this._dark();
    const chrome = this._paint(0xaaaaaa, { roughness: 0.3, metalness: 0.8 });
    const g = this.body;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 1.25), dark);
    deck.position.set(0, 0.38, 0.05);
    g.add(deck);

    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.7), bodyMat);
    cover.position.set(0, 0.62, 0.35);
    g.add(cover);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.55), dark);
    seat.position.set(0, 0.88, 0.25);
    g.add(seat);

    const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.12), bodyMat);
    fairing.position.set(0, 0.95, -0.5);
    fairing.rotation.x = -0.2;
    g.add(fairing);

    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.85, 8), chrome);
    stem.position.set(0, 1.0, -0.55);
    stem.rotation.x = 0.25;
    g.add(stem);

    const bars = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), chrome);
    bars.rotation.z = Math.PI / 2;
    bars.position.set(0, 1.4, -0.7);
    g.add(bars);
    for (const sx of [-0.35, 0.35]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), dark);
      grip.rotation.z = Math.PI / 2;
      grip.position.set(sx, 1.4, -0.7);
      g.add(grip);
    }

    const hlHouse = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.12), dark);
    hlHouse.position.set(0, 1.05, -0.7);
    g.add(hlHouse);
    const hl = new THREE.Mesh(
      new THREE.CircleGeometry(0.07, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0 })
    );
    hl.position.set(0, 1.05, -0.77);
    g.add(hl);

    const tire = this._paint(0x111111, { roughness: 0.95, metalness: 0.05 });
    const rim = chrome;
    for (const z of [-0.62, 0.68]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 12), tire);
      w.rotation.z = Math.PI / 2;
      w.position.set(0, 0.28, z);
      g.add(w);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.13, 10), rim);
      r.rotation.z = Math.PI / 2;
      r.position.set(0, 0.28, z);
      g.add(r);
    }
  }

  /** Low-poly bush plane — fuselage, wings, tail, prop, gear, cockpit glass */
  _buildPlane(color) {
    const bodyMat = this._paint(color, { roughness: 0.45, metalness: 0.3 });
    const accent = this._paint(0x4361ee, { roughness: 0.4, metalness: 0.35 });
    const dark = this._dark();
    const glass = this._glass();
    const chrome = this._paint(0xbbbbbb, { roughness: 0.35, metalness: 0.75 });
    const g = this.body;

    // Fuselage
    const fuse = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 5.2), bodyMat);
    fuse.position.y = 1.15;
    g.add(fuse);

    // Nose taper
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.75, 1.1), bodyMat);
    nose.position.set(0, 1.1, -2.9);
    g.add(nose);

    // Cockpit canopy
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 1.3), glass);
    canopy.position.set(0, 1.85, -0.9);
    g.add(canopy);

    // Wings
    const wing = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.12, 1.35), accent);
    wing.position.set(0, 1.25, -0.2);
    g.add(wing);
    // Wing tips
    for (const sx of [-3.55, 3.55]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 1.2), dark);
      tip.position.set(sx, 1.35, -0.2);
      g.add(tip);
    }

    // Horizontal stabilizer
    const hstab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.7), bodyMat);
    hstab.position.set(0, 1.55, 2.35);
    g.add(hstab);

    // Vertical fin
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.9), accent);
    fin.position.set(0, 2.15, 2.2);
    g.add(fin);

    // Prop spinner + blades (spinning group)
    this.prop = new THREE.Group();
    this.prop.position.set(0, 1.1, -3.45);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 8), chrome);
    spinner.rotation.x = Math.PI / 2;
    this.prop.add(spinner);
    for (let i = 0; i < 2; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.06), dark);
      blade.rotation.z = (i * Math.PI) / 2;
      this.prop.add(blade);
    }
    g.add(this.prop);

    // Landing gear
    for (const [x, z] of [[0.55, 0.6], [-0.55, 0.6], [0, -2.4]]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 6), dark);
      strut.position.set(x, 0.45, z);
      g.add(strut);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 10), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.18, z);
      g.add(wheel);
    }

    // Nav lights
    const red = new THREE.MeshBasicMaterial({ color: 0xff2244 });
    const green = new THREE.MeshBasicMaterial({ color: 0x44ff66 });
    const nl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.12), red);
    nl.position.set(-3.5, 1.35, -0.2);
    g.add(nl);
    const nr = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.12), green);
    nr.position.set(3.5, 1.35, -0.2);
    g.add(nr);
  }

  /** Low-poly utility heli — cabin, boom, main+tail rotors, skids */
  _buildHeli(color) {
    const bodyMat = this._paint(color, { roughness: 0.5, metalness: 0.3 });
    const dark = this._dark();
    const glass = this._glass();
    const chrome = this._paint(0xaaaaaa, { roughness: 0.35, metalness: 0.7 });
    const g = this.body;

    // Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 2.4), bodyMat);
    cabin.position.set(0, 1.35, 0.1);
    g.add(cabin);

    // Nose / chin
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 0.7), bodyMat);
    nose.position.set(0, 1.15, -1.35);
    g.add(nose);

    // Cockpit glass bubble
    const bubble = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.75, 1.0), glass);
    bubble.position.set(0, 1.85, -0.55);
    g.add(bubble);

    // Side windows
    for (const sx of [-0.82, 0.82]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 1.0), glass);
      sw.position.set(sx, 1.55, 0.2);
      g.add(sw);
    }

    // Tail boom
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 3.2), bodyMat);
    boom.position.set(0, 1.55, 2.6);
    g.add(boom);

    // Tail fin
    const tfin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.7), dark);
    tfin.position.set(0, 2.1, 4.0);
    g.add(tfin);
    const hfin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.45), dark);
    hfin.position.set(0, 1.7, 4.0);
    g.add(hfin);

    // Main rotor mast + blades
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 8), chrome);
    mast.position.set(0, 2.3, 0.1);
    g.add(mast);

    this.rotor = new THREE.Group();
    this.rotor.position.set(0, 2.65, 0.1);
    for (let i = 0; i < 2; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 5.4), dark);
      blade.rotation.y = (i * Math.PI) / 2;
      this.rotor.add(blade);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 8), chrome);
    this.rotor.add(hub);
    g.add(this.rotor);

    // Tail rotor
    this.tailRotor = new THREE.Group();
    this.tailRotor.position.set(0.25, 2.0, 4.15);
    for (let i = 0; i < 2; i++) {
      const tb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.04), dark);
      tb.rotation.z = (i * Math.PI) / 2;
      this.tailRotor.add(tb);
    }
    g.add(this.tailRotor);

    // Skids
    for (const sx of [-0.7, 0.7]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 2.8), dark);
      skid.position.set(sx, 0.22, 0.1);
      g.add(skid);
      for (const z of [-0.9, 0.9]) {
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), dark);
        strut.position.set(sx, 0.55, z);
        g.add(strut);
      }
    }

    // Spot / nav
    const spot = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.12, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0 })
    );
    spot.position.set(0, 0.95, -1.65);
    g.add(spot);
  }

  _addWheels(parent, positions, radius) {
    const tire = this._paint(0x111111, { roughness: 0.95, metalness: 0.05 });
    const rim = this._paint(0xcccccc, { roughness: 0.35, metalness: 0.7 });
    const hub = this._paint(0x444444, { roughness: 0.5, metalness: 0.5 });
    for (const [x, y, z] of positions) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.26, 12), tire);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, y, z);
      parent.add(w);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, 0.28, 10), rim);
      r.rotation.z = Math.PI / 2;
      r.position.set(x, y, z);
      parent.add(r);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.25, radius * 0.25, 0.3, 8), hub);
      h.rotation.z = Math.PI / 2;
      h.position.set(x, y, z);
      parent.add(h);
    }
  }

  _addLights(parent, ox, y, fz, rz) {
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
    const tlMat = new THREE.MeshBasicMaterial({ color: 0xff2244 });
    for (const x of [ox, -ox]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.1), hlMat);
      hl.position.set(x, y, fz);
      parent.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.08), tlMat);
      tl.position.set(x, y, rz);
      parent.add(tl);
    }
  }

  control(keys, stick, dt) {
    if (this.type === 'plane') return this._controlPlane(keys, stick, dt);
    if (this.type === 'heli') return this._controlHeli(keys, stick, dt);
    return this._controlGround(keys, stick, dt);
  }

  _controlGround(keys, stick, dt) {
    let throttle = 0;
    let steer = 0;
    if (keys['KeyW'] || keys['ArrowUp']) throttle += 1;
    if (keys['KeyS'] || keys['ArrowDown']) throttle -= 0.85;
    if (keys['KeyA'] || keys['ArrowLeft']) steer += 1;
    if (keys['KeyD'] || keys['ArrowRight']) steer -= 1;
    throttle += -stick.y;
    steer += -stick.x;
    throttle = THREE.MathUtils.clamp(throttle, -1, 1);
    steer = THREE.MathUtils.clamp(steer, -1, 1);
    const braking = keys['Space'] || keys['brake'];

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    // Longitudinal speed along facing
    let long = this.velocity.x * fx + this.velocity.z * fz;
    let lat = this.velocity.x * rx + this.velocity.z * rz;

    if (braking) {
      long = THREE.MathUtils.damp(long, 0, this.brake * 0.12, dt);
      lat = THREE.MathUtils.damp(lat, 0, this.brake * 0.1, dt);
    } else if (throttle > 0.05) {
      long += throttle * this.accel * dt;
    } else if (throttle < -0.05) {
      // Brake if going forward; reverse if near stop / already reversing
      if (long > 1.5) {
        long -= Math.abs(throttle) * this.brake * 0.55 * dt;
      } else {
        long += throttle * this.accel * this.tune.reverseMul * dt;
      }
    } else {
      long = THREE.MathUtils.damp(long, 0, this.tune.drag * 0.15, dt);
    }

    const maxFwd = this.maxSpeed;
    const maxRev = -this.maxSpeed * this.tune.reverseMul;
    long = THREE.MathUtils.clamp(long, maxRev, maxFwd);

    // Lateral grip / slip — scooters slide more
    const grip = this.tune.grip;
    lat = THREE.MathUtils.damp(lat, 0, grip * 0.2, dt);

    this.velocity.x = fx * long + rx * lat;
    this.velocity.z = fz * long + rz * lat;
    this.velocity.y = 0;
    this.speed = long;

    // Steer scales with speed (can't turn when stopped); reverse flips
    const turnFactor = THREE.MathUtils.clamp(Math.abs(long) / 7, 0, 1);
    this.yaw += steer * this.turnRate * turnFactor * Math.sign(long || 1) * dt;
    this.throttle = throttle;
    this.steer = steer;

    // Visual lean / roll target
    const leanTarget = -steer * this.tune.rollAmt * THREE.MathUtils.clamp(Math.abs(long) / 12, 0, 1);
    this._bodyLean = THREE.MathUtils.damp(this._bodyLean, leanTarget, 8, dt);
  }

  _controlPlane(keys, stick, dt) {
    let throttle = this.throttle;
    let yawIn = 0;
    let pitchIn = 0;
    if (keys['KeyW']) throttle += 0.7 * dt;
    if (keys['KeyS']) throttle -= 0.85 * dt;
    throttle += -stick.y * 0.9 * dt;
    throttle = THREE.MathUtils.clamp(throttle, 0, 1);

    if (keys['KeyA'] || keys['ArrowLeft']) yawIn += 1;
    if (keys['KeyD'] || keys['ArrowRight']) yawIn -= 1;
    yawIn += -stick.x;

    if (keys['ArrowUp']) pitchIn += 1;
    if (keys['ArrowDown']) pitchIn -= 1;
    if (keys['Space']) pitchIn += 0.85;
    if (keys['ShiftLeft'] || keys['ShiftRight']) pitchIn -= 0.85;

    this.throttle = throttle;
    this.steer = yawIn;

    const t = this.tune;
    const alt = this.mesh.position.y;
    const onGround = alt <= 0.15;

    // Accelerate toward throttle target (faster spool than before)
    const targetSpd = throttle * this.maxSpeed;
    this.speed = THREE.MathUtils.damp(this.speed, targetSpd, onGround ? 2.4 : 1.6, dt);

    // Ground steering more responsive; air uses turnRate
    const yawScale = onGround ? THREE.MathUtils.clamp(this.speed / 10, 0, 1) : 1;
    this.yaw += yawIn * this.turnRate * yawScale * dt;

    this.pitch += pitchIn * t.pitchRate * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.55, 0.55);
    if (Math.abs(pitchIn) < 0.05) {
      this.pitch = THREE.MathUtils.damp(this.pitch, 0, 1.4, dt);
    }

    const fx = -Math.sin(this.yaw) * Math.cos(this.pitch);
    const fz = -Math.cos(this.yaw) * Math.cos(this.pitch);
    this.velocity.x = fx * this.speed;
    this.velocity.z = fz * this.speed;

    let vy = this.velocity.y;

    if (onGround) {
      // Takeoff: leave ground when fast enough + nose up / high throttle
      const canLift =
        this.speed > t.stallSpeed * 1.15 &&
        (this.pitch > 0.08 || throttle > 0.7);
      if (canLift) {
        vy = Math.max(vy, 2.5 + (this.speed / this.maxSpeed) * 6);
        this.mesh.position.y = 0.2;
      } else {
        vy = 0;
        this.mesh.position.y = 0;
        // Only scrub speed when throttling down / braking on the runway
        if (throttle < 0.15) {
          this.speed = THREE.MathUtils.damp(this.speed, 0, 4, dt);
        }
      }
    } else {
      // Airborne: pitch + speed create climb; low throttle → gravity
      const lift =
        (this.speed / this.maxSpeed) * t.takeoffLift * (0.45 + throttle * 0.55) +
        this.pitch * 18;
      const grav = t.gravity * (0.4 + (1 - throttle) * 0.75);
      vy += (lift - grav) * dt;
      if (this.speed < t.stallSpeed) {
        vy -= t.gravity * 0.7 * dt;
      }
    }

    this.velocity.y = vy;
    this._bodyLean = THREE.MathUtils.damp(this._bodyLean, -yawIn * 0.22, 6, dt);
  }

  _controlHeli(keys, stick, dt) {
    let fwd = 0;
    let yawIn = 0;
    let strafe = 0;
    let collDelta = 0;

    if (keys['KeyW'] || keys['ArrowUp']) fwd += 1;
    if (keys['KeyS'] || keys['ArrowDown']) fwd -= 1;
    if (keys['KeyA'] || keys['ArrowLeft']) yawIn += 1;
    if (keys['KeyD'] || keys['ArrowRight']) yawIn -= 1;
    if (keys['KeyQ']) strafe -= 1;
    if (keys['KeyE']) strafe += 1;
    if (keys['Space']) collDelta += 1;
    if (keys['ShiftLeft'] || keys['ShiftRight'] || keys['brake']) collDelta -= 1;

    // Stick: y = forward, x = yaw (strafe via Q/E)
    fwd += -stick.y;
    yawIn += -stick.x;

    fwd = THREE.MathUtils.clamp(fwd, -1, 1);
    yawIn = THREE.MathUtils.clamp(yawIn, -1, 1);
    strafe = THREE.MathUtils.clamp(strafe, -1, 1);

    const t = this.tune;
    this.collective = THREE.MathUtils.clamp(
      this.collective + collDelta * 0.7 * dt,
      0,
      1
    );
    // Stick idle slowly returns toward hover when no coll input
    if (Math.abs(collDelta) < 0.05) {
      this.collective = THREE.MathUtils.damp(this.collective, t.hoverCollective, 0.6, dt);
    }

    this.yaw += yawIn * this.turnRate * dt;
    this.throttle = this.collective;
    this.steer = yawIn;

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    const targetVx = fx * fwd * this.maxSpeed + rx * strafe * t.strafe;
    const targetVz = fz * fwd * this.maxSpeed + rz * strafe * t.strafe;
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, targetVx, 3.5, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, targetVz, 3.5, dt);

    // Collective vs gravity
    const lift = this.collective * t.climbRate * 2.2;
    let vy = this.velocity.y;
    vy = THREE.MathUtils.damp(vy, lift - t.gravity * 0.55, 4, dt);

    // Nose tilt visual from forward input
    const pitchTarget = -fwd * 0.28;
    this.pitch = THREE.MathUtils.damp(this.pitch, pitchTarget, 5, dt);
    this._bodyLean = THREE.MathUtils.damp(this._bodyLean, -yawIn * 0.18 - strafe * 0.2, 6, dt);

    const alt = this.mesh.position.y;
    if (alt <= 0.05 && vy < 0) {
      vy = 0;
      this.mesh.position.y = 0;
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, 5, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, 5, dt);
    }

    this.velocity.y = vy;
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
  }

  update(dt) {
    if (this.isAir) this._updateAir(dt);
    else this._updateGround(dt);

    // Spinning bits
    if (this.prop) {
      const spin = 8 + Math.abs(this.throttle) * 40;
      this._propSpin += spin * dt;
      this.prop.rotation.z = this._propSpin;
    }
    if (this.rotor) {
      const spin = 4 + this.collective * 28 + (this.occupied ? 12 : 0);
      this._rotorSpin += spin * dt;
      this.rotor.rotation.y = this._rotorSpin;
      if (this.tailRotor) this.tailRotor.rotation.x = this._rotorSpin * 1.7;
    }
  }

  _updateGround(dt) {
    const prevX = this.mesh.position.x;
    const prevZ = this.mesh.position.z;

    this.mesh.position.x += this.velocity.x * dt;
    this.mesh.position.z += this.velocity.z * dt;

    if (this.world?.resolveCollision) {
      this.world.resolveCollision(this.mesh.position, this.radius);
      const hit =
        Math.abs(this.mesh.position.x - (prevX + this.velocity.x * dt)) > 0.02 ||
        Math.abs(this.mesh.position.z - (prevZ + this.velocity.z * dt)) > 0.02;
      if (hit) {
        // Soften velocity into wall normal (approximate: kill component that was blocked)
        const dx = this.mesh.position.x - prevX;
        const dz = this.mesh.position.z - prevZ;
        this.velocity.x = dx / Math.max(dt, 1e-4) * 0.35;
        this.velocity.z = dz / Math.max(dt, 1e-4) * 0.35;
        this.speed *= 0.5;
      }
    } else {
      this.mesh.position.x = THREE.MathUtils.clamp(this.mesh.position.x, -140, 240);
      this.mesh.position.z = THREE.MathUtils.clamp(this.mesh.position.z, -90, 110);
    }

    this.mesh.position.y = 0;
    this.mesh.rotation.y = this.yaw;
    this.mesh.rotation.x = 0;
    this.mesh.rotation.z = 0;
    // Lean on body subgroup so collision radius stays upright
    this.body.rotation.z = this._bodyLean;
    this.body.rotation.x = 0;
  }

  _updateAir(dt) {
    const prevX = this.mesh.position.x;
    const prevZ = this.mesh.position.z;
    const prevY = this.mesh.position.y;

    this.mesh.position.x += this.velocity.x * dt;
    this.mesh.position.z += this.velocity.z * dt;
    this.mesh.position.y += this.velocity.y * dt;

    const t = this.tune;
    // Altitude clamp
    if (this.mesh.position.y > t.maxAlt) {
      this.mesh.position.y = t.maxAlt;
      this.velocity.y = Math.min(0, this.velocity.y);
    }
    if (this.mesh.position.y < 0) {
      this.mesh.position.y = 0;
      this.velocity.y = 0;
    }

    // XZ collision — preserve Y (world.resolveCollision forces y=0)
    if (this.world?.resolveCollision) {
      const savedY = this.mesh.position.y;
      this.world.resolveCollision(this.mesh.position, this.radius);
      this.mesh.position.y = savedY;
      const hit =
        Math.abs(this.mesh.position.x - (prevX + this.velocity.x * dt)) > 0.02 ||
        Math.abs(this.mesh.position.z - (prevZ + this.velocity.z * dt)) > 0.02;
      if (hit && savedY < 4) {
        // Only soft-hit when low (skimming buildings); high altitude skips building AABBs feel OK for arcade
        this.velocity.x *= 0.4;
        this.velocity.z *= 0.4;
        this.speed *= 0.55;
      }
    } else {
      this.mesh.position.x = THREE.MathUtils.clamp(this.mesh.position.x, -140, 240);
      this.mesh.position.z = THREE.MathUtils.clamp(this.mesh.position.z, -90, 110);
    }

    // Soft landing settle
    if (this.mesh.position.y < 0.4 && this.velocity.y < 0) {
      this.velocity.y *= 0.5;
      if (this.mesh.position.y < 0.08) {
        this.mesh.position.y = 0;
        this.velocity.y = 0;
      }
    }

    this.mesh.rotation.y = this.yaw;
    this.body.rotation.x = this.pitch;
    this.body.rotation.z = this._bodyLean;

    // Keep within map even if resolve skipped
    this.mesh.position.x = THREE.MathUtils.clamp(this.mesh.position.x, -138, 238);
    this.mesh.position.z = THREE.MathUtils.clamp(this.mesh.position.z, -88, 108);

    // unused prevY silence
    void prevY;
  }

  /** Idle parked — kill motion so fleet stays put; air craft settle to pad */
  park() {
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.throttle = 0;
    if (!this.isAir) {
      this.pitch = 0;
      this._bodyLean = THREE.MathUtils.damp(this._bodyLean, 0, 6, 0.05);
      this.body.rotation.z = this._bodyLean;
      this.body.rotation.x = 0;
      this.mesh.position.y = 0;
    } else {
      // Soft settle so abandoned aircraft don't float forever
      if (this.mesh.position.y > 0.05) {
        this.mesh.position.y = Math.max(0, this.mesh.position.y - 0.35);
      } else {
        this.mesh.position.y = 0;
      }
      this.pitch = THREE.MathUtils.damp(this.pitch, 0, 4, 0.05);
      this._bodyLean = THREE.MathUtils.damp(this._bodyLean, 0, 4, 0.05);
      this.body.rotation.x = this.pitch;
      this.body.rotation.z = this._bodyLean;
      this.collective = this.tune.hoverCollective || 0;
    }
  }

  distanceTo(pos) {
    return this.mesh.position.distanceTo(pos);
  }
}

export function vehicleLabel(type) {
  return TYPE_LABEL[type] || 'Vehicle';
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

  // Plane — Belize waterfront open pad (dock approach / water edge)
  add({
    type: 'plane',
    color: 0xf4f1de,
    position: new THREE.Vector3(-112, 0, -52),
    yaw: Math.PI / 2,
  });

  // Heli — POS waterfront warehouse pad
  add({
    type: 'heli',
    color: 0x2a9d8f,
    position: new THREE.Vector3(168, 0, -58),
    yaw: -Math.PI / 2,
  });

  return list;
}

export function nearestVehicle(vehicles, pos, maxDist = 4.5) {
  let best = null;
  let bestD = Infinity;
  for (const v of vehicles) {
    if (v.occupied) continue;
    const lim = v.isAir ? Math.max(maxDist, 7.5) : maxDist;
    const d = v.distanceTo(pos);
    if (d < lim && d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}
