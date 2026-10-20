// good-1+9 mission template test: plays every stage of all 6 missions through agent / teleport hooks,
// forces failures (timer, wasted) and retries from the checkpoint, and checks localStorage progress
// survives a reload (completed set, cash, current mission, mid-mission checkpoint).
// Usage: node tools/mission-test.js [--engine chromium|webkit] [--device iphone|desktop] [--out docs/fidelity/good-1+9]
const { chromium, webkit } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const ENGINE = opt('engine', 'chromium');
const DEVICE = opt('device', 'iphone');
const OUT = path.resolve(ROOT, opt('out', 'docs/fidelity/good-1+9'));
const PUB = path.join(ROOT, 'public');
const PORT = 8860 + (ENGINE === 'webkit' ? 1 : 0);
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
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
  const ctxOpts = DEVICE === 'iphone'
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, userAgent: IOS_UA, ...(ENGINE !== 'webkit' ? { isMobile: true } : {}) }
    : { viewport: { width: 800, height: 450 } };
  const context = await browser.newContext(ctxOpts); // one context: localStorage persists across reloads
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  const ev = (fn, a) => page.evaluate(fn, a);
  const boot = async (query) => {
    await page.goto(`http://127.0.0.1:${PORT}/${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.missions, { timeout: 90000 });
    await ev(() => window.__BELIZETRINI_OPNWRLD__.beginPlay());
    await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.running, { timeout: 90000 });
    await sleep(1200);
    await ev(() => {
      const g = window.__BELIZETRINI_OPNWRLD__;
      g.player.takeDamage = function () {}; // the escape stages must not kill the test player
      for (const c of g.cops) c.mesh.position.set(9000, 0, 9000);
    });
  };
  const ms = () => ev(() => window.__BELIZETRINI_OPNWRLD__.missions.state_());
  const visible = (id) => ev((id) => !document.getElementById(id).classList.contains('hidden'), id);
  const R = { engine: ENGINE, device: DEVICE, missions: [], failures: [], persistence: {} };

  await boot('?quality=low&gov=0&fresh=1');
  R.freshStart = await ms();

  /** Perform the current stage's objective through hooks. */
  const doStage = async () => ev(() => {
    const g = window.__BELIZETRINI_OPNWRLD__, M = g.missions, s = M.stage;
    const tp = (x, z) => { if (g.player.inVehicle) g.player.exitVehicle(); g.player.mesh.position.set(x, 0, z); };
    const mk = s.marker ? g.world.markers[s.marker] : null;
    switch (s.type) {
      case 'goto': tp(mk.x + 1, mk.z + 1); if (s.interact) { M.update(0.016); g._onInteract(); } break;
      case 'pickup':
        if (s.vehicle) {
          const v = g.vehicles.find((x) => x.type === s.vehicle);
          tp(v.mesh.position.x + 1.5, v.mesh.position.z); g._onInteract();
        } else { tp(mk.x + 1, mk.z); g._onInteract(); }
        break;
      case 'deliver': tp(mk.x + 1, mk.z); g._onInteract(); break;
      case 'chase': case 'takedown': { const n = M.npc.mesh.position; tp(n.x + 1, n.z + 0.5); M.update(0.016); g._onInteract(); break; }
      case 'survive': M.debugAdvance(s.seconds + 0.1); break;
      case 'escape': g.drive.apply({ action: 'clear_wanted' }); break;
    }
    return { type: s.type, stage: M.stageIndex };
  });

  const playMission = async (id, { viaAgent = true } = {}) => {
    if (viaAgent) await ev((id) => window.__BELIZETRINI_OPNWRLD__.drive.apply({ action: 'set_mission', missionId: id }), id);
    await sleep(400);
    const rec = { id, stages: [], start: await ms() };
    for (let guard = 0; guard < 12; guard++) {
      const st = await ms();
      if (st.state !== 'active' || st.id !== id) break;
      const before = st.stage;
      const did = await doStage();
      await sleep(700);
      const after = await ms();
      rec.stages.push({ ...did, wanted: await ev(() => window.__BELIZETRINI_OPNWRLD__.wanted), advancedTo: after.state === 'active' && after.id === id ? after.stage : after.state, checkpoint: after.checkpoint });
      if (after.state === 'active' && after.id === id && after.stage === before) { rec.stuck = before; break; }
    }
    rec.end = await ms();
    rec.completeScreen = await visible('mission-complete');
    rec.cash = await ev(() => window.__BELIZETRINI_OPNWRLD__.cash);
    return rec;
  };

  // 1. Play missions 1..6 via the agent action set_mission, every stage through hooks.
  for (let id = 1; id <= 6; id++) {
    const rec = await playMission(id);
    if (id === 1 || id === 6) await page.screenshot({ path: path.join(OUT, `${ENGINE}_complete_m${id}.png`) });
    if (rec.completeScreen) { await page.click('#btn-continue').catch(() => {}); await sleep(500); }
    R.missions.push(rec);
    console.log('mission', id, JSON.stringify({ stages: rec.stages.map((s) => `${s.type}->${s.advancedTo}`), end: rec.end.state, complete: rec.completeScreen, cash: rec.cash, stuck: rec.stuck }));
  }
  R.afterStory = { ...(await ms()), progress: await ev(() => JSON.parse(localStorage.getItem('bto.progress.v1'))) };

  // 2a. Forced failure: Creek Drop timer runs out → fail screen → retry from checkpoint (stage 1, package back).
  {
    await ev(() => window.__BELIZETRINI_OPNWRLD__.drive.apply({ action: 'set_mission', missionId: 3 }));
    await sleep(500);
    await ev(() => window.__BELIZETRINI_OPNWRLD__.missions.debugAdvance(121));
    await sleep(600);
    const failed = { ...(await ms()), failScreen: await visible('mission-fail'), reason: await ev(() => document.querySelector('#mission-fail .mf-reason').textContent) };
    await page.screenshot({ path: path.join(OUT, `${ENGINE}_fail_timer.png`) });
    await page.click('#btn-retry-cp');
    await sleep(500);
    const retried = { ...(await ms()), failScreen: await visible('mission-fail') };
    const rec = await playMission(3, { viaAgent: false });
    if (rec.completeScreen) { await page.click('#btn-continue').catch(() => {}); await sleep(300); }
    R.failures.push({ case: 'Creek Drop timer', failed, retried, completedAfterRetry: rec.end.completed.includes(3) && rec.completeScreen });
    console.log('fail1', JSON.stringify(R.failures.at(-1)).slice(0, 600));
  }
  // 2b. Wasted on the escape stage of Warehouse Soft Hit → retry resumes at the stage-3 checkpoint
  //     (not the start) and re-applies the 2-star heat.
  {
    await ev(() => window.__BELIZETRINI_OPNWRLD__.drive.apply({ action: 'set_mission', missionId: 5 }));
    await sleep(400);
    await doStage(); await sleep(600); // goto
    await doStage(); await sleep(800); // takedown → escape (checkpoint)
    const atEscape = await ms();
    await ev(() => window.__BELIZETRINI_OPNWRLD__._respawn()); // wasted
    await sleep(500);
    const failed = { ...(await ms()), failScreen: await visible('mission-fail'), reason: await ev(() => document.querySelector('#mission-fail .mf-reason').textContent),
      retryLabel: await ev(() => document.getElementById('btn-retry-cp').textContent) };
    await page.screenshot({ path: path.join(OUT, `${ENGINE}_fail_wasted.png`) });
    await ev(() => window.__BELIZETRINI_OPNWRLD__.drive.apply({ action: 'retry_mission' })); // agent retry
    await sleep(800);
    const retried = { ...(await ms()), wanted: await ev(() => window.__BELIZETRINI_OPNWRLD__.wanted) };
    await doStage(); await sleep(900);
    const end = await ms();
    if (await visible('mission-complete')) { await page.click('#btn-continue').catch(() => {}); await sleep(300); }
    R.failures.push({ case: 'Warehouse wasted on escape stage', atEscape, failed, retried, end });
    console.log('fail2', JSON.stringify(R.failures.at(-1)).slice(0, 700));
  }
  // 3. Persistence: mid-mission checkpoint, then reload.
  {
    await ev(() => window.__BELIZETRINI_OPNWRLD__.drive.apply({ action: 'set_mission', missionId: 4 }));
    await sleep(400);
    await doStage(); await sleep(600); // goto → chase
    await doStage(); await sleep(800); // chase → escape (checkpoint at stage 3)
    const before = { ...(await ms()), pos: await ev(() => { const p = window.__BELIZETRINI_OPNWRLD__.player.position; return [+p.x.toFixed(1), +p.z.toFixed(1)]; }), cash: await ev(() => window.__BELIZETRINI_OPNWRLD__.cash),
      saved: await ev(() => JSON.parse(localStorage.getItem('bto.progress.v1'))) };
    await boot('?quality=low&gov=0'); // reload, no ?fresh
    const after = { ...(await ms()), pos: await ev(() => { const p = window.__BELIZETRINI_OPNWRLD__.player.position; return [+p.x.toFixed(1), +p.z.toFixed(1)]; }), cash: await ev(() => window.__BELIZETRINI_OPNWRLD__.cash),
      wanted: await ev(() => window.__BELIZETRINI_OPNWRLD__.wanted) };
    await page.screenshot({ path: path.join(OUT, `${ENGINE}_resumed.png`) });
    R.persistence = { before, after,
      ok: after.id === before.id && after.stage === before.stage && JSON.stringify(after.completed.sort()) === JSON.stringify(before.completed.sort()) && after.cash === before.cash };
    console.log('persist', JSON.stringify({ before: [before.id, before.stage, before.completed, before.cash, before.pos], after: [after.id, after.stage, after.completed, after.cash, after.pos, after.wanted], ok: R.persistence.ok }));
  }
  R.errors = [...new Set(errs)];
  fs.writeFileSync(path.join(OUT, `missions_${ENGINE}.json`), JSON.stringify(R, null, 1));
  console.log('errors', JSON.stringify(R.errors));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
