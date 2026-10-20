import * as THREE from 'three';
import { NPC } from './ai.js';

/**
 * belizetriniOPNWRLD — data-driven mission template (good-1+9). Fiction arcade missions; short staging,
 * no real-crime how-tos, non-graphic "soft hits".
 *
 * A mission is { id, name, brief, reward, setup?, stages: [...] }. Stage types:
 *   goto      reach `marker` within `radius` (optionally `interact`: press F there)
 *   pickup    `item` at `marker` (press F), or `vehicle`: get into a vehicle of that type
 *   deliver   bring `item` to `marker` (press F); fails if the item is gone
 *   chase     an NPC flees from the player; catch it (F within `catchRadius`); fails past `escapeRadius`
 *   takedown  soft-hit a stationary NPC at `marker` (F)
 *   survive   stay alive for `seconds` with at least `stars` wanted
 *   escape    lose the heat (wanted → 0); `minStars` is (re)applied on entry so a retry is meaningful
 * Common stage fields: text (objective), timer (s, fail when it runs out), checkpoint (save on entry),
 * onDone ({ heat, why } | { clearWanted }). Fail conditions: timer, wasted, target escaped, item lost.
 *
 * Checkpoints + progress persist in localStorage['bto.progress.v1']: completed missions, cash, the
 * current mission/stage, the last checkpoint (stage, position, items) and best times. Retry from the
 * checkpoint (or restart the mission) from the fail screen; a mission-complete screen shows the reward.
 */
export const MISSIONS = [
  {
    id: 1, name: 'Scooter Snatch', reward: 200,
    brief: 'Grab the orange scooter at Belikin docks. Hop on (F) near the pier.',
    stages: [
      { type: 'goto', marker: 'belikinDocks', radius: 10, text: 'Get down to Belikin docks.', checkpoint: true },
      { type: 'pickup', marker: 'belikinDocks', vehicle: 'scooter', text: 'Hop on the orange scooter (F).', onDone: { heat: 1, why: 'carTheft' } },
      { type: 'escape', minStars: 1, timer: 90, text: 'Lose the heat on the scooter.', checkpoint: true },
    ],
  },
  {
    id: 2, name: 'Queen Street Pickup', reward: 350,
    brief: 'Drive or walk to Queen Street market. Press F for the fiction package.',
    stages: [
      { type: 'goto', marker: 'queenMarket', radius: 9, text: 'Head to Queen Street market.', checkpoint: true },
      { type: 'pickup', marker: 'queenMarket', radius: 6, item: 'package', text: 'Press F — pick up the package.' },
    ],
  },
  {
    id: 3, name: 'Creek Drop', reward: 500, setup: { items: { package: true } },
    brief: 'Drop the package at the Haulover Creek boat (F).',
    stages: [
      { type: 'deliver', marker: 'hauloverBoat', radius: 7, item: 'package', timer: 120, text: 'Deliver the package to the creek boat (F).', checkpoint: true, onDone: { heat: 1, why: 'mission' } },
      { type: 'escape', minStars: 1, timer: 90, text: 'Lose the heat.' },
    ],
  },
  {
    id: 4, name: 'Rival Intercept', reward: 700,
    brief: 'Find the rival courier in Port of Spain downtown. Press F to intercept.',
    stages: [
      { type: 'goto', marker: 'posDowntown', radius: 16, text: 'Head to Port of Spain downtown.', checkpoint: true },
      { type: 'chase', npc: 'rival', marker: 'posDowntown', offset: [3, 2], color: 0xe63946, speed: 4.4, catchRadius: 2.8, escapeRadius: 70, timer: 60, text: 'The courier bolts — catch him and press F.', onDone: { heat: 2, why: 'softHit' } },
      { type: 'escape', minStars: 2, timer: 120, text: 'Lose the heat.', checkpoint: true },
    ],
  },
  {
    id: 5, name: 'Warehouse Soft Hit', reward: 900,
    brief: 'Reach the waterfront warehouse. Soft-hit the guard with F (arcade).',
    stages: [
      { type: 'goto', marker: 'warehouse', radius: 12, text: 'Reach the waterfront warehouse.', checkpoint: true },
      { type: 'takedown', npc: 'guard', marker: 'warehouse', offset: [2, 1], color: 0x457b9d, radius: 5.5, text: 'Soft-hit the guard (F).', onDone: { heat: 2, why: 'softHit' } },
      { type: 'escape', minStars: 2, timer: 120, text: 'Lose the heat.', checkpoint: true },
    ],
  },
  {
    id: 6, name: 'Safehouse Run', reward: 1500,
    brief: 'Heat is on — race to the hillside safehouse and press F.',
    stages: [
      { type: 'survive', stars: 3, seconds: 20, text: 'Heat is on — stay alive for 20 s.', checkpoint: true },
      { type: 'goto', marker: 'safehouse', radius: 8, interact: true, timer: 120, text: 'Race to the hillside safehouse and press F.', onDone: { clearWanted: true } },
    ],
  },
];
export const STAGE_TYPES = ['goto', 'pickup', 'deliver', 'chase', 'takedown', 'survive', 'escape'];
const LS_KEY = 'bto.progress.v1';

export function loadProgress() {
  try { const p = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (p && p.v === 1) return p; } catch (_) {}
  return null;
}
export function clearProgress() { try { localStorage.removeItem(LS_KEY); } catch (_) {} }

export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.currentId = 0;
    this.stageIndex = 0;
    this.state = 'idle'; // idle | active | failed | complete | story
    this.completed = new Set();
    this.items = {};
    this.npc = null;
    this.elapsed = 0; // in the current stage
    this.missionT = 0;
    this.checkpoint = null;
    this.best = {};
    this.log = [];
    this._promptShown = false;
    this._completeT = 0;
    if (/[?&]fresh=1\b/.test(window.location.search)) clearProgress();
    this._bindUI();
  }

  get current() { return MISSIONS.find((m) => m.id === this.currentId) || null; }
  get stage() { return this.current?.stages[this.stageIndex] || null; }
  npcs() { return [this.npc]; }
  /** Back-compat: blip key of the current stage marker. */
  get blipKey() { return this.stage?.marker || null; }

  /** World position for the minimap blip (the NPC during chase / takedown). */
  blipPos() {
    const s = this.stage;
    if (!s || this.state !== 'active') return null;
    if ((s.type === 'chase' || s.type === 'takedown') && this.npc?.alive) return this.npc.mesh.position;
    return s.marker ? this.game.world.markers[s.marker] : null;
  }

  // ─── lifecycle ──────────────────────────────────────────────────────────────
  /** Resume saved progress (beginPlay). Returns true when something was resumed. */
  resume() {
    const p = loadProgress();
    if (!p) { this.start(1); return false; }
    this.completed = new Set(p.completed || []);
    this.best = p.best || {};
    if (typeof p.cash === 'number') { this.game.cash = p.cash; this.game.hud?.setCash(p.cash); }
    if (!p.current) { this._storyComplete(false); return true; }
    const cp = p.checkpoint && p.checkpoint.id === p.current.id ? p.checkpoint : null;
    this.start(p.current.id, { fromCheckpoint: cp });
    this.game.hud?.toast(`Progress restored — Mission ${p.current.id}`);
    return true;
  }

  /** Start mission `id` from its first stage (agent start_mission / set_mission), or from a checkpoint. */
  start(id = 1, opts = {}) {
    const m = MISSIONS.find((x) => x.id === id);
    if (!m) return;
    this._hideOverlays();
    this._clearNpc();
    this.currentId = id;
    this.state = 'active';
    this.missionT = 0;
    this.items = { ...(m.setup?.items || {}) };
    this.checkpoint = null;
    let idx = 0;
    const cp = opts.fromCheckpoint;
    if (cp) {
      idx = cp.stage; this.items = { ...cp.items }; this.checkpoint = cp; this.missionT = cp.missionT || 0;
      if (cp.pos) this._teleport(cp.pos[0], cp.pos[1]);
    }
    this._event('start', { id, stage: idx, fromCheckpoint: !!cp });
    this.game.hud?.toast(`Mission ${id}: ${m.name}`);
    this._enterStage(idx, { retry: !!cp });
  }

  setMission(id) { this.start(Math.max(1, Math.min(MISSIONS.length, id))); }

  /** Retry from the last checkpoint of the current mission (or restart it when there is none). */
  retry() {
    const m = this.current;
    if (!m) return;
    this.game.wanted = 0; // leftover heat from the failed attempt; stages re-apply what they need
    if (this.checkpoint && this.checkpoint.id === m.id) this.start(m.id, { fromCheckpoint: this.checkpoint });
    else this.start(m.id);
    this._event('retry', { id: m.id, stage: this.stageIndex });
  }

  clear() { this._clearNpc(); this.state = 'idle'; this.currentId = 0; this._updateBlips(); }

  _enterStage(i, { retry = false } = {}) {
    const g = this.game, m = this.current;
    this.stageIndex = i;
    this.elapsed = 0;
    const s = this.stage;
    this._clearNpc();
    if (s.npc) {
      const base = g.world.markers[s.marker];
      const off = s.offset || [0, 0];
      this.npc = new NPC(g.scene, base.clone().add(new THREE.Vector3(off[0], 0, off[1])), s.color ?? 0x888888);
      this.npc.kind = s.npc;
    }
    if (s.type === 'survive' && g.wanted < s.stars) g.wanted = s.stars;
    if (s.type === 'escape' && s.minStars && g.wanted < s.minStars) g.wanted = s.minStars;
    if (s.checkpoint) {
      const p = g.player.position;
      this.checkpoint = { id: m.id, stage: i, pos: [+p.x.toFixed(2), +p.z.toFixed(2)], items: { ...this.items }, missionT: this.missionT };
      if (!retry) g.hud?.toast('Checkpoint', 1200);
    }
    this._event('stage', { id: m.id, stage: i, type: s.type, retry });
    this._hud();
    this._updateBlips();
    this._save();
  }

  _stageDone() {
    const g = this.game, s = this.stage;
    if (s.onDone?.heat) g.addWanted(s.onDone.heat, s.onDone.why || 'mission');
    if (s.onDone?.clearWanted) g.wanted = 0;
    this._event('stageDone', { id: this.currentId, stage: this.stageIndex, type: s.type, t: +this.elapsed.toFixed(2) });
    if (this.stageIndex + 1 < this.current.stages.length) this._enterStage(this.stageIndex + 1);
    else this._complete();
  }

  fail(reason) {
    if (this.state !== 'active') return;
    this.state = 'failed';
    this._clearNpc();
    this._event('fail', { id: this.currentId, stage: this.stageIndex, reason });
    this._updateBlips();
    this._showFail(reason);
    this.game.audio?.sting('fail');
  }

  /** Called by the game when the player is wasted. */
  onWasted() { if (this.state === 'active') this.fail('Wasted'); }

  _complete() {
    const g = this.game, m = this.current;
    this.state = 'complete';
    const first = !this.completed.has(m.id);
    this.completed.add(m.id);
    const t = +this.missionT.toFixed(1);
    if (!this.best[m.id] || t < this.best[m.id]) this.best[m.id] = t;
    if (first) { g.cash += m.reward; g.hud?.setCash(g.cash); }
    this._clearNpc();
    this.checkpoint = null;
    this._event('complete', { id: m.id, t, reward: first ? m.reward : 0 });
    const next = MISSIONS.find((x) => x.id === m.id + 1);
    this._nextId = next ? next.id : null;
    this._save(next ? { id: next.id, stage: 0 } : null);
    this._updateBlips();
    this._showComplete(m, first ? m.reward : 0, t);
    g.audio?.sting('complete');
    this._completeT = 3.5;
  }

  _advanceAfterComplete() {
    this._hideOverlays();
    if (this._nextId) this.start(this._nextId);
    else this._storyComplete(true);
  }

  _storyComplete(announce) {
    this.state = 'story';
    this.currentId = 0;
    this._clearNpc();
    this.game.hud?.setMission({ name: 'Story Complete', brief: 'Fiction run finished. Free roam Belize ↔ Port of Spain.' });
    this.game.hud?.setMissionTimer?.(null);
    this._updateBlips();
    if (announce) this.game.hud?.toast('Story complete');
    this._save(null);
  }

  // ─── per frame ──────────────────────────────────────────────────────────────
  update(dt) {
    const g = this.game;
    if (this.npc && !this.npc.alive) { if (this.npc.update(dt)) this.npc = null; }
    if (this.state === 'complete') {
      this._completeT -= dt;
      if (this._completeT <= 0) this._advanceAfterComplete();
      return;
    }
    if (this.state !== 'active') return;
    const s = this.stage;
    if (!s) return;
    this.elapsed += dt;
    this.missionT += dt;
    const pos = g.player.position;
    const target = s.marker ? g.world.markers[s.marker] : null;
    const dist = target ? Math.hypot(pos.x - target.x, pos.z - target.z) : Infinity;
    const blip = s.marker ? g.world.blips[s.marker] : null;
    if (blip) blip.scale.setScalar(1 + Math.sin(performance.now() * 0.005) * 0.15);
    this._promptShown = false;
    const prompt = (t) => { g.hud?.showPrompt(t); this._promptShown = true; };

    if (s.timer && this.elapsed >= s.timer) { this.fail('Out of time'); return; }
    switch (s.type) {
      case 'goto':
        if (dist < s.radius) { if (s.interact) prompt('Press F — ' + (s.prompt || 'here')); else this._stageDone(); }
        break;
      case 'pickup':
        if (s.vehicle) {
          if (g.player.inVehicle && g.player.vehicle?.type === s.vehicle) this._stageDone();
          else if (!g.player.inVehicle && dist < 7) prompt(`Press F — ${s.vehicle}`);
        } else if (dist < s.radius) prompt(`Press F — pick up ${s.item}`);
        break;
      case 'deliver':
        if (!this.items[s.item]) { this.fail(`No ${s.item}`); return; }
        if (dist < s.radius) prompt(`Press F — deliver ${s.item}`);
        break;
      case 'chase': {
        const n = this.npc;
        if (!n) break;
        const d = Math.hypot(pos.x - n.mesh.position.x, pos.z - n.mesh.position.z);
        if (n.alive) {
          // Flee from the player when close; jog around the marker otherwise.
          const np = n.mesh.position;
          if (d < 28) {
            const ax = np.x - pos.x, az = np.z - pos.z, al = Math.hypot(ax, az) || 1;
            const spd = (s.speed || 4.4) * (g.player.inVehicle ? 1.25 : 1);
            np.x += (ax / al) * spd * dt; np.z += (az / al) * spd * dt;
            g.world.resolveCollision?.(np, 0.4);
            n.mesh.rotation.y = Math.atan2(ax, az);
          }
          if (d > s.escapeRadius && this.elapsed > 2) { this.fail('The courier got away'); return; }
          if (d < s.catchRadius + 1) prompt('Press F — intercept courier');
        }
        break;
      }
      case 'takedown':
        if (this.npc?.alive && Math.hypot(pos.x - this.npc.mesh.position.x, pos.z - this.npc.mesh.position.z) < s.radius) prompt('Press F — soft hit');
        break;
      case 'survive':
        if (this.elapsed >= s.seconds) this._stageDone();
        break;
      case 'escape':
        if (this.elapsed > 0.5 && g.wanted === 0) this._stageDone();
        break;
    }
    this._hudTimer();
  }

  /** F pressed. Returns true when the mission consumed it. */
  tryInteract() {
    if (this.state !== 'active') return false;
    const g = this.game, s = this.stage;
    if (!s) return false;
    const pos = g.player.position;
    const target = s.marker ? g.world.markers[s.marker] : null;
    const dist = target ? Math.hypot(pos.x - target.x, pos.z - target.z) : Infinity;
    if (s.type === 'goto' && s.interact && dist < s.radius + 0.5) { this._stageDone(); return true; }
    if (s.type === 'pickup' && s.item && dist < s.radius) { this.items[s.item] = true; g.hud?.toast(`${s.item} acquired`); this._stageDone(); return true; }
    if (s.type === 'deliver' && this.items[s.item] && dist < s.radius) { delete this.items[s.item]; g.hud?.toast(`${s.item} delivered`); this._stageDone(); return true; }
    if ((s.type === 'chase' || s.type === 'takedown') && this.npc?.alive) {
      const r = s.type === 'chase' ? s.catchRadius + 1 : s.radius;
      if (Math.hypot(pos.x - this.npc.mesh.position.x, pos.z - this.npc.mesh.position.z) < r) {
        this.npc.softHit();
        g.hud?.toast(s.type === 'chase' ? 'Courier intercepted!' : 'Guard down — move!');
        this._stageDone();
        return true;
      }
    }
    return false;
  }

  /** Test / agent hook: fast-forward the current stage clock (survive / timers). */
  debugAdvance(sec) { if (this.state === 'active') { this.elapsed += sec; this.missionT += sec; } }

  // ─── helpers ────────────────────────────────────────────────────────────────
  _teleport(x, z) {
    const p = this.game.player;
    if (p.inVehicle) p.exitVehicle();
    p.mesh.position.set(x, 0, z);
  }

  _clearNpc() {
    if (this.npc?.mesh) this.game.scene.remove(this.npc.mesh);
    this.npc = null;
  }

  _updateBlips() {
    const blips = this.game.world.blips;
    for (const key of Object.keys(blips)) blips[key].visible = false;
    const s = this.stage;
    if (this.state === 'active' && s?.marker && blips[s.marker] && s.type !== 'survive' && s.type !== 'escape') blips[s.marker].visible = true;
  }

  _hud() {
    const m = this.current, s = this.stage;
    if (!m || !s) return;
    this.game.hud?.setMission({ name: `${m.name} · ${this.stageIndex + 1}/${m.stages.length}`, brief: s.text });
    this._hudTimer(true);
  }

  _hudTimer(force) {
    const s = this.stage;
    const hud = this.game.hud;
    if (!hud?.setMissionTimer) return;
    let left = null;
    if (this.state === 'active' && s) {
      if (s.timer) left = Math.max(0, s.timer - this.elapsed);
      else if (s.type === 'survive') left = Math.max(0, s.seconds - this.elapsed);
    }
    const key = left == null ? null : Math.ceil(left);
    if (force || key !== this._lastTimerKey) { this._lastTimerKey = key; hud.setMissionTimer(left, s?.type === 'survive'); }
  }

  _save(current) {
    const p = {
      v: 1,
      completed: [...this.completed].sort((a, b) => a - b),
      cash: this.game.cash,
      current: current !== undefined ? current : (this.currentId ? { id: this.currentId, stage: this.stageIndex } : null),
      checkpoint: this.checkpoint,
      best: this.best,
      updated: Date.now(),
    };
    try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (_) {}
    return p;
  }

  _event(kind, data) {
    this.log.push({ t: +performance.now().toFixed(0), kind, ...data });
    if (this.log.length > 200) this.log.shift();
  }

  // ─── fail / complete screens ────────────────────────────────────────────────
  _bindUI() {
    this.failEl = document.getElementById('mission-fail');
    this.doneEl = document.getElementById('mission-complete');
    document.getElementById('btn-retry-cp')?.addEventListener('click', () => this.retry());
    document.getElementById('btn-retry-start')?.addEventListener('click', () => { const id = this.currentId; if (id) { this.game.wanted = 0; this.start(id); } });
    document.getElementById('btn-continue')?.addEventListener('click', () => { if (this.state === 'complete') this._advanceAfterComplete(); });
  }

  _showFail(reason) {
    if (!this.failEl) return;
    this.failEl.querySelector('.mf-reason').textContent = reason;
    this.failEl.querySelector('.mf-name').textContent = this.current?.name || '';
    const cpBtn = document.getElementById('btn-retry-cp');
    if (cpBtn) cpBtn.textContent = this.checkpoint ? `Retry from checkpoint (stage ${this.checkpoint.stage + 1})` : 'Retry mission';
    this.failEl.classList.remove('hidden');
    this.game.hud?.setMissionTimer?.(null);
  }

  _showComplete(m, reward, t) {
    if (!this.doneEl) return;
    this.doneEl.querySelector('.mc-name').textContent = m.name;
    this.doneEl.querySelector('.mc-reward').textContent = reward ? `+$${reward.toLocaleString()}` : 'Replay — no reward';
    const mm = Math.floor(t / 60), ss = String(Math.floor(t % 60)).padStart(2, '0');
    this.doneEl.querySelector('.mc-time').textContent = `Time ${mm}:${ss}` + (this.best[m.id] ? ` · best ${Math.floor(this.best[m.id] / 60)}:${String(Math.floor(this.best[m.id] % 60)).padStart(2, '0')}` : '');
    this.doneEl.querySelector('.mc-progress').textContent = `${this.completed.size} / ${MISSIONS.length} missions`;
    this.doneEl.classList.remove('hidden');
    this.game.hud?.setMissionTimer?.(null);
  }

  _hideOverlays() {
    this.failEl?.classList.add('hidden');
    this.doneEl?.classList.add('hidden');
  }

  state_() {
    return { id: this.currentId, name: this.current?.name || null, stage: this.stageIndex, stageType: this.stage?.type || null,
      state: this.state, elapsed: +this.elapsed.toFixed(1), checkpoint: this.checkpoint ? this.checkpoint.stage : null,
      completed: [...this.completed], items: Object.keys(this.items) };
  }
}
