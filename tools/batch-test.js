// good-1+4 batching checks: character swap (merged hulls are forgotten/re-registered), vehicle
// enter/drive/exit with merged vehicles, ?toon=0 + batching, ?batch=0. Chromium/SwiftShader.
const puppeteer = require('puppeteer-core'); const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'); const PUB = path.join(ROOT, 'public'); const OUT = path.join(ROOT, 'docs/fidelity/good-1+4');
const T = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = path.join(PUB, u); if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const info = (p) => p.evaluate(() => { const g = window.__BELIZETRINI_OPNWRLD__; const s = g.toon.stats(); let meshes = 0; g.player.model?.traverse((o) => { if (o.isMesh) meshes++; });
  return { charMeshes: meshes, charBatch: g.player.batchStats || null, outlinesRegistered: s.registered, byClass: Object.fromEntries(Object.entries(s.byClass).map(([k, v]) => [k, v.n])), calls: g.renderer.info.render.calls, inVehicle: !!g.player.inVehicle }; });
(async () => {
  await new Promise((r) => srv.listen(8796, '127.0.0.1', r));
  const b = await puppeteer.launch({ executablePath: process.env.CHROME, headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const out = {};
  for (const q of ['?quality=high', '?quality=high&toon=0', '?quality=high&batch=0']) {
    const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load/.test(m.text())) errs.push(m.text()); });
    await p.setViewport({ width: 800, height: 500 });
    await p.goto('http://127.0.0.1:8796/' + q); await sleep(1500);
    await p.click('#char-male').catch(() => {}); await p.click('#btn-start');
    await p.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.player?.model, { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    const r = { start: await info(p) };
    if (q === '?quality=high') {
      // swap character twice while running
      await p.evaluate(() => window.__BELIZETRINI_OPNWRLD__.player.setCharacter('female')); await sleep(3500); r.swapFemale = await info(p);
      await p.evaluate(() => window.__BELIZETRINI_OPNWRLD__.player.setCharacter('male')); await sleep(3500); r.swapMale = await info(p);
      // enter nearest sedan, drive, screenshot from the chase camera
      await p.evaluate(() => { const g = window.__BELIZETRINI_OPNWRLD__; const v = g.vehicles.find((x) => x.type === 'sedan'); g.player.mesh.position.set(v.mesh.position.x + 2.2, 0, v.mesh.position.z); });
      await sleep(500); await p.keyboard.press('KeyF'); await sleep(1200);
      await p.keyboard.down('KeyW'); await sleep(1500); await p.keyboard.down('KeyA'); await sleep(600); await p.keyboard.up('KeyA'); await p.keyboard.up('KeyW');
      r.driving = await info(p);
      await p.screenshot({ path: path.join(OUT, 'batch_drive.png') });
      await p.keyboard.press('KeyF'); await sleep(1200); r.exited = await info(p);
    }
    r.errors = errs; out[q] = r; console.log(q, JSON.stringify(r));
    await p.close();
  }
  fs.writeFileSync(path.join(OUT, 'batch_test.json'), JSON.stringify(out, null, 1));
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
