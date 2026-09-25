import * as THREE from 'three';

/**
 * Procedural rigid-part rig for Marco's build_characters iter2 GLBs (no skins, no clips).
 *
 * At load time the flat GLB meshes are regrouped under pivot Object3Ds that match
 * build_characters.py's joint tree (Hips > Spine > Chest > Neck > Head, arms off Chest,
 * legs off Hips). Pivot positions + the mesh->joint map come from char_rig_data.js
 * (generated from Marco's raw sources; the GLBs themselves are unchanged).
 *
 * Every frame update() poses the pivots procedurally:
 *  - idle: breathing, slow weight shift (feet stay planted), relaxed arms, head drift
 *  - walk / run: one shared gait phase blended by ground speed; stride length follows
 *    speed so the stance foot moves backwards at exactly the ground speed (planted).
 *    Legs use 2-bone IK towards foot targets with heel-strike / toe-off roll, hip bob,
 *    pelvis + chest counter-twist, arm counter-swing, lean into speed and turns.
 *  - seated: per-vehicle sitting pose (hips on seat, hands forward), no walk cycle.
 * Model space: +Y up, character faces +Z, left side is +X (MODEL_YAW_OFFSET 0).
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const frac = (x) => x - Math.floor(x);

/** Gait tuning (world metres / seconds). Stride grows with speed; cadence = speed / stride. */
export const GAIT = {
  walkTop: 2.5,          // typical walk speed the walk stride is tuned for
  runBlendStart: 2.7,    // walk -> run style blend window (m/s)
  runBlendEnd: 4.6,
  walkStride: (v) => 0.8 + 0.26 * v,   // full cycle (two steps) length
  runStride: (v) => 0.9 + 0.29 * v,
  walkDuty: 0.58,                       // fraction of the cycle a foot is on the ground
  runDuty: (v) => clamp(0.40 - 0.02 * v, 0.22, 0.34),
};

/** Seated poses (radians; thigh is measured from straight down, negative = forward). */
export const SEAT_POSES = {
  scooter: { lean: 16 * DEG, thigh: -70 * DEG, knee: 72 * DEG, arm: -62 * DEG, elbow: 28 * DEG, armOut: 7 * DEG, head: -10 * DEG },
  car: { lean: -8 * DEG, thigh: -84 * DEG, knee: 80 * DEG, arm: -46 * DEG, elbow: 48 * DEG, armOut: 2 * DEG, head: 6 * DEG },
};

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const _X = new THREE.Vector3(1, 0, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _v1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _q4 = new THREE.Quaternion();

export class ProceduralRig {
  /**
   * Regroup model meshes under joint pivots. Returns null (model untouched) if the
   * mesh names do not match the rig data well enough.
   */
  static create(model, data) {
    if (!model || !data?.joints || !data?.parts) return null;
    const kids = model.children.slice();
    const mapped = kids.filter((c) => data.parts[c.name] && data.joints[data.parts[c.name]]);
    if (!kids.length || mapped.length < kids.length * 0.9) {
      console.warn('[rig] mesh names do not match rig data', mapped.length, '/', kids.length);
      return null;
    }
    return new ProceduralRig(model, data, kids);
  }

  constructor(model, data, kids) {
    this.model = model;
    this.data = data;
    const J = data.joints;
    this.jp = {};
    for (const k of Object.keys(J)) this.jp[k] = V(J[k].p);

    model.updateMatrixWorld(true);
    const byName = {};
    for (const c of kids) byName[c.name] = c;
    this._byName = byName;

    // Joint spheres (computed in the GLB's flat world space before regrouping).
    const extras = [];
    for (const s of ['L', 'R']) {
      extras.push(this._jointFiller(`LowerArm_${s}`, [[`upper_arm_${s}`, `UpperArm_${s}`, `LowerArm_${s}`], [`forearm_${s}`, `LowerArm_${s}`, `Hand_${s}`]], `elbow_${s}`));
      extras.push(this._jointFiller(`Hand_${s}`, [[`forearm_${s}`, `LowerArm_${s}`, `Hand_${s}`], [`palm_${s}`, `LowerArm_${s}`, `Hand_${s}`]], `forearm_${s}`, 0.96));
      extras.push(this._jointFiller(`LowerLeg_${s}`, [[`thigh_${s}`, `UpperLeg_${s}`, `LowerLeg_${s}`], [`shin_${s}`, `LowerLeg_${s}`, `Foot_${s}`]], `knee_${s}`));
    }

    // Pivots, parents first.
    this.pivots = {};
    const make = (name) => {
      if (this.pivots[name]) return this.pivots[name];
      const j = J[name];
      const parent = j.parent ? make(j.parent) : model;
      const o = new THREE.Object3D();
      o.name = `rig_${name}`;
      const pp = j.parent ? this.jp[j.parent] : new THREE.Vector3();
      o.position.copy(this.jp[name]).sub(pp);
      o.userData.rest = o.position.clone();
      parent.add(o);
      this.pivots[name] = o;
      return o;
    };
    for (const k of Object.keys(J)) make(k);

    // Move meshes under their joint (mesh transforms are identity: vertices are model space).
    let moved = 0;
    for (const c of kids) {
      const jn = data.parts[c.name];
      if (!jn || !this.pivots[jn]) continue;
      c.position.sub(this.jp[jn]);
      this.pivots[jn].add(c);
      moved++;
    }
    for (const e of extras) {
      if (!e) continue;
      e.mesh.position.set(0, 0, 0);
      this.pivots[e.joint].add(e.mesh);
    }
    this.fillers = extras.filter(Boolean).map((e) => `${e.joint}:${e.radius.toFixed(3)}`);

    for (const o of Object.values(this.pivots)) o.rotation.order = 'ZYX';

    // Leg + foot geometry (sagittal plane, model units).
    this.legs = {};
    for (const s of ['L', 'R']) {
      const hip = this.jp[`UpperLeg_${s}`];
      const knee = this.jp[`LowerLeg_${s}`];
      const ankle = this.jp[`Foot_${s}`];
      const L1 = hip.distanceTo(knee);
      const L2 = knee.distanceTo(ankle);
      const t0 = -Math.atan2(knee.z - hip.z, -(knee.y - hip.y));
      const s0 = -Math.atan2(ankle.z - knee.z, -(ankle.y - knee.y));
      // Toe / heel contact points relative to the ankle, from the boot sole + heel meshes.
      let toe = { y: -ankle.y, z: 0.17 };
      let heel = { y: -ankle.y, z: -0.08 };
      const sole = byName[`boot_sole_${s}`];
      const bh = byName[`boot_heel_${s}`];
      if (sole?.geometry) {
        sole.geometry.computeBoundingBox();
        const b = sole.geometry.boundingBox; // now joint-local (mesh.position = -ankle)
        const minY = b.min.y + sole.position.y;
        toe = { y: minY, z: b.max.z + sole.position.z - 0.02 };
        heel = { y: minY, z: b.min.z + sole.position.z + 0.015 };
      }
      if (bh?.geometry) {
        bh.geometry.computeBoundingBox();
        heel.z = Math.min(heel.z, bh.geometry.boundingBox.min.z + bh.position.z + 0.015);
      }
      // Lower boot vertices (ankle-local y,z) so ground contact can be solved exactly per pitch.
      const verts = [];
      const v = new THREE.Vector3();
      this.pivots[`Foot_${s}`].traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        const pos = o.geometry.attributes.position;
        o.updateMatrix();
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrix);
          if (v.y < -ankle.y + 0.07) verts.push(v.y, v.z);
        }
      });
      const leg = { hip, knee, ankle, L1, L2, t0, s0, toe, heel, verts: new Float32Array(verts) };
      if (verts.length) {
        leg.toe = this._lowestAt(leg, 36 * DEG);
        leg.heel = this._lowestAt(leg, -12 * DEG);
      }
      this.legs[s] = leg;
    }

    this.phase = 0;
    this.t = Math.random() * 10;
    this.moveW = 0;
    this.runW = 0;
    this.seatW = 0;
    this.seatPose = null;
    this.stats = { meshes: kids.length, moved };
  }

  /** Hips joint height above the feet in model units (for seating the rider). */
  hipsHeight() {
    return this.jp.Hips.y;
  }

  /** Jump straight into (or out of) the seated pose without a visible blend. */
  snapSeated(pose) {
    this.seatPose = pose || null;
    this.seatW = pose ? 1 : 0;
    this.moveW = 0;
    this.runW = 0;
  }

  /**
   * Skin-coloured sphere at a joint pivot, sized to the thicker adjacent tube end, so a
   * bent rigid joint never opens a hole. Skipped if the authored joint mesh already covers it.
   */
  _jointFiller(joint, tubes, matFrom, shrink = 1.0) {
    const P = this.jp[joint];
    if (!P) return null;
    let r = 0;
    for (const [mn, a, b] of tubes) {
      const m = this._byName[mn];
      if (!m?.geometry || !this.jp[a] || !this.jp[b]) continue;
      const dir = this.jp[b].clone().sub(this.jp[a]).normalize();
      const pos = m.geometry.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).add(m.position).sub(P);
        const ax = v.dot(dir);
        if (Math.abs(ax) > 0.012) continue;
        const rad = Math.sqrt(Math.max(0, v.lengthSq() - ax * ax));
        if (rad > r) r = rad;
      }
    }
    if (r <= 0) return null;
    r *= shrink;
    const own = this._byName[matFrom];
    if (own?.geometry && matFrom.startsWith('knee')) {
      own.geometry.computeBoundingBox();
      const s = new THREE.Vector3();
      own.geometry.boundingBox.getSize(s);
      if (Math.min(s.x, s.y, s.z) / 2 >= r * 0.98) return null; // knee ball already covers it
    }
    const mat = own?.material || new THREE.MeshStandardMaterial({ color: 0x5a3421 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat);
    mesh.name = `joint_fill_${joint}`;
    return { joint, mesh, radius: r };
  }

  /** Lowest boot point (ankle-local) when the foot is pitched by a (toe down > 0). */
  _lowestAt(leg, a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const vs = leg.verts;
    let best = Infinity;
    let by = 0;
    let bz = 0;
    for (let i = 0; i < vs.length; i += 2) {
      const y = vs[i] * c - vs[i + 1] * s;
      if (y < best) { best = y; by = vs[i]; bz = vs[i + 1]; }
    }
    return { y: by, z: bz };
  }

  /** Ankle height offset (from rest) that puts the lowest boot point exactly on the ground. */
  _groundY(leg, a) {
    if (!leg.verts.length) return 0;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const vs = leg.verts;
    let m = Infinity;
    for (let i = 0; i < vs.length; i += 2) {
      const y = vs[i] * c - vs[i + 1] * s;
      if (y < m) m = y;
    }
    return -leg.ankle.y - m;
  }

  /** Foot forwardness in [-1, 1] for phase p (1 = fully forward at heel strike). */
  _fwd(p, beta) {
    return p < beta ? Math.cos(Math.PI * (p / beta)) : -Math.cos(Math.PI * ((p - beta) / (1 - beta)));
  }

  /** Ankle offset (from rest) and world foot pitch for one leg. */
  _footTarget(leg, p, beta, half, center, rw, lift) {
    const hs = lerp(-12, -3, rw) * DEG;     // heel strike: toe up
    const to = lerp(28, 36, rw) * DEG;      // toe off: toe down
    const hp = lerp(0.15, 0.08, rw);
    const rs = lerp(0.62, 0.48, rw);
    const stance = (u) => {
      const z = center + half * (1 - 2 * u);
      let r = { y: 0, z, pitch: 0 };
      if (u < hp) r = this._pivot(leg.heel, z, 0, hs * (1 - u / hp) ** 2);
      else if (u > rs) r = this._pivot(leg.toe, z, 0, to * ((u - rs) / (1 - rs)) ** 1.5);
      if (r.pitch !== 0) r.y = this._groundY(leg, r.pitch);
      return r;
    };
    if (p < beta) return stance(p / beta);
    const u = (p - beta) / (1 - beta);
    const a = stance(1);
    const b = stance(0);
    const ew = 0.5 - 0.5 * Math.cos(Math.PI * u);
    const er = 0.5 - 0.5 * Math.cos(Math.PI * u ** 1.45);
    const e = lerp(ew, er, rw);
    return {
      z: lerp(a.z, b.z, e),
      y: lerp(a.y, b.y, e) + lift * Math.sin(Math.PI * u ** lerp(1, 0.72, rw)),
      pitch: lerp(a.pitch, b.pitch, smooth(0, 1, u)),
    };
  }

  /** Rotate the foot by pitch about a contact point (heel or toe) that stays on the ground. */
  _pivot(pt, z, y, pitch) {
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    const ry = pt.y * c - pt.z * s;
    const rz = pt.y * s + pt.z * c;
    return { y: y + pt.y - ry, z: z + pt.z - rz, pitch };
  }

  /** 2-bone sagittal IK: returns world thigh angle + relative knee angle. */
  _ik(leg, hipY, hipZ, ay, az) {
    const dy = ay - hipY;
    const dz = az - hipZ;
    const max = (leg.L1 + leg.L2) * 0.9995;
    const dist = clamp(Math.hypot(dy, dz), Math.abs(leg.L1 - leg.L2) + 1e-3, max);
    const thD = -Math.atan2(dz, -dy);
    const a = Math.acos(clamp((leg.L1 * leg.L1 + dist * dist - leg.L2 * leg.L2) / (2 * leg.L1 * dist), -1, 1));
    const g = Math.acos(clamp((leg.L1 * leg.L1 + leg.L2 * leg.L2 - dist * dist) / (2 * leg.L1 * leg.L2), -1, 1));
    return { thigh: thD - a, knee: Math.PI - g, dist };
  }

  /**
   * @param {number} dt
   * @param {object} st  speed (world m/s along facing), scale (world units per model unit),
   *                     turnRate (rad/s, + = turning left), accel (m/s^2), seated (pose|null)
   */
  update(dt, st) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const P = this.pivots;
    const scale = st.scale > 1e-4 ? st.scale : 1;
    const seated = st.seated || null;
    if (seated) this.seatPose = seated;
    const vW = seated ? 0 : Math.max(0, st.speed || 0);

    this.moveW = damp(this.moveW, smooth(0.05, 0.6, vW), 9, dt);
    this.runW = damp(this.runW, smooth(GAIT.runBlendStart, GAIT.runBlendEnd, vW), 5, dt);
    this.seatW = damp(this.seatW, seated ? 1 : 0, 12, dt);
    const mw = this.moveW;
    const rw = this.runW;
    const iw = 1 - mw;

    // Gait phase: stride follows speed so stance feet stay planted.
    const Dw = GAIT.walkStride(vW);
    const Dr = GAIT.runStride(vW);
    const Dworld = lerp(Dw, Dr, rw);
    const beta = lerp(GAIT.walkDuty, GAIT.runDuty(vW), rw);
    if (vW > 1e-3) this.phase = frac(this.phase + (vW / Dworld) * dt);
    const ph = this.phase;
    const D = Dworld / scale;
    const half = (D * beta) / 2;
    const center = -lerp(0.05, 0.075, rw) * Math.min(1, half / 0.3);
    const lift = lerp(0.075, 0.30, rw) * clamp(D / 1.1, 0.35, 1);

    // Idle signals.
    const breathe = Math.sin(TAU * 0.23 * this.t);
    const shift = Math.sin(TAU * this.t / 5.7) * 0.8 + Math.sin(TAU * this.t / 2.3) * 0.2;

    // Hips.
    const c2 = Math.cos(TAU * 2 * (ph - beta / 2));
    const c1 = Math.cos(TAU * (ph - beta / 2));
    const bob = lerp(0.024 * c2, -0.03 * c2, rw) * mw;
    const drop = lerp(0.03, 0.042, rw) * mw + iw * 0.006;
    const sway = mw * lerp(0.014, 0.006, rw) * c1 + iw * 0.012 * shift;
    let roll = mw * lerp(3.2, 2, rw) * DEG * c1 + iw * 1.6 * DEG * shift;
    roll += clamp(-(st.turnRate || 0) * vW * 0.011, -0.14, 0.14) * mw;
    const accelLean = clamp((st.accel || 0) * 0.012, -0.06, 0.1) * mw;
    const lean = mw * lerp(3, 11, rw) * DEG + accelLean;
    const fL = this._fwd(ph, beta);
    const fR = this._fwd(frac(ph + 0.5), beta);
    const pelvisYaw = -lerp(4, 7, rw) * DEG * fL * mw;
    const chestTwist = lerp(5, 9, rw) * DEG * fL * mw;

    // Seated blend of the hips first (legs are solved against the final hips transform).
    const sw = this.seatW;
    const sp = this.seatPose || SEAT_POSES.car;
    const hipsRest = P.Hips.userData.rest;
    const dyH = (bob - drop) * (1 - sw);
    P.Hips.position.set(hipsRest.x + sway * (1 - sw), hipsRest.y + dyH, hipsRest.z);
    P.Hips.rotation.set(lerp(lean, sp.lean, sw), pelvisYaw * (1 - sw), roll * (1 - sw));
    P.Hips.updateMatrix();
    const qH = P.Hips.quaternion;
    const qHi = _q1.copy(qH).invert();

    // Legs: exact 2-bone IK against the real hip joint position, then orientations as
    // quaternions relative to the hips (so pelvis twist/roll/lean never lift or sink the feet).
    for (const s of ['L', 'R']) {
      const leg = this.legs[s];
      const p = s === 'L' ? ph : frac(ph + 0.5);
      const ft = this._footTarget(leg, p, beta, half, center, rw, lift);
      const hipW = _v1.copy(leg.hip).sub(this.jp.Hips).applyQuaternion(qH).add(P.Hips.position);
      let ay = leg.ankle.y + ft.y * mw;
      const az = leg.ankle.z + ft.z * mw;
      // Lateral hip offset -> tilt the leg plane by phi and solve in that plane.
      const dxL = leg.hip.x - hipW.x;
      const solve = (y) => this._ik(leg, y + Math.hypot(dxL, y - hipW.y), hipW.z, y, az);
      const phiOf = (y) => Math.atan2(dxL, hipW.y - y);
      let ik = solve(ay);
      const pitch = ft.pitch * mw;
      // Foot pitch relative to the shin is limited so the rigid boot shaft keeps the shin inside.
      // If the limit tilts the foot, lift the ankle until the lowest boot point is on the ground
      // (never through it) and re-solve the leg.
      let footRel = pitch - ik.thigh - ik.knee + leg.s0;
      for (let it = 0; it < 6; it++) {
        const lim = clamp(footRel, -30 * DEG, 38 * DEG);
        if (lim === footRel) break;
        const actual = lim + ik.thigh + ik.knee - leg.s0;
        const need = leg.ankle.y + this._groundY(leg, actual) * mw;
        if (need <= ay + 1e-4) { footRel = lim; break; }
        ay = need;
        ik = solve(ay);
        footRel = pitch - ik.thigh - ik.knee + leg.s0;
      }
      footRel = clamp(footRel, -30 * DEG, 38 * DEG);
      // Final floor: whatever pitch the boot ends up with, its lowest point may not go below ground.
      for (let it = 0; it < 3; it++) {
        const actual = footRel + ik.thigh + ik.knee - leg.s0;
        const need = leg.ankle.y + this._groundY(leg, actual) * mw;
        if (need <= ay + 1e-4 || mw < 1e-3) break;
        ay = need;
        ik = solve(ay);
        footRel = clamp(pitch - ik.thigh - ik.knee + leg.s0, -30 * DEG, 38 * DEG);
      }
      const phiW = clamp(phiOf(ay), -0.3, 0.3);

      // Blend towards the seated pose (world-space angles).
      const thighW = lerp(ik.thigh - leg.t0, sp.thigh - leg.t0, sw);
      const kneeX = lerp(ik.knee - (leg.s0 - leg.t0), sp.knee - (leg.s0 - leg.t0), sw);
      const phi = phiW * (1 - sw);
      const pitchW = lerp(footRel + ik.thigh + ik.knee - leg.s0, 0, sw);

      const qTW = _q2.setFromAxisAngle(_Z, phi).multiply(_q3.setFromAxisAngle(_X, thighW));
      P[`UpperLeg_${s}`].quaternion.copy(qHi).multiply(qTW);
      P[`LowerLeg_${s}`].rotation.set(kneeX, 0, 0);
      const qShinW = _q3.copy(qTW).multiply(_q4.setFromAxisAngle(_X, kneeX));
      P[`Foot_${s}`].quaternion.copy(qShinW.invert()).multiply(_q2.setFromAxisAngle(_X, pitchW));
    }

    // Arms (counter-swing: left arm goes back while the left foot is forward).
    for (const [s, sg, fwd] of [['L', 1, fL], ['R', -1, fR]]) {
      const amp = lerp(18, 45, rw) * DEG * mw;
      const bias = lerp(0, 10, rw) * DEG * mw;
      let x = amp * fwd - bias + iw * 1.5 * DEG * breathe;
      let elbow = lerp(10, 85, rw) * DEG * mw + iw * 7 * DEG
        + lerp(14, 18, rw) * DEG * Math.max(0, -fwd) * mw;
      let z = sg * (-4 * DEG * (1 - rw * mw) + lerp(0, 7, rw) * DEG * mw);
      let hand = -lerp(4, 14, rw) * DEG * mw;
      if (sw > 1e-3) {
        x = lerp(x, sp.arm - sp.lean, sw);
        z = lerp(z, sg * sp.armOut, sw);
        elbow = lerp(elbow, sp.elbow, sw);
        hand = lerp(hand, -8 * DEG, sw);
      }
      P[`UpperArm_${s}`].rotation.set(x, 0, z);
      P[`LowerArm_${s}`].rotation.set(-elbow, 0, 0);
      P[`Hand_${s}`].rotation.set(hand, 0, 0);
    }

    // Torso + head (head keeps looking ahead).
    const twist = chestTwist * (1 - sw);
    const pyaw = pelvisYaw * (1 - sw);
    P.Spine.rotation.set(
      (lerp(1, 4, rw) * mw * DEG + iw * 0.8 * DEG * breathe) * (1 - sw),
      twist - pyaw,
      -roll * 0.85 * (1 - sw)
    );
    P.Chest.rotation.set(iw * 0.6 * DEG * breathe * (1 - sw), 0, 0);
    const look = iw * 5 * DEG * Math.sin(TAU * this.t / 9.5) * (1 - sw);
    const headPitch = lerp(-lean * 0.75 - 0.3 * DEG * breathe * iw, sp.head - sp.lean * 0.5, sw);
    P.Neck.rotation.set(headPitch * 0.5, -twist * 0.45 + look * 0.4, 0);
    P.Head.rotation.set(headPitch * 0.5, -twist * 0.45 + look * 0.6, 0);
  }
}
