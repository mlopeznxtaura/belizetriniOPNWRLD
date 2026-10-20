import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * belizetriniOPNWRLD — static batching (good-1+4).
 *
 * The city kit builds every window pane, window frame, trim, roof, porch post, balcony rail, road
 * strip and pad as its own Mesh (≈1,100 draws at the causeway view). They never move, share ~30
 * materials, and only differ by transform, so they are merged per material into world-space
 * geometry, split by a coarse XZ grid so frustum culling still drops the parts behind the camera.
 *
 * Rules: only plain opaque Meshes directly under the world root (no InstancedMesh, ShaderMaterial,
 * transparent, renderOrder≠0, markers/blips, outlines). Materials are reused as-is, so toon ramps,
 * fog, lights and shadows are unchanged; outline hulls were already baked from the originals.
 */
export const BATCH_ON = (() => {
  try { return !/[?&]batch=0\b/.test(window.location.search); } catch (_) { return true; }
})();

/** Materials that render identically share a key (vehicles create a fresh material per part). */
export function materialKey(m) {
  const hex = (c) => (c && c.isColor ? c.getHexString() : '');
  return [m.type, hex(m.color), hex(m.emissive), m.map?.uuid || '', m.gradientMap?.uuid || '', m.side, m.vertexColors ? 1 : 0,
    m.transparent ? 1 : 0, m.opacity, m.fog ? 1 : 0, m.customProgramCacheKey ? m.customProgramCacheKey() : '',
    m.roughness ?? '', m.metalness ?? '', m.depthWrite ? 1 : 0, m.depthTest ? 1 : 0].join('|');
}

function attrSig(g) {
  return Object.keys(g.attributes).sort().join(',') + (g.index ? ':i' : ':n');
}

export function batchStatic(root, { cell = 48 } = {}) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const c = new THREE.Vector3();
  let considered = 0;
  for (const o of root.children.slice()) {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible) continue;
    if (o.userData?.isOutline || o.userData?.markerKey || o.renderOrder !== 0 || o.children.length) continue;
    const m = o.material;
    if (!m || Array.isArray(m) || m.isShaderMaterial || m.transparent) continue;
    considered++;
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    c.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
    const key = `${materialKey(m)}|${attrSig(g)}|${Math.floor(c.x / cell)},${Math.floor(c.z / cell)}`;
    let e = groups.get(key);
    if (!e) groups.set(key, (e = { material: m, meshes: [] }));
    e.meshes.push(o);
  }
  let merged = 0, removed = 0;
  for (const { material, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((o) => {
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      return g;
    });
    const mg = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!mg) continue;
    mg.computeBoundingSphere();
    mg.computeBoundingBox();
    const mesh = new THREE.Mesh(mg, material);
    mesh.name = `batch:${material.name || material.type}:${meshes.length}`;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = meshes.some((o) => o.receiveShadow);
    // Flat decals (road strips, window panes) never cast; quality.js reads this for ultra shadows.
    mesh.userData.noCast = meshes.every((o) => o.geometry.type === 'PlaneGeometry');
    mesh.userData.batched = meshes.length;
    for (const o of meshes) root.remove(o);
    root.add(mesh);
    merged++;
    removed += meshes.length;
  }
  return { considered, groups: groups.size, merged, removed, cell };
}

/**
 * Merge the rigid mesh children of one parent (a vehicle's lean group, a character joint pivot) per
 * equivalent material, in the parent's local space, so the parent still moves / animates as one.
 * Transparent parts and parts with their own sub-hierarchy stay separate. The outline hulls those
 * parts carried (already chosen by the toon budget) are merged into one hull mesh that stays
 * registered with the toon outline culler (owner = the merged hull).
 */
export function batchChildren(parent, klass, { forgetOutlines, registerOutline } = {}) {
  parent.updateMatrixWorld(true);
  const parts = parent.children.filter((o) => o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !o.userData?.isOutline
    && o.material && !Array.isArray(o.material) && !o.material.transparent
    && o.children.every((c) => c.userData?.isOutline));
  if (parts.length < 2) return { parts: parts.length, draws: parts.length, hulls: 0 };
  const hulls = [];
  let hullMat = null, hullOrder = 0;
  for (const p of parts) {
    p.updateMatrix();
    for (const c of p.children) {
      const g = c.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(p.matrix, c.matrix));
      const n = new THREE.BufferGeometry();
      n.setAttribute('position', g.getAttribute('position'));
      n.setAttribute('normal', g.getAttribute('normal'));
      if (g.index) n.setIndex(g.index);
      hulls.push(n); hullMat = c.material; hullOrder = c.renderOrder;
    }
  }
  const groups = new Map();
  for (const p of parts) {
    const k = materialKey(p.material) + '#' + attrSig(p.geometry);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  let draws = 0;
  for (const list of groups.values()) {
    if (list.length < 2) { draws++; continue; }
    const mg = mergeGeometries(list.map((p) => { const g = p.geometry.clone(); g.applyMatrix4(p.matrix); return g; }), false);
    if (!mg) { draws += list.length; continue; }
    mg.computeBoundingSphere(); mg.computeBoundingBox();
    const m = new THREE.Mesh(mg, list[0].material);
    m.name = 'pbatch:' + list.length;
    m.userData.batched = list.length;
    m.castShadow = list.some((p) => p.castShadow);
    m.receiveShadow = list.some((p) => p.receiveShadow);
    m.renderOrder = list[0].renderOrder;
    for (const p of list) parent.remove(p);
    parent.add(m);
    draws++;
  }
  // Hulls: drop the per-part ones (registry + scene), add the merged one.
  for (const p of parts) {
    if (forgetOutlines) forgetOutlines(p);
    for (const c of p.children.slice()) p.remove(c);
    if (p.userData) delete p.userData.outlineMesh;
  }
  if (hulls.length) {
    const hg = hulls.length > 1 ? mergeGeometries(hulls, false) : hulls[0];
    if (hg) {
      hg.computeBoundingSphere(); hg.computeBoundingBox();
      const hm = new THREE.Mesh(hg, hullMat);
      hm.name = klass + 'Outline';
      hm.userData.isOutline = true;
      hm.raycast = () => {};
      hm.renderOrder = hullOrder;
      parent.add(hm);
      if (registerOutline) registerOutline(hm, klass);
    }
  }
  return { parts: parts.length, draws, hulls: hulls.length };
}

/** Per-vehicle batching (good-1+4): a parked sedan was 39 draws; rotor / prop sub-groups untouched. */
export function batchVehicle(v, hooks) {
  return v.body ? batchChildren(v.body, 'vehicle', hooks) : null;
}

/** Per-character batching (good-1+4): parts are rigid children of the rig's joint pivots. */
export function batchCharacter(rig, hooks) {
  const out = { pivots: 0, parts: 0, draws: 0, hulls: 0 };
  for (const pivot of Object.values(rig?.pivots || {})) {
    const r = batchChildren(pivot, 'char', hooks);
    out.pivots++; out.parts += r.parts; out.draws += r.draws; out.hulls += r.hulls;
  }
  return out;
}
