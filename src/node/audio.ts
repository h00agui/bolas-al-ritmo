// Utilidades de audio para Node: decodificación con ffmpeg y carga de instrumentos con caché.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { type Instrument, loadInstrument } from '../core/audio/instruments.ts';

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

/** Decodifica cualquier audio (mp3, m4a, wav, mp4…) a PCM mono Float32 a `sampleRate`. */
export function decodeFileSync(file: string, sampleRate: number): Float32Array {
  const raw = execFileSync(
    ffmpegPath(),
    ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-'],
    { maxBuffer: 2 ** 31 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

/** Decodifica un mp3 en memoria a PCM mono Float32 (mantiene el sampleRate original). */
export function decodeMp3(mp3: Uint8Array): Promise<{ data: Float32Array; sampleRate: number }> {
  const sampleRate = 44100;
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath(), ['-v', 'error', '-f', 'mp3', '-i', 'pipe:0', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1']);
    const chunks: Buffer[] = [];
    ff.stdout.on('data', (c: Buffer) => chunks.push(c));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg salió con código ${code}`));
      const buf = Buffer.concat(chunks);
      resolve({ data: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)), sampleRate });
    });
    ff.stdin.on('error', () => {});
    ff.stdin.end(mp3);
  });
}

/** Carga un instrumento desde public/instruments, con caché del PCM decodificado en .cache/. */
export async function loadInstrumentNode(id: string, root = process.cwd()): Promise<Instrument> {
  const packFile = path.join(root, 'public', 'instruments', `${id}.pack`);
  if (!fs.existsSync(packFile)) throw new Error(`No existe el instrumento "${id}" (${packFile})`);
  const cacheDir = path.join(root, '.cache', 'instruments');
  const cacheFile = path.join(cacheDir, `${id}.json`);
  const stat = fs.statSync(packFile);
  if (fs.existsSync(cacheFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as {
        mtime: number;
        sampleRate: number;
        notes: { midi: number; length: number }[];
      };
      if (meta.mtime === stat.mtimeMs) {
        const pcm = fs.readFileSync(cacheFile.replace(/\.json$/, '.f32'));
        const samples = new Map<number, Float32Array>();
        let off = 0;
        for (const n of meta.notes) {
          samples.set(n.midi, new Float32Array(pcm.buffer.slice(pcm.byteOffset + off, pcm.byteOffset + off + n.length * 4)));
          off += n.length * 4;
        }
        return { id, sampleRate: meta.sampleRate, samples, midis: [...samples.keys()].sort((a, b) => a - b) };
      }
    } catch {}
  }
  const inst = await loadInstrument(fs.readFileSync(packFile), decodeMp3);
  fs.mkdirSync(cacheDir, { recursive: true });
  const notes = inst.midis.map((m) => ({ midi: m, length: inst.samples.get(m)!.length }));
  fs.writeFileSync(cacheFile, JSON.stringify({ mtime: stat.mtimeMs, sampleRate: inst.sampleRate, notes }));
  fs.writeFileSync(
    cacheFile.replace(/\.json$/, '.f32'),
    Buffer.concat(inst.midis.map((m) => Buffer.from(inst.samples.get(m)!.buffer, inst.samples.get(m)!.byteOffset, inst.samples.get(m)!.byteLength))),
  );
  return inst;
}
