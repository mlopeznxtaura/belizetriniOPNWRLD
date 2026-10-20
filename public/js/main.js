import * as THREE from 'three';
import { buildWorld, districtAt } from './world.js';
import { Player, getStoredChar, setStoredChar } from './player.js';
import { spawnFleet, nearestVehicle, vehicleLabel } from './vehicle.js';
import { spawnCops } from './ai.js';
import { WantedSystem } from './wanted.js';
import { MissionSystem } from './missions.js';
import { HUD } from './hud.js';
import { DriveClient } from './drive.js';
import { TOON_ON, toonify, updateToon, outlineStats, TOON_Q, U as TOON_U, forgetOutlines, registerOutline } from './toon.js';
import { BATCH_ON, batchVehicle } from './batch.js';
import { createRendererRobust, watchContext, healShaderFailures, gfxToast, safePointerLock } from './gfx.js';
import { BlobShadows, BLOB_SIZE } from './blobshadow.js';
import { FpsGovernor, mountDebugOverlay } from './governor.js';
import { resolveQuality, applyPreBuild, QualityController, PRESETS, PRESET_ORDER, saveQualityChoice } from './quality.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.scene = new THREE.Scene();

    // good-1+2: robust renderer creation (WebGL2 with relaxed retries on fresh canvases, then a clear
    // in-page reason). See public/js/gfx.js for why there is no WebGL1 path with three r170.
    // good-1+3: device quality preset (URL > saved > auto-detect) decides AA before the context exists.
    const QR = resolveQuality();
    applyPreBuild(QR.preset, QR.shade);
    const made = createRendererRobust(this.canvas, { antialias: QR.preset.antialias });
    this.renderer = made.renderer;
    this.canvas = made.canvas;
    this.gfx = { attempt: made.attempt, tried: made.tried, healed: 0, context: null };
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      // Log compactly (the default dump is huge); the material is swapped by healShaderFailures().
      const log = (gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(program) || '').trim();
      console.warn('[gfx] shader failed to compile on this GPU, using fallback:', log.slice(0, 300));
      this._shaderFailed = true;
    };

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QR.preset.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Default clear matches afternoon sky; dayNight.bindRenderer keeps it in sync
    this.renderer.setClearColor(0x52b0e4, 1);

    this.clock = new THREE.Clock();
    this.running = false;
    this.paused = false;
    this.cash = 0;
    this.wanted = 0;
    this.district = 'belize';
    this._crimeCooldown = 0;
    this._fLatch = false;
    this._wantedDecay = 0;

    this.world = buildWorld(this.scene, QR.preset);
    this.world?.dayNight?.bindRenderer?.(this.renderer);
    this.player = new Player(this.scene, this.world.markers.spawn, this.world);
    this.vehicles = spawnFleet(this.scene, this.world.markers, this.world);
    this.cops = spawnCops(this.scene, this.world);
    if (TOON_ON) {
      for (const v of this.vehicles) toonify(v.mesh, { klass: 'vehicle' });
      for (const c of this.cops) toonify(c.mesh, { klass: 'vehicle' });
    }
    // good-1+4: merge each vehicle's rigid parts per material (+ its outline hulls) — ?batch=0 disables.
    if (BATCH_ON) {
      this.batchStats = { vehicles: this.vehicles.map((v) => batchVehicle(v, { forgetOutlines, registerOutline })) };
    }
    this.toon = { on: TOON_ON, stats: outlineStats, Q: TOON_Q, U: TOON_U };
    this.blobs = new BlobShadows(this.scene); // good-1+5 contact shadows (mobile path)
    this._blobCasters = [];
    this.quality = new QualityController(this, QR);
    if (QR.shade?.lambert) this.quality.stripShadowFlags();
    this.hud = new HUD();
    this.missions = new MissionSystem(this);
    this.wantedSys = new WantedSystem(this); // good-1+7: 1-5 star heat, escalation, escape
    this.drive = new DriveClient(this);

    this.player.bindInput(this.canvas);
    this.player.whenReady().then(() => console.info("[game] character ready"));
    this._bindUI();
    this._bindMobile();

    window.addEventListener('resize', () => this._onResize());
    this.quality.apply();
    this._onResize();
    // good-1+6: adaptive frame-rate governor (+ ?debug=1 overlay)
    this.governor = new FpsGovernor(this, this.quality);
    this.debugOverlay = mountDebugOverlay(this);
    this._lastFrameT = 0;
    this.gfx.context = watchContext(this.renderer, {
      onLost: () => this._stopLoop(),
      onRestore: () => this._onContextRestored(),
    });
    this._startLoop();
  }

  _bindUI() {
    this._bindCharSelect();
    this._bindQualityMenu();
    document.getElementById('btn-pause')?.addEventListener('click', (e) => { e.preventDefault(); if (this.running) this.setPaused(true); });
    document.getElementById('btn-resume')?.addEventListener('click', () => this.setPaused(false));
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
      // Time-of-day: [ ] scrub · T pause clock
      const dn = this.world?.dayNight;
      if (dn && (e.code === 'BracketLeft' || e.code === 'BracketRight' || e.code === 'KeyT')) {
        if (e.code === 'KeyT') {
          const paused = dn.togglePause();
          this.hud?.toast(paused ? 'Clock paused' : 'Clock running');
        } else {
          const delta = e.code === 'BracketRight' ? 0.75 : -0.75;
          dn.setHour(dn.hour + delta);
          this.hud?.setClock?.(dn.clockString(), dn.phaseIcon());
        }
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
    document.documentElement.classList.add('touch'); // good-1+8: touch HUD layout (style.css)
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


  _bindQualityMenu() {
    const wrap = document.getElementById('quality-select');
    if (!wrap) return;
    const auto = this.quality.auto.preset;
    const btns = [['auto', `Auto (${PRESETS[auto].label})`], ...PRESET_ORDER.map((k) => [k, PRESETS[k].label])];
    wrap.innerHTML = btns.map(([k, l]) => `<button type="button" class="q-btn" data-q="${k}">${l}</button>`).join('');
    const sync = () => {
      const saved = this._qualityChoice ?? (this.quality.source === 'saved' ? this.quality.name : (this.quality.source === 'url' ? this.quality.name : 'auto'));
      wrap.querySelectorAll('.q-btn').forEach((b) => b.classList.toggle('selected', b.dataset.q === saved));
    };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('.q-btn');
      if (!b) return;
      const choice = b.dataset.q;
      this._qualityChoice = choice;
      saveQualityChoice(choice);
      const name = choice === 'auto' ? auto : choice;
      const reload = this.quality.apply(name);
      this.governor?.rebase(name);
      this.quality.source = choice === 'auto' ? 'auto' : 'saved';
      sync();
      gfxToast(`Graphics: ${PRESETS[name].label}` + (reload.length ? ` · ${reload.join(' & ')} after reload` : ''), 2600);
    });
    sync();
  }

  _bindCharSelect() {
    const cards = document.querySelectorAll('.char-card');
    const sync = (id) => {
      const chosen = setStoredChar(id);
      cards.forEach((c) => {
        const on = c.dataset.char === chosen;
        c.classList.toggle('selected', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      this.player.setCharacter(chosen);
    };
    const stored = getStoredChar();
    sync(stored);
    cards.forEach((c) => {
      c.addEventListener('click', () => sync(c.dataset.char));
    });
    document.getElementById('btn-change-char')?.addEventListener('click', () => {
      document.getElementById('char-select')?.classList.remove('picked');
      cards.forEach((c) => c.classList.remove('hidden'));
    });
  }

  async beginPlay() {
    try {
      await this.player.setCharacter(getStoredChar());
      await this.player.whenReady();
    } catch (_) {}
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
    safePointerLock(this.canvas);
    this.hud.toast('belizetriniOPNWRLD — Caribbean day cycle');
  }

  setPaused(p) {
    this.paused = p;
    document.getElementById('pause-overlay')?.classList.toggle('hidden', !p);
    if (p) document.exitPointerLock?.();
  }

  /** good-1+7: `wanted` is the star count of the WantedSystem (0-5); setting it sets an exact level. */
  get wanted() { return this.wantedSys ? this.wantedSys.stars : (this._wanted || 0); }
  set wanted(v) { if (this.wantedSys) this.wantedSys.setStars(v); else this._wanted = v; }

  addWanted(n, why = 'mission') {
    if (this.wantedSys) this.wantedSys.addHeat(n, why);
    else { this._wanted = Math.min(5, (this._wanted || 0) + n); this.hud.setWanted(this._wanted); }
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
      this.hud.toast(vehicleLabel(near.type));
      // good-1+7: car theft is a crime; full heat when a cop is within 35 m, half otherwise.
      // (Mission 1's scooter is the mission's own vehicle and its heat comes from the mission.)
      if (!(this.missions.currentId === 1 && near.type === 'scooter') && this._crimeCooldown <= 0) {
        this.wantedSys.crime('carTheft');
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

  _startLoop() {
    if (this._raf) return;
    this.clock.getDelta(); // drop the time spent paused/lost
    this._frames = 0;
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _onContextRestored() {
    // three's own restore handler (registered first) rebuilt its GL state, programs, buffers and
    // texture bookkeeping; re-apply everything that lives in GL state or must be re-uploaded.
    const r = this.renderer;
    this._onResize();
    if (this.scene.background?.isColor) r.setClearColor(this.scene.background, 1);
    this.scene.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        m.needsUpdate = true;
        for (const k of ['map', 'gradientMap', 'emissiveMap', 'normalMap', 'alphaMap']) if (m[k]) m[k].needsUpdate = true;
      }
    });
    this.world?.dayNight?.update?.(0);
    this._startLoop();
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    if (this.gfx?.context?.lost) return;
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    this.governor?.update(rawDt);

    // Day/night advances on title + in play (pause freezes gameplay but clock still ticks unless T)
    if (this.world?.dayNight) {
      const clockDt = (this.running && this.paused) ? 0 : dt;
      this.world.dayNight.update(clockDt);
      // Keep clear color locked to TOD bg (do not rely only on scene.background)
      if (this.scene.background?.isColor) {
        this.renderer.setClearColor(this.scene.background, 1);
      }
      this.hud?.setClock?.(
        this.world.dayNight.clockString(),
        this.world.dayNight.phaseIcon()
      );
    }

    if (this.running && !this.paused) {
      this._update(dt);
    } else if (!this.running) {
      const t = performance.now() * 0.00015;
      const s = this.world.markers.spawn;
      this.player.camera.position.set(s.x + Math.sin(t) * 42, 16, s.z + Math.cos(t) * 42);
      this.player.camera.lookAt(s.x, 2, s.z);
    }

    this.quality?.update(dt);
    if (this.blobs?.enabled) this._updateBlobs();
    this.debugOverlay?.update(dt);
    updateToon(this.player.camera, dt);
    this.renderer.render(this.scene, this.player.camera);
    // After the first frames (and after a restore) every program has been compiled: swap any that
    // failed on this GPU for a plain stand-in instead of leaving holes / a blank frame.
    if (++this._frames === 2 || this._shaderFailed) {
      this._shaderFailed = false;
      const n = healShaderFailures(this.renderer, this.scene);
      if (n) { this.gfx.healed += n; gfxToast(`Simplified ${n} effect${n > 1 ? 's' : ''} for this GPU`); }
    }
  }

  /** good-1+5: one blob per character / vehicle (pooled caster records, no per-frame allocation). */
  _updateBlobs() {
    const out = this._blobCasters;
    let n = 0;
    const put = (x, y, z, yaw, sz, fade = 1) => {
      const c = out[n] || (out[n] = {});
      c.x = x; c.y = y; c.z = z; c.yaw = yaw; c.w = sz[0]; c.l = sz[1]; c.fade = fade; n++;
    };
    const p = this.player;
    if (!p.inVehicle && p.mesh) put(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 0, BLOB_SIZE.person);
    for (const v of this.vehicles) {
      if (!v.mesh?.visible) continue;
      put(v.mesh.position.x, v.mesh.position.y, v.mesh.position.z, v.yaw ?? v.mesh.rotation.y, BLOB_SIZE[v.type] || BLOB_SIZE.sedan);
    }
    for (const c of [...this.cops, ...(this.wantedSys?.units || [])]) {
      if (!c.alive || !c.mesh?.visible || c.kind === 'spikes' || c.kind === 'roadblock') continue;
      put(c.mesh.position.x, c.mesh.position.y, c.mesh.position.z, c.yaw, c.onFoot ? BLOB_SIZE.person : (c.isHeli ? BLOB_SIZE.heli : BLOB_SIZE.cop));
    }
    for (const npc of this.missions?.npcs?.() || []) {
      if (npc?.mesh?.visible && npc.mesh.parent) put(npc.mesh.position.x, npc.mesh.position.y, npc.mesh.position.z, 0, BLOB_SIZE.person, npc.alive ? 1 : 0.6);
    }
    this.blobs.update(out, n);
  }

  _update(dt) {
    this._crimeCooldown = Math.max(0, this._crimeCooldown - dt);

    this.player.update(dt);
    this.missions.update(dt);

    for (const v of this.vehicles) {
      if (!v.occupied) v.park();
    }

    const pos = this.player.position;
    this.district = districtAt(pos.x);
    this.hud.setDistrict(this.district);

    // Ambient patrols keep patrolling (and witness crimes); pursuit is the WantedSystem's units.
    for (const cop of this.cops) cop.update(dt, pos, 0);
    const dmg = this.wantedSys.update(dt);
    if (dmg > 0) {
      this.player.takeDamage(dmg);
      this.hud.setHealth(this.player.health);
      if (this.player.health <= 0) this._respawn();
    }

    const m = this.missions.current;
    const blipPos = m ? this.world.markers[m.blip] : null;
    this.hud.drawMinimap(
      pos,
      this.player.inVehicle ? this.player.vehicle.yaw : this.player.yaw,
      [...this.cops, ...this.wantedSys.units.filter((u) => u.kind !== 'spikes')],
      blipPos,
      this.player.inVehicle,
      this.world.roads
    );

    if (!this.player.inVehicle) {
      const near = nearestVehicle(this.vehicles, pos, 4.5);
      if (near) {
        const mid = m?.id;
        if (!(mid === 1 && near.type === 'scooter') && ![2, 3, 4, 5, 6].includes(mid)) {
          this.hud.showPrompt(`Press F — ${vehicleLabel(near.type)}`);
        }
      }
    } else {
      const exitHint = this.player.vehicle?.isAir
        ? 'Press F — exit (lands you)'
        : 'Press F — exit';
      this.hud.showPrompt(exitHint);
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
  }
}

let game = null;
try {
  game = new Game();
} catch (err) {
  // Renderer failures already painted their own reason (gfx.js). Anything else during boot used to
  // surface as a dead screen; say what broke instead.
  if (!err?.gfxHandled) {
    import('./gfx.js').then(({ showGfxError }) =>
      showGfxError('The game failed to start.', String(err?.message || err).slice(0, 240)));
  }
  (err?.gfxHandled ? console.warn : console.error)('[game] boot failed:', err?.message || err);
}
window.__BELIZETRINI_OPNWRLD__ = game;
