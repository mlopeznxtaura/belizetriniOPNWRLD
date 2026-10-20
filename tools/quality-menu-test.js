// good-1+3: pause-menu quality selector test (desktop P key + iPhone pause button), Chromium.
const puppeteer = require('puppeteer-core'); const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PUB = path.join(ROOT, 'public'); const OUT = path.join(ROOT, 'docs/fidelity/good-1+3');
const T = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = path.join(PUB, u); if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => srv.listen(8797, '127.0.0.1', r));
  const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const out = {};
  const st = (p) => p.evaluate(() => { const g = window.__BELIZETRINI_OPNWRLD__; const s = g.quality.stats(); return { name: s.name, source: s.source, pr: g.renderer.getPixelRatio(), far: g.player.camera.far, lightsOn: s.pointLightsOn, clouds: g.world.dayNight.lights && g.scene.getObjectByName('toonClouds').count, saved: localStorage.getItem('bto.quality'), selected: document.querySelector('.q-btn.selected')?.dataset.q, toast: document.getElementById('gfx-toast')?.textContent }; });
  // Desktop
  let p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: 960, height: 540 });
  await p.goto('http://127.0.0.1:8797/'); await sleep(1500); await p.click('#btn-start'); await sleep(4000);
  out.desktopStart = await st(p);
  await p.keyboard.press('KeyP'); await sleep(400);
  await p.click('.q-btn[data-q="ultra"]'); await sleep(800); out.afterUltra = await st(p);
  await p.screenshot({ path: path.join(OUT, 'menu_desktop.png') });
  await p.click('.q-btn[data-q="medium"]'); await sleep(800); out.afterMedium = await st(p);
  await p.reload(); await sleep(1500); await p.click('#btn-start'); await sleep(3500); out.afterReloadSaved = await st(p);
  await p.keyboard.press('KeyP'); await sleep(300); await p.click('.q-btn[data-q="auto"]'); await sleep(600); out.afterAuto = await st(p);
  out.desktopErrors = errs;
  await p.close();
  // iPhone emulation: pause button -> selector
  p = await b.newPage(); const errs2 = []; p.on('pageerror', (e) => errs2.push(e.message));
  await p.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1');
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await p.goto('http://127.0.0.1:8797/'); await sleep(1500); await p.tap('#btn-start'); await sleep(4000);
  out.iphoneStart = await st(p);
  await p.tap('#btn-pause'); await sleep(500);
  out.iphonePaused = await p.evaluate(() => !document.getElementById('pause-overlay').classList.contains('hidden'));
  await p.tap('.q-btn[data-q="low"]'); await sleep(800); out.iphoneLow = await st(p);
  await p.screenshot({ path: path.join(OUT, 'menu_iphone.png') });
  await p.tap('#btn-resume'); await sleep(400);
  out.iphoneResumed = await p.evaluate(() => document.getElementById('pause-overlay').classList.contains('hidden'));
  out.iphoneErrors = errs2;
  fs.writeFileSync(path.join(OUT, 'menu_test.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
