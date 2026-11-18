// Se ejecuta dentro de Electron: abre la app real (electron/dist/main.cjs) y la inspecciona.
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
process.env.BOLAS_SMOKE = '1';
require(path.resolve('electron/dist/main.cjs'));
app.whenReady().then(async () => {
  const win = await new Promise((resolve) => {
    const tick = () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) resolve(w);
      else setTimeout(tick, 100);
    };
    tick();
  });
  try {
    await new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = async () => {
        try {
          const ok = await win.webContents.executeJavaScript(
            '!!(window.__bolas && window.__bolas.state.hits.length > 0 && window.bolasDesktop)',
          );
          if (ok) return resolve();
        } catch {}
        if (Date.now() - t0 > 60000) return reject(new Error('la app no cargó el ejemplo en 60 s'));
        setTimeout(poll, 250);
      };
      poll();
    });
    const info = await win.webContents.executeJavaScript(
      'JSON.stringify({ url: location.href, hits: window.__bolas.state.hits.length, desktop: !!window.bolasDesktop })',
    );
    console.log('SMOKE estado', info);
    const img = await win.webContents.capturePage();
    require('node:fs').writeFileSync('out/app_smoke.png', img.toPNG());
    console.log('SMOKE OK');
    app.exit(0);
  } catch (e) {
    console.log('SMOKE ERROR', e.message);
    app.exit(1);
  }
});
