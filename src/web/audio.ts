// Audio en el navegador: carga de instrumentos (Web Audio decodifica los mp3) y reproducción en vivo
// de los choques con la misma envolvente, paneo y reverb que la exportación.
import { loadInstrument, type Instrument } from '@core/audio/instruments.ts';
import { makeImpulseResponse } from '@core/audio/reverb.ts';
import { noteHold, pitchPan, velocityGain } from '@core/audio/sampler.ts';
import { nearestSample } from '@core/audio/instruments.ts';
import type { Hit, SoundSettings } from '@core/types.ts';

type F32 = Float32Array<ArrayBuffer>;
const f32 = (a: Float32Array): F32 => a as F32;
const AC =
  window.AudioContext ||
  (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

const cache = new Map<string, Promise<Instrument>>();

/** Decodifica un pack con un OfflineAudioContext (no necesita permiso del usuario). */
export function fetchInstrument(id: string): Promise<Instrument> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const r = await fetch(`${import.meta.env.BASE_URL}instruments/${id}.pack`);
      if (!r.ok) throw new Error(`No se pudo cargar el instrumento ${id}`);
      const bytes = await r.arrayBuffer();
      const OAC =
        window.OfflineAudioContext ||
        (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
      const octx = new OAC(1, 1, 44100);
      return loadInstrument(bytes, async (mp3) => {
        const buf = await octx.decodeAudioData(mp3.slice().buffer as ArrayBuffer);
        const data = buf.numberOfChannels > 1 ? mixDown(buf) : buf.getChannelData(0);
        return { data, sampleRate: buf.sampleRate };
      });
    })();
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return p;
}

function mixDown(buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

/** Reproductor en vivo: programa los choques con antelación sobre un AudioContext. */
export class LivePlayer {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private buffers = new Map<string, Map<number, AudioBuffer>>();
  private active: AudioBufferSourceNode[] = [];
  private timer = 0;
  private ctxStart = 0; // ctx.currentTime que corresponde a t = 0 del vídeo
  private nextIndex = 0;
  private hits: Hit[] = [];
  private inst: Instrument | null = null;
  private sound: SoundSettings | null = null;

  /** Crea o reanuda el contexto. Llamar desde un gesto del usuario. */
  async ensure(): Promise<boolean> {
    if (!this.ctx) {
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.dry = this.ctx.createGain();
      this.wet = this.ctx.createGain();
      this.convolver = this.ctx.createConvolver();
      const [l, r] = makeImpulseResponse(this.ctx.sampleRate);
      const ir = this.ctx.createBuffer(2, l.length, this.ctx.sampleRate);
      ir.copyToChannel(f32(l), 0);
      ir.copyToChannel(f32(r), 1);
      this.convolver.buffer = ir;
      this.dry.connect(this.master);
      this.wet.connect(this.convolver).connect(this.master);
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {}
    }
    return this.ctx.state === 'running';
  }

  get latency(): number {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    return c ? c.outputLatency || c.baseLatency || 0 : 0;
  }

  private bufferFor(inst: Instrument, midi: number): AudioBuffer {
    let m = this.buffers.get(inst.id);
    if (!m) {
      m = new Map();
      this.buffers.set(inst.id, m);
    }
    let b = m.get(midi);
    if (!b) {
      const data = inst.samples.get(midi)!;
      b = this.ctx!.createBuffer(1, data.length, inst.sampleRate);
      b.copyToChannel(f32(data), 0);
      m.set(midi, b);
    }
    return b;
  }

  setSound(sound: SoundSettings): void {
    this.sound = sound;
    if (!this.master || !this.dry || !this.wet) return;
    this.master.gain.value = 0.9 * sound.volume;
    this.wet.gain.value = 0.55 * sound.reverb;
    this.dry.gain.value = 1 - 0.25 * sound.reverb;
  }

  /** Empieza a sonar desde el instante t (s del vídeo). */
  play(hits: Hit[], inst: Instrument, sound: SoundSettings, t: number): void {
    if (!this.ctx) return;
    this.stop();
    this.hits = hits;
    this.inst = inst;
    this.setSound(sound);
    this.ctxStart = this.ctx.currentTime + 0.08 - t;
    this.nextIndex = hits.findIndex((h) => h.t >= t);
    if (this.nextIndex < 0) this.nextIndex = hits.length;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  /** Instante del vídeo que suena ahora mismo. */
  get position(): number {
    return this.ctx ? this.ctx.currentTime - this.ctxStart - this.latency : 0;
  }

  private schedule(): void {
    if (!this.ctx || !this.inst || !this.sound) return;
    const horizon = this.ctx.currentTime + 0.35;
    while (this.nextIndex < this.hits.length) {
      const h = this.hits[this.nextIndex];
      const when = this.ctxStart + h.t;
      if (when > horizon) break;
      if (when >= this.ctx.currentTime - 0.02) this.trigger(h, Math.max(when, this.ctx.currentTime));
      this.nextIndex++;
    }
  }

  private trigger(hit: Hit, when: number): void {
    const ctx = this.ctx!;
    const inst = this.inst!;
    const sound = this.sound!;
    for (const n of hit.notes) {
      const sm = nearestSample(inst, n.midi);
      const src = ctx.createBufferSource();
      src.buffer = this.bufferFor(inst, sm);
      src.playbackRate.value = Math.pow(2, (n.midi - sm) / 12);
      const g = ctx.createGain();
      const hold = noteHold(n.duration, sound.sustain);
      const gain = velocityGain(n.velocity) * 0.8;
      g.gain.setValueAtTime(gain, when);
      g.gain.setValueAtTime(gain, when + hold);
      g.gain.linearRampToValueAtTime(0, when + hold + Math.max(0.02, sound.release));
      const pan = ctx.createStereoPanner();
      pan.pan.value = pitchPan(n.midi);
      src.connect(g).connect(pan);
      pan.connect(this.dry!);
      pan.connect(this.wet!);
      src.start(when);
      src.stop(when + hold + Math.max(0.02, sound.release) + 0.05);
      this.active.push(src);
      src.onended = () => {
        const i = this.active.indexOf(src);
        if (i >= 0) this.active.splice(i, 1);
      };
    }
  }

  /** Toca un choque suelto ahora (para probar un instrumento). */
  preview(hit: Hit, inst: Instrument, sound: SoundSettings): void {
    if (!this.ctx) return;
    this.inst = inst;
    this.setSound(sound);
    this.trigger(hit, this.ctx.currentTime + 0.02);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    for (const s of this.active) {
      try {
        s.stop();
      } catch {}
    }
    this.active = [];
    this.nextIndex = this.hits.length;
  }
}
