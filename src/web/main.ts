// Web "Bolas al ritmo": estado, controles, vista previa con sonido y exportación.
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import { INSTRUMENTS, type Instrument } from '@core/audio/instruments.ts';
import { PALETTES, hexToRgb, luminance, rgbToHex } from '@core/color.ts';
import { parseMidi, writeMidi } from '@core/midi/parse.ts';
import { MODES, getMode } from '@core/modes/index.ts';
import { buildProject, defaultProject, normalizeProject, planChanged, type Project } from '@core/project.ts';
import { prepareHud, type CanvasLike, type DrawEnv } from '@core/scene/draw.ts';
import { DEFAULT_STYLE, type SceneStyle } from '@core/scene/style.ts';
import { VIDEO_H as H, VIDEO_W as W } from '@core/types.ts';
import type { Hit, MusicSettings, Score, SoundSettings } from '@core/types.ts';
import { LivePlayer, fetchInstrument } from './audio.ts';
import { exportVideo, type ExportResult } from './export.ts';
import { canShareFiles, desktop, lastSavedPath, saveFile, shareFile, slug, stripExt } from './files.ts';
import { drawRoll, drawTicks } from './pianoroll.ts';
import { DEFAULT_TRANSCRIBE, decodeForModel, transcribe, type TranscribeOptions } from './transcribe.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const fmt = (v: number, d = 1) =>
  Number(v).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** mm:ss.d (décimas) */
const mmssd = (s: number) => {
  const d = Math.round(s * 10);
  return `${Math.floor(d / 600)}:${String(Math.floor((d % 600) / 10)).padStart(2, '0')}.${d % 10}`;
};
/** Lee "m:ss.d", "ss.d" o "ss" y devuelve segundos (o null si no se entiende). */
const parseTime = (txt: string): number | null => {
  const m = txt
    .trim()
    .replace(',', '.')
    .match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return (m[1] ? +m[1] * 60 : 0) + +m[2];
};
const STORE = 'bolas-al-ritmo:v2';

// ---------- estado ----------
let project: Project = defaultProject();
let score: Score | null = null;
let audioForModel: Float32Array | null = null; // última canción decodificada (para reconvertir)
let transcribeOpts: TranscribeOptions = { ...DEFAULT_TRANSCRIBE };
let hits: Hit[] = [];
let duration = 3;
let plan: unknown = null;
let t = 0;
let playing = false;
let exporting = false;
let cancelFlag = false;
let lastResult: ExportResult | null = null;
let lastName = '';
let instrument: Instrument | null = null;
const player = new LivePlayer();

const PRESETS: Record<string, { name: string; style: Partial<SceneStyle> }> = {
  noche: {
    name: 'Noche',
    style: {
      colorMode: 'nota',
      bgTop: '#0f1020',
      bgBottom: '#040406',
      glow: 1,
      trail: 0.18,
      particles: 1,
      outline: true,
      textColor: '#ffffff',
    },
  },
  neon: {
    name: 'Neón',
    style: {
      colorMode: 'paleta',
      palette: 'neon',
      bgTop: '#000000',
      bgBottom: '#05000a',
      glow: 1.5,
      trail: 0.3,
      particles: 1.5,
      outline: false,
      textColor: '#ffffff',
    },
  },
  fuego: {
    name: 'Fuego',
    style: {
      colorMode: 'paleta',
      palette: 'fuego',
      bgTop: '#220803',
      bgBottom: '#000000',
      glow: 1.2,
      trail: 0.24,
      particles: 1.8,
      outline: true,
      textColor: '#ffe9d9',
    },
  },
  hielo: {
    name: 'Hielo',
    style: {
      colorMode: 'paleta',
      palette: 'hielo',
      ringMode: 'fijo',
      ringColor: '#dff6ff',
      bgTop: '#06263a',
      bgBottom: '#020b12',
      glow: 1,
      trail: 0.2,
      particles: 1,
      outline: true,
      textColor: '#e6f7ff',
    },
  },
  papel: {
    name: 'Papel',
    style: {
      colorMode: 'nota',
      ringMode: 'fijo',
      ringColor: '#1d1b2b',
      bgTop: '#fbf7f0',
      bgBottom: '#ece4ff',
      glow: 0.5,
      trail: 0.14,
      particles: 1,
      outline: false,
      textColor: '#1d1b2b',
    },
  },
};

// ---------- lienzo de la vista previa ----------
const cv = $<HTMLCanvasElement>('cv');
const ctx = cv.getContext('2d')!;
const makeCanvas = (w: number, h: number): CanvasLike => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('imagen'));
    img.src = src;
  });
const previewEnv: DrawEnv = { makeCanvas, cache: {}, fps: 60, loadImage };
let preparing: Promise<void> | null = null;
/** Carga lo que necesite el modo actual (WebGL) y el logo; vuelve a dibujar al terminar. */
function prepareMode(): Promise<void> {
  const mode = getMode(project.style.mode);
  preparing = (async () => {
    try {
      await mode.prepare?.(previewEnv);
      await prepareHud(project.style, previewEnv);
    } catch (e) {
      console.error(e);
      $('statusText').textContent = 'No se pudo iniciar el modo 3D (WebGL)';
    }
    drawFrame();
  })();
  return preparing;
}

function sizeCanvas(): void {
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const s = Math.max(0.3, Math.min(1, (r.width * dpr) / W));
  const w = Math.round(W * s);
  const h = Math.round(H * s);
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  drawFrame();
}
function drawFrame(): void {
  if (!plan || (plan as { kind?: string }).kind !== project.style.mode) return;
  const s = cv.width / W;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  try {
    getMode(project.style.mode).draw(ctx, t, plan, project.style, previewEnv);
  } catch (e) {
    console.error(e);
  }
}
function themeColor(): string {
  const m = getComputedStyle(document.body).color.match(/\d+(\.\d+)?/g) || ['17', '17', '20'];
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}
function redrawRoll(): void {
  drawRoll($<HTMLCanvasElement>('roll'), {
    score,
    hits,
    music: project.music,
    segDur: segmentSeconds(),
    t,
    theme: themeColor(),
  });
}
function segmentSeconds(): number {
  if (!score) return 0;
  const m = project.music;
  const total = (score.duration - m.start) / m.speed;
  return m.duration > 0 ? Math.min(m.duration, total) : total;
}
function updateTime(): void {
  $('time').textContent = `${mmss(t)} / ${mmss(duration)}`;
  ($('seek') as HTMLInputElement).value = String(t);
}

// ---------- recálculo ----------
let planTimer = 0;
function schedule(fn: () => void, ms = 90): void {
  clearTimeout(planTimer);
  planTimer = window.setTimeout(fn, ms);
}
function rebuild(): void {
  const built = buildProject(project, score);
  hits = built.hits;
  duration = built.duration;
  plan = built.plan;
  t = Math.min(t, duration);
  ($('seek') as HTMLInputElement).max = String(duration);
  if (score) {
    syncRange();
    const rate = hits.length / Math.max(0.1, duration);
    $('statusText').textContent = `${hits.length} choques · ${fmt(duration)} s`;
    $('songNote').textContent = hits.length
      ? `${hits.length} choques en ${fmt(duration)} s (${fmt(rate)} por segundo)`
      : 'No hay notas en este tramo: cambia el inicio, la duración o las pistas.';
  } else {
    $('statusText').textContent = 'Sube un MIDI';
  }
  drawTicks($<HTMLCanvasElement>('ticks'), hits, duration);
  redrawRoll();
  updateTime();
  drawFrame();
}
function replan(): void {
  if (!hits.length && !score) {
    rebuild();
    return;
  }
  plan = getMode(project.style.mode).plan(hits, duration, project.style);
  drawFrame();
}

// ---------- cargar música ----------
function busy(text: string): void {
  const b = $('busy');
  b.hidden = !text;
  b.textContent = text;
}
function setScore(s: Score | null, kind: Project['source']): void {
  stop();
  score = s;
  project.source = kind;
  project.music.start = 0;
  t = 0;
  if (s) {
    project.name = s.name;
    if (!project.style.title && s.source === 'midi' && s.name && s.name !== 'midi') project.style.title = '';
  }
  renderTracks();
  $('songName').textContent = s ? `${s.name} · ${mmss(s.duration)} · ${s.notes.length} notas` : '';
  $('transcribeBox').hidden = !s || s.source !== 'transcription';
  syncControls();
  rebuild();
  persist();
}
async function loadMidiFile(data: ArrayBuffer, name: string): Promise<void> {
  try {
    const s = parseMidi(data, stripExt(name));
    if (!s.notes.length) throw new Error('vacío');
    setScore(s, { kind: 'midi', file: name });
    audioForModel = null;
  } catch {
    $('songName').textContent = 'No he podido leer ese archivo MIDI.';
  }
}
async function loadAudioFile(data: ArrayBuffer, name: string): Promise<void> {
  busy('Leyendo el audio…');
  try {
    const { audio } = await decodeForModel(data);
    audioForModel = audio;
    await runTranscription(stripExt(name));
  } catch (e) {
    console.error(e);
    busy('');
    $('songName').textContent = 'No he podido leer ese archivo. Prueba con MP3, M4A, WAV o un vídeo MP4.';
  }
}
let transcribing = false;
async function runTranscription(name: string): Promise<void> {
  if (!audioForModel || transcribing) return;
  transcribing = true;
  $('statusText').textContent = 'Convirtiendo a MIDI…';
  try {
    const { score: s, backend } = await transcribe(audioForModel, name, transcribeOpts, (p, stage) =>
      busy(`${stage} ${Math.round(p * 100)} %`),
    );
    console.info(`Transcripción con backend ${backend}: ${s.notes.length} notas`);
    if (!s.notes.length) {
      $('songName').textContent = 'No he encontrado notas claras. Prueba a subir la sensibilidad.';
      $('transcribeBox').hidden = false;
    } else setScore(s, { kind: 'transcription', file: name });
  } catch (e) {
    console.error(e);
    $('songName').textContent = `No se pudo convertir la canción: ${(e as Error).message}`;
  } finally {
    transcribing = false;
    busy('');
  }
}
/** Lee una imagen y la reduce a `maxW` px de ancho (PNG con transparencia) para guardarla en el proyecto. */
async function fileToDataUrl(file: File, maxW: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const s = Math.min(1, maxW / img.width);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** Enlace de YouTube → audio (lo descarga la app de escritorio) → MIDI por transcripción. */
async function loadFromYoutube(url: string): Promise<void> {
  const d = desktop();
  if (!d?.youtubeAudio) {
    $('ytNote').hidden = false;
    return;
  }
  if (!/youtu\.?be/i.test(url)) {
    $('songName').textContent = 'Pega un enlace de YouTube (youtube.com o youtu.be).';
    return;
  }
  busy('Descargando el audio de YouTube…');
  try {
    const r = await d.youtubeAudio(url);
    const buf = r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) as ArrayBuffer;
    await loadAudioFile(buf, `${r.title}.${r.name.split('.').pop() ?? 'm4a'}`);
  } catch (e) {
    console.error(e);
    busy('');
    const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    $('songName').textContent = `No se pudo bajar el audio: ${msg}`;
  }
}
async function openFromDesktop(): Promise<void> {
  const f = await desktop()?.openFile();
  if (!f) return;
  const buf = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer;
  if (/\.midi?$/i.test(f.name)) await loadMidiFile(buf, f.name);
  else await loadAudioFile(buf, f.name);
}
async function loadDemo(): Promise<void> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}demo/para-elisa.mid`);
    if (!r.ok) throw new Error(String(r.status));
    const s = parseMidi(await r.arrayBuffer(), 'Para Elisa (ejemplo)');
    setScore(s, { kind: 'midi', file: 'para-elisa.mid' });
    if (hits.length > 12) {
      t = hits[10].t + 0.05;
      updateTime();
      drawFrame();
      redrawRoll();
    }
  } catch {
    $('songNote').textContent = 'No se pudo cargar el ejemplo. Sube un MIDI para empezar.';
  }
}
function renderTracks(): void {
  const box = $('tracks');
  if (!score || score.tracks.length < 2) {
    box.innerHTML = '';
    return;
  }
  const chosen = project.music.tracks === 'all' ? null : new Set(project.music.tracks);
  box.innerHTML = score.tracks
    .map((tr) => {
      const on = chosen ? chosen.has(tr.index) : tr.instrument !== 'drums';
      return `<label class="track"><input type="checkbox" data-track="${tr.index}" ${on ? 'checked' : ''}>${tr.name}<small>${tr.noteCount} notas${tr.instrument === 'drums' ? ' · percusión' : ''}</small></label>`;
    })
    .join('');
  box.querySelectorAll<HTMLInputElement>('input[data-track]').forEach((el) =>
    el.addEventListener('change', () => {
      const list = [...box.querySelectorAll<HTMLInputElement>('input[data-track]')]
        .filter((x) => x.checked)
        .map((x) => +x.dataset.track!);
      project.music.tracks = list;
      stop();
      schedule(rebuild);
      persist();
    }),
  );
}

// ---------- instrumento y reproducción ----------
async function ensureInstrument(): Promise<Instrument> {
  if (instrument && instrument.id === project.sound.instrument) return instrument;
  busy('Cargando el instrumento…');
  try {
    instrument = await fetchInstrument(project.sound.instrument);
  } finally {
    busy('');
  }
  return instrument;
}
function setIcons(): void {
  $('icoPlay').hidden = playing;
  $('icoPause').hidden = !playing;
  $('play').setAttribute('aria-label', playing ? 'Pausa' : 'Reproducir');
}
async function play(): Promise<void> {
  if (!hits.length || exporting) return;
  const ok = await player.ensure();
  const inst = await ensureInstrument();
  if (!ok) {
    $('statusText').textContent = 'Toca otra vez para oír el audio';
    return;
  }
  if (t >= duration - 0.05) t = 0;
  player.play(hits, inst, project.sound, t);
  playing = true;
  setIcons();
  requestAnimationFrame(loop);
}
function loop(): void {
  if (!playing) return;
  t = Math.min(duration, Math.max(0, player.position));
  drawFrame();
  updateTime();
  redrawRoll();
  if (t >= duration) {
    stop();
    return;
  }
  requestAnimationFrame(loop);
}
function stop(): void {
  playing = false;
  player.stop();
  setIcons();
}

// ---------- exportar ----------
function progress(f: number, text?: string): void {
  $('barFill').style.width = `${Math.round(f * 100)}%`;
  if (text) $('exportMsg').textContent = text;
}
async function doExport(): Promise<void> {
  if (!hits.length || exporting) return;
  stop();
  exporting = true;
  cancelFlag = false;
  ($('export') as HTMLButtonElement).disabled = true;
  $('cancel').hidden = false;
  $('bar').hidden = false;
  $('result').hidden = true;
  $('exportMsg').className = 'msg';
  progress(0, 'Preparando…');
  try {
    const inst = await ensureInstrument();
    const t0 = performance.now();
    const res = await exportVideo(
      {
        hits,
        duration,
        plan,
        style: project.style,
        mode: getMode(project.style.mode),
        instrument: inst,
        sound: project.sound,
        onProgress: progress,
        isCancelled: () => cancelFlag,
      },
      player.ctx,
    );
    lastResult = res;
    lastName = `${slug(project.style.title || project.name)}-bolas.${res.ext}`;
    const out = $<HTMLVideoElement>('out');
    if (out.src) URL.revokeObjectURL(out.src);
    out.src = URL.createObjectURL(res.blob);
    out.addEventListener('loadedmetadata', () => (out.currentTime = Math.min(2, duration / 3)), {
      once: true,
    });
    $('result').hidden = false;
    $('share').hidden = !canShareFiles();
    progress(
      1,
      `Listo en ${Math.round((performance.now() - t0) / 1000)} s: ${fmt(res.blob.size / 1048576)} MB${res.ext === 'webm' ? ' (WebM: este navegador no graba MP4)' : ''}.`,
    );
  } catch (e) {
    const msg = (e as Error).message;
    $('exportMsg').className = msg === 'cancel' ? 'msg' : 'msg err';
    $('exportMsg').textContent = msg === 'cancel' ? 'Cancelado.' : `No se pudo crear el vídeo: ${msg}`;
    if (msg !== 'cancel') console.error(e);
  } finally {
    exporting = false;
    ($('export') as HTMLButtonElement).disabled = false;
    $('cancel').hidden = true;
    setTimeout(() => ($('bar').hidden = true), 600);
  }
}
async function saveVideo(): Promise<void> {
  if (!lastResult) return;
  const r = await saveFile(lastResult.blob, lastName);
  $('exportMsg').textContent =
    r === 'saved'
      ? `Guardado: ${lastName}`
      : r === 'declined'
        ? 'No se ha guardado. Puedes volver a pulsar “Guardar MP4”.'
        : r === 'busy'
          ? 'Hay otra descarga pendiente; prueba en unos segundos.'
          : 'Aquí no se puede guardar el archivo.';
}

// ---------- proyecto y persistencia ----------
function persist(): void {
  try {
    localStorage.setItem(
      STORE,
      JSON.stringify({ music: project.music, sound: project.sound, style: project.style, transcribeOpts }),
    );
  } catch {}
}
function loadStored(): void {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (s) {
      project = normalizeProject({
        app: 'bolas-al-ritmo',
        version: 1,
        music: s.music,
        sound: s.sound,
        style: s.style,
      });
      project.music.tracks = 'all';
      if (s.transcribeOpts) transcribeOpts = { ...transcribeOpts, ...s.transcribeOpts };
    }
  } catch {}
}
async function saveProject(): Promise<void> {
  const p: Project = { ...project, hits, duration };
  const r = await saveFile(
    new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }),
    `proyecto-${slug(project.style.title || project.name)}.json`,
  );
  $('exportMsg').textContent = r === 'saved' ? 'Proyecto guardado.' : 'No se ha guardado el proyecto.';
}
async function openProject(file: File): Promise<void> {
  try {
    const p = normalizeProject(JSON.parse(await file.text()));
    const keepStart = score ? Math.min(p.music.start, Math.max(0, score.duration - 1)) : 0;
    project = { ...p, music: { ...p.music, start: keepStart, tracks: 'all' } };
    if (!score && p.hits?.length) {
      hits = p.hits;
    }
    syncControls();
    renderTracks();
    rebuild();
    persist();
    $('exportMsg').textContent = `Proyecto abierto${p.source?.file ? ` (era para: ${p.source.file})` : ''}.`;
  } catch {
    $('exportMsg').textContent = 'Ese archivo no es un proyecto de Bolas al ritmo.';
  }
}
async function downloadMidi(): Promise<void> {
  if (!score) return;
  const bytes = writeMidi(score.notes, score.name);
  await saveFile(new Blob([bytes as BlobPart], { type: 'audio/midi' }), `${slug(score.name)}.mid`);
}

// ---------- controles ----------
type Kind = 'num' | 'str' | 'bool';
interface Ctl {
  id: string;
  get: () => unknown;
  set: (v: unknown) => void;
  kind: Kind;
  fmt?: (v: never) => string;
  after: 'music' | 'sound' | 'style' | 'transcribe';
}
const m = () => project.music;
const so = () => project.sound;
const st = () => project.style;
const numCtl = (
  id: string,
  obj: () => Record<string, unknown>,
  key: string,
  after: Ctl['after'],
  f?: (v: number) => string,
): Ctl => ({ id, kind: 'num', get: () => obj()[key], set: (v) => (obj()[key] = v), after, fmt: f as never });
const strCtl = (id: string, obj: () => Record<string, unknown>, key: string, after: Ctl['after']): Ctl => ({
  id,
  kind: 'str',
  get: () => obj()[key],
  set: (v) => (obj()[key] = v),
  after,
});
const boolCtl = (id: string, obj: () => Record<string, unknown>, key: string, after: Ctl['after']): Ctl => ({
  id,
  kind: 'bool',
  get: () => obj()[key],
  set: (v) => (obj()[key] = v),
  after,
});
const CTLS: Ctl[] = [
  strCtl('selection', m as never, 'selection', 'music'),
  numCtl('start', m as never, 'start', 'music', mmssd),
  numCtl('speed', m as never, 'speed', 'music', (v) => `×${fmt(v, 2)}`),
  numCtl('minGap', m as never, 'minGap', 'music', (v) => `${fmt(v, 2)} s`),
  numCtl('lead', m as never, 'lead', 'music', (v) => `${fmt(v, 1)} s`),
  strCtl('instrument', so as never, 'instrument', 'sound'),
  numCtl('volume', so as never, 'volume', 'sound', (v) => `${Math.round(v * 100)} %`),
  numCtl('reverb', so as never, 'reverb', 'sound', (v) => `${Math.round(v * 100)} %`),
  strCtl('sustain', so as never, 'sustain', 'sound'),
  strCtl('mode', st as never, 'mode', 'style'),
  strCtl('colorMode', st as never, 'colorMode', 'style'),
  strCtl('palette', st as never, 'palette', 'style'),
  numCtl('platformLength', st as never, 'platformLength', 'style', (v) => `${v} px`),
  numCtl('platformThickness', st as never, 'platformThickness', 'style', (v) => `${v} px`),
  numCtl('descent', st as never, 'descent', 'style', (v) => `${v} px/s`),
  numCtl('spread', st as never, 'spread', 'style', (v) => `${Math.round(v * 100)} %`),
  numCtl('ringRadius', st as never, 'ringRadius', 'style', (v) => `${v} px`),
  numCtl('ringWidth', st as never, 'ringWidth', 'style', (v) => `${v} px`),
  strCtl('ringMode', st as never, 'ringMode', 'style'),
  strCtl('ringColor', st as never, 'ringColor', 'style'),
  numCtl('ballStart', st as never, 'ballStart', 'style', (v) => `${v} px`),
  numCtl('ballEnd', st as never, 'ballEnd', 'style', (v) => `${v} px`),
  numCtl('gravity', st as never, 'gravity', 'style', (v) => `×${fmt(v, 2)}`),
  numCtl('chaos', st as never, 'chaos', 'style', (v) => `${Math.round(v * 100)} %`),
  numCtl('trail', st as never, 'trail', 'style', (v) => `${fmt(v, 2)} s`),
  numCtl('particles', st as never, 'particles', 'style', (v) => `×${fmt(v, 1)}`),
  numCtl('glow', st as never, 'glow', 'style', (v) => `×${fmt(v, 1)}`),
  boolCtl('outline', st as never, 'outline', 'style'),
  strCtl('bgTop', st as never, 'bgTop', 'style'),
  strCtl('bgBottom', st as never, 'bgBottom', 'style'),
  strCtl('title', st as never, 'title', 'style'),
  strCtl('subtitle', st as never, 'subtitle', 'style'),
  strCtl('handle', st as never, 'handle', 'style'),
  strCtl('textColor', st as never, 'textColor', 'style'),
  boolCtl('noteNames', st as never, 'noteNames', 'style'),
  strCtl('textStyle', st as never, 'textStyle', 'style'),
  numCtl('logoSize', st as never, 'logoSize', 'style', (v) => `${Math.round(v * 100)} %`),
  strCtl('theme3d', st as never, 'theme3d', 'style'),
  strCtl('floorColor', st as never, 'floorColor', 'style'),
  numCtl('cameraAzimuth', st as never, 'cameraAzimuth', 'style', (v) => `${v}°`),
  numCtl('cameraElevation', st as never, 'cameraElevation', 'style', (v) => `${v}°`),
  numCtl('cameraDistance', st as never, 'cameraDistance', 'style', (v) => `${fmt(v, 1)}`),
  numCtl('lightAngle', st as never, 'lightAngle', 'style', (v) => `${v}°`),
  numCtl('shadowSoftness', st as never, 'shadowSoftness', 'style', (v) => `${Math.round(v * 100)} %`),
  numCtl('pace3d', st as never, 'pace3d', 'style', (v) => `${fmt(v, 1)}`),
  numCtl('spread3d', st as never, 'spread3d', 'style', (v) => `${fmt(v, 1)}`),
  numCtl('tileSize', st as never, 'tileSize', 'style', (v) => `${fmt(v, 2)}`),
  numCtl('ballSize3d', st as never, 'ballSize3d', 'style', (v) => `${fmt(v, 2)}`),
  numCtl('recoil', st as never, 'recoil', 'style', (v) => `×${fmt(v, 1)}`),
  numCtl('maxBalls', st as never, 'maxBalls', 'style', (v) => `${v}`),
  boolCtl('cameraDirector', st as never, 'cameraDirector', 'style'),
  strCtl('ballStyle3d', st as never, 'ballStyle3d', 'style'),
  strCtl('ballColor3d', st as never, 'ballColor3d', 'style'),
  strCtl('ballColorFixed', st as never, 'ballColorFixed', 'style'),
  strCtl('ballColor2', st as never, 'ballColor2', 'style'),
  numCtl('trail3d', st as never, 'trail3d', 'style', (v) => `${Math.round(v * 100)} %`),
  numCtl('seed', st as never, 'seed', 'style', (v) => `#${v}`),
  numCtl('bloom', st as never, 'bloom', 'style', (v) => `${Math.round(v * 100)} %`),
  boolCtl('counter', st as never, 'counter', 'style'),
  numCtl(
    'onsetThresh',
    (() => transcribeOpts) as never,
    'onsetThresh',
    'transcribe',
    (v) => `${Math.round((0.8 - v) * 166 + 1)}`,
  ),
  numCtl(
    'minNoteLen',
    (() => transcribeOpts) as never,
    'minNoteLen',
    'transcribe',
    (v) => `${Math.round(v * 11.6)} ms`,
  ),
];
function readCtl(el: HTMLInputElement | HTMLSelectElement, kind: Kind): unknown {
  return kind === 'bool' ? (el as HTMLInputElement).checked : kind === 'num' ? +el.value : el.value;
}
function writeCtl(el: HTMLInputElement | HTMLSelectElement, kind: Kind, v: unknown): void {
  if (kind === 'bool') (el as HTMLInputElement).checked = !!v;
  else el.value = String(v);
}
/** Fin del tramo en segundos de la canción (duración 0 = hasta el final). */
function rangeEnd(): number {
  const songEnd = score ? score.duration : project.music.start + 30;
  return project.music.duration > 0
    ? Math.min(songEnd, project.music.start + project.music.duration)
    : songEnd;
}
function setRange(start: number, end: number): void {
  const songEnd = score ? score.duration : Infinity;
  start = Math.max(
    0,
    Math.min(Number.isFinite(songEnd) ? songEnd - 0.5 : start, Math.round(start * 10) / 10),
  );
  end = Math.max(start + 0.5, Math.min(Number.isFinite(songEnd) ? songEnd : end, Math.round(end * 10) / 10));
  project.music.start = start;
  project.music.duration = Math.round((end - start) * 10) / 10;
  syncRange();
  t = 0;
  stop();
  schedule(rebuild, 60);
  persist();
}
/** Refleja inicio y fin en los deslizadores y en los campos exactos. */
function syncRange(): void {
  const songEnd = score ? score.duration : project.music.start + 30;
  const endEl = $<HTMLInputElement>('end');
  const startEl = $<HTMLInputElement>('start');
  startEl.max = String(Math.max(0, Math.floor((songEnd - 0.5) * 10) / 10));
  endEl.max = String(Math.ceil(songEnd * 10) / 10);
  const end = rangeEnd();
  startEl.value = String(project.music.start);
  endEl.value = String(end);
  $('startV').textContent = mmssd(project.music.start);
  $('endV').textContent = mmssd(end);
  $<HTMLInputElement>('startExact').value = mmssd(project.music.start);
  $<HTMLInputElement>('endExact').value = mmssd(end);
}
function syncControls(): void {
  syncRange();
  for (const c of CTLS) {
    const el = $<HTMLInputElement>(c.id);
    writeCtl(el, c.kind, c.get());
    const out = document.getElementById(c.id + 'V');
    if (out && c.fmt) out.textContent = c.fmt(c.get() as never);
  }
  (project.style.colors || []).slice(0, 5).forEach((col, i) => ($<HTMLInputElement>('c' + i).value = col));
  $('paletteRow').hidden = project.style.colorMode !== 'paleta';
  $('customRow').hidden = project.style.colorMode !== 'paleta' || project.style.palette !== 'personalizada';
  document
    .querySelectorAll<HTMLElement>('[data-mode]')
    .forEach((el) => (el.hidden = !(el.dataset.mode ?? '').split(/\s+/).includes(project.style.mode)));
  $('ringColor')
    .closest('.row')!
    .toggleAttribute('hidden', project.style.mode !== 'ring' || project.style.ringMode !== 'fijo');
  const is3d = project.style.mode === 'platforms3d';
  $('ballColorFixed')
    .closest('.row')!
    .toggleAttribute('hidden', !is3d || project.style.ballColor3d !== 'fija');
  $('ballColor2')
    .closest('.row')!
    .toggleAttribute('hidden', !is3d || project.style.ballStyle3d !== 'canica');
  $('floorColor')
    .closest('.row')!
    .toggleAttribute('hidden', !is3d || project.style.theme3d !== 'personalizado');
  $('modeDesc').textContent = getMode(project.style.mode).description;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.preset')) {
    const p = PRESETS[b.dataset.p!].style;
    b.classList.toggle(
      'on',
      Object.entries(p).every(([k, v]) => (project.style as unknown as Record<string, unknown>)[k] === v),
    );
  }
}
function onChange(c: Ctl, el: HTMLInputElement | HTMLSelectElement): void {
  const before = { ...project.style };
  c.set(readCtl(el, c.kind));
  const out = document.getElementById(c.id + 'V');
  if (out && c.fmt) out.textContent = c.fmt(c.get() as never);
  if (c.after === 'music') {
    if (c.id === 'start' || c.id === 'speed') t = 0;
    if (c.id === 'start') {
      // el fin se mantiene donde estaba (si cabe): la duración es lo que cambia
      const end = Math.max(project.music.start + 0.5, rangeEnd());
      project.music.duration = Math.round((end - project.music.start) * 10) / 10;
      syncRange();
    }
    stop();
    schedule(rebuild);
  } else if (c.after === 'sound') {
    player.setSound(project.sound);
    if (c.id === 'instrument') {
      instrument = null;
      void ensureInstrument().then((inst) => {
        if (hits.length && player.ctx)
          player.preview(hits[Math.min(hits.length - 1, 10)], inst, project.sound);
      });
    }
  } else if (c.after === 'style') {
    stop();
    if (c.id === 'mode') {
      replan();
      void prepareMode();
    } else if (c.id === 'maxBalls') schedule(rebuild, 120);
    else if (planChanged(project.style.mode, before, project.style)) schedule(replan, 120);
    else drawFrame();
    if (
      [
        'mode',
        'colorMode',
        'palette',
        'ringMode',
        'bgTop',
        'bgBottom',
        'ballColor3d',
        'ballStyle3d',
        'theme3d',
      ].includes(c.id)
    )
      syncControls();
  }
  persist();
}
function bind(): void {
  for (const c of CTLS) {
    const el = $<HTMLInputElement>(c.id);
    const ev = c.kind === 'bool' || el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
    el.addEventListener(ev, () => onChange(c, el));
    if (el.type === 'color') el.addEventListener('input', () => onChange(c, el));
    if (el.type === 'range' && c.after === 'transcribe') el.addEventListener('change', () => persist());
  }
  for (let i = 0; i < 5; i++)
    $<HTMLInputElement>('c' + i).addEventListener('input', (e) => {
      const cs = [...(project.style.colors || DEFAULT_STYLE.colors)];
      cs[i] = (e.target as HTMLInputElement).value;
      project.style.colors = cs;
      schedule(replan, 120);
      persist();
    });
  $('play').addEventListener('click', () => (playing ? stop() : void play()));
  $('seek').addEventListener('input', (e) => {
    t = +(e.target as HTMLInputElement).value;
    const was = playing;
    stop();
    drawFrame();
    updateTime();
    redrawRoll();
    if (was) void play();
  });
  $('fileMidi').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) await loadMidiFile(await f.arrayBuffer(), f.name);
    input.value = '';
  });
  $('fileAudio').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) await loadAudioFile(await f.arrayBuffer(), f.name);
    input.value = '';
  });
  $('demo').addEventListener('click', () => void loadDemo());
  $('logoFile').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      project.style.logo = await fileToDataUrl(f, 900);
      syncControls();
      await prepareHud(project.style, previewEnv);
      drawFrame();
      persist();
    } catch {
      $('statusText').textContent = 'No se pudo leer la imagen';
    }
  });
  $('logoClear').addEventListener('click', () => {
    project.style.logo = '';
    syncControls();
    drawFrame();
    persist();
  });
  $('retranscribe').addEventListener('click', () => void runTranscription(score?.name || 'canción'));
  $('downloadMidi').addEventListener('click', () => void downloadMidi());
  $('reset').addEventListener('click', () => {
    const mode = project.style.mode;
    project.style = { ...DEFAULT_STYLE, colors: [...DEFAULT_STYLE.colors], mode };
    syncControls();
    replan();
    persist();
  });
  $('export').addEventListener('click', () => {
    void player.ensure();
    void doExport();
  });
  $('cancel').addEventListener('click', () => (cancelFlag = true));
  $('save').addEventListener('click', () => void saveVideo());
  $('share').addEventListener('click', async () => {
    if (lastResult && !(await shareFile(lastResult.blob, lastName, project.style.title || 'Bolas al ritmo')))
      $('exportMsg').textContent = 'No se pudo compartir; usa “Guardar MP4”.';
  });
  $('saveProj').addEventListener('click', () => void saveProject());
  $('openFolder').addEventListener('click', () => void desktop()?.showInFolder(lastSavedPath));
  const d = desktop();
  if (d) {
    document.body.classList.add('desktop');
    d.onMenu((action) => {
      if (action === 'save-project') void saveProject();
      if (action === 'open') void openFromDesktop();
      if (action === 'youtube') $('ytUrl').focus();
    });
    d.onUpdate((text) => ($('statusText').textContent = text));
    d.onYoutubeProgress?.((text) => busy(text));
    $('openAny').hidden = false;
    $('openAny').addEventListener('click', () => void openFromDesktop());
  }
  const yt = () => void loadFromYoutube($<HTMLInputElement>('ytUrl').value);
  $('ytGo').addEventListener('click', yt);
  $('ytUrl').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') yt();
  });
  $('loadProj').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void openProject(f);
    input.value = '';
  });
  const rb = $('rollBox');
  const pick = (e: PointerEvent) => {
    if (!score) return;
    const r = rb.getBoundingClientRect();
    const s = Math.max(0, Math.min(score.duration - 1, ((e.clientX - r.left) / r.width) * score.duration));
    const dur = project.music.duration > 0 ? project.music.duration : 30;
    setRange(Math.round(s * 10) / 10, Math.round(s * 10) / 10 + dur);
  };
  $('end').addEventListener('input', () => setRange(project.music.start, +$<HTMLInputElement>('end').value));
  const exact = () => {
    const a = parseTime($<HTMLInputElement>('startExact').value);
    const z = parseTime($<HTMLInputElement>('endExact').value);
    if (a === null || z === null) {
      syncRange();
      return;
    }
    setRange(a, z);
  };
  for (const id of ['startExact', 'endExact']) {
    $(id).addEventListener('change', exact);
    $(id).addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') exact();
    });
  }
  $('rangeAll').addEventListener('click', () => setRange(0, score ? score.duration : 30));
  rb.addEventListener('pointerdown', (e) => {
    rb.setPointerCapture(e.pointerId);
    pick(e);
  });
  rb.addEventListener('pointermove', (e) => e.buttons && pick(e));
  new ResizeObserver(() => {
    sizeCanvas();
    redrawRoll();
    drawTicks($<HTMLCanvasElement>('ticks'), hits, duration);
  }).observe(document.body);
  new MutationObserver(() => redrawRoll()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}
function buildStaticLists(): void {
  $('instrument').innerHTML = INSTRUMENTS.map((i) => `<option value="${i.id}">${i.name}</option>`).join('');
  $('mode').innerHTML = Object.values(MODES)
    .map((md) => `<option value="${md.id}">${md.name}</option>`)
    .join('');
  $('palette').innerHTML = Object.entries(PALETTES)
    .map(([id, p]) => `<option value="${id}">${p.name}</option>`)
    .join('');
  $('presets').innerHTML = Object.entries(PRESETS)
    .map(([id, p]) => {
      const s = { ...DEFAULT_STYLE, ...p.style };
      const pal = PALETTES[s.palette];
      const dots =
        s.colorMode === 'nota'
          ? ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0']
          : [0, 1, 2, 3].map((k) => rgbToHex(pal.at(k, s.colors)));
      const dark = luminance(hexToRgb(s.bgTop)) < 0.55;
      return `<button type="button" class="preset" data-p="${id}" style="background:radial-gradient(circle at 78% 30%, ${dots[0]} 0 9px, transparent 10px),radial-gradient(circle at 62% 42%, ${dots[1]} 0 6px, transparent 7px),radial-gradient(circle at 88% 55%, ${dots[2]} 0 5px, transparent 6px),linear-gradient(${s.bgTop}, ${s.bgBottom});color:${dark ? '#fff' : '#1d1b2b'}">${p.name}</button>`;
    })
    .join('');
  for (const b of document.querySelectorAll<HTMLButtonElement>('.preset'))
    b.addEventListener('click', () => {
      project.style = { ...project.style, ...PRESETS[b.dataset.p!].style };
      syncControls();
      replan();
      persist();
    });
}

// ---------- arranque ----------
function start(): void {
  loadStored();
  buildStaticLists();
  syncControls();
  bind();
  sizeCanvas();
  setIcons();
  updateTime();
  if (document.fonts)
    document.fonts.ready.then(() => {
      previewEnv.cache = {};
      drawFrame();
    });
  void loadDemo();
  void prepareMode();
  void ensureInstrument().catch(() => undefined);
  (window as unknown as { __bolas: unknown }).__bolas = {
    get state() {
      return {
        project,
        hits,
        plan,
        duration,
        score: score && { name: score.name, notes: score.notes.length, duration: score.duration },
      };
    },
    exportVideo: doExport,
    loadAudio: loadAudioFile,
    loadMidi: loadMidiFile,
    get lastResult() {
      return lastResult;
    },
    setTranscribe(o: Partial<TranscribeOptions>) {
      transcribeOpts = { ...transcribeOpts, ...o };
    },
    async setMode(mode: string) {
      project.style.mode = mode;
      syncControls();
      replan();
      await prepareMode();
    },
    setMusic(o: Partial<MusicSettings>) {
      Object.assign(project.music, o);
      syncControls();
      rebuild();
    },
    async setStyle(o: Partial<SceneStyle>) {
      Object.assign(project.style, o);
      syncControls();
      replan();
      await prepareMode();
    },
    seek(sec: number) {
      stop();
      t = Math.max(0, Math.min(duration, sec));
      drawFrame();
      updateTime();
      redrawRoll();
    },
    get ready() {
      return preparing ?? Promise.resolve();
    },
    get env() {
      return previewEnv;
    },
  };
}
start();

export type { MusicSettings, SoundSettings };
