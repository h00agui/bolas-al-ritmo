// Reverb por convolución con una respuesta al impulso generada (determinista): sala pequeña y luminosa.
import { fftInPlace, nextPow2 } from './fft.ts';

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Respuesta al impulso estéreo: ruido con caída exponencial, filtro paso bajo suave y pre-delay. */
export function makeImpulseResponse(sampleRate: number, seconds = 1.6, decay = 0.45, seed = 7): [Float32Array, Float32Array] {
  const n = Math.round(seconds * sampleRate);
  const pre = Math.round(0.012 * sampleRate);
  const out: [Float32Array, Float32Array] = [new Float32Array(n + pre), new Float32Array(n + pre)];
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry32(seed + ch * 101);
    let lp = 0;
    let energy = 0;
    const a = Math.exp((-2 * Math.PI * 4500) / sampleRate); // paso bajo ~4.5 kHz
    for (let i = 0; i < n; i++) {
      const env = Math.exp(-i / sampleRate / decay) * (i < 0.02 * sampleRate ? i / (0.02 * sampleRate) : 1);
      const white = (rnd() * 2 - 1) * env;
      lp = a * lp + (1 - a) * white;
      out[ch][pre + i] = lp;
      energy += lp * lp;
    }
    const g = 1 / Math.sqrt(energy);
    for (let i = 0; i < n; i++) out[ch][pre + i] *= g;
  }
  return out;
}

/**
 * Convolución por bloques (overlap-add) de una señal mono con una IR estéreo.
 * Devuelve dos canales de la misma longitud que la entrada.
 */
export function convolveStereo(input: Float32Array, ir: [Float32Array, Float32Array]): [Float32Array, Float32Array] {
  const M = ir[0].length;
  const block = 32768;
  const size = nextPow2(block + M - 1);
  const irF: { re: Float64Array; im: Float64Array }[] = ir.map((h) => {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    re.set(h);
    fftInPlace(re, im);
    return { re, im };
  });
  const out: [Float32Array, Float32Array] = [new Float32Array(input.length), new Float32Array(input.length)];
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const yr = new Float64Array(size);
  const yi = new Float64Array(size);
  for (let start = 0; start < input.length; start += block) {
    re.fill(0);
    im.fill(0);
    const n = Math.min(block, input.length - start);
    for (let i = 0; i < n; i++) re[i] = input[start + i];
    fftInPlace(re, im);
    for (let ch = 0; ch < 2; ch++) {
      const h = irF[ch];
      for (let i = 0; i < size; i++) {
        yr[i] = re[i] * h.re[i] - im[i] * h.im[i];
        yi[i] = re[i] * h.im[i] + im[i] * h.re[i];
      }
      fftInPlace(yr, yi, true);
      const end = Math.min(size, input.length - start);
      const o = out[ch];
      for (let i = 0; i < end; i++) o[start + i] += yr[i];
    }
  }
  return out;
}
