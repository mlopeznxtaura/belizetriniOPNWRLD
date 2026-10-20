// good-1+6 governor test: inject artificial frame load inside rAF (a busy-loop after each render) and
// record the governor timeline: it must step down under load, settle without thrashing, and recover.
// Usage: node tools/governor-test.js [--engine chromium|webkit] [--out docs/fidelity/good-1+6]
// Phases (seconds): A baseline · B fill-bound load (busy ms ∝ drawing-buffer pixels: pixel-ratio cuts
// help) · C heavy constant load (CPU-bound: walks the whole ladder incl. the tier drop) · D no load (recover).
const { chromium, webkit } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const ENGINE = opt('engine', 'chromium');
const OUT = path.resolve(ROOT, opt('out', 'docs/fidelity/good-1+6'));
const PUB = path.join(ROOT, 'public');
const PORT = 8810 + (ENGINE === 'webkit' ? 1 : 0);
const Q = opt('query', '?quality=medium&fps=20&debug=1');
const PH = { A: +opt('A', 8), B: +opt('B', 30), C: +opt('C', 30), D: +opt('D', 75) };
const FILL_MS = +opt('fill', 70); // busy ms at the medium preset's full buffer (480x270 CSS @ DPR 2 → 600x338)
const HEAVY_MS = +opt('heavy', 140);
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
  const context = await browser.newContext({ viewport: { width: 480, height: 270 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  await page.goto(`http://127.0.0.1:${PORT}/${Q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.governor, { timeout: 90000 });
  await page.evaluate(() => window.__BELIZETRINI_OPNWRLD__.beginPlay());
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.player?.model, { timeout: 90000 }).catch(() => {});
  await sleep(1500);
  // Install the load hook and a 250 ms sampler; reset the governor clock so t=0 is the start of phase A.
  await page.evaluate(({ FILL_MS, HEAVY_MS }) => {
    const g = window.__BELIZETRINI_OPNWRLD__;
    g.governor.rebase(g.quality.name); g.governor.timeline.length = 0; g.governor.t = 0;
    window.__LOAD = { mode: 'none' };
    const gl = g.renderer.getContext();
    const ref = 600 * 338;
    const orig = g.renderer.render.bind(g.renderer);
    g.renderer.render = (s, c) => {
      orig(s, c);
      const L = window.__LOAD; let ms = 0;
      if (L.mode === 'fill') ms = FILL_MS * (gl.drawingBufferWidth * gl.drawingBufferHeight) / ref;
      else if (L.mode === 'heavy') ms = HEAVY_MS;
      if (ms) { const t0 = performance.now(); while (performance.now() - t0 < ms) {} }
    };
    window.__SAMPLES = [];
    const t0 = performance.now();
    setInterval(() => {
      const s = g.governor.state();
      window.__SAMPLES.push({ t: +((performance.now() - t0) / 1000).toFixed(2), load: window.__LOAD.mode, fps: s.fps, avgMs: s.avgMs, level: s.level,
        tier: s.tier, pr: s.pixelRatio, buf: [gl.drawingBufferWidth, gl.drawingBufferHeight], outl: s.outlineDist, clouds: s.clouds, foam: s.foam });
    }, 250);
  }, { FILL_MS, HEAVY_MS });
  const phase = async (mode, sec) => { await page.evaluate((m) => { window.__LOAD.mode = m; }, mode); await sleep(sec * 1000); };
  await phase('none', PH.A);
  await phase('fill', PH.B);
  await page.screenshot({ path: path.join(OUT, `${ENGINE}_under_fill_load.png`) });
  await phase('heavy', PH.C);
  await page.screenshot({ path: path.join(OUT, `${ENGINE}_under_heavy_load.png`) });
  await phase('none', PH.D);
  await page.screenshot({ path: path.join(OUT, `${ENGINE}_recovered.png`) });
  const res = await page.evaluate(() => {
    const g = window.__BELIZETRINI_OPNWRLD__;
    return { samples: window.__SAMPLES, timeline: g.governor.timeline, final: g.governor.state(), ladder: g.governor.steps };
  });
  // Analysis.
  const ev = res.timeline;
  const tB = PH.A, tC = PH.A + PH.B, tD = PH.A + PH.B + PH.C;
  const inPh = (e, a, b) => e.t >= a && e.t < b;
  const downsB = ev.filter((e) => inPh(e, tB, tC) && e.action.startsWith('down')).length;
  const upsB = ev.filter((e) => inPh(e, tB, tC) && e.action.startsWith('up')).length;
  // thrash = direction reversals within 8 s
  let reversals = 0;
  for (let i = 1; i < ev.length; i++) if (ev[i].action[0] !== ev[i - 1].action[0] && ev[i].t - ev[i - 1].t < 8) reversals++;
  const s = res.samples;
  const lastOf = (a, b) => [...s].reverse().find((x) => x.t >= a && x.t < b);
  const summary = {
    engine: ENGINE, query: Q, phases: PH, fillMs: FILL_MS, heavyMs: HEAVY_MS, errors: [...new Set(errs)],
    ladder: res.ladder.map((x) => x.kind + (x.pr ? ':' + x.pr : x.tier ? ':' + x.tier : '')),
    endOfA: lastOf(0, tB), endOfB: lastOf(tB, tC), endOfC: lastOf(tC, tD), endOfD: lastOf(tD, 1e9),
    stepsDownInB: downsB, stepsUpInB: upsB, reversalsUnder8s: reversals,
    maxLevelInC: Math.max(...s.filter((x) => x.t >= tC && x.t < tD).map((x) => x.level)),
    firstDownAfterLoad: ev.find((e) => e.t >= tB && e.action.startsWith('down'))?.t ?? null,
    recoveredToLevel0At: (() => { const x = s.find((x) => x.t >= tD && x.level === 0); return x ? x.t : null; })(),
    events: ev.length,
  };
  fs.writeFileSync(path.join(OUT, `timeline_${ENGINE}.json`), JSON.stringify({ summary, timeline: ev, samples: s }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
