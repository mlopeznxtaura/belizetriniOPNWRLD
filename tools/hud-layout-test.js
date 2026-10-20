// HUD layout test: screenshots + automated bounding-box overlap check of the in-game HUD.
// Usage: node tools/hud-layout-test.js [chromium|webkit] [--out docs/fidelity/good-1+8]
// Devices: iPhone 15 portrait 390x844@3, iPhone SE portrait 375x667@2, iPhone 15 landscape 844x390@3,
// SE landscape 667x375@2, desktop 1280x720. The longest mission brief, a prompt and a toast are forced
// visible, wanted = 5 stars, so the worst case is checked. Overlap = any two HUD boxes intersecting
// (> 0.5 px each way), or a box leaving the viewport.
const { chromium, webkit } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const ENGINE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'chromium';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(ROOT, opt('out', 'docs/fidelity/good-1+8'));
const PUB = path.resolve(opt('root', path.join(ROOT, 'public')));
const TAG = opt('tag', ENGINE);
const PORT = 8850 + (ENGINE === 'webkit' ? 1 : 0) + (PUB.includes('/tmp/') ? 2 : 0);
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEVICES = [
  { name: 'iphone15_portrait', w: 390, h: 844, dsf: 3, touch: true },
  { name: 'iphoneSE_portrait', w: 375, h: 667, dsf: 2, touch: true },
  { name: 'iphone15_landscape', w: 844, h: 390, dsf: 3, touch: true },
  { name: 'iphoneSE_landscape', w: 667, h: 375, dsf: 2, touch: true },
  // Safe-area variants: headless engines report env(safe-area-inset-*) = 0, so the iPhone 15 insets are
  // injected through the CSS variables the layout reads (portrait 59/0/34/0, landscape 0/59/21/59).
  { name: 'iphone15_portrait_insets', w: 390, h: 844, dsf: 3, touch: true, insets: [59, 0, 34, 0] },
  { name: 'iphone15_landscape_insets', w: 844, h: 390, dsf: 3, touch: true, insets: [0, 59, 21, 59] },
  { name: 'desktop', w: 1280, h: 720, dsf: 1, touch: false },
];
const IDS = ['tod-clock', 'mission-brief', 'cash', 'wanted', 'health-wrap', 'minimap', 'district-label', 'prompt', 'toast', 'btn-pause', 'stick-zone', 'btn-action', 'btn-brake'];

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
  const results = {};
  let total = 0;
  for (const d of DEVICES) {
    const ctxOpts = { viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dsf };
    if (d.touch) Object.assign(ctxOpts, { hasTouch: true, userAgent: IOS_UA, ...(ENGINE !== 'webkit' ? { isMobile: true } : {}) });
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 300)); });
    await page.goto(`http://127.0.0.1:${PORT}/?quality=low&gov=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.hud, { timeout: 90000 });
    await page.evaluate(() => window.__BELIZETRINI_OPNWRLD__.beginPlay());
    await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.player?.model, { timeout: 90000 }).catch(() => {});
    if (d.insets) await page.addStyleTag({ content: `:root{--sat:${d.insets[0]}px!important;--sar:${d.insets[1]}px!important;--sab:${d.insets[2]}px!important;--sal:${d.insets[3]}px!important}` });
    await sleep(1500);
    // Worst case content: the longest brief, a prompt, a toast, 5 stars, the clock.
    await page.evaluate(async () => {
      const g = window.__BELIZETRINI_OPNWRLD__;
      const { MISSIONS } = await import('/js/missions.js');
      const list = Array.isArray(MISSIONS) ? MISSIONS : Object.values(MISSIONS);
      const longest = list.reduce((a, m) => ((m.brief || '').length > (a.brief || '').length ? m : a), list[0]);
      g.missions.update = () => {}; // keep the forced texts on screen
      g.hud.setMission({ name: longest.name, brief: longest.brief });
      g.hud.setWanted(5, false);
      g.hud.showPrompt('Press F — Sedan'); g.hud._promptClear && clearTimeout(g.hud._promptClear);
      g.hud.toast('+$1500 — Safehouse Run done', 600000);
      window.__keepPrompt = setInterval(() => g.hud.showPrompt('Press F — Sedan'), 100);
    });
    await sleep(600);
    const r = await page.evaluate(([IDS, ins]) => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const [it, ir, ib, il] = ins || [0, 0, 0, 0]; // boxes must stay inside the safe area
      const boxes = [];
      for (const id of IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        const cs = getComputedStyle(el);
        let hidden = cs.display === 'none' || cs.visibility === 'hidden' || el.classList.contains('hidden');
        for (let p = el.parentElement; p && !hidden; p = p.parentElement) { const pc = getComputedStyle(p); if (pc.display === 'none' || p.classList.contains('hidden')) hidden = true; }
        const b = el.getBoundingClientRect();
        if (hidden || b.width === 0 || b.height === 0) continue;
        boxes.push({ id, x: +b.left.toFixed(1), y: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
      }
      const overlaps = [], outside = [];
      for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i];
        const toast = a.id === 'toast' || a.id === 'prompt'; // centred, inset-independent
        const L = toast ? 0 : il, T = toast ? 0 : it, Rr = toast ? 0 : ir, B = toast ? 0 : ib;
        if (a.x < L - 0.5 || a.y < T - 0.5 || a.x + a.w > vw - Rr + 0.5 || a.y + a.h > vh - B + 0.5) outside.push(a.id);
        for (let j = i + 1; j < boxes.length; j++) {
          const b = boxes[j];
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ox > 0.5 && oy > 0.5) overlaps.push([a.id, b.id, +ox.toFixed(1), +oy.toFixed(1)]);
        }
      }
      return { vw, vh, boxes, overlaps, outside, touchClass: document.documentElement.classList.contains('touch') };
    }, [IDS, d.insets || null]);
    const shot = path.join(OUT, `${TAG}_${d.name}.png`);
    await page.screenshot({ path: shot });
    r.errors = [...new Set(errs)];
    r.png = path.relative(ROOT, shot);
    results[d.name] = r;
    total += r.overlaps.length + r.outside.length;
    console.log(TAG, d.name, `boxes=${r.boxes.length}`, 'overlaps=' + JSON.stringify(r.overlaps), 'outside=' + JSON.stringify(r.outside), 'errors=' + r.errors.length);
    await context.close();
  }
  results._total = total;
  results._browser = browser.version();
  fs.writeFileSync(path.join(OUT, `hud_${TAG}.json`), JSON.stringify(results, null, 1));
  console.log(TAG, 'TOTAL overlaps+outside =', total);
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
