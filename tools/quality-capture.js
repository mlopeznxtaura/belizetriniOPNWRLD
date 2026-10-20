// good-1+3 / good-1+4 capture: per-preset (or per-tree) metrics + screenshots at the good-1+1 spots.
// Usage:
//   node tools/quality-capture.js presets [--presets low,medium] [--spots queen] [--out docs/fidelity/good-1+3]
//   node tools/quality-capture.js detect  [--out ...]      # auto-detect results for emulated devices
//   node tools/quality-capture.js tree --tag before --root /tmp/base/public --presets high --spots queen,shore,bridge,pos
// Env: CHROME (Chromium binary). Math.random is seeded (mulberry32) so builds are deterministic.
// Frame time = median of 15 renders each followed by a 1-px readPixels (GPU sync) on SwiftShader.
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const MODE = argv[0] || 'presets';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(ROOT, opt('out', 'docs/fidelity/good-1+3'));
const PUB = path.resolve(opt('root', path.join(ROOT, 'public')));
const TAG = opt('tag', 'q');
const PORT = +opt('port', 8791);
const VW = +opt('w', 960), VH = +opt('h', 540), DSF = +opt('dsf', 2);
const SPOTS = {
  queen: { pos: [-60, 6], yaw: 0.35, heading: 0.35 + Math.PI * 0.75, label: 'Queen St, Belize' },
  shore: { pos: [-70, -101], yaw: -0.75, heading: Math.PI * 0.9, label: 'South shore / water, Belize' },
  bridge: { pos: [12, 3], yaw: -Math.PI / 2 + 0.12, heading: Math.PI / 2, label: 'Causeway to Port of Spain' },
  pos: { pos: [145, 22], yaw: 0.15, heading: Math.PI * 0.6, label: 'Downtown Port of Spain' },
};
const TIMES = { noon: 12, dusk: 18.75 };
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED = `(() => { let a = 0x9e3779b9; Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();`;

function serve() {
  const server = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    const file = path.join(PUB, u);
    if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}
const launch = () => puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function openGame(browser, query, extraInit = '') {
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  await page.evaluateOnNewDocument(SEED + extraInit);
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: DSF });
  await page.goto(`http://127.0.0.1:${PORT}/${query}`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await page.click('#char-male').catch(() => {});
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.player?.model, { timeout: 60000 }).catch(() => {});
  await sleep(2500);
  await page.addStyleTag({ content: '#hud,#toast,#prompt,#mobile-controls,#gfx-toast{display:none!important}' });
  return { page, errs };
}

async function measure(page, S, hour) {
  await page.evaluate((S, hour) => {
    const g = window.__BELIZETRINI_OPNWRLD__;
    const dn = g.world.dayNight; dn.setHour(hour); dn.pause(true);
    const p = g.player;
    if (p.inVehicle) p.exitVehicle();
    p.mesh.position.set(S.pos[0], 0, S.pos[1]);
    p.yaw = S.yaw; p.pitch = 0.12; p.heading = S.heading;
    p._camInit = false;
    g.wanted = 0;
    for (const c of g.cops) c.mesh.position.set(9999, 0, 9999);
    window.__FREEZE = true; // test-patched base trees honour this
    if (g.toon?.Q) g.toon.Q.freezeTime = true;
    if (g.toon?.U) g.toon.U.uTime.value = 100;
  }, S, hour);
  await sleep(1800);
  return page.evaluate(() => {
    const g = window.__BELIZETRINI_OPNWRLD__;
    // good-1+11: settle the streamed chunks around the spot (no-op on trees without streaming)
    if (g.streamer?.enabled) { const q = g.player.mesh.position; g.streamer._schedule(q); g.streamer.loadAround(q, g.streamer.ring.load); g.streamer._schedule(q); }
    const r = g.renderer; const cam = g.player.camera;
    const gl = r.getContext(); const px = new Uint8Array(4);
    g.quality?.update?.(0);
    // autoReset would zero info after the shadow pass; count the whole frame (shadow + main) instead.
    r.info.autoReset = false; r.info.reset();
    r.render(g.scene, cam);
    r.info.autoReset = true;
    let batched = 0, meshes = 0; g.scene.traverse((o) => { if (o.isMesh) { meshes++; if (o.userData?.batched) batched++; } });
    const info = { meshes, batchMeshes: batched, batchStats: g.world.root.userData.batchStats || null, calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs?.length ?? null,
      geometries: r.info.memory.geometries, textures: r.info.memory.textures };
    const times = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      r.render(g.scene, cam);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    let pointLights = 0, pointLightsOn = 0;
    g.scene.traverse((o) => { if (o.isPointLight) { pointLights++; if (o.visible) pointLightsOn++; } });
    return { ...info, frameMsMedian: +times[7].toFixed(2), frameMsMin: +times[0].toFixed(2), pointLights, pointLightsOn,
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], aa: gl.getContextAttributes().antialias,
      shadows: r.shadowMap.enabled, far: cam.far, quality: g.quality?.stats?.() ?? null };
  });
}

async function runPresets() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const browser = await launch();
  const mp = path.join(OUT, 'metrics.json');
  const all = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf8')) : {};
  const presets = opt('presets', 'low,medium,high,ultra').split(',');
  const spots = opt('spots', 'queen').split(',');
  const times = opt('times', 'noon').split(',');
  const prefix = MODE === 'tree' ? TAG : 'preset';
  for (const pr of presets) {
    const { page, errs } = await openGame(browser, `?quality=${pr}${opt('query', '')}`);
    for (const sk of spots) for (const tk of times) {
      const m = await measure(page, SPOTS[sk], TIMES[tk]);
      const name = MODE === 'tree' ? `${TAG}_${sk}_${tk}` : `${pr}_${sk}_${tk}`;
      const shot = path.join(OUT, name + '.png');
      await page.screenshot({ path: shot });
      (all[prefix] = all[prefix] || {})[MODE === 'tree' ? `${sk}_${tk}` : `${pr}_${sk}_${tk}`] = { ...m, png: path.relative(ROOT, shot) };
      console.log(name, JSON.stringify({ calls: m.calls, tris: m.triangles, ms: m.frameMsMedian, buf: m.buffer, aa: m.aa, sh: m.shadows, pl: m.pointLightsOn }));
    }
    (all[prefix]._errors = all[prefix]._errors || {})[pr] = [...new Set(errs.filter((e) => !/Failed to load resource/.test(e)))];
    await page.close();
  }
  fs.writeFileSync(mp, JSON.stringify(all, null, 1));
  await browser.close(); server.close();
}

// Auto-detect under emulated devices. The GPU string is spoofed (SwiftShader would always say "low").
async function runDetect() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const browser = await launch();
  const spoof = (vendor, renderer) => `(() => { for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) { const o = C.prototype.getParameter; C.prototype.getParameter = function (p) { if (p === 0x9245) return ${JSON.stringify(vendor)}; if (p === 0x9246) return ${JSON.stringify(renderer)}; return o.call(this, p); }; } })();`;
  const devs = [
    { name: 'iPhone 15 (393x852 @3, iOS 18)', vp: [393, 852, 3, true], ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1', gpu: ['Apple Inc.', 'Apple GPU'] },
    { name: 'iPhone 13/14 (390x844 @3, iOS 17)', vp: [390, 844, 3, true], ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1', gpu: ['Apple Inc.', 'Apple GPU'] },
    { name: 'iPhone SE (375x667 @2, iOS 17)', vp: [375, 667, 2, true], ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1', gpu: ['Apple Inc.', 'Apple GPU'] },
    { name: 'iPad (820x1180 @2, iPadOS)', vp: [820, 1180, 2, true], ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', gpu: ['Apple Inc.', 'Apple GPU'] },
    { name: 'Android mid (412x915 @2.6, Adreno 610)', vp: [412, 915, 2.625, true], ua: 'Mozilla/5.0 (Linux; Android 14; SM-A145) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', gpu: ['Qualcomm', 'Adreno (TM) 610'] },
    { name: 'Desktop NVIDIA', vp: [1440, 900, 1, false], ua: null, gpu: ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)'] },
    { name: 'Laptop Intel iGPU', vp: [1366, 768, 1, false], ua: null, gpu: ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)'] },
    { name: 'Headless SwiftShader (real)', vp: [960, 540, 1, false], ua: null, gpu: null },
  ];
  const rows = [];
  for (const d of devs) {
    const page = await browser.newPage();
    if (d.gpu) await page.evaluateOnNewDocument(spoof(d.gpu[0], d.gpu[1]));
    if (d.ua) await page.setUserAgent(d.ua);
    if (d.vp[3]) await page.evaluateOnNewDocument('Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });');
    await page.setViewport({ width: d.vp[0], height: d.vp[1], deviceScaleFactor: d.vp[2], isMobile: d.vp[3], hasTouch: d.vp[3] });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const r = await page.evaluate(() => { const g = window.__BELIZETRINI_OPNWRLD__; const s = g?.quality?.stats(); return s ? { active: s.name, auto: s.auto, reason: s.autoReason, gpu: g.quality.auto.info.gpu } : null; });
    rows.push({ device: d.name, ...r });
    console.log(d.name, JSON.stringify(r));
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'detect.json'), JSON.stringify(rows, null, 1));
  await browser.close(); server.close();
}

(MODE === 'detect' ? runDetect() : runPresets()).catch((e) => { console.error(e); process.exit(1); });
