// Descarga los samples de FluidR3_GM (licencia MIT, vía midi-js-soundfonts) y los empaqueta
// en public/instruments/<id>.pack: un índice JSON + los mp3 de cada nota en un solo archivo.
//   node scripts/build-instruments.mjs [id ...]
import fs from 'node:fs';
import path from 'node:path';
import { INSTRUMENTS } from '../src/core/audio/catalog.js';

const BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM';
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const outDir = path.resolve('public/instruments');
fs.mkdirSync(outDir, { recursive: true });

const only = process.argv.slice(2);
const list = INSTRUMENTS.filter((i) => !only.length || only.includes(i.id));

async function fetchNote(gm, midi) {
  const name = `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${BASE}/${gm}-mp3/${name}.mp3`);
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
    if (r.status === 404) return null;
    await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
  }
  throw new Error(`No se pudo descargar ${gm} ${name}`);
}

for (const inst of list) {
  const file = path.join(outDir, `${inst.id}.pack`);
  if (fs.existsSync(file) && !only.length) {
    console.log(`${inst.id}: ya existe`);
    continue;
  }
  const notes = [];
  const blobs = [];
  let offset = 0;
  const midis = [];
  for (let m = inst.range[0]; m <= inst.range[1]; m += inst.step) midis.push(m);
  // descargas en paralelo de 8 en 8
  for (let i = 0; i < midis.length; i += 8) {
    const chunk = midis.slice(i, i + 8);
    const results = await Promise.all(chunk.map((m) => fetchNote(inst.gm, m)));
    results.forEach((bytes, j) => {
      if (!bytes) return;
      notes.push({ midi: chunk[j], offset, length: bytes.length });
      blobs.push(bytes);
      offset += bytes.length;
    });
    process.stdout.write(`\r${inst.id}: ${Math.min(i + 8, midis.length)}/${midis.length}`);
  }
  const index = Buffer.from(JSON.stringify({ id: inst.id, gm: inst.gm, format: 'mp3', notes }), 'utf8');
  const header = Buffer.alloc(8);
  header.write('BAR1', 0, 'ascii');
  header.writeUInt32LE(index.length, 4);
  fs.writeFileSync(file, Buffer.concat([header, index, ...blobs]));
  console.log(`\r${inst.id}: ${notes.length} notas, ${(offset / 1024 / 1024).toFixed(2)} MB -> ${file}`);
}
