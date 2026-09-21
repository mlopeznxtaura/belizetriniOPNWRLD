import { districtLabel } from './world.js';

export class HUD {
  constructor() {
    this.cashEl = document.getElementById('cash');
    this.wantedEl = document.getElementById('wanted');
    this.healthBar = document.getElementById('health-bar');
    this.missionTitle = document.getElementById('mission-title');
    this.missionText = document.getElementById('mission-text');
    this.districtEl = document.getElementById('district-label');
    this.promptEl = document.getElementById('prompt');
    this.toastEl = document.getElementById('toast');
    this.minimap = document.getElementById('minimap');
    this.mctx = this.minimap.getContext('2d');
    this._toastTimer = null;
    this._promptClear = null;
    this.setWanted(0);
  }

  show() {
    document.getElementById('hud')?.classList.remove('hidden');
  }

  setCash(n) {
    this.cashEl.textContent = '$' + Math.floor(n).toLocaleString();
  }

  setWanted(stars) {
    const s = Math.max(0, Math.min(5, Math.floor(stars)));
    this.wantedEl.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const span = document.createElement('span');
      span.className = 'star' + (i < s ? ' on' : '');
      span.textContent = '★';
      this.wantedEl.appendChild(span);
    }
  }

  setHealth(h) {
    this.healthBar.style.width = Math.max(0, Math.min(100, h)) + '%';
  }

  setMission(m) {
    if (!m) {
      this.missionTitle.textContent = 'No mission';
      this.missionText.textContent = 'Waiting…';
      return;
    }
    this.missionTitle.textContent = m.name;
    this.missionText.textContent = m.brief;
  }

  setDistrict(d) {
    this.districtEl.textContent = districtLabel(d);
  }

  showPrompt(text) {
    this.promptEl.textContent = text;
    this.promptEl.classList.remove('hidden');
    clearTimeout(this._promptClear);
    this._promptClear = setTimeout(() => this.hidePrompt(), 220);
  }

  hidePrompt() {
    this.promptEl.classList.add('hidden');
  }

  toast(text, ms = 2800) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toastEl.classList.add('hidden');
    }, ms);
  }

  drawMinimap(playerPos, yaw, cops, blipWorldPos, inVehicle, roads) {
    const ctx = this.mctx;
    const W = this.minimap.width;
    const H = this.minimap.height;
    const scale = 0.42;
    ctx.fillStyle = '#080e1c';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#0a2838';
    ctx.fillRect(0, H * 0.72, W, H * 0.28);

    const toMap = (wx, wz) => {
      const dx = (wx - playerPos.x) * scale;
      const dz = (wz - playerPos.z) * scale;
      const c = Math.cos(-yaw);
      const s = Math.sin(-yaw);
      const rx = dx * c - dz * s;
      const rz = dx * s + dz * c;
      return [W / 2 + rx, H / 2 + rz];
    };

    if (roads?.length) {
      ctx.strokeStyle = '#2a2a40';
      ctx.lineWidth = 2.5;
      for (const r of roads) {
        const [ax, ay] = toMap(r.x1, r.z1);
        const [bx, by] = toMap(r.x2, r.z2);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    const landmarks = [
      [-108, -36], [-60, -12], [-95, 20], [140, 8], [175, -48], [-25, 65],
    ];
    ctx.fillStyle = '#3a4558';
    for (const [x, z] of landmarks) {
      const [mx, my] = toMap(x, z);
      if (mx < 0 || my < 0 || mx > W || my > H) continue;
      ctx.fillRect(mx - 2, my - 2, 4, 4);
    }

    if (cops) {
      ctx.fillStyle = '#4488ff';
      for (const c of cops) {
        if (!c.alive) continue;
        const [mx, my] = toMap(c.mesh.position.x, c.mesh.position.z);
        if (mx < 2 || my < 2 || mx > W - 2 || my > H - 2) continue;
        ctx.beginPath();
        ctx.arc(mx, my, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (blipWorldPos) {
      const [mx, my] = toMap(blipWorldPos.x, blipWorldPos.z);
      ctx.fillStyle = '#00f5d4';
      ctx.beginPath();
      ctx.arc(
        Math.max(4, Math.min(W - 4, mx)),
        Math.max(4, Math.min(H - 4, my)),
        5,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.fillStyle = inVehicle ? '#ffd60a' : '#f72585';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
