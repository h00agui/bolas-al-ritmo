// Genera public/demo/para-elisa.mid (Beethoven, dominio público): el ejemplo que carga la web.
//   npx tsx scripts/make-demo.ts
import fs from 'node:fs';
import path from 'node:path';
import { writeMidi } from '../src/core/midi/parse.ts';
import type { Note } from '../src/core/types.ts';

const N: Record<string, number> = {
  E2: 40,
  E3: 52,
  'G#3': 56,
  A2: 45,
  A3: 57,
  C4: 60,
  E4: 64,
  'G#4': 68,
  A4: 69,
  B4: 71,
  C5: 72,
  D5: 74,
  'D#5': 75,
  E5: 76,
  F5: 77,
  G5: 79,
  A5: 81,
  B5: 83,
  C6: 84,
  F4: 65,
  G4: 67,
  'C#5': 73,
  'C#4': 61,
  D4: 62,
  F2: 41,
  F3: 53,
  G2: 43,
  G3: 55,
  F4b: 65,
};
type Slot = string | string[] | null;
const turn: Slot[] = ['E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5'];
const barA: Slot[] = [['A2', 'A4'], 'E3', 'A3', 'C4', 'E4', 'A4'];
const barB1: Slot[] = [['E2', 'B4'], 'E3', 'G#3', 'E4', 'G#4', 'B4'];
const barC: Slot[] = [['A2', 'C5'], 'E3', 'A3', 'E4', 'E5', 'D#5'];
const barB2: Slot[] = [['E2', 'B4'], 'E3', 'G#3', 'E4', 'C5', 'B4'];
const end1: Slot[] = [['A2', 'A4'], 'E3', 'A3', null, 'E5', 'D#5'];
// segunda parte (sección en Do mayor)
const partB: Slot[] = [
  ['A2', 'A4'],
  'E3',
  'A3',
  'B4',
  'C5',
  'D5',
  ['C4', 'E5'],
  'G3',
  'C4',
  'G4',
  'F5',
  'E5',
  ['G3', 'D5'],
  'G3',
  'B4',
  'F5',
  'E5',
  'D5',
  ['A2', 'C5'],
  'E3',
  'A3',
  'E5',
  'D5',
  'C5',
  ['E2', 'B4'],
  'E3',
  'E4',
  'E4',
  'E5',
  'E4',
  'E5',
  'E5',
  'E6' as string,
  'D#5',
  'E5',
  'D#5',
];
N.E6 = 88;
const end2: Slot[] = [['A2', 'A4'], 'E3', 'A3'];
const slots: Slot[] = [
  'E5',
  'D#5',
  ...turn,
  ...barA,
  ...barB1,
  ...barC,
  ...turn,
  ...barA,
  ...barB2,
  ...end1,
  ...turn,
  ...barA,
  ...barB1,
  ...barC,
  ...turn,
  ...barA,
  ...barB2,
  ...partB,
  ...turn,
  ...barA,
  ...barB1,
  ...barC,
  ...turn,
  ...barA,
  ...barB2,
  ...end2,
];
const LH = new Set(['E2', 'E3', 'G#3', 'A2', 'A3', 'C4', 'G3', 'F2', 'F3', 'G2']);
const DT = 0.2;
const notes: Note[] = [];
let t = 0;
slots.forEach((s, i) => {
  if (s) {
    const names = Array.isArray(s) ? s : [s];
    for (const nm of names) {
      const lh = LH.has(nm) && !(Array.isArray(s) && names.indexOf(nm) === 1);
      notes.push({
        time: +t.toFixed(3),
        duration: lh ? 0.55 : 0.19,
        midi: N[nm],
        velocity: lh ? 0.55 : 0.8,
        track: lh ? 1 : 0,
      });
    }
  }
  t += i >= slots.length - 3 ? DT * 1.4 : DT;
});
const out = path.resolve('public/demo');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'para-elisa.mid'), writeMidi(notes, 'Para Elisa (Beethoven)', 150));
console.log(`${notes.length} notas, ${t.toFixed(1)} s -> public/demo/para-elisa.mid`);
