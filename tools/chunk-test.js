// good-1+11 / good-1+12 streaming-world verification.
// Usage:
//   node tools/chunk-test.js spots  [--presets low,medium,high] [--spots a,b] [--out DIR] [--engine chromium|webkit] [--device iphone]
//   node tools/chunk-test.js drive  [--preset high] [--route belize|islands] [--out DIR] [--engine ...] [--device iphone]
//   node tools/chunk-test.js aerial [--out DIR] [--size 1800] [--region belize|all]
//   node tools/chunk-test.js shots  --cams '[{"name":"x","pos":[x,y,z],"look":[x,y,z]}]' [--preset high] [--out DIR] [--hour 12]
// Chromium = SwiftShader software GL (numbers are CPU raster, not a phone GPU). WebKit = WPE, iPhone UA.
const { chromium, webkit } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const MODE = argv[0] || 'spots';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(ROOT, opt('out', 'docs/fidelity/good-1+11'));
const ENGINE = opt('engine', 'chromium');
const DEVICE = opt('device', 'desktop');
const PUB = path.join(ROOT, 'public');
const PORT = 8900 + Math.floor(Math.random() * 90);
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED = `(() => { let a = 0x9e3779b9; Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();`;

// Fixed camera spots: [camera pos], [look-at]. Same views on every preset.
const SPOTS = {
  queen: { cam: [-48, 9, 20], look: [-62, 2, -6], label: 'Queen St core (regression)' },
  canal: { cam: [-238, 12, 75], look: [-262, 0, 30], label: 'Collet Canal lanes' },
  swing: { cam: [-36, 10, 160], look: [-60, 3, 185], label: 'Haulover Creek swing bridge' },
  fort: { cam: [70, 14, 262], look: [100, 6, 300], label: 'Fort George lighthouse + water taxi' },
  lanes: { cam: [-405, 9, 3], look: [-450, 2, 40], label: 'Stilt-house lanes (west)' },
  market: { cam: [-74, 8, 228], look: [-52, 2, 200], label: 'Queen St market + plaza (Northside)' },
  harbour: { cam: [130, 22, 250], look: [40, 0, 230], label: 'Harbour view from the sea' },
};
const ROUTES = {
  // Drive path across chunk borders: core spawn → west lanes → north over the creek → Fort George → back.
  belize: [[-72, 0], [-150, 0], [-540, 0], [-540, 0], [-380, 0], [-380, 280], [100, 280], [40, 280], [40, 140], [-60, 140], [-60, 50], [-60, 0], [-72, 0]],
};

function serve() {
  const server = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"actions":[]}'); }
    const file = path.join(PUB, u);
    if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

async function launch() {
  if (ENGINE === 'webkit') return webkit.launch({ headless: true });
  return chromium.launch({ executablePath: process.env.CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
}

async function openGame(browser, query, vw = 960, vh = 540) {
  const ctxOpts = { viewport: { width: vw, height: vh }, deviceScaleFactor: 1 };
  if (DEVICE === 'iphone') Object.assign(ctxOpts, { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, userAgent: IOS_UA, ...(ENGINE !== 'webkit' ? { isMobile: true } : {}) });
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  await page.addInitScript(SEED);
  await page.goto(`http://127.0.0.1:${PORT}/${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.streamer, null, { timeout: 60000 });
  await sleep(1200);
  await page.evaluate(() => { const b = document.getElementById('char-male'); b && b.click(); document.getElementById('btn-start').click(); });
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.running, null, { timeout: 60000 });
  await sleep(1500);
  return { page, errs, context };
}

// In-page helpers: manual render with a free camera (game loop stopped), metrics, PNG.
const PAGE_LIB = `
window.__ct = {
  g: () => window.__BELIZETRINI_OPNWRLD__,
  freeze(hour) {
    const g = this.g(); g._stopLoop();
    g.toon.Q.freezeTime = true;
    if (hour != null) { g.world.dayNight.setHour(hour); if (!g.world.dayNight.paused) g.world.dayNight.togglePause?.(); }
    if (!this.cam) { this.cam = g.player.camera.clone(); }
    for (const id of ['hud', 'mobile-controls']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; }
  },
  place(cx, cy, cz, lx, ly, lz) {
    const g = this.g(), cam = this.cam;
    cam.aspect = g.renderer.domElement.width / g.renderer.domElement.height;
    cam.far = g.quality.q.far; cam.updateProjectionMatrix();
    cam.position.set(cx, cy, cz); cam.lookAt(lx, ly, lz); cam.updateMatrixWorld();
    g.player.mesh.position.set(lx, 0, lz); // streaming focus
  },
  settle() { const g = this.g(), S = g.streamer; S._schedule(this.cam.position); S.loadAround(this.cam.position, S.ring.load); S._schedule(this.cam.position); },
  render(n = 1) {
    const g = this.g(), cam = this.cam, r = g.renderer;
    g.world.updateOcean(cam); g.toon.update(cam, 0); g.world.dayNight.update(0);
    g.quality.updateLights(true);
    const gl = r.getContext(); const px = new Uint8Array(4);
    const ts = [];
    for (let i = 0; i < n; i++) { const t = performance.now(); r.render(g.scene, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t); }
    ts.sort((a, b) => a - b);
    return { calls: r.info.render.calls, tris: r.info.render.triangles, ms: +ts[Math.floor(ts.length / 2)].toFixed(1) };
  },
  breakdown() {
    const g = this.g();
    const out = {};
    g.scene.traverseVisible((o) => {
      if (!o.isMesh) return; const gg = o.geometry; if (!gg) return;
      let t = (gg.index ? gg.index.count : gg.attributes.position.count) / 3; if (gg.drawRange && gg.drawRange.count !== Infinity) t = Math.min(t, gg.drawRange.count / 3);
      if (o.isInstancedMesh) t *= o.count;
      const k = (o.name || o.type).split(':')[0] + (o.userData.isOutline ? ':outline' : '');
      out[k] = (out[k] || 0) + Math.round(t);
    });
    return out;
  },
  png() { this.render(1); return this.g().renderer.domElement.toDataURL('image/png'); }, // same task as the draw (no preserveDrawingBuffer)
  mem() { const r = this.g().renderer; return { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs.length }; },
};`;

async function savePng(page, file) {
  const data = await page.evaluate(() => window.__ct.png());
  fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
}

async function spots() {
  const presets = opt('presets', 'low,medium,high').split(',');
  const names = opt('spots', Object.keys(SPOTS).join(',')).split(',');
  const browser = await launch();
  const out = { engine: ENGINE, device: DEVICE, results: {} };
  for (const p of presets) {
    const { page, errs, context } = await openGame(browser, `?quality=${p}&gov=0&fresh=1`);
    await page.evaluate(PAGE_LIB);
    await page.evaluate(() => window.__ct.freeze(12));
    out.results[p] = {};
    for (const s of names) {
      const S = SPOTS[s];
      await page.evaluate(([c, l]) => { window.__ct.place(...c, ...l); window.__ct.settle(); }, [S.cam, S.look]);
      const m = await page.evaluate(() => { window.__ct.render(2); return window.__ct.render(9); });
      const info = await page.evaluate(() => window.__ct.g().streamer.info());
      out.results[p][s] = { ...m, loaded: info.loaded.length, farTris: info.farTris };
      await savePng(page, path.join(OUT, `spot_${s}_${p}${ENGINE === 'webkit' ? '_webkit' : ''}${DEVICE === 'iphone' ? '_iphone' : ''}.png`));
      console.log(p, s, JSON.stringify(out.results[p][s]));
    }
    out.results[p].errors = errs.slice();
    await context.close();
  }
  await browser.close();
  return out;
}

async function drive() {
  const preset = opt('preset', 'high');
  const route = ROUTES[opt('route', 'belize')];
  const speed = +opt('speed', 25);
  const browser = await launch();
  const { page, errs, context } = await openGame(browser, `?quality=${preset}&gov=0&fresh=1`, 640, 360);
  await page.evaluate(PAGE_LIB);
  // Baselines: (a) no chunks loaded, (b) start position settled.
  // warmAll(): one render with frustum culling off, so every resident (core) geometry has been uploaded
  // once — otherwise first-time-seen core batches would look like growth. Chunks are what we measure.
  await page.evaluate(() => {
    window.__ct.warmAll = () => {
      const g = window.__ct.g(), keep = [];
      g.scene.traverse((o) => { if (o.frustumCulled) { keep.push(o); o.frustumCulled = false; } });
      g.renderer.render(g.scene, g.player.camera);
      g.renderer.render(g.scene, g.player.camera);
      for (const o of keep) o.frustumCulled = true;
    };
  });
  const base = await page.evaluate(async (start) => {
    // GPU-upload tracker: three adds a 'dispose' listener to a geometry when it uploads it and removes it
    // when the geometry is disposed, so this set == geometries currently resident on the GPU.
    const T = await import('three');
    const up = window.__ctUp = new Set();
    const oa = T.BufferGeometry.prototype.addEventListener, orm = T.BufferGeometry.prototype.removeEventListener;
    T.BufferGeometry.prototype.addEventListener = function (t, f) { if (t === 'dispose') up.add(this); return oa.call(this, t, f); };
    T.BufferGeometry.prototype.removeEventListener = function (t, f) { if (t === 'dispose') up.delete(this); return orm.call(this, t, f); };
    const g = window.__ct.g();
    const v = g.vehicles.find((o) => o.type === (window.__ctVehicle || 'sedan'));
    v.mesh.position.set(start[0], 0, start[1]);
    g.player.enterVehicle(v); // seated character parts are uploaded before the empty baseline
    g.streamer.unloadAll(); g.streamer.enabled = false;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__ct.warmAll();
    const empty = window.__ct.mem();
    window.__ctU0 = new Set(window.__ctUp);
    // chunk-owned = vertex-colour batches, outline hull batches (aBoxMin) and shared prop geometries
    window.__ct.chunkOwned = () => [...window.__ctUp].filter((x) => !window.__ctU0.has(x) && (x.attributes.color || x.attributes.aBoxMin || x.userData.shared)).length;
    window.__ct.ownedNames = () => {
      const own = new Map(); g.streamer.root.traverse((o) => { if (o.geometry) own.set(o.geometry, (o.parent?.name || '') + '/' + o.name); });
      const out = {}; for (const x of window.__ctUp) { if (window.__ctU0.has(x) || !(x.attributes.color || x.attributes.aBoxMin || x.userData.shared)) continue; const n = (own.get(x) || 'detached').split('/').pop().split(':')[0]; out[n] = (out[n] || 0) + 1; }
      return out;
    };
    // orphans: chunk-owned geometries still on the GPU whose mesh is no longer in the streamer (= leaks)
    window.__ct.orphans = () => {
      const own = new Set(); g.streamer.root.traverse((o) => { if (o.geometry) own.add(o.geometry); });
      return [...window.__ctUp].filter((x) => !window.__ctU0.has(x) && (x.attributes.color || x.attributes.aBoxMin || x.userData.shared) && !own.has(x)).length;
    };
    window.__ct.otherNew = () => [...window.__ctUp].filter((x) => !window.__ctU0.has(x) && !(x.attributes.color || x.attributes.aBoxMin || x.userData.shared)).length;
    g.streamer.enabled = true;
    return { empty };
  }, route[0]);
  // Put the player in a sedan and move it kinematically along the route at `speed` m/s (wall clock),
  // while the real game loop runs (streaming, rendering, HUD, AI).
  const res = await page.evaluate(async ([route, speed]) => {
    const g = window.__ct.g();
    const v = g.player.vehicle;
    g.streamer.resetStats();
    // settle at the start
    const S = g.streamer;
    const waitIdle = async () => { for (let i = 0; i < 900; i++) { await new Promise((r) => requestAnimationFrame(r)); if (!S.current && !S.queue.length && i > 8) break; } };
    await waitIdle();
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    window.__ct.warmAll();
    const progNames = () => g.renderer.info.programs.map((p) => p.name + '#' + p.id);
    const progs0 = progNames();
    const startMem = { ...window.__ct.mem(), chunkOwned: window.__ct.chunkOwned(), owned: window.__ct.ownedNames(), detail: S.contentChunks.filter((c) => c.state === 'loaded').map((c) => c.key + (c.detailOn ? '+' : '-')).join(' ') };
    const startLoaded = S.info().loaded.length;
    S.resetStats();
    const frames = [];
    let seg = 0, t = 0, last = performance.now();
    const segLen = (i) => Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]);
    const memTrace = [];
    await new Promise((resolve) => {
      const step = () => {
        const now = performance.now(); const dt = Math.min(0.25, (now - last) / 1000); last = now;
        t += speed * dt;
        while (seg < route.length - 1 && t > segLen(seg)) { t -= segLen(seg); seg++; }
        if (seg >= route.length - 1) { resolve(); return; }
        const a = route[seg], b = route[seg + 1], L = segLen(seg) || 1, f = t / L;
        v.mesh.position.set(a[0] + (b[0] - a[0]) * f, 0, a[1] + (b[1] - a[1]) * f);
        v.yaw = Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
        v.velocity.set(0, 0, 0); v.speed = speed;
        frames.push({ dt: +(dt * 1000).toFixed(1), stream: +S.stats.lastFrameMs.toFixed(2), loaded: S.stats.loaded, x: Math.round(v.mesh.position.x), z: Math.round(v.mesh.position.z) });
        if (frames.length % 20 === 0) memTrace.push({ f: frames.length, ...window.__ct.mem(), chunkOwned: window.__ct.chunkOwned(), orphans: window.__ct.orphans(), loaded: S.stats.loaded, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles });
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    // back at the start: drop hysteresis for one schedule so the loaded set equals the start set
    S.hyst = 0; S._schedule(v.mesh.position); S.hyst = 48;
    await waitIdle();
    window.__ct.warmAll();
    const endMem = { ...window.__ct.mem(), chunkOwned: window.__ct.chunkOwned(), orphans: window.__ct.orphans(), otherNew: window.__ct.otherNew(), owned: window.__ct.ownedNames(), detail: S.contentChunks.filter((c) => c.state === 'loaded').map((c) => c.key + (c.detailOn ? '+' : '-')).join(' ') };
    const endLoaded = S.info().loaded.length;
    const newPrograms = progNames().filter((n) => !progs0.includes(n));
    const info = S.info();
    // leave: unload everything → must equal the empty baseline
    S.unloadAll(); S.enabled = false;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__ct.warmAll();
    const afterUnload = { ...window.__ct.mem(), chunkOwned: window.__ct.chunkOwned(), orphans: window.__ct.orphans(), otherNew: window.__ct.otherNew() };
    S.enabled = true;
    return { startMem, endMem, afterUnload, info, frames, memTrace, district: g.district, startLoaded, endLoaded, newPrograms };
  }, [route, speed]);
  const st = res.frames.map((f) => f.stream).sort((a, b) => a - b);
  const dts = res.frames.map((f) => f.dt).sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const summary = {
    preset, engine: ENGINE, device: DEVICE, frames: res.frames.length, loads: res.info.loads, unloads: res.info.unloads, aborted: res.info.aborted,
    streamMs: { p50: q(st, 0.5), p95: q(st, 0.95), max: st[st.length - 1] }, maxStepMs: res.info.maxStepMs, maxStepLabel: res.info.maxStepLabel, buildMs: res.info.buildMs,
    frameMs: { p50: q(dts, 0.5), p95: q(dts, 0.95), max: dts[dts.length - 1] },
    framesOverStreamBudget: res.frames.filter((f) => f.stream > res.info.budget + 1).length, budget: res.info.budget,
    memory: { empty: base.empty, start: res.startMem, endBackAtStart: res.endMem, afterUnloadAll: res.afterUnload, startLoaded: res.startLoaded, endLoaded: res.endLoaded },
    // chunk resources: back at the start the same set is resident; after leaving (unload) nothing remains
    maxOrphansDuringDrive: Math.max(0, ...res.memTrace.map((m) => m.orphans)),
    memoryBackToBaseline: res.afterUnload.chunkOwned === 0 && res.afterUnload.orphans === 0 && res.endMem.orphans === 0 && res.afterUnload.textures === base.empty.textures
      && res.afterUnload.geometries === base.empty.geometries + res.afterUnload.otherNew,
    note: 'chunkOwned = streamed geometries resident on the GPU; orphans = chunk geometries resident without a loaded owner (leaks); otherNew = non-chunk game objects first drawn during the drive. Back at the start, chunkOwned can exceed the start snapshot by detail buffers of still-loaded chunks that were drawn up close during the drive (hidden, freed when their chunk unloads).',
    programsStable: res.endMem.programs === res.startMem.programs, newPrograms: res.newPrograms,
    errors: errs.slice(),
  };
  fs.writeFileSync(path.join(OUT, `drive_${opt('route', 'belize')}_${preset}${ENGINE === 'webkit' ? '_webkit' : ''}${DEVICE === 'iphone' ? '_iphone' : ''}.json`), JSON.stringify({ summary, memTrace: res.memTrace, frames: res.frames }, null, 0));
  console.log(JSON.stringify(summary, null, 1));
  await context.close(); await browser.close();
  return summary;
}

async function shots() {
  const cams = JSON.parse(opt('cams', '[]'));
  const preset = opt('preset', 'high');
  const browser = await launch();
  const { page, errs, context } = await openGame(browser, `?quality=${preset}&gov=0&fresh=1`, +opt('w', 960), +opt('h', 540));
  await page.evaluate(PAGE_LIB);
  await page.evaluate((h) => window.__ct.freeze(h), +opt('hour', 12));
  for (const c of cams) {
    await page.evaluate((c) => { window.__ct.place(...c.pos, ...c.look); window.__ct.settle(); }, c);
    const m = await page.evaluate(() => { window.__ct.render(1); return window.__ct.render(1); });
    if (argv.includes('--breakdown')) console.log('  breakdown (scene, not frustum-culled)', JSON.stringify(await page.evaluate(() => window.__ct.breakdown())));
    await savePng(page, path.join(OUT, `${c.name}.png`));
    console.log(c.name, JSON.stringify(m));
  }
  console.log('errors', JSON.stringify(errs));
  await context.close(); await browser.close();
}

async function aerial() {
  const size = +opt('size', 1600);
  const region = opt('region', 'belize');
  const browser = await launch();
  const { page, errs, context } = await openGame(browser, `?quality=high&gov=0&fresh=1`, size, size);
  await page.evaluate(PAGE_LIB);
  const r = await page.evaluate(async (region) => {
    const g = window.__ct.g(); const T = g.scene.constructor; void T;
    window.__ct.freeze(12);
    const L = g.world.layout;
    const b = region === 'all' ? g.world.layout.bounds : { minX: -600, maxX: 280, minZ: -150, maxZ: 370 };
    if (region !== 'all' && region !== 'belize') Object.assign(b, JSON.parse(region));
    g.streamer.loadAround({ x: 0, z: 0 }, Infinity);
    const THREE = await import('three');
    const w = b.maxX - b.minX, h = b.maxZ - b.minZ, s = Math.max(w, h) / 2;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const cam = new THREE.OrthographicCamera(-s, s, s, -s, 1, 2000);
    cam.position.set(cx, 600, cz); cam.up.set(0, 0, 1); cam.lookAt(cx, 0, cz); cam.updateMatrixWorld();
    // Looking straight down with up = +z (north) puts +x (east) on the LEFT; the PNG is mirrored
    // horizontally afterwards (tools/aerial-annotate.py) so the map reads north-up / east-right.
    const fog = g.scene.fog; g.scene.fog = null;
    // the sky dome / stars / sun disks / clouds follow the player camera: hide them for the map view
    const hidden = [];
    g.scene.traverse((o) => { const m = o.material; if (o.visible && (o.isMesh || o.isPoints || o.isSprite) && m && !Array.isArray(m) && m.fog === false) { hidden.push(o); o.visible = false; } });
    g.scene.traverse((o) => { if (o.visible && /cloud/i.test(o.name)) { hidden.push(o); o.visible = false; } });
    g.world.ocean.scale.set(6, 1, 6); g.world.updateOcean({ position: { x: cx, z: cz } });
    g.toon.update(cam, 0);
    g.renderer.render(g.scene, cam);
    const url = g.renderer.domElement.toDataURL('image/png');
    g.scene.fog = fog;
    for (const o of hidden) o.visible = true;
    return { url, view: { cx, cz, s }, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, loaded: g.streamer.info().loaded.length,
      districts: L.districts.map((d) => ({ id: d.id, label: d.label, rect: d.rect })), mem: window.__ct.mem() };
  }, region);
  const file = path.join(OUT, `aerial_${region === 'all' ? 'all' : region.startsWith('{') ? 'custom' : region}.png`);
  fs.writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
  delete r.url;
  fs.writeFileSync(file.replace('.png', '.json'), JSON.stringify(r, null, 1));
  console.log(JSON.stringify({ ...r, errors: errs }, null, 0).slice(0, 1500));
  await context.close(); await browser.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  try {
    if (MODE === 'spots') { const r = await spots(); fs.writeFileSync(path.join(OUT, `spots_${ENGINE}${DEVICE === 'iphone' ? '_iphone' : ''}_${opt('presets', 'low,medium,high').replace(/,/g, '-')}.json`), JSON.stringify(r, null, 1)); }
    else if (MODE === 'drive') await drive();
    else if (MODE === 'aerial') await aerial();
    else if (MODE === 'shots') await shots();
  } finally { server.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
