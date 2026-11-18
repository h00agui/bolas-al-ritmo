// De la partitura a los choques: qué notas suenan en cada rebote y cuándo.
import type { Hit, HitNote, MusicSettings, Note, Score } from '../types.ts';

export const DEFAULT_MUSIC: MusicSettings = {
  tracks: 'all',
  selection: 'melody',
  minGap: 0.1,
  start: 0,
  duration: 30,
  speed: 1,
  minVelocity: 0,
  lowest: 0,
  highest: 127,
  lead: 0.5,
};

/** Notas que empiezan casi a la vez se consideran un acorde (ms). */
const CHORD_WINDOW = 0.03;

function selectNotes(score: Score, s: MusicSettings): Note[] {
  const drumTracks = new Set(score.tracks.filter((t) => t.instrument === 'drums').map((t) => t.index));
  const wanted = s.tracks === 'all' ? null : new Set(s.tracks);
  return score.notes.filter((n) => {
    if (wanted ? !wanted.has(n.track) : drumTracks.has(n.track)) return false;
    if (n.velocity < s.minVelocity) return false;
    if (n.midi < s.lowest || n.midi > s.highest) return false;
    return true;
  });
}

/** Agrupa notas simultáneas en acordes, ordenados por tiempo. */
export function groupChords(notes: Note[], window = CHORD_WINDOW): Note[][] {
  const sorted = [...notes].sort((a, b) => a.time - b.time || b.midi - a.midi);
  const groups: Note[][] = [];
  for (const n of sorted) {
    const last = groups[groups.length - 1];
    if (last && n.time - last[0].time <= window) last.push(n);
    else groups.push([n]);
  }
  return groups;
}

/**
 * Convierte la partitura en choques según los ajustes.
 * Los tiempos de los choques son relativos al inicio del vídeo (incluyen `lead`).
 */
export function scoreToHits(score: Score, settings: Partial<MusicSettings> = {}): Hit[] {
  const s = { ...DEFAULT_MUSIC, ...settings };
  const notes = selectNotes(score, s);
  const end = s.duration > 0 ? s.start + s.duration * s.speed : Infinity;
  const inRange = notes.filter((n) => n.time >= s.start && n.time < end);
  const groups = groupChords(inRange);
  const hits: Hit[] = [];
  for (const g of groups) {
    const t = (g[0].time - s.start) / s.speed + s.lead;
    let chosen: Note[];
    switch (s.selection) {
      case 'melody':
        chosen = [g.reduce((a, b) => (b.midi > a.midi ? b : a))];
        break;
      case 'bass':
        chosen = [g.reduce((a, b) => (b.midi < a.midi ? b : a))];
        break;
      default:
        chosen = g;
    }
    const hitNotes: HitNote[] = chosen.map((n) => ({ midi: n.midi, velocity: n.velocity, duration: n.duration / s.speed }));
    const last = hits[hits.length - 1];
    if (last && t - last.t < s.minGap) {
      // demasiado seguido: se une al choque anterior (sin repetir alturas) y se descarta su tiempo
      if (s.selection === 'chords' || s.selection === 'all') {
        for (const hn of hitNotes) if (!last.notes.some((x) => x.midi === hn.midi)) last.notes.push(hn);
      }
      continue;
    }
    const strength = Math.min(1, 0.35 + 0.65 * Math.max(...hitNotes.map((n) => n.velocity)) + 0.08 * (hitNotes.length - 1));
    hits.push({ t: +t.toFixed(4), notes: hitNotes, strength: +strength.toFixed(3) });
  }
  return hits;
}

/** Duración total del vídeo para unos choques: último choque + cola para que suene la última nota. */
export function hitsDuration(hits: Hit[], tail = 2.5): number {
  if (!hits.length) return 3;
  const last = hits[hits.length - 1];
  return last.t + Math.max(tail, Math.min(4, ...last.notes.map((n) => n.duration + 1)));
}
