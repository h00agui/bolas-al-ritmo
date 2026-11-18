// Exportación de vídeo en el navegador: WebCodecs (H.264 + AAC/Opus) con mp4-muxer; si el
// navegador no puede codificar, grabación en tiempo real con MediaRecorder.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { renderHits } from '@core/audio/sampler.ts';
import type { Instrument } from '@core/audio/instruments.ts';
import type { Mode } from '@core/modes/index.ts';
import type { DrawEnv } from '@core/scene/draw.ts';
import type { SceneStyle } from '@core/scene/style.ts';
import { FPS, SAMPLE_RATE, VIDEO_H as H, VIDEO_W as W } from '@core/types.ts';
import type { Hit, SoundSettings } from '@core/types.ts';

export interface ExportJob {
  hits: Hit[];
  duration: number;
  plan: unknown;
  style: SceneStyle;
  mode: Mode<unknown>;
  instrument: Instrument;
  sound: SoundSettings;
  onProgress: (p: number, text: string) => void;
  isCancelled: () => boolean;
}

export interface ExportResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  realtime: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const makeCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

async function pickVideoConfig(): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const codec of ['avc1.640034', 'avc1.64002A', 'avc1.640028', 'avc1.4D402A', 'avc1.42E02A']) {
    for (const hw of ['prefer-hardware', 'no-preference'] as const) {
      const cfg: VideoEncoderConfig = {
        codec,
        width: W,
        height: H,
        bitrate: 10_000_000,
        framerate: FPS,
        hardwareAcceleration: hw,
        avc: { format: 'avc' },
      };
      try {
        if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
      } catch {}
    }
  }
  return null;
}

async function pickAudioConfig(): Promise<{ cfg: AudioEncoderConfig; mux: 'aac' | 'opus' } | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
  for (const [codec, mux, bitrate] of [
    ['mp4a.40.2', 'aac', 192_000],
    ['opus', 'opus', 160_000],
  ] as const) {
    const cfg: AudioEncoderConfig = { codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate };
    try {
      if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux };
    } catch {}
  }
  return null;
}

export async function canExportFast(): Promise<boolean> {
  return !!(await pickVideoConfig()) && !!(await pickAudioConfig());
}

async function renderAudio(job: ExportJob): Promise<[Float32Array, Float32Array]> {
  return renderHits(job.hits, job.instrument, job.sound, job.duration, SAMPLE_RATE, async (p) => {
    job.onProgress(0.08 * p, 'Tocando las notas…');
    await sleep(0);
  });
}

async function exportWebCodecs(
  job: ExportJob,
  vcfg: VideoEncoderConfig,
  acfg: { cfg: AudioEncoderConfig; mux: 'aac' | 'opus' },
): Promise<Blob> {
  const nF = Math.ceil(job.duration * FPS);
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    audio: { codec: acfg.mux, numberOfChannels: 2, sampleRate: SAMPLE_RATE },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let err: Error | null = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (err = e) });
  venc.configure(vcfg);
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (err = e) });
  aenc.configure(acfg.cfg);
  const [L, R] = await renderAudio(job);
  const step = SAMPLE_RATE / 10;
  for (let i = 0; i < L.length; i += step) {
    const n = Math.min(step, L.length - i);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0);
    data.set(R.subarray(i, i + n), n);
    const ad = new AudioData({
      format: 'f32-planar',
      sampleRate: SAMPLE_RATE,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((i / SAMPLE_RATE) * 1e6),
      data,
    });
    aenc.encode(ad);
    ad.close();
  }
  await aenc.flush();
  const c = makeCanvas(W, H);
  const x = c.getContext('2d', { alpha: false })!;
  const env: DrawEnv = { makeCanvas, cache: {}, fps: FPS };
  const t0 = performance.now();
  for (let i = 0; i < nF; i++) {
    if (job.isCancelled()) throw new Error('cancel');
    if (err) throw err;
    job.mode.draw(x, i / FPS, job.plan, job.style, env);
    const vf = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    while (venc.encodeQueueSize > 4) await sleep(2);
    if (i % 10 === 0) {
      const el = (performance.now() - t0) / 1000;
      const left = i ? (el / i) * (nF - i) : 0;
      job.onProgress(
        0.08 + (0.92 * i) / nF,
        `Creando vídeo… ${Math.round((100 * i) / nF)} %${i > 30 ? ` · quedan ${Math.ceil(left)} s` : ''}`,
      );
      await sleep(0);
    }
  }
  await venc.flush();
  if (err) throw err;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

async function exportRealtime(job: ExportJob, ctx: AudioContext): Promise<ExportResult> {
  if (typeof MediaRecorder === 'undefined')
    throw new Error('Este navegador no puede crear vídeo. Prueba con Chrome, Edge o Safari actualizados.');
  const mime = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ].find((m) => MediaRecorder.isTypeSupported(m));
  const [L, R] = await renderAudio(job);
  const c = makeCanvas(W, H);
  c.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(c);
  const x = c.getContext('2d')!;
  const env: DrawEnv = { makeCanvas, cache: {}, fps: 60 };
  job.mode.draw(x, 0, job.plan, job.style, env);
  const ab = ctx.createBuffer(2, L.length, SAMPLE_RATE);
  ab.copyToChannel(L as Float32Array<ArrayBuffer>, 0);
  ab.copyToChannel(R as Float32Array<ArrayBuffer>, 1);
  const dest = ctx.createMediaStreamDestination();
  const src = ctx.createBufferSource();
  src.buffer = ab;
  src.connect(dest);
  const stream = c.captureStream(FPS);
  stream.addTrack(dest.stream.getAudioTracks()[0]);
  const rec = new MediaRecorder(
    stream,
    mime ? { mimeType: mime, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 192_000 } : undefined,
  );
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(500);
  const at0 = ctx.currentTime + 0.15;
  src.start(at0);
  try {
    await new Promise<void>((resolve, reject) => {
      const step = () => {
        if (job.isCancelled()) return reject(new Error('cancel'));
        const tt = ctx.currentTime - at0;
        if (tt >= job.duration) return resolve();
        job.mode.draw(x, Math.max(0, tt), job.plan, job.style, env);
        job.onProgress(
          Math.max(0, tt) / job.duration,
          `Grabando en tiempo real… ${Math.round((100 * Math.max(0, tt)) / job.duration)} %`,
        );
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  } finally {
    try {
      rec.stop();
      src.stop();
    } catch {}
    c.remove();
  }
  await stopped;
  const type = rec.mimeType || mime || 'video/webm';
  return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm', realtime: true };
}

/** Crea el vídeo. `ctx` solo hace falta para la grabación en tiempo real. */
export async function exportVideo(job: ExportJob, ctx: AudioContext | null): Promise<ExportResult> {
  if (document.fonts)
    await Promise.all(
      ['800 92px Inter', '500 44px Inter', '600 40px Inter', '700 27px Inter'].map((f) =>
        document.fonts.load(f).catch(() => undefined),
      ),
    );
  const vcfg = await pickVideoConfig();
  const acfg = vcfg ? await pickAudioConfig() : null;
  if (vcfg && acfg) return { blob: await exportWebCodecs(job, vcfg, acfg), ext: 'mp4', realtime: false };
  if (!ctx)
    throw new Error(
      'Este navegador necesita permiso de audio para grabar: pulsa primero el botón de reproducir.',
    );
  return exportRealtime(job, ctx);
}
