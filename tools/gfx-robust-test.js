// good-1+2 robustness test: renderer fallback, forced context loss/restore, iPhone emulation, WebKit.
// Usage (see GOOD-1+2-IOS-WEBGL-REPORT.md for the headless env):
//   node tools/gfx-robust-test.js chromium [case,...]   cases: fallback,nowebgl2,ctxloss,iphone,shaderfail
//   node tools/gfx-robust-test.js webkit   [case,...]
// Env: CHROME=/path/to/chromium (Chromium engine), PLAYWRIGHT_BROWSERS_PATH (WebKit). Writes
// docs/fidelity/good-1+2/<engine>_<case>.png and results_<engine>.json.
const { chromium, webkit } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.resolve(ROOT, process.env.GFX_OUT || 'docs/fidelity/good-1+2');
const ENGINE = process.argv[2] || 'chromium';
const CASES = (process.argv[3] || 'fallback,nowebgl2,ctxloss,iphone,shaderfail').split(',');
const PORT = 8781 + (ENGINE === 'webkit' ? 1 : 0);
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

// Init script: make the first N getContext('webgl2') calls return null (N = Infinity => never).
const failWebgl2 = (n) => `(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  let left = ${n === Infinity ? 'Infinity' : n};
  window.__webgl2Refused = 0;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl2' && left > 0) { left--; window.__webgl2Refused++; return null; }
    return orig.call(this, type, attrs);
  };
})();`;

async function run() {
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
  const browser = ENGINE === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ executablePath: process.env.CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const resPath = path.join(OUT, `results_${ENGINE}.json`);
  const results = fs.existsSync(resPath) ? JSON.parse(fs.readFileSync(resPath, 'utf8')) : {};
  results._browser = browser.version();

  for (const cs of CASES) {
    const ctxOpts = cs === 'iphone'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: ENGINE !== 'webkit' ? true : undefined, hasTouch: true, userAgent: IOS_UA }
      : { viewport: { width: 800, height: 500 } };
    if (ctxOpts.isMobile === undefined) delete ctxOpts.isMobile; // WebKit/Linux: isMobile unsupported
    const context = await browser.newContext(ctxOpts);
    if (cs === 'fallback') await context.addInitScript(failWebgl2(2));
    if (cs === 'nowebgl2') await context.addInitScript(failWebgl2(Infinity));
    // shaderfail: simulate a driver that rejects the water fragment shader (compile error).
    if (cs === 'shaderfail') await context.addInitScript(`(() => {
      const o = WebGL2RenderingContext.prototype.shaderSource;
      WebGL2RenderingContext.prototype.shaderSource = function (sh, src) {
        if (/uRects/.test(src) && /gl_FragColor|pc_fragColor/.test(src)) src = src.replace('void main() {', 'void main() { this_is_not_glsl;');
        return o.call(this, sh, src);
      };
    })();`);
    const page = await context.newPage();
    const uncaught = [], consoleErr = [], warns = [];
    page.on('pageerror', (e) => uncaught.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErr.push(m.text());
      if (m.type() === 'warning' && /\[gfx\]|Shader|Program Info/.test(m.text())) warns.push(m.text().slice(0, 300));
    });
    const r = { case: cs };
    try {
      await page.goto(`http://127.0.0.1:${PORT}/${process.env.GFX_QUERY || ''}`, { waitUntil: 'domcontentloaded' });
      await sleep(2500);
      if (cs === 'nowebgl2') {
        r.errorShown = await page.evaluate(() => document.getElementById('gfx-error')?.innerText || null);
        r.diag = await page.evaluate(() => window.__GFX_DIAG__ || null);
        r.refused = await page.evaluate(() => window.__webgl2Refused);
        await page.screenshot({ path: path.join(OUT, `${ENGINE}_${cs}.png`) });
      } else {
        if (cs === 'iphone') await page.tap('#char-female').catch(() => page.click('#char-female').catch(() => {}));
        else await page.click('#char-male').catch(() => {});
        if (cs === 'iphone') await page.tap('#btn-start').catch(() => page.click('#btn-start'));
        else await page.click('#btn-start');
        await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.player?.model, null, { timeout: 60000 }).catch(() => {});
        await sleep(3000);
        const probe = () => page.evaluate(() => {
          const g = window.__BELIZETRINI_OPNWRLD__;
          const r = g.renderer; const gl = r.getContext();
          let px = null, distinct = 0;
          if (!gl.isContextLost()) {
            r.render(g.scene, g.player.camera);
            const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
            const buf = new Uint8Array(4 * 16);
            const cols = new Set();
            for (let i = 0; i < 16; i++) {
              gl.readPixels(Math.floor(w * ((i % 4) + 0.5) / 4), Math.floor(h * (Math.floor(i / 4) + 0.5) / 4), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf.subarray(i * 4, i * 4 + 4));
              cols.add(buf.slice(i * 4, i * 4 + 3).join(','));
            }
            px = Array.from(buf.slice(0, 4)); distinct = cols.size;
          }
          return { frames: g._frames, lost: gl.isContextLost(), attempt: g.gfx?.attempt, tried: g.gfx?.tried?.map((t) => t.label + (t.ok ? ':ok' : ':fail')),
            healed: g.gfx?.healed, ctx: g.gfx?.context ? { losses: g.gfx.context.losses, restores: g.gfx.context.restores } : null,
            calls: r.info.render.calls, tris: r.info.render.triangles, programs: r.info.programs.length,
            bad: r.info.programs.filter((p) => p.diagnostics && p.diagnostics.runnable === false).length,
            px, distinctSamples: distinct, dbw: gl.drawingBufferWidth, dbh: gl.drawingBufferHeight,
            dpr: window.devicePixelRatio, glVersion: gl.getParameter(gl.VERSION), ua: navigator.userAgent.slice(0, 80),
            precisionFragHigh: gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision };
        });
        r.start = await probe();
        if (cs === 'fallback') r.refused = await page.evaluate(() => window.__webgl2Refused);
        if (cs === 'ctxloss') {
          await page.evaluate(() => { window.__ext = window.__BELIZETRINI_OPNWRLD__.renderer.getContext().getExtension('WEBGL_lose_context'); window.__ext.loseContext(); });
          await sleep(700);
          r.lostA = await page.evaluate(() => ({ f: window.__BELIZETRINI_OPNWRLD__._frames, lost: window.__BELIZETRINI_OPNWRLD__.gfx.context.lost, raf: window.__BELIZETRINI_OPNWRLD__._raf }));
          await sleep(700);
          r.lostB = await page.evaluate(() => ({ f: window.__BELIZETRINI_OPNWRLD__._frames, toast: document.getElementById('gfx-toast')?.textContent }));
          await page.screenshot({ path: path.join(OUT, `${ENGINE}_${cs}_lost.png`) });
          await page.evaluate(() => window.__ext.restoreContext());
          await sleep(3500);
          r.restored = await probe();
          await sleep(1000);
          r.restored2 = await page.evaluate(() => ({ f: window.__BELIZETRINI_OPNWRLD__._frames }));
          // Second cycle: the restored context must survive another loss too.
          await page.evaluate(() => { const e = window.__BELIZETRINI_OPNWRLD__.renderer.getContext().getExtension('WEBGL_lose_context'); e.loseContext(); setTimeout(() => e.restoreContext(), 600); });
          await sleep(4000);
          r.cycle2 = await probe();
          // Movement still works after restores.
          await page.keyboard.down('KeyW'); await sleep(1200); await page.keyboard.up('KeyW');
          r.moved = await page.evaluate(() => +(window.__BELIZETRINI_OPNWRLD__.player.groundSpeed ?? 0).toFixed(2));
        }
        if (cs === 'iphone') {
          await page.addStyleTag({ content: '#toast{display:none!important}' });
          r.mobileControls = await page.evaluate(() => !document.getElementById('mobile-controls')?.classList.contains('hidden'));
          // Drive the virtual stick for a second.
          const box = await page.locator('#stick-zone').boundingBox().catch(() => null);
          if (box) {
            await page.evaluate(() => { const g = window.__BELIZETRINI_OPNWRLD__; g.player.mobileStick.y = -1; });
            await sleep(1200);
            r.stickSpeed = await page.evaluate(() => +(window.__BELIZETRINI_OPNWRLD__.player.groundSpeed ?? 0).toFixed(2));
            await page.evaluate(() => { const g = window.__BELIZETRINI_OPNWRLD__; g.player.mobileStick.y = 0; });
          }
          await sleep(800);
        }
        await page.screenshot({ path: path.join(OUT, `${ENGINE}_${cs}.png`) });
        r.end = await probe();
      }
    } catch (e) {
      r.harnessError = String(e.message || e).slice(0, 400);
    }
    r.uncaught = [...new Set(uncaught)];
    r.consoleErrors = [...new Set(consoleErr.filter((e) => !/Failed to load resource|status of 404/.test(e)))];
    r.shaderWarnings = [...new Set(warns)];
    results[cs] = r;
    console.log(ENGINE, cs, JSON.stringify(r));
    await context.close();
  }
  fs.writeFileSync(resPath, JSON.stringify(results, null, 1));
  await browser.close(); server.close();
}
run().catch((e) => { console.error(e); process.exit(1); });
