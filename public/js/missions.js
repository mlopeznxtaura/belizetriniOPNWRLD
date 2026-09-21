import * as THREE from 'three';
import { NPC } from './ai.js';

/** Fiction arcade missions — short staging, no real-crime how-tos */
export const MISSIONS = [
  {
    id: 1,
    name: 'Scooter Snatch',
    brief: 'Grab the orange scooter at Belikin docks. Hop on (F) near the pier.',
    reward: 200,
    blip: 'belikinDocks',
    wantedOnComplete: 1,
  },
  {
    id: 2,
    name: 'Queen Street Pickup',
    brief: 'Drive or walk to Queen Street market. Press F for the fiction package.',
    reward: 350,
    blip: 'queenMarket',
    wantedOnComplete: 0,
  },
  {
    id: 3,
    name: 'Creek Drop',
    brief: 'Drop the package at the Haulover Creek boat (F).',
    reward: 500,
    blip: 'hauloverBoat',
    wantedOnComplete: 1,
  },
  {
    id: 4,
    name: 'Rival Intercept',
    brief: 'Find the rival courier in Port of Spain downtown. Press F to intercept.',
    reward: 700,
    blip: 'posDowntown',
    wantedOnComplete: 2,
  },
  {
    id: 5,
    name: 'Warehouse Soft Hit',
    brief: 'Reach the waterfront warehouse. Soft-hit the guard with F (arcade).',
    reward: 900,
    blip: 'warehouse',
    wantedOnComplete: 2,
  },
  {
    id: 6,
    name: 'Safehouse Run',
    brief: 'Heat is on — race to the hillside safehouse and press F.',
    reward: 1500,
    blip: 'safehouse',
    wantedOnComplete: 0,
    setWanted: 3,
  },
];

export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.currentId = 0;
    this.completed = new Set();
    this.hasPackage = false;
    this.scooterStolen = false;
    this.rivalNpc = null;
    this.guardNpc = null;
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
    if (this.rivalNpc?.mesh) {
      g.scene.remove(this.rivalNpc.mesh);
      this.rivalNpc = null;
    }
    if (this.guardNpc?.mesh) {
      g.scene.remove(this.guardNpc.mesh);
      this.guardNpc = null;
    }

    if (id === 1) this.scooterStolen = false;
    if (id === 2) this.hasPackage = false;
    if (id === 3) this.hasPackage = true;

    if (id === 4) {
      this.rivalNpc = new NPC(
        g.scene,
        g.world.markers.posDowntown.clone().add(new THREE.Vector3(3, 0, 2)),
        0xe63946
      );
    }
    if (id === 5) {
      this.guardNpc = new NPC(
        g.scene,
        g.world.markers.warehouse.clone().add(new THREE.Vector3(2, 0, 1)),
        0x457b9d
      );
    }
    if (id === 6) {
      const stars = MISSIONS[5].setWanted || 3;
      g.wanted = Math.max(g.wanted, stars);
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
    if (!target) return;
    const dist = pos.distanceTo(target);

    const blip = g.world.blips[m.blip];
    if (blip) {
      blip.scale.setScalar(1 + Math.sin(performance.now() * 0.005) * 0.15);
    }

    if (this.rivalNpc) this.rivalNpc.update(dt);
    if (this.guardNpc) this.guardNpc.update(dt);

    switch (m.id) {
      case 1:
        if (g.player.inVehicle && g.player.vehicle?.type === 'scooter') {
          if (!this.scooterStolen) {
            this.scooterStolen = true;
            this._complete();
          }
        } else if (dist < 6 && !g.player.inVehicle) {
          g.hud?.showPrompt('Press F — orange scooter');
        }
        break;
      case 2:
        if (dist < 5) g.hud?.showPrompt('Press F — pick up package');
        break;
      case 3:
        if (dist < 6) g.hud?.showPrompt('Press F — deliver to boat');
        break;
      case 4:
        if (this.rivalNpc?.alive && dist < 5) {
          g.hud?.showPrompt('Press F — intercept courier');
        }
        break;
      case 5:
        if (this.guardNpc?.alive && dist < 5) {
          g.hud?.showPrompt('Press F — soft hit');
        }
        break;
      case 6:
        if (dist < 7) g.hud?.showPrompt('Press F — enter safehouse');
        break;
    }
  }

  tryInteract() {
    if (!this.current) return false;
    const g = this.game;
    const pos = g.player.position;
    const m = this.current;
    const target = g.world.markers[m.blip];
    if (!target) return false;
    const dist = pos.distanceTo(target);

    if (m.id === 2 && dist < 6) {
      this.hasPackage = true;
      g.hud?.toast('Package acquired');
      this._complete();
      return true;
    }
    if (m.id === 3 && dist < 7 && this.hasPackage) {
      this.hasPackage = false;
      g.hud?.toast('Package delivered');
      this._complete();
      return true;
    }
    if (m.id === 4 && this.rivalNpc?.alive && dist < 5.5) {
      this.rivalNpc.softHit();
      g.addWanted(2);
      g.hud?.toast('Courier intercepted!');
      setTimeout(() => {
        if (this.currentId === 4) this._complete();
      }, 700);
      return true;
    }
    if (m.id === 5 && this.guardNpc?.alive && dist < 5.5) {
      this.guardNpc.softHit();
      g.addWanted(2);
      g.hud?.toast('Guard down — move!');
      setTimeout(() => {
        if (this.currentId === 5) this._complete();
      }, 700);
      return true;
    }
    if (m.id === 6 && dist < 8) {
      g.wanted = 0;
      g.hud?.setWanted(0);
      g.hud?.toast('Safehouse — story complete');
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
    this.game.hud?.toast(`+$${m.reward} — ${m.name} done`);
    this.game.hud?.setCash(this.game.cash);

    if (m.id >= 6) {
      this.currentId = 6;
      this.game.hud?.setMission({
        name: 'Story Complete',
        brief: 'Fiction run finished. Free roam Belize ↔ Port of Spain.',
      });
      for (const b of Object.values(this.game.world.blips)) b.visible = false;
      return;
    }
    this.start(m.id + 1);
  }
}
