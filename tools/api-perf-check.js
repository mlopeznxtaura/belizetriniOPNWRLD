// good-1+6: boot server.js, open the game, let the client sync, then read GET /api/status (perf block).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const PORT = 8833;
const OUT = process.argv[2] || path.join(ROOT, 'docs/fidelity/good-1+6/api_status.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/health`); break; } catch (_) { await sleep(250); } }
  const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
  await page.goto(`http://127.0.0.1:${PORT}/?quality=low&debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.governor, { timeout: 90000 });
  await page.evaluate(() => window.__BELIZETRINI_OPNWRLD__.beginPlay());
  await page.evaluate(() => window.__BELIZETRINI_OPNWRLD__.drive.apply({ action: 'set_wanted', stars: 3 }));
  await sleep(14000);
  const st = await (await fetch(`http://127.0.0.1:${PORT}/api/status`)).json();
  fs.writeFileSync(OUT, JSON.stringify(st, null, 1));
  console.log(JSON.stringify({ running: st.running, perf: st.perf, wanted: st.wanted, wantedState: st.wantedState, mission: st.mission }));
  await browser.close(); srv.kill();
})().catch((e) => { console.error(e); process.exit(1); });
