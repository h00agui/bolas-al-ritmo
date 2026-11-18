import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseMidi } from '@core/midi/parse.ts';
import { scoreToHits, hitsDuration } from '@core/music/hits.ts';
import { mergeBallHits, splitHitsIntoBalls } from '@core/music/voices.ts';
import {
  ballActive,
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
  const st = { ...DEFAULT_STYLE, maxBalls: 3, pieces: 'auto' as const };
  const plan = planCircuit(raw, hitsDuration(raw), st, { minGap: 0.2 });

  it('reparte en varias bolas, cada una llega exacta a sus piezas y el circuito desciende', () => {
    expect(plan.balls.length).toBeGreaterThan(1);
    for (const b of plan.balls)
      for (let k = 1; k < b.T.length; k++) expect(b.P[k][1]).toBeLessThan(b.P[k - 1][1]);
    // una bola secundaria no está en escena antes de empezar a caer
    const second = plan.balls[1];
    expect(ballActive(second, Math.max(0, second.pre!.tRel - 0.1))).toBe(false);
    expect(ballActive(second, second.T[0])).toBe(true);
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
        if (Math.abs(ps[i].P[1] - ps[j].P[1]) > 2.5) continue;
        const d = Math.hypot(ps[i].P[0] - ps[j].P[0], ps[i].P[1] - ps[j].P[1]);
        expect(d).toBeGreaterThan(0.7);
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

  it('la cámara encuadra siempre a todas las bolas en escena y vibra en los acentos', () => {
    const aspect = 9 / 16;
    let checked = 0;
    for (let t = 0; t < plan.duration; t += 0.25) {
      const c = cameraAt(plan, t);
      expect(c.pos.every(Number.isFinite)).toBe(true);
      expect(c.pos[2]).toBeGreaterThan(plan.wallZ);
      const f = [c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]];
      const fl = Math.hypot(...f);
      const fw = f.map((v) => v / fl);
      const right = [fw[2], 0, -fw[0]];
      const rl = Math.hypot(...right);
      const rt = right.map((v) => v / rl);
      const upv = [
        rt[1] * fw[2] - rt[2] * fw[1],
        rt[2] * fw[0] - rt[0] * fw[2],
        rt[0] * fw[1] - rt[1] * fw[0],
      ];
      const tanV = Math.tan((c.fov * Math.PI) / 360);
      const tanH = tanV * aspect;
      for (const b of plan.balls) {
        // al acabar su último golpe la bola cae y sale de plano a propósito
        if (!ballActive(b, t) || t > b.T[b.T.length - 1] + (b.tail?.hold ?? 1)) continue;
        const p = ballAtPlan(b, plan, t);
        const v = [p[0] - c.pos[0], p[1] - c.pos[1], p[2] - c.pos[2]];
        const depth = v[0] * fw[0] + v[1] * fw[1] + v[2] * fw[2];
        expect(depth).toBeGreaterThan(0);
        const hx = Math.abs(v[0] * rt[0] + v[1] * rt[1] + v[2] * rt[2]) / depth;
        const vy = Math.abs(v[0] * upv[0] + v[1] * upv[1] + v[2] * upv[2]) / depth;
        expect(hx).toBeLessThan(tanH);
        expect(vy).toBeLessThan(tanV);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
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
