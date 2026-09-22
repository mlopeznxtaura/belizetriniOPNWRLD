const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=240,280',
    ],
  });
  const outDir = '/workspace/app13-caribcrime/public/assets/characters/portraits';
  for (const [name, url] of [
    ['thumb_male.png', '/assets/characters/male.glb'],
    ['thumb_female.png', '/assets/characters/female.glb'],
  ]) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERR', e.message));
    await page.setViewport({ width: 240, height: 280, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:8765/_thumb_capture.html?url=${encodeURIComponent(url)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForFunction(() => document.title === 'READY' && !!window.__SHOT__, { timeout: 60000 });
    const dataUrl = await page.evaluate(() => window.__SHOT__);
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const dest = path.join(outDir, name);
    fs.writeFileSync(dest, buf);
    console.log('wrote', dest, buf.length);
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
