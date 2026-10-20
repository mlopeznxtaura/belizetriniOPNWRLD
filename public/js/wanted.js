import * as THREE from 'three';
import { Cop } from './ai.js';
import { Vehicle } from './vehicle.js';
import { TOON_ON, toonify } from './toon.js';

/**
 * belizetriniOPNWRLD — wanted levels 1–5 (good-1+7). Stylised, non-graphic arcade fiction.
 *
 * HEAT: a float 0–5.99; stars = floor(heat). Crimes add heat (CRIME_HEAT), witnessed crimes more.
 * SIGHT: the player is "seen" while any pursuit unit (or ambient patrol) is within its sight radius
 *   with a clear line of sight (2-D segment test against the building colliders), or under the heli
 *   spotlight. Seen → the last-known position (LKP) is refreshed and the escape timer resets.
 * ESCAPE: unseen, a search timer runs (ESCAPE_SEC per star, ×2 speed once the player is outside the
 *   search radius around the LKP). When it fills, one star drops and the timer restarts. The HUD stars
 *   flash while the cops are searching.
 * ESCALATION (target unit counts per star, UNITS):
 *   1★ one cop on foot · 2★ patrol cars · 3★ more cars + a roadblock ahead
 *   4★ ramming + AI heli with a (fake, no-light) spotlight · 5★ max units + spike strips + roadblocks
 * Pursuit cars path along the road graph (A* over road intersections) until close, then steer direct.
 */
export const CRIME_HEAT = { carTheft: 1.0, hitPed: 0.7, ramCop: 1.2, softHit: 2.0, mission: 1.0 };
export const UNITS = {
  //      foot cars  roadblocks heli spikes
  0: { foot: 0, cars: 0, roadblocks: 0, heli: 0, spikes: 0 },
  1: { foot: 1, cars: 0, roadblocks: 0, heli: 0, spikes: 0 },
  2: { foot: 1, cars: 2, roadblocks: 0, heli: 0, spikes: 0 },
  3: { foot: 2, cars: 3, roadblocks: 1, heli: 0, spikes: 0 },
  4: { foot: 2, cars: 4, roadblocks: 1, heli: 1, spikes: 0 },
  5: { foot: 2, cars: 6, roadblocks: 2, heli: 1, spikes: 2 },
};
export const ESCAPE_SEC = [0, 8, 11, 14, 17, 20]; // unseen seconds to drop one star, per current star
const SIGHT = [0, 32, 40, 48, 56, 64];
const SEARCH_R = [0, 45, 60, 75, 90, 110];

// ─── Road graph ────────────────────────────────────────────────────────────────
export function buildRoadGraph(roads) {
  const nodes = []; const key = new Map();
  const nodeAt = (x, z) => {
    const k = Math.round(x) + ',' + Math.round(z);
    if (key.has(k)) return key.get(k);
    const id = nodes.length; nodes.push({ id, x, z, adj: [] }); key.set(k, id); return id;
  };
  const segs = roads.map((r) => ({ ...r, pts: [] }));
  for (const s of segs) { s.pts.push([0, s.x1, s.z1], [1, s.x2, s.z2]); }
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    const d = (a.x2 - a.x1) * (b.z2 - b.z1) - (a.z2 - a.z1) * (b.x2 - b.x1);
    if (Math.abs(d) < 1e-9) continue;
    const t = ((b.x1 - a.x1) * (b.z2 - b.z1) - (b.z1 - a.z1) * (b.x2 - b.x1)) / d;
    const u = ((b.x1 - a.x1) * (a.z2 - a.z1) - (b.z1 - a.z1) * (a.x2 - a.x1)) / d;
    if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) continue;
    const x = a.x1 + t * (a.x2 - a.x1), z = a.z1 + t * (a.z2 - a.z1);
    a.pts.push([t, x, z]); b.pts.push([u, x, z]);
  }
  for (const s of segs) {
    s.pts.sort((p, q) => p[0] - q[0]);
    let prev = null;
    for (const [, x, z] of s.pts) {
      const id = nodeAt(x, z);
      if (prev != null && prev !== id) {
        const w = Math.hypot(nodes[prev].x - x, nodes[prev].z - z);
        nodes[prev].adj.push([id, w]); nodes[id].adj.push([prev, w]);
      }
      prev = id;
    }
  }
  return {
    nodes,
    nearest(x, z) {
      let best = 0, bd = Infinity;
      for (const n of nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n.id; } }
      return best;
    },
    /** A* node path (ids) from a to b. */
    path(a, b) {
      if (a === b) return [a];
      const g = new Map([[a, 0]]), from = new Map(), open = new Set([a]);
      const h = (i) => Math.hypot(nodes[i].x - nodes[b].x, nodes[i].z - nodes[b].z);
      const f = new Map([[a, h(a)]]);
      let guard = 0;
      while (open.size && guard++ < 2000) {
        let cur = null, cf = Infinity;
        for (const i of open) { const v = f.get(i); if (v < cf) { cf = v; cur = i; } }
        if (cur === b) { const out = [b]; while (from.has(out[0])) out.unshift(from.get(out[0])); return out; }
        open.delete(cur);
        for (const [nb, w] of nodes[cur].adj) {
          const ng = g.get(cur) + w;
          if (ng < (g.get(nb) ?? Infinity)) { from.set(nb, cur); g.set(nb, ng); f.set(nb, ng + h(nb)); open.add(nb); }
        }
      }
      return [a];
    },
  };
}

/** 2-D line of sight: does segment p→q cross any collider AABB? (slab test) */
export function hasLOS(colliders, px, pz, qx, qz) {
  const dx = qx - px, dz = qz - pz;
  for (const c of colliders) {
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) { if (px < c.minX || px > c.maxX) continue; }
    else { let a = (c.minX - px) / dx, b = (c.maxX - px) / dx; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) continue; }
    if (Math.abs(dz) < 1e-9) { if (pz < c.minZ || pz > c.maxZ) continue; }
    else { let a = (c.minZ - pz) / dz, b = (c.maxZ - pz) / dz; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) continue; }
    if (t1 > 0.02 && t0 < 0.98) return false;
  }
  return true;
}

// ─── Units ────────────────────────────────────────────────────────────────────
const _mats = {};
function mat(c) { return (_mats[c] = _mats[c] || new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })); }

/** A cop on foot: blocky, dark-blue uniform, cap. Runs at the player; a "tackle" is arcade damage. */
class FootCop {
  constructor(scene, pos) {
    this.kind = 'foot'; this.onFoot = true; this.alive = true; this.yaw = 0; this.radius = 0.4;
    const g = new THREE.Group();
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
    const uni = mat(0x1d3a8a), skin = mat(0x9a6b45), dark = mat(0x111522);
    add(new THREE.BoxGeometry(0.46, 0.55, 0.28), uni, 0, 1.12, 0);
    const legGeo = new THREE.BoxGeometry(0.17, 0.74, 0.2).translate(0, -0.37, 0); // pivot at the hip
    this.legL = add(legGeo, dark, -0.12, 0.76, 0);
    this.legR = add(legGeo, dark, 0.12, 0.76, 0);
    add(new THREE.BoxGeometry(0.27, 0.29, 0.26), skin, 0, 1.56, 0);
    add(new THREE.BoxGeometry(0.33, 0.1, 0.36), dark, 0, 1.74, -0.03);
    add(new THREE.BoxGeometry(0.12, 0.08, 0.02), mat(0xf2c94c), 0.1, 1.24, -0.15); // badge
    g.position.copy(pos); g.position.y = 0;
    if (TOON_ON) toonify(g, { klass: 'char', maxPer: 3 });
    scene.add(g); this.mesh = g; this._t = 0;
  }
  update(dt, ctx) {
    const p = this.mesh.position, tgt = ctx.seen ? ctx.playerPos : ctx.lkp;
    const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.hypot(dx, dz) || 1;
    const spd = d > 1.2 ? 6.2 : 0;
    p.x += (dx / d) * spd * dt; p.z += (dz / d) * spd * dt;
    ctx.world.resolveCollision?.(p, this.radius);
    this.yaw = Math.atan2(-dx, -dz); this.mesh.rotation.y = this.yaw;
    this._t += dt * (spd ? 11 : 0);
    const sw = spd ? Math.sin(this._t) * 0.55 : 0;
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    if (!ctx.inVehicle && ctx.seen && Math.hypot(ctx.playerPos.x - p.x, ctx.playerPos.z - p.z) < 1.4) return { hit: true, damage: 6 * dt };
    return null;
  }
}

/** Pursuit cruiser (the patrol Cop mesh) following the road graph, ramming from 4★. */
class CarUnit extends Cop {
  constructor(scene, pos, world, graph) {
    super(scene, pos, world);
    this.kind = 'car'; this.graph = graph; this.path = []; this._repath = 0; this.vel = 0; this.ramCool = 0;
    if (TOON_ON) toonify(this.mesh, { klass: 'vehicle' });
  }
  update(dt, ctx) {
    this._t += dt;
    this.bar.material.color.setHex(Math.sin(this._t * 12) > 0 ? 0x2244ff : 0xff2222);
    const p = this.mesh.position, tgt = ctx.seen ? ctx.playerPos : ctx.lkp;
    const direct = Math.hypot(tgt.x - p.x, tgt.z - p.z);
    let aimX = tgt.x, aimZ = tgt.z;
    // Ram (4★+): lead the target by its velocity.
    const ram = ctx.stars >= 4 && direct < 22 && ctx.seen;
    if (ram && ctx.playerVel) { aimX += ctx.playerVel.x * 0.5; aimZ += ctx.playerVel.z * 0.5; }
    if (direct > 26 && this.graph) {
      this._repath -= dt;
      if (this._repath <= 0 || !this.path.length) {
        this._repath = 1.5;
        this.path = this.graph.path(this.graph.nearest(p.x, p.z), this.graph.nearest(tgt.x, tgt.z));
      }
      while (this.path.length) {
        const n = this.graph.nodes[this.path[0]];
        if (Math.hypot(n.x - p.x, n.z - p.z) < 4) this.path.shift(); else { aimX = n.x; aimZ = n.z; break; }
      }
    } else this.path.length = 0;
    const dx = aimX - p.x, dz = aimZ - p.z, d = Math.hypot(dx, dz) || 1;
    const want = Math.atan2(-dx, -dz);
    let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += THREE.MathUtils.clamp(dy, -2.6 * dt, 2.6 * dt);
    const top = (11 + ctx.stars * 1.6) * (ram ? 1.35 : 1) * (direct < 6 && !ram ? 0.4 : 1);
    this.vel = THREE.MathUtils.damp(this.vel, top * (Math.abs(dy) > 1.2 ? 0.45 : 1), 1.8, dt);
    p.x += -Math.sin(this.yaw) * this.vel * dt; p.z += -Math.cos(this.yaw) * this.vel * dt;
    this.world?.resolveCollision?.(p, this.radius);
    p.y = 0; this.mesh.rotation.y = this.yaw;
    this.ramCool = Math.max(0, this.ramCool - dt);
    const pd = Math.hypot(ctx.playerPos.x - p.x, ctx.playerPos.z - p.z);
    if (pd < 3.4 && ctx.seen) {
      if (ram && this.ramCool <= 0) { this.ramCool = 1.2; return { hit: true, damage: 9, ram: true, dir: [-Math.sin(this.yaw), -Math.cos(this.yaw)] }; }
      return { hit: true, damage: (ctx.inVehicle ? 2.5 : 5) * dt * ctx.stars };
    }
    return null;
  }
}

/** Roadblock: two cruisers nose-to-nose across the road + a striped barrier; blocks like a wall. */
class Roadblock {
  constructor(scene, x, z, alongYaw, world) {
    this.kind = 'roadblock'; this.alive = true; this.world = world;
    const g = new THREE.Group();
    g.position.set(x, 0, z); g.rotation.y = alongYaw;
    this.cars = [];
    for (const s of [-1, 1]) {
      const c = new Cop(scene, new THREE.Vector3(), null);
      scene.remove(c.mesh); c.mesh.position.set(s * 2.4, 0, 0); c.mesh.rotation.y = s * Math.PI / 2 + 0.35 * s;
      g.add(c.mesh); this.cars.push(c);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(9, 0.35, 0.25), mat(0xf4f1e8));
    bar.position.set(0, 0.9, 2.6); g.add(bar);
    for (const sx of [-4, 4]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.2), mat(0xd62828)); leg.position.set(sx, 0.45, 2.6); g.add(leg); }
    if (TOON_ON) toonify(g, { klass: 'vehicle', maxPer: 4 });
    scene.add(g); this.mesh = g; this._t = 0;
    // A wall collider across the road (axis-aligned bounds of the block).
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    this.collider = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, roadblock: true };
    world?.colliders?.push(this.collider);
  }
  update(dt) {
    this._t += dt;
    for (const c of this.cars) c.bar.material.color.setHex(Math.sin(this._t * 12) > 0 ? 0x2244ff : 0xff2222);
    return null;
  }
  dispose(scene) {
    const cs = this.world?.colliders; if (cs) { const i = cs.indexOf(this.collider); if (i >= 0) cs.splice(i, 1); }
    scene.remove(this.mesh);
  }
}

/** Spike strip across the road: a vehicle that drives over it loses most of its speed for 4 s. */
class SpikeStrip {
  constructor(scene, x, z, acrossYaw) {
    this.kind = 'spikes'; this.alive = true;
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(8, 0.06, 0.5), mat(0x2b2d42));
    base.position.y = 0.06; g.add(base);
    for (let i = -7; i <= 7; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), mat(0xd9d9d9)); s.position.set(i * 0.5, 0.17, 0); g.add(s); }
    g.position.set(x, 0, z); g.rotation.y = acrossYaw;
    scene.add(g); this.mesh = g; this.tripped = 0;
  }
  update(dt, ctx) {
    this.tripped = Math.max(0, this.tripped - dt);
    if (!ctx.vehicle || this.tripped > 0) return null;
    const lp = this.mesh.worldToLocal(new THREE.Vector3(ctx.playerPos.x, 0, ctx.playerPos.z));
    if (Math.abs(lp.x) < 4.2 && Math.abs(lp.z) < 1.4) { this.tripped = 3; return { spikes: true }; }
    return null;
  }
}

/** AI-flown police heli (the player's heli kit) circling the player with a fake spotlight cone. */
class HeliUnit {
  constructor(scene, pos, world) {
    this.kind = 'heli'; this.isHeli = true; this.alive = true;
    this.v = new Vehicle(scene, { type: 'heli', position: new THREE.Vector3(pos.x, 30, pos.z), color: 0x1d3a8a, world: null });
    if (TOON_ON) toonify(this.v.mesh, { klass: 'vehicle' });
    this.mesh = this.v.mesh; this.yaw = 0; this._a = Math.random() * 6.28;
    // Spotlight without a real light (no shader-variant change for every material): additive cone + ground pool.
    const coneM = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(4.5, 1, 18, 1, true), coneM);
    this.cone.geometry.translate(0, -0.5, 0);
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(4.5, 24), new THREE.MeshBasicMaterial({ color: 0xfff6d5, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.pool.rotation.x = -Math.PI / 2;
    for (const o of [this.cone, this.pool]) { o.userData.noOutline = true; o.renderOrder = 5; o.raycast = () => {}; scene.add(o); }
    this.spot = new THREE.Vector3(pos.x, 0, pos.z);
  }
  update(dt, ctx) {
    const p = this.mesh.position, tgt = ctx.seen ? ctx.playerPos : ctx.lkp;
    this._a += dt * 0.35;
    const ox = tgt.x + Math.cos(this._a) * 18, oz = tgt.z + Math.sin(this._a) * 18;
    p.x = THREE.MathUtils.damp(p.x, ox, 0.9, dt); p.z = THREE.MathUtils.damp(p.z, oz, 0.9, dt);
    p.y = THREE.MathUtils.damp(p.y, 26, 1, dt);
    this.yaw = Math.atan2(-(tgt.x - p.x), -(tgt.z - p.z)); this.mesh.rotation.y = this.yaw; this.mesh.rotation.x = -0.12;
    if (this.v.rotor) this.v.rotor.rotation.y += dt * 28;
    if (this.v.tailRotor) this.v.tailRotor.rotation.x += dt * 40;
    // The pool sweeps toward the player (lags a little, so you can slip out of it).
    this.spot.x = THREE.MathUtils.damp(this.spot.x, tgt.x, 1.6, dt); this.spot.z = THREE.MathUtils.damp(this.spot.z, tgt.z, 1.6, dt);
    this.pool.position.set(this.spot.x, 0.09, this.spot.z);
    const h = p.y; this.cone.position.copy(p); this.cone.position.y -= 1.2;
    this.cone.lookAt(this.spot.x, 0, this.spot.z); this.cone.rotateX(Math.PI / 2);
    this.cone.scale.set(1, h, 1);
    this.lit = Math.hypot(ctx.playerPos.x - this.spot.x, ctx.playerPos.z - this.spot.z) < 4.8;
    return null;
  }
  dispose(scene) { scene.remove(this.mesh, this.cone, this.pool); }
}

// ─── System ───────────────────────────────────────────────────────────────────
export class WantedSystem {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.units = [];
    this.graph = buildRoadGraph(game.world.roads || []);
    this.lkp = new THREE.Vector3();
    this.seen = false;
    this.searchT = 0;
    this._spawnT = 0;
    this.log = [];
    this.stats = { spawned: { foot: 0, car: 0, roadblock: 0, heli: 0, spikes: 0 }, crimes: 0, escapes: 0 };
    this._crimeCool = {};
    this.spikedT = 0;
    this.t = 0;
    this._retry = {};
  }

  get stars() { return Math.min(5, Math.floor(this.heat + 1e-6)); }

  /** Agent / mission: set an exact level (0–5). */
  setStars(n) {
    n = THREE.MathUtils.clamp(Math.round(Number(n) || 0), 0, 5);
    const before = this.stars;
    this.heat = n ? n + 0.25 : 0;
    this.searchT = 0;
    if (n > 0 && before === 0) { this.lkp.copy(this.game.player.position); this.seen = true; }
    if (n === 0) this.clearUnits();
    this._event('set', n);
    this._hud(true);
  }

  addHeat(amount, why = 'crime') {
    const before = this.stars;
    this.heat = Math.min(5.99, this.heat + amount);
    this.searchT = 0;
    this.lkp.copy(this.game.player.position);
    this.seen = true;
    this.stats.crimes++;
    this._event('crime:' + why, this.stars);
    if (this.stars !== before) this._hud(true);
  }

  /** A crime; `witnessed` multiplies the heat (a cop saw it). Per-type cooldown so one act counts once. */
  crime(type, opts = {}) {
    if ((this._crimeCool[type] || 0) > this.t) return false;
    this._crimeCool[type] = this.t + (opts.cool ?? 2);
    const witnessed = opts.witnessed ?? this._copsNear(35);
    const base = CRIME_HEAT[type] ?? 1;
    this.addHeat(witnessed ? base : base * 0.5, type);
    return true;
  }

  _copsNear(r) {
    const p = this.game.player.position;
    const all = [...this.game.cops, ...this.units];
    return all.some((c) => c.alive && c.mesh && Math.hypot(c.mesh.position.x - p.x, c.mesh.position.z - p.z) < r);
  }

  clearUnits() {
    for (const u of this.units) this._remove(u);
    this.units.length = 0;
  }

  _remove(u) {
    if (u.dispose) u.dispose(this.game.scene); else this.game.scene.remove(u.mesh);
  }

  _event(kind, v) {
    this.log.push({ t: +this.t.toFixed(2), kind, stars: v });
    if (this.log.length > 300) this.log.shift();
  }

  _hud(force = false) {
    const flashing = this.stars > 0 && !this.seen;
    if (force || flashing !== this._lastFlash || this.stars !== this._lastStars) {
      this._lastFlash = flashing; this._lastStars = this.stars;
      this.game.hud?.setWanted(this.stars, flashing);
    }
  }

  count(kind) { return this.units.filter((u) => u.kind === kind).length; }

  /** Pick a road node at a distance band from the player; `ahead` prefers the player's heading. */
  _nodeAround(minD, maxD, ahead = null) {
    const p = this.game.player.position, cam = this.game.player.camera;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    let best = null, bs = -Infinity;
    for (const n of this.graph.nodes) {
      const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
      if (d < minD || d > maxD) continue;
      let s;
      if (ahead) s = (dx * ahead.x + dz * ahead.y) / d + Math.random() * 0.2;
      else s = -(dx * fwd.x + dz * fwd.z) / d + Math.random() * 0.6; // spawn out of view (behind the camera)
      if (this.units.some((u) => u.mesh && Math.hypot(u.mesh.position.x - n.x, u.mesh.position.z - n.z) < 6)) s -= 2;
      if (s > bs) { bs = s; best = n; }
    }
    return best;
  }

  _spawn(kind) {
    const g = this.game, sc = g.scene, p = g.player.position;
    let u = null;
    if (kind === 'foot') {
      const a = Math.random() * Math.PI * 2;
      const pos = new THREE.Vector3(p.x + Math.cos(a) * 22, 0, p.z + Math.sin(a) * 22);
      g.world.resolveCollision?.(pos, 0.5);
      u = new FootCop(sc, pos);
    } else if (kind === 'car') {
      const n = this._nodeAround(45, 95) || this._nodeAround(20, 140);
      if (!n) return null;
      u = new CarUnit(sc, new THREE.Vector3(n.x, 0, n.z), g.world, this.graph);
    } else if (kind === 'heli') {
      u = new HeliUnit(sc, new THREE.Vector3(p.x + 40, 0, p.z + 40), g.world);
    } else if (kind === 'roadblock' || kind === 'spikes') {
      const v = g.player.inVehicle ? g.player.vehicle.velocity : null;
      let dir = v && Math.hypot(v.x, v.z) > 2 ? new THREE.Vector2(v.x, v.z).normalize() : null;
      if (!dir) { const f = new THREE.Vector3(); g.player.camera.getWorldDirection(f); dir = new THREE.Vector2(f.x, f.z).normalize(); }
      const n = this._nodeAround(kind === 'spikes' ? 30 : 45, kind === 'spikes' ? 75 : 110, dir);
      if (!n) return null;
      // Orient across the road: use the node's road edge most aligned with the heading.
      let along = Math.atan2(dir.x, dir.y);
      let bestDot = -1;
      for (const [nb] of n.adj) {
        const m = this.graph.nodes[nb];
        const ex = m.x - n.x, ez = m.z - n.z, el = Math.hypot(ex, ez) || 1;
        const dt = Math.abs((ex * dir.x + ez * dir.y) / el);
        if (dt > bestDot) { bestDot = dt; along = Math.atan2(ex, ez); }
      }
      u = kind === 'roadblock' ? new Roadblock(sc, n.x, n.z, along, g.world) : new SpikeStrip(sc, n.x, n.z, along);
    }
    if (u) { this.units.push(u); this.stats.spawned[kind]++; this._event('spawn:' + kind, this.stars); }
    return u;
  }

  /** Per frame (gameplay only). Returns accumulated damage this frame. */
  update(dt) {
    const g = this.game, P = g.player, pos = P.position;
    this.t += dt;
    const stars = this.stars;
    // Witness ambient crimes: ram a patrol / pursuit car at speed.
    const veh = P.inVehicle ? P.vehicle : null;
    if (veh && !veh.isAir && Math.abs(veh.speed) > 6) {
      for (const c of [...g.cops, ...this.units.filter((u) => u.kind === 'car')]) {
        if (c.alive && c.mesh && Math.hypot(c.mesh.position.x - pos.x, c.mesh.position.z - pos.z) < 3.2) { this.crime('ramCop', { witnessed: true, cool: 3 }); break; }
      }
      for (const npc of g.missions?.npcs?.() || []) {
        if (npc?.alive && Math.hypot(npc.mesh.position.x - pos.x, npc.mesh.position.z - pos.z) < 1.8) { npc.softHit(); this.crime('hitPed', { cool: 1 }); }
      }
    }
    if (stars === 0) {
      if (this.units.length) this.clearUnits();
      this.seen = false; this._hud();
      return 0;
    }
    // Sight.
    const R = SIGHT[stars];
    const cols = g.world.colliders || [];
    let seen = false;
    for (const u of [...this.units, ...g.cops]) {
      if (!u.alive || !u.mesh || u.kind === 'spikes') continue;
      if (u.kind === 'heli') { if (u.lit) { seen = true; break; } continue; }
      const up = u.mesh.position, d = Math.hypot(up.x - pos.x, up.z - pos.z);
      if (d < R && hasLOS(g.world.losColliders ? g.world.losColliders(up.x, up.z, pos.x, pos.z) : cols.filter((c) => !c.roadblock), up.x, up.z, pos.x, pos.z)) { seen = true; break; }
    }
    this.seen = seen;
    if (seen) { this.lkp.copy(pos); this.searchT = 0; }
    else {
      const far = Math.hypot(pos.x - this.lkp.x, pos.z - this.lkp.z) > SEARCH_R[stars];
      this.searchT += dt * (far ? 2 : 1);
      if (this.searchT >= ESCAPE_SEC[stars]) {
        this.searchT = 0;
        this.heat = stars - 1 > 0 ? stars - 1 + 0.25 : 0;
        this.stats.escapes++;
        this._event('decay', this.stars);
      }
    }
    this._hud();
    if (this.freezeUnits) return 0; // test hook: units hold still, nothing spawns / recycles
    // Escalation: bring unit counts to the target for the current star (one spawn per 0.4 s).
    const want = UNITS[this.stars];
    this._spawnT -= dt;
    for (const kind of ['foot', 'car', 'roadblock', 'heli', 'spikes']) {
      const have = this.units.filter((u) => u.kind === kind);
      const n = want[kind === 'car' ? 'cars' : kind === 'roadblock' ? 'roadblocks' : kind];
      if (have.length > n) {
        // Stand down the farthest extras.
        have.sort((a, b) => b.mesh.position.distanceTo(pos) - a.mesh.position.distanceTo(pos));
        for (const u of have.slice(0, have.length - n)) { this._remove(u); this.units.splice(this.units.indexOf(u), 1); }
      } else if (have.length < n && this._spawnT <= 0 && (this._retry[kind] || 0) <= this.t) {
        // A kind that finds no spot (e.g. no road node ahead) retries in 1 s and does not block the others.
        if (this._spawn(kind)) this._spawnT = 0.4; else this._retry[kind] = this.t + 1;
      }
    }
    // Recycle units left far behind (roadblocks / spikes the player has passed, cars stuck far away).
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const d = Math.hypot(u.mesh.position.x - pos.x, u.mesh.position.z - pos.z);
      const lim = u.kind === 'roadblock' || u.kind === 'spikes' ? 130 : u.kind === 'foot' ? 90 : 170;
      if (d > lim) { this._remove(u); this.units.splice(i, 1); this._event('recycle:' + u.kind, this.stars); }
    }
    // Update units.
    const ctx = { playerPos: pos, lkp: this.lkp, seen, stars: this.stars, world: g.world, inVehicle: P.inVehicle, vehicle: veh, playerVel: veh?.velocity };
    let dmg = 0;
    this.spikedT = Math.max(0, this.spikedT - dt);
    for (const u of this.units) {
      const r = u.update(dt, ctx);
      if (!r) continue;
      if (r.hit) dmg += r.damage;
      if (r.ram && veh) { veh.velocity.x += r.dir[0] * 9; veh.velocity.z += r.dir[1] * 9; veh.speed *= 0.6; }
      if (r.spikes && veh) { this.spikedT = 4; g.hud?.toast('Spike strip! Tyres blown'); this._event('spiked', this.stars); }
    }
    if (veh && this.spikedT > 0) { veh.speed *= Math.pow(0.35, dt); veh.velocity.multiplyScalar(Math.pow(0.35, dt)); }
    return dmg;
  }

  state() {
    const c = {};
    for (const u of this.units) c[u.kind] = (c[u.kind] || 0) + 1;
    return { stars: this.stars, heat: +this.heat.toFixed(2), seen: this.seen, searchT: +this.searchT.toFixed(2),
      escapeAt: ESCAPE_SEC[this.stars] || 0, units: this.units.length, byKind: c, flashing: this.stars > 0 && !this.seen };
  }
}
