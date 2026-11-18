// Copia a public/ los recursos que vienen de node_modules (modelo de transcripción).
//   node scripts/sync-assets.mjs
import fs from 'node:fs';
import path from 'node:path';

const copies = [['node_modules/@spotify/basic-pitch/model', 'public/models/basic-pitch']];
for (const [from, to] of copies) {
  if (!fs.existsSync(from)) {
    console.error(`Falta ${from}: ejecuta npm install`);
    process.exit(1);
  }
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f));
  console.log(`${from} -> ${to}`);
}
