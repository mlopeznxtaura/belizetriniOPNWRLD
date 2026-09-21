import * as THREE from 'three';
import { buildWorld, districtAt } from './world.js';
import { Player } from './player.js';
import { spawnFleet, nearestVehicle } from './vehicle.js';
import { spawnCops } from './ai.js';
import { MissionSystem } from './missions.js';
import { HUD } from './hud.js';
import { DriveClient } from './drive.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.scene = new THREE.Scene();

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      const note = document.createElement('div');
      note.style.cssText =
        'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:#050510;color:#f72585;padding:2rem;text-align:center;font-family:sans-serif';
      note.innerHTML =
        '<div><h1>belizetriniOPNWRLD</h1><p>WebGL unavailable.</p><p style="color:#889">Try Chrome/Firefox with hardware acceleration.</p></div>';
      document.body.appendChild(note);
      throw err;
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.clock = new THREE.Clock();
    this.running = false;
    this.paused = false;
    this.cash = 0;
    this.wanted = 0;
    this.district = 'belize';
    this._crimeCooldown = 0;
    this._fLatch = false;
    this._wantedDecay = 0;

    this.world = buildWorld(this.scene);
    this.player = new Player(this.scene, this.world.markers.spawn, this.world);
    this.vehicles = spawnFleet(this.scene, this.world.markers, this.world);
    this.cops = spawnCops(this.scene, this.world);
    this.hud = new HUD();
    this.missions = new MissionSystem(this);
    this.drive = new DriveClient(this);

    this.player.bindInput(this.canvas);
    this.player.whenReady().then(() => console.info("[game] character ready"));
    this._bindUI();
    this._bindMobile();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _bindUI() {
    document.getElementById('btn-start')?.addEventListener('click', () => this.beginPlay());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (!this.running) return;
        if (e.code === 'Escape' && document.pointerLockElement) {
          document.exitPointerLock();
          return;
        }
        this.setPaused(!this.paused);
      }
      if (e.code === 'KeyF') {
        if (this._fLatch) return;
        this._fLatch = true;
        this._onInteract();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyF') this._fLatch = false;
    });
  }

  _bindMobile() {
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    document.getElementById('mobile-controls')?.classList.remove('hidden');
    const zone = document.getElementById('stick-zone');
    const stick = document.getElementById('stick');
    if (!zone || !stick) return;
    let active = false;
    const setStick = (cx, cy) => {
      const rect = zone.getBoundingClientRect();
      const ox = rect.left + rect.width / 2;
      const oy = rect.top + rect.height / 2;
      let dx = (cx - ox) / (rect.width / 2);
      let dy = (cy - oy) / (rect.height / 2);
      const len = Math.hypot(dx, dy) || 1;
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      this.player.mobileStick.x = dx;
      this.player.mobileStick.y = dy;
      stick.style.transform = `translate(${dx * 36}px, ${dy * 36}px)`;
    };
    const clearStick = () => {
      this.player.mobileStick.x = 0;
      this.player.mobileStick.y = 0;
      stick.style.transform = '';
      active = false;
    };
    zone.addEventListener('touchstart', (e) => {
      active = true;
      setStick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      if (!active) return;
      setStick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchend', clearStick);
    zone.addEventListener('touchcancel', clearStick);

    document.getElementById('btn-action')?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this._onInteract();
    });
    document.getElementById('btn-brake')?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.player.keys['Space'] = true;
    });
    document.getElementById('btn-brake')?.addEventListener('touchend', () => {
      this.player.keys['Space'] = false;
    });
  }

  async beginPlay() {
    try { await this.player.whenReady(); } catch (_) {}
    document.getElementById('start-screen')?.classList.add('hidden');
    this.hud.show();
    this.running = true;
    this.paused = false;
    this.cash = 0;
    this.wanted = 0;
    this.player.health = 100;
    this.hud.setCash(0);
    this.hud.setWanted(0);
    this.hud.setHealth(100);
    this.missions.start(1);
    this.drive.start();
    this.canvas.requestPointerLock?.();
    this.hud.toast('belizetriniOPNWRLD — night run');
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause-overlay')?.classList.toggle('hidden', !p);
    if (p) document.exitPointerLock?.();
  }

  addWanted(n) {
    this.wanted = Math.min(5, this.wanted + n);
    this.hud.setWanted(this.wanted);
  }

  _onInteract() {
    if (!this.running || this.paused) return;
    if (this.missions.tryInteract()) return;

    if (this.player.inVehicle) {
      this.player.exitVehicle();
      this.hud.toast('On foot');
      return;
    }
    const near = nearestVehicle(this.vehicles, this.player.position, 4.5);
    if (near) {
      this.player.enterVehicle(near);
      const label =
        near.type === 'scooter' ? 'Scooter' : near.type === 'van' ? 'Van' : 'Sedan';
      this.hud.toast(label);
      if (this._nearCops(18) && this._crimeCooldown <= 0) {
        this.addWanted(1);
        this._crimeCooldown = 5;
      }
    }
  }

  _nearCops(r) {
    const p = this.player.position;
    return this.cops.some((c) => c.alive && c.mesh.position.distanceTo(p) < r);
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.player.camera.aspect = w / h;
    this.player.camera.updateProjectionMatrix();
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.running && !this.paused) {
      this._update(dt);
    } else if (!this.running) {
      const t = performance.now() * 0.00015;
      const s = this.world.markers.spawn;
      this.player.camera.position.set(s.x + Math.sin(t) * 42, 16, s.z + Math.cos(t) * 42);
      this.player.camera.lookAt(s.x, 2, s.z);
    }

    this.renderer.render(this.scene, this.player.camera);
  }

  _update(dt) {
    this._crimeCooldown = Math.max(0, this._crimeCooldown - dt);

    this.player.update(dt);
    this.missions.update(dt);

    for (const v of this.vehicles) {
      if (!v.occupied) v.speed = 0;
    }

    const pos = this.player.position;
    this.district = districtAt(pos.x);
    this.hud.setDistrict(this.district);

    for (const cop of this.cops) {
      const hit = cop.update(dt, pos, this.wanted);
      if (hit?.hit) {
        this.player.takeDamage(hit.damage);
        this.hud.setHealth(this.player.health);
        if (this.player.health <= 0) this._respawn();
      }
    }

    if (this.wanted > 0 && !this._nearCops(45)) {
      this._wantedDecay += dt;
      if (this._wantedDecay > 25) {
        this.wanted = Math.max(0, this.wanted - 1);
        this.hud.setWanted(this.wanted);
        this._wantedDecay = 0;
      }
    } else {
      this._wantedDecay = 0;
    }

    const m = this.missions.current;
    const blipPos = m ? this.world.markers[m.blip] : null;
    this.hud.drawMinimap(
      pos,
      this.player.inVehicle ? this.player.vehicle.yaw : this.player.yaw,
      this.cops,
      blipPos,
      this.player.inVehicle,
      this.world.roads
    );

    if (!this.player.inVehicle) {
      const near = nearestVehicle(this.vehicles, pos, 4.5);
      if (near) {
        const mid = m?.id;
        if (!(mid === 1 && near.type === 'scooter') && ![2, 3, 4, 5, 6].includes(mid)) {
          this.hud.showPrompt('Press F — enter vehicle');
        }
      }
    } else {
      this.hud.showPrompt('Press F — exit vehicle');
    }

    this.hud.setCash(this.cash);
  }

  _respawn() {
    this.hud.toast('Wasted — respawning at docks');
    if (this.player.inVehicle) this.player.exitVehicle();
    this.player.mesh.position.copy(this.world.markers.spawn);
    this.player.health = 100;
    this.hud.setHealth(100);
    this.wanted = Math.max(0, this.wanted - 1);
    this.hud.setWanted(this.wanted);
  }
}

const game = new Game();
window.__BELIZETRINI_OPNWRLD__ = game;
