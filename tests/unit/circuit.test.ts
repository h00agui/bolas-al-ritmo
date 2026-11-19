import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseMidi } from '@core/midi/parse.ts';
import { scoreToHits, hitsDuration } from '@core/music/hits.ts';
import { mergeBallHits, splitHitsIntoBalls } from '@core/music/voices.ts';
import { ballActive, ballAtPlan, cameraAt, onRail, planCircuit, recoilAt } from '@core/modes/circuit.plan.ts';
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

  it('las teclas quedan dentro del circuito, sin solaparse, y cada bola en su franja', () => {
    const ps = plan.pieces;
    for (const p of ps) expect(Math.abs(p.P[0])).toBeLessThan(st.spread3d + 0.05);
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        if (ps[i].ball !== ps[j].ball) continue;
        const dy = Math.abs(ps[i].P[1] - ps[j].P[1]);
        const dx = Math.abs(ps[i].P[0] - ps[j].P[0]);
        // dos teclas de la misma bola nunca ocupan el mismo sitio (solapadas en x solo a distinta altura)
        expect(dy > 0.28 || dx > 0.6).toBe(true);
      }
    // con varias bolas, cada una en su franja horizontal
    const nb = plan.balls.length;
    for (const p of ps) {
      const bandW = (2 * st.spread3d) / nb - 0.3;
      const bandC = -st.spread3d + ((2 * st.spread3d) / nb) * (p.ball + 0.5);
      expect(Math.abs(p.P[0] - bandC)).toBeLessThan(bandW / 2 + 0.05);
    }
  });

  it('va de un lado a otro según el ritmo: pozo con paredes alternas en lo rápido y rampas en lo medio', () => {
    const melody = scoreToHits(score, { duration: 30, minGap: 0.03, selection: 'melody' });
    const solo = planCircuit(melody, hitsDuration(melody), { ...st, maxBalls: 1 }, { minGap: 0.1 });
    const b = solo.balls[0];
    const keys = b.pieces.map((i) => solo.pieces[i]);
    // teclas de pozo: alternan lado (la punta mira hacia dentro, en sentidos opuestos)
    let shaftPairs = 0;
    for (let k = 1; k < keys.length; k++)
      if (keys[k].shaft && keys[k - 1].shaft) {
        expect(keys[k].tip).toBe(-keys[k - 1].tip);
        expect(Math.sign(keys[k].P[0] - keys[k - 1].P[0])).toBe(keys[k - 1].tip);
        shaftPairs++;
      }
    expect(shaftPairs).toBeGreaterThan(5);
    // a ritmo medio (una nota cada medio segundo): rampa, la bola avanza en horizontal más de lo que baja
    const medium = Array.from({ length: 40 }, (_, i) => ({
      t: 0.5 + i * 0.5,
      strength: 0.7,
      notes: [{ midi: 60 + ((i * 7) % 12), velocity: 0.8, duration: 0.3 }],
    }));
    const ramp = planCircuit(medium, 21, { ...st, maxBalls: 1 }, { minGap: 0.1 });
    const rk = ramp.balls[0].pieces.map((i) => ramp.pieces[i]);
    expect(rk.every((p) => !p.shaft)).toBe(true);
    let horizontal = 0;
    for (let k = 1; k < rk.length; k++) {
      const dx = Math.abs(rk[k].P[0] - rk[k - 1].P[0]);
      const dy = rk[k - 1].P[1] - rk[k].P[1];
      expect(dy).toBeGreaterThan(0.2);
      // las teclas no se pisan: o están bien separadas en horizontal, o una queda bien por debajo
      expect(dx >= 0.6 || dy >= 0.85).toBe(true);
      if (dx >= 0.6) {
        expect(dx).toBeGreaterThan(dy * 0.8);
        horizontal++;
      }
    }
    expect(horizontal).toBeGreaterThan((rk.length - 1) * 0.6);
    // cambia de sentido al llegar al borde: varias veces, pero no a cada momento
    let turns = 0;
    let dir = 0;
    for (let k = 1; k < rk.length; k++) {
      const d = Math.sign(rk[k].P[0] - rk[k - 1].P[0]);
      if (d && dir && d !== dir) turns++;
      if (d) dir = d;
    }
    expect(turns).toBeGreaterThanOrEqual(2);
    expect(turns).toBeLessThan(rk.length / 4);
  });

  it('la cámara encuadra siempre a todas las bolas en escena', () => {
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
        // al acabar su último golpe la bola cae y sale de plano a propósito; al empezar entra por arriba
        if (!ballActive(b, t) || t > b.T[b.T.length - 1] + (b.tail?.hold ?? 1)) continue;
        const p = ballAtPlan(b, plan, t);
        if (t < b.T[0] && p[1] > b.P[0][1] + 1.3) continue;
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
    expect(recoilAt(2, 1, 1)).toBe(0);
  });

  it('la cámara no hace zoom (distancia fija) ni da tirones', () => {
    let prev: ReturnType<typeof cameraAt> | null = null;
    for (let t = 0; t < plan.duration; t += 1 / 60) {
      const c = cameraAt(plan, t);
      const d = Math.hypot(c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]);
      expect(Math.abs(d - plan.camDist)).toBeLessThan(1e-3);
      if (prev) {
        // movimiento por fotograma acotado (sin cortes): menos de 0,2 unidades a 60 Hz
        const step = Math.hypot(c.pos[0] - prev.pos[0], c.pos[1] - prev.pos[1], c.pos[2] - prev.pos[2]);
        expect(step).toBeLessThan(0.2);
      }
      prev = c;
    }
  });

  it('entre notas lejanas la bola baja por una tubería ondulada, sin saltos de posición', () => {
    const times = [0.5, 1.0, 1.8, 3.3, 3.5, 3.7, 6.7, 7.0, 13.0, 13.4, 14.2, 20.0, 20.3];
    const hits = times.map((t, i) => ({
      t,
      strength: 0.7,
      notes: [{ midi: 60 + ((i * 5) % 12), velocity: 0.8, duration: 0.4 }],
    }));
    const sparse = planCircuit(hits, 22, DEFAULT_STYLE, { minGap: 0.1 });
    expect(sparse.rails.length).toBeGreaterThanOrEqual(4);
    const b = sparse.balls[0];
    for (const r of sparse.rails) {
      expect(r.tA).toBeGreaterThan(b.T[r.k]);
      expect(r.tB).toBeLessThan(b.T[r.k + 1]);
      // la tubería ondula (crestas) y puede hacer algún rizo, pero en conjunto siempre baja
      let low = r.pts[0][1];
      for (let i = 1; i < r.pts.length; i++) {
        low = Math.min(low, r.pts[i][1]);
        expect(r.pts[i][1]).toBeLessThanOrEqual(low + 1.35);
      }
      expect(r.pts[r.pts.length - 1][1]).toBeLessThan(r.pts[0][1] - 0.3);
      expect(onRail(b, sparse, (r.tA + r.tB) / 2)).toBe(true);
      // los carriles son rectos: fuera de las curvas en U la dirección horizontal se mantiene
      let flips = 0;
      let dir = 0;
      for (let i = 1; i < r.pts.length; i++) {
        const d = Math.sign(r.pts[i][0] - r.pts[i - 1][0]);
        if (d && dir && d !== dir) flips++;
        if (d) dir = d;
      }
      expect(flips).toBeLessThan(6);
      for (const p of r.pts) expect(Math.abs(p[0])).toBeLessThan(DEFAULT_STYLE.spread3d + 0.05);
      // la bola rueda a una velocidad creíble (ni flota ni vuela)
      let len = 0;
      for (let i = 1; i < r.pts.length; i++)
        len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      const v = len / (r.tB - r.tA);
      expect(v).toBeGreaterThan(1.2);
      expect(v).toBeLessThan(5);
    }
    let prev: number[] | null = null;
    for (let t = b.pre!.tRel; t < b.T[b.T.length - 1]; t += 1 / 120) {
      const p = ballAtPlan(b, sparse, t);
      if (prev) expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])).toBeLessThan(0.25);
      prev = p;
    }
    for (let k = 0; k < b.T.length; k++) {
      const p = ballAtPlan(b, sparse, b.T[k] - 1e-4);
      expect(Math.hypot(p[0] - b.P[k][0], p[1] - b.P[k][1])).toBeLessThan(0.02);
    }
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
