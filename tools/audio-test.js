// good-1+10 audio test (iPhone emulation): context created + 'running' after a simulated tap on START,
// suspended on visibility hidden and running again after visible / pageshow, auto-resume after an
// OS-style suspend (interruption path), nodes created per event (footsteps, sting, chirps), engine
// pitch follows speed, siren with wanted, mute toggle persisted, one-time silent-switch hint,
// and a real signal measured on the master bus (AnalyserNode RMS).
// Usage: node tools/audio-test.js [chromium|webkit] [--out docs/fidelity/good-1+10]
const { chromium, webkit } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const ENGINE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'chromium';
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(ROOT, opt('out', 'docs/fidelity/good-1+10'));
const PUB = path.join(ROOT, 'public');
const PORT = 8870 + (ENGINE === 'webkit' ? 1 : 0);
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, userAgent: IOS_UA, ...(ENGINE !== 'webkit' ? { isMobile: true } : {}) });
  // Gesture spy: record every AudioContext construction and resume() call with the event that is
  // being dispatched at that instant (window.event). A call made synchronously inside the tap handler
  // sees a trusted touchend/pointerup/click; anything after an await/timer sees no event.
  await context.addInitScript(() => {
    const log = (window.__acLog = []);
    const now = () => { const e = window.event; return { ev: e ? e.type : null, trusted: !!(e && e.isTrusted), t: Math.round(performance.now()) }; };
    for (const name of ['AudioContext', 'webkitAudioContext']) {
      const Orig = window[name];
      if (!Orig) continue;
      const origResume = Orig.prototype.resume;
      if (origResume && !origResume.__spy) {
        Orig.prototype.resume = function () { log.push({ op: 'resume', stateBefore: this.state, ...now() }); return origResume.apply(this, arguments); };
        Orig.prototype.resume.__spy = true;
      }
      const Spy = function (...a) { const c = new Orig(...a); log.push({ op: 'create', cls: name, state: c.state, ...now() }); c.addEventListener('statechange', () => log.push({ op: 'state', state: c.state, ...now() })); return c; };
      Spy.prototype = Orig.prototype;
      window[name] = Spy;
    }
  });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  const ev = (fn, a) => page.evaluate(fn, a);
  const A = () => ev(() => window.__BELIZETRINI_OPNWRLD__.audio.state());
  const R = { engine: ENGINE, steps: {} };
  const SINK_STEPS = new Set(['runningAfterTap', 'suspendOnHiddenResumeOnVisible', 'resumeOnPageshow', 'autoResumeAfterInterruption', 'footstepNodesPerEvent', 'enginePitchBySpeed', 'missionCompleteSting', 'ambienceDayNight', 'muteToggle']);
  const check = (name, ok, data) => {
    const limit = !ok && R.noAudioSink && SINK_STEPS.has(name);
    R.steps[name] = { ok: !!ok, ...(limit ? { limit: 'no-audio-sink' } : {}), ...data };
    console.log(ENGINE, name, ok ? 'OK' : (limit ? 'LIMIT(no audio sink)' : 'FAIL'), JSON.stringify(data).slice(0, 300));
  };

  await page.goto(`http://127.0.0.1:${PORT}/?quality=low&gov=0&fresh=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.audio, { timeout: 90000 });
  await sleep(800);
  const before = await A();
  check('noContextBeforeGesture', before.state === 'none' && !before.unlocked, before);

  // 1. Simulated tap on START (touchstart/touchend + click).
  await page.tap('#btn-start');
  await sleep(1200);
  const afterTap = await A();
  const acLog = await ev(() => window.__acLog.slice());
  const create = acLog.find((x) => x.op === 'create');
  const gestureResumes = acLog.filter((x) => x.op === 'resume' && x.trusted && ['touchend', 'pointerup', 'click', 'keydown'].includes(x.ev));
  const strayResumes = acLog.filter((x) => x.op === 'resume' && !x.trusted && x.t <= (create ? create.t + 50 : 0));
  // Created inside a trusted gesture, and either already 'running' at creation (Chromium) or resume()d
  // synchronously inside that same gesture (WebKit/iOS creates it 'suspended').
  check('unlockInsideGesture', !!create && create.trusted && (create.state === 'running' || gestureResumes.length >= 1) && strayResumes.length === 0,
    { create, gestureResumes: gestureResumes.length, firstResume: gestureResumes[0], strayResumes: strayResumes.length, transitions: acLog.filter((x) => x.op === 'state').map((x) => x.state) });
  R.acLog = acLog;
  const sink = afterTap.state === 'running';
  R.noAudioSink = !sink;
  check('runningAfterTap', sink && afterTap.unlocked, afterTap);
  if (!sink) {
    // Headless browser without an audio output device: the context can be created and resume()d in
    // the gesture but never reaches 'running', so sink-dependent steps below are recorded as limits.
    console.log(ENGINE, 'NOTE context never reached running (no audio sink); sink-dependent steps become limits');
  }
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.running, { timeout: 90000 }).catch(() => {});
  await sleep(1500);
  await ev(() => { const g = window.__BELIZETRINI_OPNWRLD__; g.player.takeDamage = () => {}; for (const c of g.cops) c.mesh.position.set(9000, 0, 9000); });

  // Signal meter on the master bus (test-only analyser).
  await ev(() => {
    const a = window.__BELIZETRINI_OPNWRLD__.audio;
    window.__an = a.ctx.createAnalyser(); window.__an.fftSize = 2048; a.master.connect(window.__an);
    window.__rms = () => { const b = new Float32Array(window.__an.fftSize); window.__an.getFloatTimeDomainData(b); let s = 0; for (const v of b) s += v * v; return Math.sqrt(s / b.length); };
  });

  // 2. Visibility hidden → visible.
  const setVis = (v) => ev((v) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, v);
  await setVis('hidden'); await sleep(700);
  const hidden = await A();
  await setVis('visible'); await sleep(900);
  const visible = await A();
  check('suspendOnHiddenResumeOnVisible', hidden.state === 'suspended' && visible.state === 'running', { hidden: hidden.state, visible: visible.state, resumes: visible.events.resume });
  // pageshow path
  await setVis('hidden'); await sleep(500);
  await ev(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); window.dispatchEvent(new Event('pageshow')); });
  await sleep(900);
  const ps = await A();
  check('resumeOnPageshow', ps.state === 'running', { state: ps.state });
  // 3. Interruption path: the OS suspends the context while we are visible → auto resume.
  await ev(() => window.__BELIZETRINI_OPNWRLD__.audio.ctx.suspend());
  await sleep(1300);
  const intr = await A();
  check('autoResumeAfterInterruption', intr.state === 'running', { state: intr.state, resumes: intr.events.resume });

  // 4. Footsteps: walk with W for 2.5 s → one node set per step.
  const n0 = (await A()).nodesCreated, f0 = (await A()).events.footstep;
  await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW');
  const walk = await A();
  const steps = walk.events.footstep - f0;
  check('footstepNodesPerEvent', steps >= 2 && walk.nodesCreated - n0 >= steps * 3, { steps, nodesAdded: walk.nodesCreated - n0, rms: await ev(() => +window.__rms().toFixed(4)) });

  // 5. Engine: in a sedan, pitch follows speed.
  const eng = await ev(async () => {
    const g = window.__BELIZETRINI_OPNWRLD__, a = g.audio;
    const v = g.vehicles.find((x) => x.type === 'sedan');
    g.player.mesh.position.set(v.mesh.position.x + 1.5, 0, v.mesh.position.z);
    g.player.enterVehicle(v);
    const sample = async (spd) => { const set = () => { v.velocity.set(-Math.sin(v.yaw) * spd, 0, -Math.cos(v.yaw) * spd); v.speed = spd; v.throttle = spd > 0 ? 1 : 0; }; set(); const keep = setInterval(set, 8); await new Promise((r) => setTimeout(r, 900)); clearInterval(keep); return { f: +a.eng.o1.frequency.value.toFixed(1), gain: +a.eng.gain.gain.value.toFixed(3), rms: +window.__rms().toFixed(4) }; };
    const idle = await sample(0), mid = await sample(12), fast = await sample(26);
    // heli voice
    g.player.exitVehicle();
    const h = g.vehicles.find((x) => x.type === 'heli');
    let heli = null;
    if (h) { g.player.mesh.position.set(h.mesh.position.x + 2, 0, h.mesh.position.z); g.player.enterVehicle(h); await new Promise((r) => setTimeout(r, 900)); heli = { f: +a.eng.o1.frequency.value.toFixed(1), thumpHz: +a.eng.lfo.frequency.value.toFixed(1) }; g.player.exitVehicle(); }
    return { idle, mid, fast, heli };
  });
  check('enginePitchBySpeed', eng.idle.gain > 0 && eng.fast.f > eng.idle.f && eng.mid.rms > 0, eng);

  // 6. Siren with wanted ≥ 1.
  await ev(() => window.__BELIZETRINI_OPNWRLD__.drive.apply({ action: 'set_wanted', stars: 3 }));
  await sleep(3500);
  const sir = await A();
  await ev(() => window.__BELIZETRINI_OPNWRLD__.drive.apply({ action: 'clear_wanted' }));
  await sleep(1200);
  const sirOff = await A();
  check('sirenWithWanted', sir.sirenGain > 0 && sirOff.sirenGain === 0, { at3stars: sir.sirenGain, cleared: sirOff.sirenGain });

  // 7. Mission-complete sting (mission 2 via hooks).
  const s0 = (await A()).events.sting, nn0 = (await A()).nodesCreated;
  await ev(() => {
    const g = window.__BELIZETRINI_OPNWRLD__;
    g.drive.apply({ action: 'set_mission', missionId: 2 });
    const mk = g.world.markers.queenMarket; g.player.mesh.position.set(mk.x + 1, 0, mk.z);
  });
  await sleep(900);
  await ev(() => window.__BELIZETRINI_OPNWRLD__._onInteract());
  await sleep(500);
  const st = await A();
  check('missionCompleteSting', st.events.sting === s0 + 1 && st.nodesCreated - nn0 >= 8, { stings: st.events.sting - s0, nodesAdded: st.nodesCreated - nn0, rms: await ev(() => +window.__rms().toFixed(4)) });
  await page.screenshot({ path: path.join(OUT, `${ENGINE}_sting.png`) });

  // 8. Ambience: day chirps (and crickets at night).
  const c0 = (await A()).events;
  await ev(() => window.__BELIZETRINI_OPNWRLD__.world.dayNight.setHour(23));
  await sleep(2500);
  const night = await A();
  check('ambienceDayNight', night.events.cricket > c0.cricket && (night.events.chirp > 0), { chirps: night.events.chirp, crickets: night.events.cricket - c0.cricket });
  await ev(() => window.__BELIZETRINI_OPNWRLD__.world.dayNight.setHour(14));

  // 9. Mute toggle in the pause menu (persisted).
  await page.tap('#btn-pause'); await sleep(400);
  await page.screenshot({ path: path.join(OUT, `${ENGINE}_pause_mute.png`) });
  await page.tap('#btn-mute'); await sleep(500);
  const m1 = { ...(await A()), master: await ev(() => +window.__BELIZETRINI_OPNWRLD__.audio.master.gain.value.toFixed(3)), label: await ev(() => document.getElementById('btn-mute').textContent), saved: await ev(() => localStorage.getItem('bto.muted')) };
  await page.tap('#btn-mute'); await sleep(400);
  const m2 = { muted: (await A()).muted, label: await ev(() => document.getElementById('btn-mute').textContent), saved: await ev(() => localStorage.getItem('bto.muted')) };
  check('muteToggle', m1.muted && m1.master < 0.05 && m1.saved === '1' && !m2.muted && m2.saved === '0', { m1: { muted: m1.muted, master: m1.master, label: m1.label, saved: m1.saved }, m2 });
  await page.tap('#btn-resume').catch(() => {});

  // 10. One-time silent-switch hint (iOS UA): shown on the first unlock only.
  const hint1 = await ev(() => !!window.__BELIZETRINI_OPNWRLD__.audio.hintShown);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__BELIZETRINI_OPNWRLD__?.audio, { timeout: 90000 });
  await sleep(600);
  await page.tap('#btn-start'); await sleep(1500);
  const hint2 = await ev(() => !!window.__BELIZETRINI_OPNWRLD__.audio.hintShown);
  const reloadState = await A();
  check('hintOnce', hint1 && !hint2, { firstLoad: hint1, secondLoad: hint2, mutedRestored: reloadState.muted, stateAfterReloadTap: reloadState.state });

  R.final = await A();
  R.errors = [...new Set(errs)];
  R.allOk = Object.values(R.steps).every((s) => s.ok) && R.errors.length === 0;
  // Without a sink: everything that does not need a running context must pass, with 0 errors.
  R.gesturePathOk = Object.values(R.steps).every((s) => s.ok || s.limit) && R.errors.length === 0;
  fs.writeFileSync(path.join(OUT, `audio_${ENGINE}.json`), JSON.stringify(R, null, 1));
  console.log(ENGINE, 'ALL', R.allOk ? 'OK' : (R.gesturePathOk ? 'OK-WITH-LIMITS(no audio sink)' : 'FAIL'), 'errors', JSON.stringify(R.errors));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
