#!/usr/bin/env -S npx tsx
// Motor de render: MIDI (o proyecto) -> MP4 1080x1920 con el sonido de cada nota.
//
//   npm run render -- --midi cancion.mid [--project proyecto.json] [--out video.mp4]
//        [--mode platforms|ring] [--instrument piano] [--selection melody|chords|bass|all]
//        [--start 0] [--duration 30] [--speed 1] [--min-gap 0.1] [--title "..."] [--subtitle "..."]
//        [--handle "@cuenta"] [--palette arcoiris] [--color-mode nota|paleta] [--stills 1.5,7.2]
//   Con --project se usan los ajustes del archivo (los parámetros sueltos los sobrescriben).
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHits } from '../core/audio/sampler.ts';
import { parseMidi } from '../core/midi/parse.ts';
import { getMode } from '../core/modes/index.ts';
import { prepareHud, type CanvasLike, type DrawEnv } from '../core/scene/draw.ts';
import { buildProject, normalizeProject, type Project } from '../core/project.ts';
import { FPS, SAMPLE_RATE, VIDEO_H, VIDEO_W } from '../core/types.ts';
import { loadInstrumentNode } from '../node/audio.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const fontDir = path.join(root, 'node_modules', '@fontsource', 'inter', 'files');
if (fs.existsSync(fontDir))
  for (const f of [
    'inter-latin-500-normal.woff2',
    'inter-latin-600-normal.woff2',
    'inter-latin-800-normal.woff2',
  ])
    GlobalFonts.registerFromPath(path.join(fontDir, f), 'Inter');

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const i = argv.indexOf('--' + k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (k: string): number | undefined => (arg(k) !== undefined ? Number(arg(k)) : undefined);

const project: Project = normalizeProject(
  arg('project') ? JSON.parse(fs.readFileSync(arg('project')!, 'utf8')) : null,
);
const midiFile = arg('midi') ?? (project.source?.kind === 'midi' ? project.source.file : undefined);
if (!midiFile && !project.hits) {
  console.error('Falta --midi cancion.mid (o un --project con choques guardados)');
  process.exit(1);
}
if (arg('mode')) project.style.mode = arg('mode')!;
if (arg('instrument')) project.sound.instrument = arg('instrument')!;
if (arg('selection')) project.music.selection = arg('selection') as Project['music']['selection'];
if (num('start') !== undefined) project.music.start = num('start')!;
if (num('duration') !== undefined) project.music.duration = num('duration')!;
if (num('speed') !== undefined) project.music.speed = num('speed')!;
if (num('min-gap') !== undefined) project.music.minGap = num('min-gap')!;
for (const k of ['title', 'subtitle', 'handle', 'palette'] as const)
  if (arg(k) !== undefined) project.style[k] = arg(k)!;
if (arg('color-mode')) project.style.colorMode = arg('color-mode') as 'nota' | 'paleta';
const out = arg('out') ?? 'video.mp4';

const score = midiFile ? parseMidi(fs.readFileSync(midiFile), path.basename(midiFile)) : null;
if (getMode(project.style.mode).requiresWebGL) {
  console.error(
    `El modo "${getMode(project.style.mode).name}" necesita WebGL: expórtalo desde la web o la app. Aquí se usa el modo Plataformas.`,
  );
  project.style.mode = 'platforms';
}
const { hits, duration, plan } = buildProject(project, score);
const mode = getMode(project.style.mode);
console.log(
  `${hits.length} choques · ${duration.toFixed(1)} s · modo ${mode.name} · ${project.sound.instrument}`,
);

const cv = createCanvas(VIDEO_W, VIDEO_H);
const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D;
const env: DrawEnv = {
  makeCanvas: (w, h) => createCanvas(w, h) as unknown as CanvasLike,
  cache: {},
  fps: FPS,
  loadImage: async (src) =>
    (await loadImage(src)) as unknown as CanvasImageSource & { width: number; height: number },
};
await prepareHud(project.style, env);

const stills = arg('stills');
if (stills) {
  for (const s of stills.split(',')) {
    const t = Math.round(Number(s) * FPS) / FPS;
    mode.draw(ctx, t, plan, project.style, env);
    const f = `${out.replace(/\.mp4$/, '')}_${s}.png`;
    fs.writeFileSync(f, cv.toBuffer('image/png'));
    console.log('->', f);
  }
  process.exit(0);
}

// 1) audio: cada choque toca sus notas con el instrumento
const instrument = await loadInstrumentNode(project.sound.instrument, root);
const t0 = Date.now();
const [l, r] = await renderHits(hits, instrument, project.sound, duration, SAMPLE_RATE);
const pcm = Buffer.alloc(l.length * 8);
for (let i = 0; i < l.length; i++) {
  pcm.writeFloatLE(l[i], i * 8);
  pcm.writeFloatLE(r[i], i * 8 + 4);
}
const audioFile = `${out.replace(/\.mp4$/, '')}.audio.f32`;
fs.writeFileSync(audioFile, pcm);
console.log(`audio en ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// 2) vídeo: fotogramas en bruto a ffmpeg
const tmp = `${out.replace(/\.mp4$/, '')}.part.mp4`;
const ff = spawn(
  process.env.FFMPEG_PATH || 'ffmpeg',
  [
    '-y',
    '-v',
    'error',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${VIDEO_W}x${VIDEO_H}`,
    '-r',
    String(FPS),
    '-i',
    '-',
    '-f',
    'f32le',
    '-ar',
    String(SAMPLE_RATE),
    '-ac',
    '2',
    '-i',
    audioFile,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-vf',
    'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    tmp,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const done = new Promise<number | null>((resolve) => ff.on('close', resolve));
const nF = Math.ceil(duration * FPS);
const t1 = Date.now();
for (let i = 0; i < nF; i++) {
  mode.draw(ctx, i / FPS, plan, project.style, env);
  if (!ff.stdin.write(Buffer.from(cv.data()))) await new Promise((res) => ff.stdin.once('drain', res));
  if (i % 150 === 0) process.stdout.write(`\r${Math.round((100 * i) / nF)}%`);
}
ff.stdin.end();
const code = await done;
fs.unlinkSync(audioFile);
if (code !== 0) {
  console.error('\nffmpeg falló');
  process.exit(1);
}
fs.renameSync(tmp, out);
console.log(`\r${nF} fotogramas en ${((Date.now() - t1) / 1000).toFixed(1)} s -> ${out}`);
