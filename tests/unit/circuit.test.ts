import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseMidi } from '@core/midi/parse.ts';
import { scoreToHits, hitsDuration } from '@core/music/hits.ts';
import { mergeBallHits, splitHitsIntoBalls } from '@core/music/voices.ts';
import {
  ballAtPlan,
  cameraAt,
  composeSegments,
  planCircuit,
  recoilAt,
  shakeAt,
} from '@core/modes/circuit.plan.ts';
import { DEFAULT_STYLE } from '@core/scene/style.ts';
import { buildProject, defaultProject } from '@core/project.ts';

const score = parseMidi(fs.readFileSync('public/demo/para-elisa.mid'), 'demo');
const raw = scoreToHits(score, { duration: 30, minGap: 0.03, selection: 'chords' });

describe('reparto entre bolas', () => {
  it('cada bola respeta la separación mínima y no se pierde ninguna nota', () => {
    const balls = splitHitsIntoBalls(raw, { maxBalls: 3, minGap: 0.25 });
    expect(balls.length).toBeGreaterThan(1);
    expect(balls.length).toBeLessThanOrEqual(3);
    for (const b of balls)
      for (let i = 1; i < b.hits.length; i++)
        expect(b.hits[i].t - b.hits[i - 1].t).toBeGreaterThanOrEqual(0.25 - 1e-6);
    const merged = mergeBallHits(balls);
    const notesIn = raw.reduce((n, h) => n + h.notes.length, 0);
    const notesOut = merged.reduce((n, h) => n + h.notes.length, 0);
    expect(notesOut).toBeGreaterThan(notesIn * 0.85);
  });
  it('con una sola bola equivale a unir notas demasiado seguidas', () => {
    const one = splitHitsIntoBalls(raw, { maxBalls: 1, minGap: 0.2 });
    expect(one.length).toBe(1);
    for (let i = 1; i < one[0].hits.length; i++)
      expect(one[0].hits[i].t - one[0].hits[i - 1].t).toBeGreaterThanOrEqual(0.2 - 1e-6);
  });
});

describe('planCircuit', () => {
  const st = { ...DEFAULT_STYLE, maxBalls: 3 };
  const plan = planCircuit(raw, hitsDuration(raw), st, { minGap: 0.2 });

  it('reparte en varias bolas y cada una llega exacta a sus piezas', () => {
    expect(plan.balls.length).toBeGreaterThan(1);
    for (const b of plan.balls)
      for (let k = 0; k < b.T.length; k++) {
        const p = ballAtPlan(b, plan, b.T[k]);
        const q = b.P[k];
        expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThan(1e-6);
      }
  });

  it('las piezas no se solapan entre sí (ni entre bolas distintas)', () => {
    const ps = plan.pieces;
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        if (Math.abs(ps[i].P[2] - ps[j].P[2]) > 2.5) continue;
        const d = Math.hypot(ps[i].P[0] - ps[j].P[0], ps[i].P[2] - ps[j].P[2]);
        expect(d).toBeGreaterThan(0.8);
      }
  });

  it('los tramos cubren todo el vídeo y mezclan piezas y planos', () => {
    const segs = plan.segments;
    expect(segs[0].start).toBe(0);
    expect(segs[segs.length - 1].end).toBeGreaterThan(plan.duration);
    const kinds = new Set(segs.map((s) => s.kind));
    const shots = new Set(segs.map((s) => s.shot));
    expect(kinds.size).toBeGreaterThan(1);
    expect(shots.size).toBeGreaterThan(1);
    const fixed = composeSegments(plan.audioHits, plan.duration, { ...st, pieces: 'drum' });
    expect(fixed.every((s) => s.kind === 'drum')).toBe(true);
  });

  it('la cámara está definida en todo momento, mira hacia las bolas y vibra en los acentos', () => {
    for (const t of [0, 3, 10, 20, plan.duration]) {
      const c = cameraAt(plan, t);
      expect(c.pos.every(Number.isFinite)).toBe(true);
      expect(c.fov).toBeGreaterThan(20);
      expect(c.pos[1]).toBeGreaterThan(c.look[1]);
    }
    const strong = plan.audioHits.find((h) => h.strength > 0.8);
    if (strong) expect(shakeAt(plan, strong.t + 0.02)).toBeGreaterThan(0);
    expect(recoilAt(2, 1, 1)).toBe(0);
  });

  it('la semilla cambia el trazado sin cambiar los tiempos', () => {
    const other = planCircuit(raw, hitsDuration(raw), { ...st, seed: 7 }, { minGap: 0.2 });
    expect(other.balls[0].T).toEqual(plan.balls[0].T);
    const moved = other.pieces.filter((p, i) => Math.abs(p.P[0] - plan.pieces[i].P[0]) > 0.05).length;
    expect(moved).toBeGreaterThan(plan.pieces.length * 0.2);
  });

  it('buildProject devuelve los choques de audio de todas las bolas', () => {
    const project = defaultProject();
    project.music.duration = 20;
    project.music.minGap = 0.35; // más separación de la que permite la melodía: hacen falta dos bolas
    project.style.maxBalls = 2;
    const built = buildProject(project, score);
    expect((built.plan as { balls: unknown[] }).balls.length).toBe(2);
    expect(built.hits.length).toBeGreaterThan(50);
  });
});
