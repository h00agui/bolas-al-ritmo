// Captura fotogramas de la vista previa (build en dist/) en Chrome sin pantalla, para revisar el aspecto.
//   npm run build && node scripts/frames.mjs [--mode platforms3d] [--times 1,3,6] [--style '{"pieces":"key"}'] [--music '{"minGap":0.2}'] [--midi out/x.mid] [--export]
// Deja las capturas en out/frames/<mode>_<t>.png (el lienzo de la vista previa, 540×960).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const mode = arg('mode', 'platforms3d');
const times = arg('times', '0.5,2,4,7,11,16').split(',').map(Number);
const style = JSON.parse(arg('style', '{}'));
const music = JSON.parse(arg('music', '{}'));
const midi = arg('midi', '');
const outDir = arg('out', 'out/frames');
const port = +arg('port', '8766');

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
};
const server = http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(root, url.replace(/^\/$/, '/index.html'));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  })
  .listen(port);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: true,
  protocolTimeout: 300000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('console:', m.text());
});
await page.setViewport({ width: 1280, height: 1000 });
await page.goto(`http://localhost:${port}/?backend=cpu`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__bolas && window.__bolas.state.hits.length > 0, { timeout: 30000 });
if (midi) {
  const buf = fs.readFileSync(midi);
  await page.evaluate(
    async (b64, name) => {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      await window.__bolas.loadMidi(new File([u8], name));
    },
    buf.toString('base64'),
    path.basename(midi),
  );
}
await page.evaluate((m) => window.__bolas.setMusic(m), music);
await page.evaluate((m) => window.__bolas.setMode(m), mode);
await page.evaluate((s) => window.__bolas.setStyle(s), style);
await page.evaluate(() => window.__bolas.ready);
await new Promise((r) => setTimeout(r, 800));
fs.mkdirSync(outDir, { recursive: true });
const cv = await page.$('#cv');
for (const t of times) {
  await page.evaluate((sec) => window.__bolas.seek(sec), t);
  await new Promise((r) => setTimeout(r, 150));
  const file = path.join(outDir, `${mode}_${String(t).replace('.', '_')}.png`);
  await cv.screenshot({ path: file });
  console.log('capturado', file);
}
if (process.argv.includes('--export')) {
  const t0 = Date.now();
  await page.evaluate(() => {
    void window.__bolas.exportVideo();
  });
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const msg = await page.evaluate(() => document.getElementById('exportMsg').textContent);
    const done = await page.evaluate(() => !!window.__bolas.lastResult);
    console.log('  ', msg);
    if (done || /No se pudo/.test(msg)) break;
  }
  console.log(
    'export:',
    await page.evaluate(() => document.getElementById('exportMsg').textContent),
    `(${((Date.now() - t0) / 1000).toFixed(0)} s)`,
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
    const file = path.join(outDir, `${mode}.mp4`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log('vídeo', file);
  }
}
await browser.close();
server.close();
