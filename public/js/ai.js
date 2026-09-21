import * as THREE from 'three';

/** Cop NPCs — chase when wanted > 0 */
export class Cop {
  constructor(scene, position) {
    this.scene = scene;
    this.speed = 11;
    this.yaw = 0;
    this.alive = true;
    this.chaseBoost = 0;

    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.65, 4.0),
      new THREE.MeshStandardMaterial({ color: 0x1a1a40, roughness: 0.5, metalness: 0.2 })
    );
    body.position.y = 0.5;
    body.castShadow = true;
    this.mesh.add(body);
    // light bar
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.25, 0.4),
      new THREE.MeshBasicMaterial({ color: 0x2244ff })
    );
    bar.position.set(0, 1.0, 0);
    this.mesh.add(bar);
    this.lightBlink = new THREE.PointLight(0x2244ff, 0.8, 15);
    this.lightBlink.position.set(0, 1.2, 0);
    this.mesh.add(this.lightBlink);
    this.mesh.position.copy(position);
    this.mesh.position.y = 0;
    scene.add(this.mesh);
    this._t = Math.random() * 10;
  }

  update(dt, playerPos, wanted) {
    if (!this.alive) return;
    this._t += dt;
    // blink
    const blink = Math.sin(this._t * 12) > 0;
    this.lightBlink.color.setHex(blink ? 0x2244ff : 0xff2222);
    this.lightBlink.intensity = wanted > 0 ? 1.4 : 0.3;

    if (wanted <= 0) {
      // patrol slowly
      this.yaw += Math.sin(this._t * 0.3) * 0.4 * dt;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      this.mesh.position.x += fx * 3 * dt;
      this.mesh.position.z += fz * 3 * dt;
    } else {
      const dx = playerPos.x - this.mesh.position.x;
      const dz = playerPos.z - this.mesh.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      this.yaw = Math.atan2(-dx, -dz);
      const spd = this.speed + wanted * 1.5;
      this.mesh.position.x += (dx / dist) * spd * dt;
      this.mesh.position.z += (dz / dist) * spd * dt;

      // contact damage / arrest bump
      if (dist < 3.5) {
        return { hit: true, damage: 8 * dt * wanted };
      }
    }
    this.mesh.position.x = THREE.MathUtils.clamp(this.mesh.position.x, -130, 230);
    this.mesh.position.z = THREE.MathUtils.clamp(this.mesh.position.z, -80, 100);
    this.mesh.rotation.y = this.yaw;
    return null;
  }
}

/** Simple civilian / rival NPC for missions */
export class NPC {
  constructor(scene, position, color = 0x888888) {
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.8, 4, 6),
      new THREE.MeshStandardMaterial({ color })
    );
    body.position.y = 0.95;
    body.castShadow = true;
    this.mesh.add(body);
    this.mesh.position.copy(position);
    this.alive = true;
    this.ragdollT = 0;
    scene.add(this.mesh);
  }

  /** Soft hit — despawn / light ragdoll tilt then remove */
  softHit() {
    if (!this.alive) return;
    this.alive = false;
    this.ragdollT = 0.8;
  }

  update(dt) {
    if (this.alive) return false;
    this.ragdollT -= dt;
    this.mesh.rotation.z += 2 * dt;
    this.mesh.position.y = Math.max(0, this.mesh.position.y - 0.5 * dt);
    if (this.ragdollT <= 0) {
      this.mesh.visible = false;
      this.mesh.parent?.remove(this.mesh);
      return true; // removed
    }
    return false;
  }
}

export function spawnCops(scene) {
  const spots = [
    [-60, 20], [-40, -20], [-90, 0], [20, 5],
    [120, 30], [150, -15], [170, 10], [100, 0],
  ];
  return spots.map(
    ([x, z]) => new Cop(scene, new THREE.Vector3(x, 0, z))
  );
}
