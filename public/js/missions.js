import * as THREE from 'three';
import { NPC } from './ai.js';

export const MISSIONS = [
  {
    id: 1,
    name: 'Scooter Snatch',
    brief: 'Steal the orange scooter at Belikin docks.',
    reward: 200,
    blip: 'belikinDocks',
    wantedOnComplete: 1,
  },
  {
    id: 2,
    name: 'Queen Street Pickup',
    brief: 'Pick up the package at Queen Street market.',
    reward: 350,
    blip: 'queenMarket',
    wantedOnComplete: 0,
  },
  {
    id: 3,
    name: 'Creek Drop',
    brief: 'Deliver the package to the boat at Haulover Creek.',
    reward: 500,
    blip: 'hauloverBoat',
    wantedOnComplete: 1,
  },
  {
    id: 4,
    name: 'Rival Intercept',
    brief: 'Intercept the rival courier in Port of Spain downtown.',
    reward: 700,
    blip: 'posDowntown',
    wantedOnComplete: 2,
  },
  {
    id: 5,
    name: 'Warehouse Soft Hit',
    brief: 'Take out the warehouse guard (non-graphic). Get close and press F.',
    reward: 900,
    blip: 'warehouse',
    wantedOnComplete: 2,
  },
  {
    id: 6,
    name: 'Safehouse Run',
    brief: 'Escape to the hillside Safehouse with the heat on.',
    reward: 1500,
    blip: 'safehouse',
    wantedOnComplete: 0,
    setWanted: 3,
  },
];

export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.currentId = 0; // 0 = not started, 1-6 active/done progressing
    this.completed = new Set();
    this.hasPackage = false;
    this.scooterStolen = false;
    this.rivalNpc = null;
    this.guardNpc = null;
    this.boatMarker = null;
  }

  get current() {
    return MISSIONS.find((m) => m.id === this.currentId) || null;
  }

  start(id = 1) {
    this.currentId = id;
    this._setupMission(id);
    this.game.hud?.toast(`Mission ${id}: ${this.current?.name}`);
    this.game.hud?.setMission(this.current);
    this._updateBlips();
  }

  setMission(id) {
    this.start(Math.max(1, Math.min(6, id)));
  }

  _setupMission(id) {
    const g = this.game;
    // cleanup prior NPCs
    if (this.rivalNpc?.mesh) {
      g.scene.remove(this.rivalNpc.mesh);
      this.rivalNpc = null;
    }
    if (this.guardNpc?.mesh) {
      g.scene.remove(this.guardNpc.mesh);
      this.guardNpc = null;
    }

    if (id === 1) {
      this.scooterStolen = false;
    }
    if (id === 2) this.hasPackage = false;
    if (id === 3) this.hasPackage = true;
    if (id === 4) {
      this.rivalNpc = new NPC(g.scene, g.world.markers.posDowntown.clone().add(new THREE.Vector3(3, 0, 2)), 0xe63946);
    }
    if (id === 5) {
      this.guardNpc = new NPC(g.scene, g.world.markers.warehouse.clone().add(new THREE.Vector3(2, 0, 1)), 0x457b9d);
    }
    if (id === 6) {
      g.wanted = Math.max(g.wanted, 3);
      g.hud?.setWanted(g.wanted);
    }
  }

  _updateBlips() {
    const blips = this.game.world.blips;
    for (const key of Object.keys(blips)) blips[key].visible = false;
    const m = this.current;
    if (m && blips[m.blip]) blips[m.blip].visible = true;
  }

  update(dt) {
    if (!this.current) return;
    const g = this.game;
    const pos = g.player.position;
    const m = this.current;
    const target = g.world.markers[m.blip];
    const dist = pos.distanceTo(target);

    // Pulse active blip
    const blip = g.world.blips[m.blip];
    if (blip) {
      blip.scale.setScalar(1 + Math.sin(performance.now() * 0.005) * 0.15);
    }

    if (this.rivalNpc) this.rivalNpc.update(dt);
    if (this.guardNpc) this.guardNpc.update(dt);

    switch (m.id) {
      case 1:
        // Complete when player enters the orange scooter (type scooter near docks) OR is near and in vehicle that is scooter
        if (g.player.inVehicle && g.player.vehicle?.type === 'scooter') {
          if (!this.scooterStolen) {
            this.scooterStolen = true;
            this._complete();
          }
        } else if (dist < 5 && !g.player.inVehicle) {
          g.hud?.showPrompt('Press F to hop on the scooter');
        }
        break;
      case 2:
        if (dist < 4) {
          g.hud?.showPrompt('Press F to pick up package');
        }
        break;
      case 3:
        if (dist < 5) {
          g.hud?.showPrompt('Press F to deliver package');
        }
        break;
      case 4:
        if (this.rivalNpc?.alive && dist < 4) {
          g.hud?.showPrompt('Press F to intercept courier');
        } else if (this.rivalNpc && !this.rivalNpc.alive) {
          // wait for ragdoll then complete
          if (!this.rivalNpc.mesh.visible || this.rivalNpc.ragdollT <= 0) {
            this._complete();
          }
        }
        break;
      case 5:
        if (this.guardNpc?.alive && dist < 4) {
          g.hud?.showPrompt('Press F — soft hit on guard');
        } else if (this.guardNpc && !this.guardNpc.alive) {
          if (!this.guardNpc.mesh.visible || this.guardNpc.ragdollT <= 0) {
            this._complete();
          }
        }
        break;
      case 6:
        if (dist < 6) {
          g.hud?.showPrompt('Press F to enter Safehouse');
        }
        break;
    }
  }

  /** Called when player presses F for mission interactions */
  tryInteract() {
    if (!this.current) return false;
    const g = this.game;
    const pos = g.player.position;
    const m = this.current;
    const target = g.world.markers[m.blip];
    const dist = pos.distanceTo(target);

    if (m.id === 2 && dist < 5) {
      this.hasPackage = true;
      g.hud?.toast('Package acquired');
      this._complete();
      return true;
    }
    if (m.id === 3 && dist < 6 && this.hasPackage) {
      this.hasPackage = false;
      g.hud?.toast('Package delivered to the boat');
      this._complete();
      return true;
    }
    if (m.id === 4 && this.rivalNpc?.alive && dist < 5) {
      this.rivalNpc.softHit();
      g.addWanted(2);
      g.hud?.toast('Courier intercepted!');
      setTimeout(() => { if (this.currentId === 4) this._complete(); }, 700);
      return true;
    }
    if (m.id === 5 && this.guardNpc?.alive && dist < 5) {
      this.guardNpc.softHit();
      g.addWanted(2);
      g.hud?.toast('Guard down — get out!');
      setTimeout(() => { if (this.currentId === 5) this._complete(); }, 700);
      return true;
    }
    if (m.id === 6 && dist < 7) {
      g.wanted = 0;
      g.hud?.setWanted(0);
      g.hud?.toast('Safehouse reached — story complete!');
      this._complete();
      return true;
    }
    return false;
  }

  _complete() {
    const m = this.current;
    if (!m || this.completed.has(m.id)) return;
    this.completed.add(m.id);
    this.game.cash += m.reward;
    if (m.wantedOnComplete) this.game.addWanted(m.wantedOnComplete);
    this.game.hud?.toast(`+$${m.reward} — ${m.name} complete`);
    this.game.hud?.setCash(this.game.cash);

    if (m.id >= 6) {
      this.currentId = 6;
      this.game.hud?.setMission({
        name: 'Story Complete',
        brief: 'You made it. belizetriniOPNWRLD — end of the fictional run. Replay from mission 1 anytime.',
      });
      for (const b of Object.values(this.game.world.blips)) b.visible = false;
      return;
    }
    // chain next
    this.start(m.id + 1);
  }
}
