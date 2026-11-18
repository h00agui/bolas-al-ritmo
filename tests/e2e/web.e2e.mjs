// Prueba de punta a punta en Chrome sin pantalla sobre la build (dist/):
// carga, ejemplo, cambio de modo, conversión de una canción a MIDI, exportación MP4 y capturas.
//   npm run build && node tests/e2e/web.e2e.mjs [--no-export] [--no-transcribe]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = path.resolve('dist');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.mp3': 'audio/mpeg',
  '.mid': 'audio/midi',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.pack': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
};
const server = http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const f = url.startsWith('/test-assets/')
      ? path.resolve('out', url.slice(13))
      : path.join(root, url.replace(/^\/$/, '/index.html'));
    if (
      !(f.startsWith(root) || f.startsWith(path.resolve('out'))) ||
      !fs.existsSync(f) ||
      fs.statSync(f).isDirectory()
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  })
  .listen(8765);

const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  protocolTimeout: 900000,
  args: [
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const errors = [];
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  if (m.type() === 'info') console.log('  ', m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
await page.setViewport({ width: 1280, height: 900 });
await page.goto('http://localhost:8765/?backend=cpu', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__bolas && window.__bolas.state.hits.length > 0, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 500));
fs.mkdirSync('out', { recursive: true });
const st = await page.evaluate(() => {
  const s = window.__bolas.state;
  return { hits: s.hits.length, duration: s.duration, score: s.score, mode: s.project.style.mode };
});
console.log('cargado:', JSON.stringify(st));
await page.screenshot({ path: 'out/web_desktop.png' });

// cambiar de modo desde la interfaz y capturar cada uno
for (const mode of ['ring', 'platforms', 'platforms3d']) {
  await page.evaluate((m) => window.__bolas.setMode(m), mode);
  await page.evaluate(() => window.__bolas.ready);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: `out/web_mode_${mode}.png`,
    clip: { x: 60, y: 130, width: 400, height: 640 },
  });
}
console.log('modo:', await page.evaluate(() => window.__bolas.state.project.style.mode));
// exportación corta en 3D (WebGL por software: lenta)
if (!process.argv.includes('--no-export')) {
  const t0 = Date.now();
  await page.evaluate(() => window.__bolas.setMusic({ duration: 4 }));
  await page.evaluate(() => window.__bolas.exportVideo());
  await page.waitForFunction(
    () => window.__bolas.lastResult || /No se pudo/.test(document.getElementById('exportMsg').textContent),
    { timeout: 900000 },
  );
  console.log(
    'export 3D:',
    await page.evaluate(() => document.getElementById('exportMsg').textContent),
    `(${((Date.now() - t0) / 1000).toFixed(1)} s)`,
  );
  const b64 = await page.evaluate(async () => {
    const r = window.__bolas.lastResult;
    if (!r) return null;
    const buf = new Uint8Array(await r.blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000)
      s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  if (b64) fs.writeFileSync('out/web_export_3d.mp4', Buffer.from(b64, 'base64'));
  await page.evaluate(() => window.__bolas.setMusic({ duration: 30 }));
}
await page.evaluate(() => window.__bolas.setMode('platforms'));

if (!process.argv.includes('--no-transcribe')) {
  const t0 = Date.now();
  // Chrome sin pantalla no siempre decodifica mp3: la prueba usa un wav generado con ffmpeg.
  // Se lanza sin esperar y se vigila el estado (la conversión puede tardar minutos sin GPU).
  await page.evaluate(() => {
    window.__done = false;
    fetch('/test-assets/test-song.wav')
      .then((r) => r.arrayBuffer())
      .then((b) => window.__bolas.loadAudio(b, 'test-song.wav'))
      .finally(() => (window.__done = true));
  });
  let lastStage = '';
  await page.waitForFunction(
    () => {
      const b = document.getElementById('busy');
      if (!b.hidden && b.textContent !== window.__lastStage) {
        window.__lastStage = b.textContent;
        console.info('etapa: ' + b.textContent);
      }
      return window.__done === true;
    },
    { timeout: 900000, polling: 1000 },
  );
  void lastStage;
  const s = await page.evaluate(() => window.__bolas.state);
  console.log(
    `transcripción: ${s.score && s.score.notes} notas, ${s.hits.length} choques (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
  );
  await page.screenshot({ path: 'out/web_transcribed.png', fullPage: true });
}

if (!process.argv.includes('--no-export')) {
  const t0 = Date.now();
  await page.evaluate(() => window.__bolas.exportVideo());
  await page.waitForFunction(
    () => window.__bolas.lastResult || /No se pudo/.test(document.getElementById('exportMsg').textContent),
    { timeout: 600000 },
  );
  console.log(
    'export:',
    await page.evaluate(() => document.getElementById('exportMsg').textContent),
    `(${((Date.now() - t0) / 1000).toFixed(1)} s)`,
  );
  const b64 = await page.evaluate(async () => {
    const r = window.__bolas.lastResult;
    if (!r) return null;
    const buf = new Uint8Array(await r.blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000)
      s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  if (b64) {
    fs.writeFileSync('out/web_export.mp4', Buffer.from(b64, 'base64'));
    console.log('-> out/web_export.mp4');
  }
}

const m = await browser.newPage();
await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await m.goto('http://localhost:8765/', { waitUntil: 'networkidle0' });
await m.waitForFunction(() => window.__bolas && window.__bolas.state.hits.length > 0, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 400));
await m.screenshot({ path: 'out/web_mobile.png' });
await m.screenshot({ path: 'out/web_mobile_full.png', fullPage: true });
console.log(
  'desbordamiento lateral en móvil:',
  await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  'px',
);
const real = errors.filter((e) => !/favicon|404/.test(e));
console.log(real.length ? 'consola:\n' + real.join('\n') : 'consola: sin errores');
await browser.close();
server.close();
process.exit(real.some((e) => e.startsWith('pageerror')) ? 1 : 0);
