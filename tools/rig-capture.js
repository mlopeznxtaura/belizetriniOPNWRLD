// Headless procedural-rig verification: serves public/ + tools/rig-capture.html, drives the real
// Player/ProceduralRig, writes PNGs + metrics to tools/marco_char_delta/anim_verify/.
//   node tools/rig-capture.js
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'tools/marco_char_delta/anim_verify');
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const file = u === '/_rig_capture.html' ? path.join(ROOT, 'tools/rig-capture.html') : path.join(PUB, u);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(8766, '127.0.0.1', r));
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); if (/error|warn|rig/i.test(t)) console.log('[page]', t); });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.setViewport({ width: 360, height: 460 });
  await page.goto('http://127.0.0.1:8766/_rig_capture.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title === 'READY', { timeout: 240000 });
  const err = await page.evaluate(() => window.__ERROR__ || null);
  if (err) { console.error('HARNESS ERROR', err); }
  const metrics = await page.evaluate(() => window.__METRICS__ || null);
  const images = await page.evaluate(() => window.__IMAGES__ || {});
  fs.mkdirSync(OUT, { recursive: true });
  for (const [k, v] of Object.entries(images)) {
    fs.writeFileSync(path.join(OUT, `${k}.png`), Buffer.from(v.split(',')[1], 'base64'));
  }
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
  console.log('wrote', Object.keys(images).length, 'images to', OUT);
  await browser.close();
  server.close();
  if (err) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
