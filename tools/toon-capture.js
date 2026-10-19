// good-1+1 toon capture: before/after screenshots at 4 fixed spots x 2 times of day, plus
// renderer.info (draw calls, triangles), point-light count and frame time on the SwiftShader path.
//
// Usage:
//   node tools/toon-capture.js after                      # serves ./public (toon on)
//   node tools/toon-capture.js before --root /tmp/app13-before/public   # baseline tree (150e290)
//   node tools/toon-capture.js flag0 --query '?toon=0'    # current tree with the kill switch
//   node tools/toon-capture.js sheet                      # contact sheet from existing PNGs + metrics
// Options: --spots a,b  --times noon,dusk  (subset runs to stay under command time limits)
// Env: CHROME=/path/to/chrome (default /usr/bin/google-chrome)
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs/fidelity/good-1+1');
const argv = process.argv.slice(2);
const TAG = argv[0] || 'after';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const PUB = path.resolve(opt('root', path.join(ROOT, 'public')));
const QUERY = opt('query', '');
const PORT = +opt('port', 8771);

// Fixed spots: player position, camera yaw (camera looks along (-sin yaw, -cos yaw)), character heading.
const SPOTS = {
  queen: { pos: [-60, 6], yaw: 0.35, heading: 0.35 + Math.PI * 0.75, label: 'Queen St, Belize' },
  shore: { pos: [-70, -101], yaw: -0.75, heading: Math.PI * 0.9, label: 'South shore / water, Belize' },
  bridge: { pos: [12, 3], yaw: -Math.PI / 2 + 0.12, heading: Math.PI / 2, label: 'Causeway to Port of Spain' },
  pos: { pos: [145, 22], yaw: 0.15, heading: Math.PI * 0.6, label: 'Downtown Port of Spain' },
};
const TIMES = { noon: 12, dusk: 18.75, night: 23 }; // night is an optional extra (--times night)
const wantSpots = (opt('spots', Object.keys(SPOTS).join(','))).split(',');
const wantTimes = (opt('times', 'noon,dusk')).split(',');

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    const file = path.join(PUB, u);
    if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  await page.setViewport({ width: 960, height: 540 });
  await page.goto(`http://127.0.0.1:${PORT}/${QUERY}`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await page.click('#char-male').catch(() => {});
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.player?.model, { timeout: 60000 }).catch(() => {});
  await sleep(2500);
  // Hide HUD/toasts so the frames compare the world only.
  await page.addStyleTag({ content: '#hud,#toast,#prompt,#mobile-controls{display:none!important}' });

  const metricsPath = path.join(OUT, 'metrics.json');
  const all = fs.existsSync(metricsPath) ? JSON.parse(fs.readFileSync(metricsPath, 'utf8')) : {};
  all[TAG] = all[TAG] || {};
  for (const sk of wantSpots) {
    for (const tk of wantTimes) {
      const S = SPOTS[sk];
      await page.evaluate((S, hour) => {
        const g = window.__BELIZETRINI_OPNWRLD__;
        const dn = g.world.dayNight; dn.setHour(hour); dn.pause(true);
        const p = g.player;
        if (p.inVehicle) p.exitVehicle();
        p.mesh.position.set(S.pos[0], 0, S.pos[1]);
        p.yaw = S.yaw; p.pitch = 0.12; p.heading = S.heading;
        p._camInit = false;
        g.wanted = 0;
        for (const c of g.cops) { c.mesh.position.set(9999, 0, 9999); }
      }, S, TIMES[tk]);
      await sleep(1800);
      const shot = path.join(OUT, `${TAG}_${sk}_${tk}.png`);
      await page.screenshot({ path: shot });
      const m = await page.evaluate(() => {
        const g = window.__BELIZETRINI_OPNWRLD__;
        const r = g.renderer; const cam = g.player.camera;
        const gl = r.getContext(); const px = new Uint8Array(4);
        r.render(g.scene, cam);
        const info = { calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs?.length ?? null,
          geometries: r.info.memory.geometries, textures: r.info.memory.textures };
        const times = [];
        for (let i = 0; i < 15; i++) {
          const t0 = performance.now();
          r.render(g.scene, cam);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // sync the GPU (SwiftShader) work
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        let pointLights = 0, pointLightsOn = 0;
        g.scene.traverse((o) => { if (o.isPointLight) { pointLights++; if (o.intensity > 0 && o.visible) pointLightsOn++; } });
        const ts = g.toon?.stats ? g.toon.stats() : null;
        return { ...info, frameMsMedian: +times[7].toFixed(2), frameMsMin: +times[0].toFixed(2), pointLights, pointLightsOn,
          toon: !!g.toon?.on, outlines: ts, hour: +g.world.dayNight.hour.toFixed(2),
          cam: cam.position.toArray().map((v) => +v.toFixed(1)) };
      });
      all[TAG][`${sk}_${tk}`] = { ...m, png: path.relative(ROOT, shot) };
      console.log(TAG, sk, tk, JSON.stringify(m));
    }
  }
  all[TAG]._errors = [...new Set(errs.filter((e) => !/Failed to load resource/.test(e)))];
  fs.writeFileSync(metricsPath, JSON.stringify(all, null, 1));
  console.log('errors', JSON.stringify(all[TAG]._errors));
  await browser.close(); server.close();
}

// Contact sheet: rows = spot x time, columns = before | after (rendered via the same headless Chrome).
async function sheet() {
  const metrics = JSON.parse(fs.readFileSync(path.join(OUT, 'metrics.json'), 'utf8'));
  const cols = ['before', 'after'].filter((t) => metrics[t]);
  const rows = [];
  for (const sk of Object.keys(SPOTS)) for (const tk of ['noon', 'dusk']) rows.push([sk, tk]);
  const img = (f) => fs.existsSync(f) ? 'data:image/png;base64,' + fs.readFileSync(f).toString('base64') : '';
  let html = `<html><body style="margin:0;background:#14161c;color:#e8e8e8;font:13px sans-serif">
  <div style="padding:10px 14px;font-size:18px"><b>belizetriniOPNWRLD good-1+1</b> — Wind Waker toon pass · before (150e290) vs after · SwiftShader 960x540</div>
  <table style="border-collapse:collapse">`;
  html += '<tr><td></td>' + cols.map((c) => `<td style="padding:4px 8px;font-size:15px"><b>${c}</b></td>`).join('') + '</tr>';
  for (const [sk, tk] of rows) {
    html += `<tr><td style="padding:4px 8px;width:120px;vertical-align:top">${SPOTS[sk].label}<br><i>${tk}</i></td>`;
    for (const c of cols) {
      const m = metrics[c][`${sk}_${tk}`];
      const f = path.join(OUT, `${c}_${sk}_${tk}.png`);
      html += `<td style="padding:3px"><img src="${img(f)}" width="480" height="270" style="display:block"><div style="padding:2px 0 6px">${m ? `calls ${m.calls} · tris ${m.triangles} · ${m.frameMsMedian} ms` : 'n/a'}</div></td>`;
    }
    html += '</tr>';
  }
  html += '</table></body></html>';
  const htmlPath = path.join(OUT, 'contact_sheet.html');
  fs.writeFileSync(htmlPath, html);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1130, height: 400 });
  await page.goto('file://' + htmlPath);
  await page.screenshot({ path: path.join(OUT, 'contact_sheet.png'), fullPage: true });
  await browser.close();
  fs.unlinkSync(htmlPath);
  console.log('sheet', path.join(OUT, 'contact_sheet.png'));
}

(TAG === 'sheet' ? sheet() : capture()).catch((e) => { console.error(e); process.exit(1); });
