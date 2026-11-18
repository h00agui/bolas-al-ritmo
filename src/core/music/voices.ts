// Reparto de los choques entre varias bolas: cada bola necesita un tiempo mínimo entre sus golpes.
// Cuando una nota llega y ninguna bola libre puede atenderla, entra una bola nueva (hasta maxBalls).
import type { Hit, HitNote } from '../types.ts';

export interface BallHits {
  /** índice de la bola (0 = principal) */
  ball: number;
  hits: Hit[];
}

export interface VoiceOptions {
  maxBalls: number; // 1..6
  minGap: number; // s entre golpes de la misma bola
}

interface BallState {
  lastT: number;
  lastMidi: number;
  hits: Hit[];
}

/**
 * Devuelve las listas de choques de cada bola. Los choques originales pueden tener varias notas
 * (acordes): se reparten entre bolas distintas que caen a la vez; si no hay bolas libres, la nota
 * se suma al golpe de la bola más cercana en altura que esté libre o se descarta.
 */
export function splitHitsIntoBalls(hits: Hit[], opts: VoiceOptions): BallHits[] {
  const maxBalls = Math.max(1, Math.min(8, Math.round(opts.maxBalls)));
  const balls: BallState[] = [];
  const free = (b: BallState, t: number) => t - b.lastT >= opts.minGap - 1e-6;
  for (const h of hits) {
    const notes = [...h.notes].sort((a, b) => b.midi - a.midi);
    const usedNow = new Set<BallState>();
    for (const note of notes) {
      // bola libre más cercana en altura (que no haya tocado ya en este instante)
      let best: BallState | null = null;
      let bd = Infinity;
      for (const b of balls) {
        if (usedNow.has(b) || !free(b, h.t)) continue;
        const d = Math.abs(b.lastMidi - note.midi);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (!best && balls.length < maxBalls) {
        best = { lastT: -Infinity, lastMidi: note.midi, hits: [] };
        balls.push(best);
      }
      if (!best) {
        // sin bola disponible: la nota se añade al golpe de una bola que ya toca ahora (acorde) si existe
        const same = [...usedNow][0];
        if (same) same.hits[same.hits.length - 1].notes.push(note);
        continue;
      }
      best.hits.push({ t: h.t, notes: [note], strength: h.strength });
      best.lastT = h.t;
      best.lastMidi = note.midi;
      usedNow.add(best);
    }
  }
  return balls.map((b, i) => ({ ball: i, hits: b.hits }));
}

/** Une las listas de varias bolas en una sola secuencia ordenada (para el audio). */
export function mergeBallHits(balls: BallHits[]): Hit[] {
  const all: Hit[] = [];
  for (const b of balls) for (const h of b.hits) all.push(h);
  all.sort((a, b) => a.t - b.t);
  const out: Hit[] = [];
  for (const h of all) {
    const last = out[out.length - 1];
    if (last && Math.abs(h.t - last.t) < 1e-6) {
      for (const n of h.notes) if (!last.notes.some((x) => x.midi === n.midi)) last.notes.push(n);
      last.strength = Math.max(last.strength, h.strength);
    } else out.push({ t: h.t, notes: [...h.notes], strength: h.strength });
  }
  return out;
}

export type { HitNote };
