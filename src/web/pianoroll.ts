// Piano roll: todas las notas de la partitura (tenues), las que suenan en los choques (vivas),
// el tramo elegido y el cursor de reproducción.
import { pitchColor } from '@core/music/names.ts';
import { rgba } from '@core/color.ts';
import type { Hit, Score } from '@core/types.ts';
import type { MusicSettings } from '@core/types.ts';

export interface RollView {
  score: Score | null;
  hits: Hit[];
  music: MusicSettings;
  segDur: number;
  t: number; // instante del vídeo (relativo al tramo)
  theme: string; // color del texto del tema, rgb(...)
}

export function drawRoll(canvas: HTMLCanvasElement, v: RollView): void {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  const x = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  x.clearRect(0, 0, w, h);
  if (!v.score || !v.score.notes.length) {
    x.fillStyle = v.theme.replace('rgb', 'rgba').replace(')', ',0.5)');
    x.font = `${13 * dpr}px Inter, system-ui, sans-serif`;
    x.textAlign = 'center';
    x.fillText('Sube un MIDI o una canción', w / 2, h / 2 + 5 * dpr);
    return;
  }
  const total = v.score.duration;
  const lo = Math.max(0, v.score.tracks.reduce((a, t) => Math.min(a, t.lowest), 127) - 2);
  const hi = Math.min(127, v.score.tracks.reduce((a, t) => Math.max(a, t.highest), 0) + 2);
  const rows = Math.max(12, hi - lo + 1);
  const rowH = h / rows;
  const px = (t: number) => (t / total) * w;
  const py = (m: number) => h - (m - lo + 1) * rowH;
  // tramo elegido
  const a = px(v.music.start);
  const b = px(Math.min(total, v.music.start + v.segDur * v.music.speed));
  x.fillStyle = 'rgba(255,59,47,0.10)';
  x.fillRect(a, 0, b - a, h);
  // notas de la partitura
  const used = new Set<number>();
  for (const hh of v.hits)
    for (const n of hh.notes)
      used.add(Math.round(((hh.t - v.music.lead) * v.music.speed + v.music.start) * 1000) * 1000 + n.midi);
  for (const n of v.score.notes) {
    const key = Math.round(n.time * 1000) * 1000 + n.midi;
    const on = used.has(key);
    x.fillStyle = on
      ? rgba(pitchColor(n.midi, 0.2, 0.7), 0.95)
      : v.theme.replace('rgb', 'rgba').replace(')', ',0.18)');
    x.fillRect(px(n.time), py(n.midi), Math.max(1.5 * dpr, px(n.duration)), Math.max(1, rowH - 1));
  }
  // bordes del tramo y cursor
  x.fillStyle = '#ff3b2f';
  x.fillRect(a, 0, Math.max(2, 1.5 * dpr), h);
  x.fillRect(b - Math.max(2, 1.5 * dpr), 0, Math.max(2, 1.5 * dpr), h);
  if (v.t > 0) {
    x.fillStyle = v.theme;
    x.fillRect(px(v.music.start + Math.max(0, v.t - v.music.lead) * v.music.speed), 0, Math.max(1, dpr), h);
  }
}

/** Marcas de los choques en la barra de reproducción. */
export function drawTicks(canvas: HTMLCanvasElement, hits: Hit[], segDur: number): void {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  const x = canvas.getContext('2d')!;
  x.clearRect(0, 0, canvas.width, canvas.height);
  const pad = 10 * dpr;
  const w = canvas.width - 2 * pad;
  const hh = canvas.height * 0.32;
  for (const h of hits) {
    x.fillStyle = rgba(pitchColor(h.notes[0]?.midi ?? 60), 0.7);
    x.fillRect(pad + (h.t / Math.max(0.01, segDur)) * w, 0, Math.max(1, dpr), hh);
  }
}
