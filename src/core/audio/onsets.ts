// Detección de golpes (onsets) en una grabación, para el modo "canción original":
// espectrograma mel en dB → flujo espectral por banda → picos → retroceso al inicio del ataque.
import { fftInPlace } from './fft.ts';

export const ANALYSIS_SR = 24000;
const N_FFT = 1024;
const HOP = 128;
const N_MELS = 80;
export const HOP_SEC = HOP / ANALYSIS_SR;

export type Band = 'all' | 'low' | 'mid' | 'high';
export const BANDS: Record<Band, [number, number]> = {
  all: [0, Infinity],
  low: [0, 250],
  mid: [250, 2500],
  high: [2500, Infinity],
};

export interface AudioAnalysis {
  env: Record<Band, Float32Array>;
  hop: number;
  frames: number;
  duration: number;
}

export interface OnsetOptions {
  band?: Band;
  sens?: number; // 0..100
  minGap?: number;
  start?: number;
  end?: number;
  offset?: number; // ms
}

const hzToMel = (f: number) => (f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27));
const melToHz = (m: number) => (m < 15 ? m * (200 / 3) : 1000 * Math.exp((m - 15) * (Math.log(6.4) / 27)));

function melBank(sr: number, nfft: number, nMels: number) {
  const m0 = hzToMel(0);
  const m1 = hzToMel(sr / 2);
  const pts = Array.from({ length: nMels + 2 }, (_, i) => melToHz(m0 + ((m1 - m0) * i) / (nMels + 1)));
  const bins = nfft / 2 + 1;
  const bank: { first: number; w: Float32Array; center: number }[] = [];
  for (let m = 0; m < nMels; m++) {
    const lo = pts[m];
    const c = pts[m + 1];
    const hi = pts[m + 2];
    const norm = 2 / (hi - lo);
    const w: number[] = [];
    let first = -1;
    for (let k = 0; k < bins; k++) {
      const f = (k * sr) / nfft;
      const v = Math.max(0, Math.min((f - lo) / (c - lo), (hi - f) / (hi - c)));
      if (v > 0) {
        if (first < 0) first = k;
        w.push(v * norm);
      } else if (first >= 0) break;
    }
    bank.push({ first: Math.max(first, 0), w: Float32Array.from(w), center: c });
  }
  return bank;
}

/** Analiza audio mono a ANALYSIS_SR. ~1 s por minuto de audio. */
export async function analyzeAudio(mono: Float32Array, onProgress?: (p: number) => void | Promise<void>): Promise<AudioAnalysis> {
  const sr = ANALYSIS_SR;
  const half = N_FFT / 2;
  const n = mono.length;
  const padded = new Float32Array(n + N_FFT);
  for (let i = 0; i < n; i++) padded[i + half] = mono[i];
  for (let i = 0; i < half; i++) {
    padded[half - 1 - i] = mono[Math.min(n - 1, i + 1)] || 0;
    padded[half + n + i] = mono[Math.max(0, n - 2 - i)] || 0;
  }
  const frames = 1 + Math.floor(n / HOP);
  const win = new Float32Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
  const bank = melBank(sr, N_FFT, N_MELS);
  const mel = new Float32Array(frames * N_MELS);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const pw = new Float64Array(half + 1);
  let maxDb = -Infinity;
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = padded[o + i] * win[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    for (let k = 0; k <= half; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
    for (let m = 0; m < N_MELS; m++) {
      const b = bank[m];
      let s = 0;
      for (let k = 0; k < b.w.length; k++) s += pw[b.first + k] * b.w[k];
      const db = 10 * Math.log10(Math.max(1e-10, s));
      mel[f * N_MELS + m] = db;
      if (db > maxDb) maxDb = db;
    }
    if (onProgress && (f & 2047) === 2047) await onProgress(f / frames);
  }
  const floor = maxDb - 80;
  for (let i = 0; i < mel.length; i++) if (mel[i] < floor) mel[i] = floor;
  const shift = N_FFT / (2 * HOP);
  const env = {} as Record<Band, Float32Array>;
  for (const [name, [lo, hi]] of Object.entries(BANDS) as [Band, [number, number]][]) {
    const ms = bank.map((b, i) => [b.center, i] as const).filter(([c]) => c >= lo && c < hi).map(([, i]) => i);
    const e = new Float32Array(frames);
    for (let f = 1; f < frames; f++) {
      let s = 0;
      for (const m of ms) {
        const d = mel[f * N_MELS + m] - mel[(f - 1) * N_MELS + m];
        if (d > 0) s += d;
      }
      const idx = f + shift;
      if (idx < frames) e[idx] = ms.length ? s / ms.length : 0;
    }
    env[name] = e;
  }
  if (onProgress) await onProgress(1);
  return { env, hop: HOP_SEC, frames, duration: n / sr };
}

export interface Onset {
  t: number;
  s: number;
}

/** Golpes dentro de [start, end), con tiempos relativos a `start`. sens 0..100 (más = más golpes). */
export function detectOnsets(analysis: AudioAnalysis, opts: OnsetOptions = {}): Onset[] {
  const { band = 'all', sens = 45, minGap = 0.09, start = 0, end = Infinity, offset = 0 } = opts;
  const x0 = analysis.env[band] || analysis.env.all;
  const hop = analysis.hop;
  const L = x0.length;
  const fr = (s: number) => Math.round(s / hop);
  const preMax = fr(0.03);
  const postMax = 1;
  const preAvg = fr(0.1);
  const postAvg = fr(0.1) + 1;
  const wait = Math.max(1, fr(minGap));
  const a = Math.max(0, fr(start) - preAvg);
  const b = Math.min(L, fr(Math.min(end, analysis.duration)) + postAvg + 1);
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = a; i < b; i++) {
    if (x0[i] < mn) mn = x0[i];
    if (x0[i] > mx) mx = x0[i];
  }
  const rng = mx - mn || 1;
  const x = (i: number) => (x0[i] - mn) / rng;
  const s01 = Math.max(0, Math.min(100, sens)) / 100;
  const delta = 0.01 + 0.19 * (1 - s01) ** 2;
  const peaks: number[] = [];
  let last = -Infinity;
  for (let i = a; i < b; i++) {
    const v = x(i);
    let isMax = true;
    for (let j = Math.max(a, i - preMax); j < Math.min(b, i + postMax); j++)
      if (x(j) > v) {
        isMax = false;
        break;
      }
    if (!isMax) continue;
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(a, i - preAvg); j < Math.min(b, i + postAvg); j++) {
      sum += x(j);
      cnt++;
    }
    if (v >= sum / cnt + delta && i - last > wait) {
      peaks.push(i);
      last = i;
    }
  }
  const hits: Onset[] = [];
  for (const p of peaks) {
    let m = p;
    while (m > a + 1 && !(x0[m] <= x0[m - 1] && x0[m] < x0[m + 1])) m--;
    const t = m * hop;
    if (t >= start && t < end) hits.push({ t: t - start + offset / 1000, s: x(p) });
  }
  const out: Onset[] = [];
  for (const h of hits) if (!out.length || h.t - out[out.length - 1].t >= minGap) out.push(h);
  const ss = out.map((h) => h.s).sort((p, q) => p - q);
  const p95 = ss[Math.floor(ss.length * 0.95)] || 1;
  return out.filter((h) => h.t >= 0).map((h) => ({ t: +h.t.toFixed(4), s: +Math.min(1, h.s / p95).toFixed(3) }));
}
