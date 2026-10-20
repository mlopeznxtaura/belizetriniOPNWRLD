// good-1+7 wanted-level test (iPhone emulation, low preset by default).
// Usage: node tools/wanted-test.js [--engine chromium|webkit] [--query '?quality=low'] [--out docs/fidelity/good-1+7]
// 1. per star 1..5: set via the agent action, count spawned units per kind, read HUD stars
// 2. crimes: car theft near a cop, ramming a cop, a mission soft-hit
// 3. escape/decay timing with frozen units: in search radius vs outside it (x2), HUD flashing
// 4. frame ms at 0 vs 5 stars (median of 15 GPU-synced renders) + rAF fps
const { chromium, webkit } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const ENGINE = opt('engine', 'chromium');
const OUT = path.resolve(ROOT, opt('out', 'docs/fidelity/good-1+7'));
const Q = opt('query', '?quality=low');
const PUB = path.join(ROOT, 'public');
const PORT = 8820 + (ENGINE === 'webkit' ? 1 : 0);
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"actions":[]}'); }
    const file = path.join(PUB, u);
    if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = ENGINE === 'webkit' ? await webkit.launch({ headless: true })
    : await chromium.launch({ executablePath: process.env.CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, userAgent: IOS_UA, ...(ENGINE !== 'webkit' ? { isMobile: true } : {}) });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  await page.goto(`http://127.0.0.1:${PORT}/${Q}${Q.includes('?') ? '&' : '?'}gov=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.wantedSys, { timeout: 90000 });
  await page.evaluate(() => window.__BELIZETRINI_OPNWRLD__.beginPlay());
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.player?.model, { timeout: 90000 }).catch(() => {});
  await sleep(1500);
  const R = { engine: ENGINE, query: Q };
  const ev = (fn, a) => page.evaluate(fn, a);
  const hud = () => ev(() => ({ on: document.querySelectorAll('#wanted .star.on').length, flashing: document.querySelectorAll('#wanted .star.on.flash').length > 0 }));
  // Setup: open crossroads on Queen St, ambient patrols parked far away (no stray witnesses), mission 1 off.
  await ev(() => {
    const g = window.__BELIZETRINI_OPNWRLD__;
    g.player.health = 1e9; g.player.takeDamage = function () {}; // keep the test alive
    g.missions.currentId = 0;
    for (const c of g.cops) c.mesh.position.set(9000 + Math.random() * 10, 0, 9000);
    g.drive.apply({ action: 'teleport', x: -60, z: 0 });
    g.world.dayNight.setHour(12); g.world.dayNight.pause(true);
  });
  // 1. Per-star unit counts.
  R.perStar = [];
  for (let s = 1; s <= 5; s++) {
    await ev((s) => window.__BELIZETRINI_OPNWRLD__.drive.apply({ action: 'set_wanted', stars: s }), s);
    await sleep(ENGINE === 'webkit' ? 5000 : 6000);
    const st = await ev(() => { const w = window.__BELIZETRINI_OPNWRLD__.wantedSys; return { ...w.state(), gameWanted: window.__BELIZETRINI_OPNWRLD__.wanted }; });
    const h = await hud();
    R.perStar.push({ set: s, stars: st.stars, gameWanted: st.gameWanted, byKind: st.byKind, units: st.units, hudStars: h.on, seen: st.seen });
    console.log('star', s, JSON.stringify(R.perStar.at(-1)));
    if (s === 3 || s === 5) {
      await ev(() => { const g = window.__BELIZETRINI_OPNWRLD__; const rb = g.wantedSys.units.find((u) => u.kind === 'roadblock') || g.wantedSys.units.find((u) => u.kind === 'car'); window.__rbPos = rb ? [rb.mesh.position.x, rb.mesh.position.z] : null; });
    }
    if (s >= 3) await page.screenshot({ path: path.join(OUT, `${ENGINE}_star${s}.png`) });
  }
  // Frame ms at 5 stars vs 0 (median of 15 GPU-synced renders) + real rAF fps.
  const perf = () => ev(async () => {
    const g = window.__BELIZETRINI_OPNWRLD__; const r = g.renderer; const gl = r.getContext(); const px = new Uint8Array(4);
    const t = []; for (let i = 0; i < 15; i++) { const t0 = performance.now(); r.render(g.scene, g.player.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b);
    let n = 0; const t0 = performance.now(); await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return { renderMs: +t[7].toFixed(1), rafFps: +(n / ((performance.now() - t0) / 1000)).toFixed(1), calls: r.info.render.calls, units: g.wantedSys.units.length, stars: g.wantedSys.stars };
  });
  R.perf5 = await perf();
  console.log('perf5', JSON.stringify(R.perf5));
  // Heli spotlight close-up (4-5 stars).
  await ev(() => { const g = window.__BELIZETRINI_OPNWRLD__; const h = g.wantedSys.units.find((u) => u.kind === 'heli'); window.__heli = !!h; });
  await page.screenshot({ path: path.join(OUT, `${ENGINE}_star5_b.png`) });
  // Agent clear.
  await ev(() => window.__BELIZETRINI_OPNWRLD__.drive.apply({ action: 'clear_wanted' }));
  await sleep(800);
  R.afterClear = await ev(() => window.__BELIZETRINI_OPNWRLD__.wantedSys.state());
  R.afterClear.hud = (await hud()).on;
  R.perf0 = await perf();
  console.log('clear', JSON.stringify(R.afterClear), 'perf0', JSON.stringify(R.perf0));

  // 2. Crimes.
  R.crimes = {};
  R.crimes.carTheftWitnessed = await ev(() => {
    const g = window.__BELIZETRINI_OPNWRLD__; const w = g.wantedSys;
    w.setStars(0); w._crimeCool = {}; g._crimeCooldown = 0;
    const v = g.vehicles.find((x) => x.type === 'sedan' && !x.occupied);
    g.player.mesh.position.set(v.mesh.position.x + 2, 0, v.mesh.position.z);
    g.cops[0].mesh.position.set(v.mesh.position.x + 10, 0, v.mesh.position.z + 4);
    g._onInteract();
    const r = { inVehicle: g.player.inVehicle, heat: w.heat, stars: w.stars };
    g.player.exitVehicle(); g.cops[0].mesh.position.set(9000, 0, 9000);
    return r;
  });
  R.crimes.carTheftUnwitnessed = await ev(() => {
    const g = window.__BELIZETRINI_OPNWRLD__; const w = g.wantedSys;
    w.setStars(0); w._crimeCool = {}; g._crimeCooldown = 0;
    const v = g.vehicles.find((x) => x.type === 'sedan' && !x.occupied);
    g.player.mesh.position.set(v.mesh.position.x + 2, 0, v.mesh.position.z);
    g._onInteract();
    const r = { inVehicle: g.player.inVehicle, heat: w.heat, stars: w.stars };
    g.player.exitVehicle();
    return r;
  });
  R.crimes.ramCop = await ev(async () => {
    const g = window.__BELIZETRINI_OPNWRLD__; const w = g.wantedSys;
    w.setStars(0); w._crimeCool = {}; g._crimeCooldown = 0;
    const v = g.vehicles.find((x) => x.type === 'sedan' && !x.occupied);
    g.player.mesh.position.set(v.mesh.position.x + 2, 0, v.mesh.position.z);
    g.player.enterVehicle(v);
    g.cops[1].mesh.position.set(v.mesh.position.x + 1.5, 0, v.mesh.position.z);
    v.speed = 12; v.velocity.set(0, 0, -12);
    w.update(0.016);
    const r = { heat: w.heat, stars: w.stars, log: w.log.slice(-2) };
    g.player.exitVehicle(); g.cops[1].mesh.position.set(9000, 0, 9000);
    return r;
  });
  R.crimes.softHitMission5 = await ev(() => {
    const g = window.__BELIZETRINI_OPNWRLD__; const w = g.wantedSys;
    w.setStars(0); w._crimeCool = {}; g._crimeCooldown = 0;
    g.missions.start(5);
    const npc = g.missions.npcs().find((n) => n && n.alive);
    if (npc) g.player.mesh.position.set(npc.mesh.position.x + 1, 0, npc.mesh.position.z);
    const before = w.heat;
    // ported missions may first need the goto stage done; the takedown is the interact
    for (let i = 0; i < 3 && w.heat === before; i++) { g.missions.update?.(0.016); g.missions.tryInteract(); }
    const r = { before, heat: w.heat, stars: w.stars };
    g.missions.currentId = 0; g.missions.clear?.();
    return r;
  });
  console.log('crimes', JSON.stringify(R.crimes));

  // 3. Escape / decay timing with frozen units.
  const decay = async (label, setup) => {
    await ev((setup) => {
      const g = window.__BELIZETRINI_OPNWRLD__; const w = g.wantedSys;
      w.setStars(0); g.drive.apply({ action: 'teleport', x: -60, z: 0 });
      w.setStars(2);
      for (const c of g.cops) c.alive = false; // ambient patrols wander (and clamp to the map edge): keep them out of this timing test
      w.freezeUnits = true; // test hook: units hold still, no new spawns; sight/decay still run
      // Player behind a building block, out of every unit's sight.
      if (setup === 'inRadius') g.player.mesh.position.set(-72, 0, -20);
      else g.player.mesh.position.set(160, 0, 30); // across the causeway, outside the 60 m search radius
      w.lkp.set(-60, 0, 0);
      for (const u of w.units) if (u.mesh) u.mesh.position.set(u.mesh.position.x + 400, u.mesh.position.y, u.mesh.position.z + 400);
      window.__decay = { t0: performance.now(), marks: [] };
    }, setup);
    const marks = []; let flashSeen = false; let gt0 = null; const trace = [];
    const t0 = Date.now();
    let last = 2;
    while (Date.now() - t0 < 50000) {
      const s = await ev(() => ({ ...window.__BELIZETRINI_OPNWRLD__.wantedSys.state(), gt: window.__BELIZETRINI_OPNWRLD__.wantedSys.t, running: window.__BELIZETRINI_OPNWRLD__.running && !window.__BELIZETRINI_OPNWRLD__.paused }));
      const h = await hud();
      if (h.flashing) flashSeen = true;
      if (gt0 == null) gt0 = s.gt;
      if (s.stars !== last) { marks.push({ stars: s.stars, gameSec: +(s.gt - gt0).toFixed(2), wallSec: +((Date.now() - t0) / 1000).toFixed(1), hud: h.on }); last = s.stars; }
      trace.push([+(s.gt - gt0).toFixed(2), s.stars, s.searchT, s.seen, s.running]);
      if (s.stars === 0) break;
      await sleep(250);
    }
    const out = { label, marks, flashSeen, trace: trace.filter((_, i) => i % 4 === 0), log: await ev(() => window.__BELIZETRINI_OPNWRLD__.wantedSys.log.filter((e) => e.kind === 'decay' || e.kind === 'set').slice(-4)) };
    await ev(() => { const g = window.__BELIZETRINI_OPNWRLD__; g.wantedSys.freezeUnits = false; for (const c of g.cops) c.alive = true; });
    return out;
  };
  R.decayInRadius = await decay('in search radius (expect 11 s + 8 s game time)', 'inRadius');
  console.log('decayIn', JSON.stringify(R.decayInRadius));
  R.decayOutside = await decay('outside search radius (x2: expect 5.5 s + 4 s game time)', 'outside');
  console.log('decayOut', JSON.stringify(R.decayOutside));
  // Seen → no decay: put a frozen unit right next to the player for 12 s.
  R.seenNoDecay = await ev(async () => {
    const g = window.__BELIZETRINI_OPNWRLD__; const w = g.wantedSys;
    w.setStars(0); g.drive.apply({ action: 'teleport', x: -60, z: 0 }); w.setStars(1);
    await new Promise((r) => setTimeout(r, 2500));
    w.freezeUnits = true;
    const u = w.units[0]; if (u) u.mesh.position.set(g.player.position.x + 6, 0, g.player.position.z);
    await new Promise((r) => setTimeout(r, 12000));
    const r = { stars: w.stars, seen: w.seen, searchT: w.searchT, flashing: !!document.querySelector('#wanted .star.flash') };
    w.freezeUnits = false; w.setStars(0);
    return r;
  });
  console.log('seen', JSON.stringify(R.seenNoDecay));
  R.spawnedTotals = await ev(() => window.__BELIZETRINI_OPNWRLD__.wantedSys.stats);
  R.errors = [...new Set(errs)];
  fs.writeFileSync(path.join(OUT, `wanted_${ENGINE}.json`), JSON.stringify(R, null, 1));
  console.log('errors', JSON.stringify(R.errors));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
