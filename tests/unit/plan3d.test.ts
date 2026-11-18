import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseMidi } from '@core/midi/parse.ts';
import { scoreToHits, hitsDuration } from '@core/music/hits.ts';
import { ballAt3d, cameraTarget3d, planPlatforms3d, recoilAt } from '@core/modes/platforms3d.plan.ts';
import { DEFAULT_STYLE } from '@core/scene/style.ts';

const score = parseMidi(fs.readFileSync('public/demo/para-elisa.mid'), 'demo');
const hits = scoreToHits(score, { duration: 30 });
const duration = hitsDuration(hits);
const plan = planPlatforms3d(hits, duration, DEFAULT_STYLE);

describe('planPlatforms3d', () => {
  it('la bola llega exactamente a cada placa en su instante', () => {
    expect(plan.N).toBe(hits.length);
    for (let k = 0; k < plan.N; k++) {
      const p = ballAt3d(plan, plan.T[k]);
      const q = plan.P[k];
      expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThan(1e-6);
    }
  });

  it('las placas miran hacia arriba y no se solapan', () => {
    for (let k = 0; k < plan.N; k++) expect(plan.n[k][1]).toBeGreaterThan(0.5);
    for (let k = 1; k < plan.N; k++) {
      const a = plan.P[k];
      const b = plan.P[k - 1];
      expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThanOrEqual(plan.tile.length * 1.1);
      expect(a[2]).toBeLessThan(b[2]); // siempre avanza
    }
  });

  it('entre choques la bola sube y vuelve a bajar (salto visible)', () => {
    let hops = 0;
    for (let k = 0; k < plan.N - 1; k++) {
      const mid = ballAt3d(plan, (plan.T[k] + plan.T[k + 1]) / 2);
      if (mid[1] > Math.max(plan.P[k][1], plan.P[k + 1][1]) + 0.1) hops++;
    }
    expect(hops / (plan.N - 1)).toBeGreaterThan(0.9);
  });

  it('la velocidad de salida es la reflexión (con restitución) de la de llegada', () => {
    for (let k = 1; k < plan.N - 1; k++) {
      const f = plan.fl[k];
      const prev = plan.fl[k - 1];
      const dt = plan.T[k] - plan.T[k - 1];
      const vin = [prev.v[0], prev.v[1] - prev.g * dt, prev.v[2]];
      const n = plan.n[k];
      // la componente tangencial no cambia
      const tangIn = [vin[0] - (vin[0] * n[0] + vin[1] * n[1] + vin[2] * n[2]) * n[0], 0, 0];
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const vnIn = dot(vin, n);
      const vnOut = dot(f.v, n);
      expect(vnIn).toBeLessThan(0);
      expect(vnOut).toBeGreaterThan(0);
      const e = vnOut / -vnIn;
      expect(e).toBeGreaterThan(0.35);
      expect(e).toBeLessThan(1.7);
      void tangIn;
    }
  });

  it('la cámara sigue a la bola y el rebote de la placa se amortigua', () => {
    const [cx, cz] = cameraTarget3d(plan, plan.T[Math.floor(plan.N / 2)]);
    const p = plan.P[Math.floor(plan.N / 2)];
    expect(Math.hypot(cx - p[0], cz - p[2])).toBeLessThan(3);
    expect(Math.abs(recoilAt(0, 1, 1))).toBeGreaterThan(0.05);
    expect(Math.abs(recoilAt(1, 1, 1))).toBeLessThan(0.002);
    expect(recoilAt(2, 1, 1)).toBe(0);
  });
});
