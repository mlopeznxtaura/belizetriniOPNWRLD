/**
 * Agent drive client — syncs state to server and polls /api/drive/poll
 */
export class DriveClient {
  constructor(game) {
    this.game = game;
    this._syncTimer = null;
    this._pollTimer = null;
  }

  start() {
    this._syncTimer = setInterval(() => this.sync(), 1000);
    this._pollTimer = setInterval(() => this.poll(), 500);
    this.sync();
  }

  stop() {
    clearInterval(this._syncTimer);
    clearInterval(this._pollTimer);
  }

  async sync() {
    const g = this.game;
    try {
      await fetch('/api/state-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          running: g.running,
          paused: g.paused,
          missionId: g.missions.currentId,
          missionName: g.missions.current?.name || 'None',
          cash: g.cash,
          wanted: g.wanted,
          health: g.player.health,
          playerPos: {
            x: +g.player.position.x.toFixed(2),
            y: +g.player.position.y.toFixed(2),
            z: +g.player.position.z.toFixed(2),
          },
          district: g.district,
          inVehicle: g.player.inVehicle,
        }),
      });
    } catch (_) {
      /* offline / static host without API */
    }
  }

  async poll() {
    try {
      const res = await fetch('/api/drive/poll');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.actions?.length) return;
      for (const a of data.actions) this.apply(a);
    } catch (_) {}
  }

  apply(a) {
    const g = this.game;
    const action = a.action;
    switch (action) {
      case 'start_mission':
        if (!g.running) g.beginPlay();
        g.missions.start(a.missionId || g.missions.currentId || 1);
        break;
      case 'set_mission':
        if (!g.running) g.beginPlay();
        g.missions.setMission(a.missionId || 1);
        break;
      case 'give_cash':
        g.cash += Number(a.amount) || 500;
        g.hud.setCash(g.cash);
        g.hud.toast(`Agent: +$${Number(a.amount) || 500}`);
        break;
      case 'clear_wanted':
        g.wanted = 0;
        g.hud.setWanted(0);
        g.hud.toast('Agent: heat cleared');
        break;
      case 'set_wanted':
        g.wanted = Math.max(0, Math.min(5, Number(a.stars) || Number(a.amount) || 0));
        g.hud.setWanted(g.wanted);
        break;
      case 'heal':
        g.player.heal(100);
        g.hud.setHealth(g.player.health);
        break;
      case 'pause':
        g.setPaused(true);
        break;
      case 'resume':
        g.setPaused(false);
        break;
      case 'teleport': {
        const x = Number(a.x);
        const z = Number(a.z);
        let tx = Number.isFinite(x) ? x : null;
        let tz = Number.isFinite(z) ? z : null;
        if (a.district === 'trinidad') {
          tx = tx ?? 140;
          tz = tz ?? 20;
        } else if (a.district === 'belize') {
          tx = tx ?? -70;
          tz = tz ?? 5;
        }
        if (tx == null) tx = 0;
        if (tz == null) tz = 0;
        if (g.player.inVehicle) g.player.exitVehicle();
        g.player.mesh.position.set(tx, 0, tz);
        g.hud.toast(`Agent: teleport (${tx.toFixed(0)}, ${tz.toFixed(0)})`);
        break;
      }
      case 'spawn_car': {
        import('./vehicle.js').then(({ Vehicle }) => {
          const pos = g.player.position.clone();
          pos.x += 3;
          const v = new Vehicle(g.scene, {
            position: pos,
            color: 0x00f5d4,
            yaw: g.player.yaw,
          });
          g.vehicles.push(v);
          g.hud.toast('Agent: car spawned');
        });
        break;
      }
      default:
        break;
    }
  }
}
