// Instrumentos: catálogo y lectura de los packs de samples (public/instruments/<id>.pack).
import { INSTRUMENTS as CATALOG } from './catalog.js';

export interface InstrumentInfo {
  id: string;
  name: string;
  gm: string;
  range: [number, number];
  step: number;
}

export const INSTRUMENTS: InstrumentInfo[] = CATALOG as InstrumentInfo[];
export const DEFAULT_INSTRUMENT = 'piano';

/** Un instrumento cargado: PCM mono de cada nota disponible, todas al mismo sampleRate. */
export interface Instrument {
  id: string;
  sampleRate: number;
  samples: Map<number, Float32Array>;
  /** alturas disponibles, ordenadas */
  midis: number[];
}

export interface PackIndex {
  id: string;
  gm: string;
  format: 'mp3';
  notes: { midi: number; offset: number; length: number }[];
}

/** Separa un .pack en su índice y los bytes de cada nota. */
export function readPack(bytes: ArrayBuffer | Uint8Array): {
  index: PackIndex;
  blobs: Map<number, Uint8Array>;
} {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'BAR1') throw new Error('Pack de instrumento no válido');
  const len = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(4, true);
  const index = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + len))) as PackIndex;
  const base = 8 + len;
  const blobs = new Map<number, Uint8Array>();
  for (const n of index.notes) blobs.set(n.midi, u8.subarray(base + n.offset, base + n.offset + n.length));
  return { index, blobs };
}

export type Decoder = (mp3: Uint8Array) => Promise<{ data: Float32Array; sampleRate: number }>;

/** Decodifica un pack con el decodificador del entorno (Web Audio en el navegador, ffmpeg en Node). */
export async function loadInstrument(pack: ArrayBuffer | Uint8Array, decode: Decoder): Promise<Instrument> {
  const { index, blobs } = readPack(pack);
  const samples = new Map<number, Float32Array>();
  let sampleRate = 44100;
  const entries = [...blobs.entries()];
  for (let i = 0; i < entries.length; i += 8) {
    const chunk = entries.slice(i, i + 8);
    const decoded = await Promise.all(chunk.map(([, b]) => decode(b)));
    decoded.forEach((d, j) => {
      sampleRate = d.sampleRate;
      samples.set(chunk[j][0], trimSilence(d.data));
    });
  }
  return { id: index.id, sampleRate, samples, midis: [...samples.keys()].sort((a, b) => a - b) };
}

/** Quita el silencio inicial que deja el codificador mp3 (para que el ataque caiga exacto en el choque). */
function trimSilence(data: Float32Array, threshold = 0.002): Float32Array {
  let i = 0;
  while (i < data.length && Math.abs(data[i]) < threshold) i++;
  i = Math.max(0, i - 8);
  return i ? data.subarray(i) : data;
}

/** Nota disponible más cercana a `midi`. */
export function nearestSample(inst: Instrument, midi: number): number {
  let best = inst.midis[0];
  let bd = Infinity;
  for (const m of inst.midis) {
    const d = Math.abs(m - midi);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}
