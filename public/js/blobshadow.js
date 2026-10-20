import * as THREE from 'three';

/**
 * belizetriniOPNWRLD — blob / contact shadows (good-1+5).
 *
 * The mobile (Lambert) path never renders a shadow map. Instead every character and vehicle gets a
 * flat, two-step cel "puddle" decal on the ground: ONE InstancedMesh (one draw call, one tiny
 * program, no textures) whose instances are re-placed each frame. Elliptical for vehicles (oriented
 * with the yaw), round for people; air vehicles shrink and fade with altitude.
 */
const MAX = 64;

export class BlobShadows {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const fade = new Float32Array(MAX).fill(1);
    geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(fade, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uDark: { value: 0.34 } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: /* glsl */`
        attribute float aFade;
        varying vec2 vUv; varying float vFade;
        void main() {
          vUv = uv * 2.0 - 1.0; vFade = aFade;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uDark;
        varying vec2 vUv; varying float vFade;
        void main() {
          float r = dot(vUv, vUv);
          if (r > 1.0) discard;
          // Wind Waker contact shadow: a solid core plus one lighter ring (cel steps, no smooth blur).
          float a = r < 0.45 ? 1.0 : 0.55;
          gl_FragColor = vec4(0.05, 0.07, 0.14, uDark * a * vFade);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX);
    this.mesh.name = 'blobShadows';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3; // after opaque ground, before transparent props
    this.mesh.count = 0;
    this.mesh.raycast = () => {};
    this.mesh.userData.noOutline = true;
    this.fade = geo.getAttribute('aFade');
    scene.add(this.mesh);
    this.enabled = true;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  setEnabled(on) { this.enabled = !!on; this.mesh.visible = this.enabled; if (!on) this.mesh.count = 0; }

  /** Ground height under (x, z): the world is flat except the causeway deck. */
  static groundAt(x, z) { return (x > -1 && x < 81 && Math.abs(z) < 6.5) ? 0.47 : 0.05; }

  /** casters: [{ x, y, z, yaw, w, l, fade }] (w/l = footprint in metres). */
  update(casters, count = casters.length) {
    if (!this.enabled) return;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const c = casters[i];
      if (n >= MAX) break;
      const gy = BlobShadows.groundAt(c.x, c.z);
      const h = Math.max(0, (c.y ?? 0) - gy);
      // Lifted casters (helis, jumping cars) get a smaller, fainter shadow; gone by ~40 m.
      const k = THREE.MathUtils.clamp(1 - h / 40, 0, 1);
      if (k <= 0.02) continue;
      const sc = 0.55 + 0.45 * k;
      this._q.setFromAxisAngle(this._up, c.yaw || 0);
      this._s.set(c.w * sc, 1, c.l * sc);
      this._p.set(c.x, gy + 0.02, c.z);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      this.fade.setX(n, (c.fade ?? 1) * k);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fade.needsUpdate = true;
  }
}

/** Footprint per vehicle type (width, length in metres, slightly larger than the body). */
export const BLOB_SIZE = {
  sedan: [2.5, 4.9], van: [2.7, 5.8], scooter: [0.9, 2.1], plane: [7, 7], heli: [3.4, 6.5], cop: [2.6, 5.0], person: [0.95, 0.95],
};
