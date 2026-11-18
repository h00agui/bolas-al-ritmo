// Sampler: convierte los choques en audio con un instrumento. El mismo código sirve para la
// exportación en el navegador y para el motor en Node, así que el vídeo suena igual en los dos.
import type { Hit, SoundSettings } from '../types.ts';
import { SAMPLE_RATE } from '../types.ts';
import { type Instrument, nearestSample } from './instruments.ts';
import { convolveStereo, makeImpulseResponse } from './reverb.ts';

export const DEFAULT_SOUND: SoundSettings = {
  instrument: 'piano',
  volume: 0.85,
  reverb: 0.25,
  sustain: 'ring',
  release: 0.35,
};

/** Ganancia según la fuerza con que se toca (0..1). */
export const velocityGain = (v: number): number => 0.25 + 0.75 * Math.pow(Math.max(0, Math.min(1, v)), 1.4);

/** Paneo estéreo por altura: graves un poco a la izquierda, agudos a la derecha. */
export const pitchPan = (midi: number): number => Math.max(-0.35, Math.min(0.35, (midi - 64) / 90));

/** Duración (s) durante la que suena una nota antes de la cola de liberación. */
export function noteHold(duration: number, sustain: SoundSettings['sustain']): number {
  return sustain === 'ring' ? 6 : Math.max(0.12, duration);
}

/**
 * Renderiza los choques a PCM estéreo (dos Float32Array) a `sampleRate` Hz.
 * `onProgress` recibe 0..1 de vez en cuando (y puede devolver una promesa para ceder el hilo).
 */
export async function renderHits(
  hits: Hit[],
  instrument: Instrument,
  sound: SoundSettings,
  duration: number,
  sampleRate = SAMPLE_RATE,
  onProgress?: (p: number) => void | Promise<void>,
): Promise<[Float32Array, Float32Array]> {
  const n = Math.ceil(duration * sampleRate);
  const dry: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const release = Math.max(0.02, sound.release);
  let count = 0;
  for (const hit of hits) {
    for (const note of hit.notes) {
      const srcMidi = nearestSample(instrument, note.midi);
      const src = instrument.samples.get(srcMidi);
      if (!src) continue;
      const rate = (Math.pow(2, (note.midi - srcMidi) / 12) * instrument.sampleRate) / sampleRate;
      const gain = velocityGain(note.velocity) * 0.8;
      const pan = pitchPan(note.midi);
      const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
      const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
      const hold = noteHold(note.duration, sound.sustain);
      const start = Math.round(hit.t * sampleRate);
      const total = Math.min(Math.round((hold + release) * sampleRate), Math.floor((src.length - 2) / rate), n - start);
      const relStart = Math.round(hold * sampleRate);
      for (let i = 0; i < total; i++) {
        const pos = i * rate;
        const j = pos | 0;
        const f = pos - j;
        const v = src[j] * (1 - f) + src[j + 1] * f;
        const env = i < relStart ? 1 : 1 - (i - relStart) / (total - relStart);
        dry[0][start + i] += v * gl * env;
        dry[1][start + i] += v * gr * env;
      }
    }
    if (onProgress && ++count % 20 === 0) await onProgress((0.8 * count) / hits.length);
  }
  let out = dry;
  if (sound.reverb > 0.01) {
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = 0.5 * (dry[0][i] + dry[1][i]);
    const wet = convolveStereo(mono, makeImpulseResponse(sampleRate));
    const w = 0.55 * sound.reverb;
    const d = 1 - 0.25 * sound.reverb;
    out = [new Float32Array(n), new Float32Array(n)];
    for (let ch = 0; ch < 2; ch++) for (let i = 0; i < n; i++) out[ch][i] = dry[ch][i] * d + wet[ch][i] * w;
  }
  if (onProgress) await onProgress(0.95);
  normalize(out, sound.volume);
  if (onProgress) await onProgress(1);
  return out;
}

/** Ajusta el pico a `target` (0..1) y limita con rodilla suave lo que sobresalga. */
export function normalize(channels: Float32Array[], target: number): void {
  let peak = 1e-6;
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  const g = Math.min(target / peak, 4);
  for (const c of channels)
    for (let i = 0; i < c.length; i++) {
      const v = c[i] * g;
      c[i] = Math.abs(v) < 0.8 ? v : Math.sign(v) * (0.8 + 0.2 * Math.tanh((Math.abs(v) - 0.8) / 0.2));
    }
}

/** Entrelaza dos canales en un Float32Array LRLR… */
export function interleave(l: Float32Array, r: Float32Array): Float32Array {
  const out = new Float32Array(l.length * 2);
  for (let i = 0; i < l.length; i++) {
    out[2 * i] = l[i];
    out[2 * i + 1] = r[i];
  }
  return out;
}

/** Codifica PCM estéreo como WAV de 16 bits. */
export function encodeWav(l: Float32Array, r: Float32Array, sampleRate: number): Uint8Array {
  const n = l.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))), true);
    v.setInt16(46 + i * 4, Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))), true);
  }
  return new Uint8Array(buf);
}
