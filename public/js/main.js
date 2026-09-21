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
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      const note = document.createElement('div');
      note.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:#050510;color:#f72585;padding:2rem;text-align:center;font-family:sans-serif';
      note.innerHTML = '<div><h1>belizetriniOPNWRLD</h1><p>WebGL unavailable in this browser.</p><p style="color:#889">Try Chrome/Firefox with hardware acceleration.</p></div>';
      document.body.appendChild(note);
      throw err;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();
    this.running = false;
    this.paused = false;
    this.cash = 0;
    this.wanted = 0;
    this.district = 'belize';
    this._crimeCooldown = 0;
    this._fLatch = false;

    this.world = buildWorld(this.scene);
    this.player = new Player(this.scene, this.world.markers.spawn);
    this.vehicles = spawnFleet(this.scene, this.world.markers);
    this.cops = spawnCops(this.scene);
    this.hud = new HUD();
    this.missions = new MissionSystem(this);
    this.drive = new DriveClient(this);

    this.player.bindInput(this.canvas);
    this._bindUI();
    this._bindMobile();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();

    // Render idle world on start screen
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _bindUI() {
    document.getElementById('btn-start')?.addEventListener('click', () => {
      this.beginPlay();
    });
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
    const mc = document.getElementById('mobile-controls');
    mc?.classList.remove('hidden');
    const zone = document.getElementById('stick-zone');
    const stick = document.getElementById('stick');
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
      const t = e.changedTouches[0];
      setStick(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      if (!active) return;
      const t = e.changedTouches[0];
      setStick(t.clientX, t.clientY);
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

  beginPlay() {
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
    this.hud.toast('Welcome to belizetriniOPNWRLD');
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
    // Mission interact first
    if (this.missions.tryInteract()) return;

    // Enter / exit vehicle
    if (this.player.inVehicle) {
      this.player.exitVehicle();
      this.hud.toast('On foot');
      // Exiting stolen scooter near cops can raise heat — mild
      if (this.wanted === 0 && this._crimeCooldown <= 0) {
        // no auto heat
      }
      return;
    }
    const near = nearestVehicle(this.vehicles, this.player.position, 4.5);
    if (near) {
      this.player.enterVehicle(near);
      this.hud.toast(near.type === 'scooter' ? 'Scooter' : 'Vehicle');
      // Stealing near cops
      if (this._nearCops(18) && near.type !== 'owned') {
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

    // Always render
    if (this.running && !this.paused) {
      this._update(dt);
    } else if (!this.running) {
      // gentle orbit of spawn for title screen
      const t = performance.now() * 0.00015;
      this.player.camera.position.set(
        this.world.markers.spawn.x + Math.sin(t) * 40,
        18,
        this.world.markers.spawn.z + Math.cos(t) * 40
      );
      this.player.camera.lookAt(this.world.markers.spawn.x, 2, this.world.markers.spawn.z);
    }

    this.renderer.render(this.scene, this.player.camera);
  }

  _update(dt) {
    this._crimeCooldown = Math.max(0, this._crimeCooldown - dt);

    this.player.update(dt);
    this.missions.update(dt);

    // Idle vehicles stay put; occupied handled in player
    for (const v of this.vehicles) {
      if (!v.occupied) {
        // slight settle
        v.speed = 0;
      }
    }

    const pos = this.player.position;
    this.district = districtAt(pos.x);
    this.hud.setDistrict(this.district);

    // Cops
    for (const cop of this.cops) {
      const hit = cop.update(dt, pos, this.wanted);
      if (hit?.hit) {
        this.player.takeDamage(hit.damage);
        this.hud.setHealth(this.player.health);
        if (this.player.health <= 0) {
          this._respawn();
        }
      }
    }

    // Wanted decay slowly if far from cops
    if (this.wanted > 0 && !this._nearCops(45)) {
      this._wantedDecay = (this._wantedDecay || 0) + dt;
      if (this._wantedDecay > 25) {
        this.wanted = Math.max(0, this.wanted - 1);
        this.hud.setWanted(this.wanted);
        this._wantedDecay = 0;
      }
    } else {
      this._wantedDecay = 0;
    }

    // Minimap
    const m = this.missions.current;
    const blipPos = m ? this.world.markers[m.blip] : null;
    this.hud.drawMinimap(
      pos,
      this.player.inVehicle ? this.player.vehicle.yaw : this.player.yaw,
      this.cops,
      blipPos,
      this.player.inVehicle
    );

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
