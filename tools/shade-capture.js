// good-1+5 capture: mobile Lambert path vs toon path — screenshots, program counts, shadow state, frame ms.
// Usage: node tools/shade-capture.js <chromium|webkit> <configs> [--root public] [--tag x] [--out docs/fidelity/good-1+5]
//   configs: comma list of name=query, e.g. "med_lambert=?quality=medium,med_toon=?quality=medium&shade=toon&blobs=0"
//   --device iphone|desktop (default iphone: 390x844 @3, touch, iOS UA)
// Math.random seeded; water/cloud time frozen; spot = Queen St noon with a car + a cop parked in view.
const { chromium, webkit } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const ENGINE = argv[0] || 'chromium';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const CONFIGS = (argv[1] || '').split(',').filter(Boolean).map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; });
const OUT = path.resolve(ROOT, opt('out', 'docs/fidelity/good-1+5'));
const PUB = path.resolve(opt('root', path.join(ROOT, 'public')));
const DEVICE = opt('device', 'iphone');
const PORT = 8800 + (ENGINE === 'webkit' ? 1 : 0) + (PUB.includes('/tmp/') ? 2 : 0);
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED = `(() => { let a = 0x9e3779b9; Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();`;

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
  const browser = ENGINE === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ executablePath: process.env.CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const mp = path.join(OUT, `shade_${ENGINE}.json`);
  const all = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf8')) : {};
  for (const [name, query] of CONFIGS) {
    const ctxOpts = DEVICE === 'iphone'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, userAgent: IOS_UA, ...(ENGINE !== 'webkit' ? { isMobile: true } : {}) }
      : { viewport: { width: 960, height: 540 } };
    const context = await browser.newContext(ctxOpts);
    await context.addInitScript(SEED);
    const page = await context.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 300)); });
    await page.goto(`http://127.0.0.1:${PORT}/${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.player, { timeout: 90000 });
    await sleep(1000);
    await page.evaluate(() => window.__BELIZETRINI_OPNWRLD__.beginPlay());
    await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.player?.model, { timeout: 90000 }).catch(() => {});
    await sleep(2000);
    await page.addStyleTag({ content: '#hud,#toast,#prompt,#mobile-controls,#gfx-toast{display:none!important}' });
    await page.evaluate(() => {
      const g = window.__BELIZETRINI_OPNWRLD__;
      const dn = g.world.dayNight; dn.setHour(12); dn.pause(true);
      const p = g.player;
      if (p.inVehicle) p.exitVehicle();
      p.mesh.position.set(-60, 0, 6); p.yaw = 0.35; p.pitch = 0.18; p.heading = 0.35 + Math.PI * 0.75; p._camInit = false;
      g.wanted = 0;
      for (const c of g.cops) c.mesh.position.set(9999, 0, 9999);
      // A sedan and a cop cruiser parked in view (so the contact shadows show).
      const car = g.vehicles.find((v) => v.type === 'sedan') || g.vehicles[0];
      car.mesh.position.set(-63.5, 0, 0.5); car.yaw = 0.3; car.mesh.rotation.y = 0.3; car.park?.();
      const cop = g.cops[0]; cop.mesh.position.set(-57, 0, -2); cop.yaw = -0.4; cop.mesh.rotation.y = -0.4;
      cop.update = () => null; // frozen for the capture
      if (g.toon?.Q) g.toon.Q.freezeTime = true;
      if (g.toon?.U) g.toon.U.uTime.value = 100;
    });
    await sleep(2200);
    const m = await page.evaluate(() => {
      const g = window.__BELIZETRINI_OPNWRLD__;
      const r = g.renderer; const cam = g.player.camera;
      const gl = r.getContext(); const px = new Uint8Array(4);
      r.info.autoReset = false; r.info.reset();
      r.render(g.scene, cam);
      r.info.autoReset = true;
      const progs = (r.info.programs || []).map((p) => p.name || p.cacheKey?.slice(0, 40));
      const byType = {};
      for (const n of progs) byType[n] = (byType[n] || 0) + 1;
      let cast = 0, recv = 0, lamb = 0, toon = 0;
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (o.castShadow) cast++; if (o.receiveShadow) recv++;
        const mm = Array.isArray(o.material) ? o.material : [o.material];
        for (const x of mm) { if (x?.isMeshLambertMaterial) lamb++; if (x?.isMeshToonMaterial) toon++; }
      });
      const times = [];
      for (let i = 0; i < 15; i++) {
        const t0 = performance.now();
        r.render(g.scene, cam);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return { calls: r.info.render.calls, triangles: r.info.render.triangles, programs: progs.length, programTypes: byType,
        shadowMap: r.shadowMap.enabled, castShadowMeshes: cast, receiveShadowMeshes: recv, lambertMeshes: lamb, toonMeshes: toon,
        blobs: g.blobs ? { enabled: g.blobs.enabled, count: g.blobs.mesh.count } : null,
        frameMsMedian: +times[7].toFixed(2), frameMsMin: +times[0].toFixed(2),
        buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], quality: g.quality?.stats?.() ?? null };
    });
    const shot = path.join(OUT, `${ENGINE}_${name}.png`);
    await page.screenshot({ path: shot });
    m.errors = [...new Set(errs)];
    m.query = query; m.png = path.relative(ROOT, shot);
    all[name] = m;
    console.log(ENGINE, name, JSON.stringify({ calls: m.calls, progs: m.programs, ms: m.frameMsMedian, sm: m.shadowMap, cast: m.castShadowMeshes, lamb: m.lambertMeshes, toon: m.toonMeshes, blobs: m.blobs, shade: m.quality?.shading, errs: m.errors.length }));
    await context.close();
  }
  all._browser = browser.version();
  fs.writeFileSync(mp, JSON.stringify(all, null, 1));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
