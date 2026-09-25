// Headless smoke test of the real game page: start as a character, sprint, stop, enter/exit a vehicle.
// Usage: node tools/game-smoke.js [male|female]   (serves public/ on :8767, screenshots to anim_verify/)
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'tools/marco_char_delta/anim_verify');
const CH = process.argv[2] || 'female';
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  const file = path.join(PUB, u);
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => server.listen(8767, '127.0.0.1', r));
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  const missing = new Set();
  page.on('response', (r) => { if (r.status() >= 400) missing.add(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')); });
  await page.setViewport({ width: 800, height: 500 });
  await page.goto('http://127.0.0.1:8767/', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await page.click(`#char-${CH}`).catch(() => {});
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.player?.model, { timeout: 60000 }).catch(() => {});
  await sleep(4000);
  const st = () => page.evaluate(() => {
    const g = window.__BELIZETRINI_OPNWRLD__; const p = g.player;
    return { rig: !!p.rig, speed: +(p.groundSpeed ?? 0).toFixed(2), heading: +(p.heading ?? 0).toFixed(2),
      pos: p.root ? [p.root.position.x, p.root.position.z].map((v) => +v.toFixed(2)) : null,
      inVehicle: !!(p.vehicle || p.inVehicle || p.currentVehicle), runW: p.rig ? +p.rig.runW.toFixed(2) : null };
  });
  const out = { start: await st() };
  await page.screenshot({ path: path.join(OUT, `game_${CH}_idle.png`) });
  await page.keyboard.down('KeyW'); await sleep(1500); out.walk = await st();
  await page.screenshot({ path: path.join(OUT, `game_${CH}_walk.png`) });
  await page.keyboard.down('ShiftLeft'); await sleep(2000); out.sprint = await st();
  await page.screenshot({ path: path.join(OUT, `game_${CH}_sprint.png`) });
  await page.keyboard.down('KeyA'); await sleep(700); out.turning = await st(); await page.keyboard.up('KeyA');
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW'); await sleep(1200); out.stopped = await st();
  // Walk up to the nearest vehicle, enter (F), drive briefly, exit (F).
  out.vehicleType = await page.evaluate(() => {
    const g = window.__BELIZETRINI_OPNWRLD__; const p = g.player.position;
    let best = null, bd = 1e9;
    for (const v of g.vehicles) { const d = v.mesh.position.distanceTo(p); if (d < bd) { bd = d; best = v; } }
    g.player.mesh.position.set(best.mesh.position.x + 2.2, 0, best.mesh.position.z);
    return best.type;
  });
  await sleep(600);
  await page.keyboard.press('KeyF'); await sleep(1500); out.afterEnter = await st();
  await page.screenshot({ path: path.join(OUT, `game_${CH}_vehicle.png`) });
  await page.keyboard.down('KeyW'); await sleep(1200); await page.keyboard.up('KeyW');
  out.driving = await page.evaluate(() => { const v = window.__BELIZETRINI_OPNWRLD__.player.vehicle; return v ? +Math.abs(v.speed ?? 0).toFixed(2) : null; });
  await sleep(1500);
  await page.keyboard.press('KeyF'); await sleep(1500); out.afterExit = await st();
  await page.screenshot({ path: path.join(OUT, `game_${CH}_exited.png`) });
  out.errors = [...new Set(errs.filter((e) => !/Failed to load resource/.test(e)))];
  out.missing = [...missing].slice(0, 40);
  console.log(JSON.stringify(out, null, 1));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
