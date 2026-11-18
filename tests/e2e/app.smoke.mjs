// Arranca la aplicación de escritorio (Electron) sin pantalla, espera a que cargue el ejemplo
// y hace una captura: comprueba que el protocolo app://, el preload y la web funcionan juntos.
//   npm run app:prepare && xvfb-run -a node tests/e2e/app.smoke.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electronPath from 'electron';

fs.mkdirSync('out', { recursive: true });
const script = path.resolve('tests/e2e/app.smoke.electron.cjs');
const child = spawn(electronPath, ['--no-sandbox', script], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));
const code = await new Promise((r) => child.on('close', r));
const lines = out
  .split('\n')
  .filter(
    (l) => /SMOKE|error|Error/i.test(l) && !/sandbox|dbus|gpu|GLES|vulkan|Fontconfig|D-Bus|EGL/i.test(l),
  );
console.log(lines.join('\n'));
process.exit(code === 0 && /SMOKE OK/.test(out) ? 0 : 1);
