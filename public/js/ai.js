import * as THREE from 'three';

/** Cop cruisers — chase when wanted > 0 */
export class Cop {
  constructor(scene, position, world) {
    this.scene = scene;
    this.world = world || null;
    this.speed = 11;
    this.yaw = 0;
    this.alive = true;
    this.radius = 1.2;

    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.65, 4.1),
      new THREE.MeshStandardMaterial({ color: 0x1a1a40, roughness: 0.5, metalness: 0.25 })
    );
    body.position.y = 0.5;
    this.mesh.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.55, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x0a0a18, roughness: 0.35, metalness: 0.3 })
    );
    cabin.position.set(0, 1.05, -0.1);
    this.mesh.add(cabin);

    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.22, 0.38),
      new THREE.MeshBasicMaterial({ color: 0x2244ff })
    );
    bar.position.set(0, 1.35, 0);
    this.mesh.add(bar);
    this.bar = bar;

    this.mesh.position.copy(position);
    this.mesh.position.y = 0;
    scene.add(this.mesh);
    this._t = Math.random() * 10;
  }

  update(dt, playerPos, wanted) {
    if (!this.alive) return null;
    this._t += dt;
    const blink = Math.sin(this._t * 12) > 0;
    this.bar.material.color.setHex(blink ? 0x2244ff : 0xff2222);

    if (wanted <= 0) {
      this.yaw += Math.sin(this._t * 0.3) * 0.35 * dt;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      this.mesh.position.x += fx * 2.8 * dt;
      this.mesh.position.z += fz * 2.8 * dt;
    } else {
      const dx = playerPos.x - this.mesh.position.x;
      const dz = playerPos.z - this.mesh.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      this.yaw = Math.atan2(-dx, -dz);
      const spd = this.speed + wanted * 1.4;
      this.mesh.position.x += (dx / dist) * spd * dt;
      this.mesh.position.z += (dz / dist) * spd * dt;

      if (dist < 3.6) {
        this.mesh.rotation.y = this.yaw;
        return { hit: true, damage: 7 * dt * wanted };
      }
    }

    if (this.world?.resolveCollision) {
      this.world.resolveCollision(this.mesh.position, this.radius);
    } else {
      this.mesh.position.x = THREE.MathUtils.clamp(this.mesh.position.x, -140, 240);
      this.mesh.position.z = THREE.MathUtils.clamp(this.mesh.position.z, -90, 110);
    }
    this.mesh.position.y = 0;
    this.mesh.rotation.y = this.yaw;
    return null;
  }
}

/** Mission NPC (rival / guard) — soft-hit arcade */
export class NPC {
  constructor(scene, position, color = 0x888888) {
    this.mesh = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.26), mat);
    torso.position.y = 1.1;
    this.mesh.add(torso);
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.24), mat);
    hips.position.y = 0.78;
    this.mesh.add(hips);
    for (const sx of [-0.12, 0.12]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.65, 0.18), mat);
      leg.position.set(sx, 0.35, 0);
      this.mesh.add(leg);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.26), skin);
    head.position.y = 1.55;
    this.mesh.add(head);
    this.mesh.position.copy(position);
    this.alive = true;
    this.ragdollT = 0;
    scene.add(this.mesh);
  }

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
      return true;
    }
    return false;
  }
}

export function spawnCops(scene, world) {
  const spots = [
    [-62, 18], [-42, -18], [-92, 2], [15, 4],
    [118, 28], [148, -12], [168, 8], [95, 2],
  ];
  return spots.map(
    ([x, z]) => new Cop(scene, new THREE.Vector3(x, 0, z), world)
  );
}
