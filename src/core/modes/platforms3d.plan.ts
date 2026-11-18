// Planificador del modo Plataformas 3D (sin dependencias de WebGL: se prueba en Node).
// La bola avanza por el suelo (hacia -z) a saltos; cada placa está donde cae una nota y se inclina
// justo para mandarla a la siguiente. Unidades: 1 ≈ el largo de una placa.
import type { RGB } from '../color.ts';
import { noteName } from '../music/names.ts';
import { rnd, lastIndex } from '../scene/draw.ts';
import { hitColors, startColor, type SceneStyle } from '../scene/style.ts';
import type { Hit } from '../types.ts';

export type V3 = [number, number, number];

export interface Flight3 {
  p: V3; // posición de salida (centro de la bola)
  v: V3; // velocidad de salida
  g: number;
}

export interface Plan3D {
  kind: 'platforms3d';
  N: number;
  T: number[];
  S: number[];
  names: string[];
  col: RGB[];
  startCol: RGB;
  duration: number;
  r: number; // radio de la bola
  P: V3[]; // centro de la bola en cada choque
  n: V3[]; // normal de cada placa
  standH: number[]; // altura de la cara superior de cada placa
  fl: Flight3[]; // vuelo k -> k+1
  pre: { tRel: number; g: number; from: V3 } | null;
  tail: { g: number; vy0: number; e: number } | null;
  cam: Float32Array; // objetivo de la cámara (x, z) a CAM_HZ
  camHz: number;
  tile: { length: number; width: number; thickness: number };
}

const CAM_HZ = 60;

export function planPlatforms3d(hits: Hit[], duration: number, st: SceneStyle): Plan3D {
  const N = hits.length;
  const T = hits.map((h) => h.t);
  const S = hits.map((h) => h.strength);
  const r = st.ballSize3d;
  const L = st.tileSize;
  const tile = { length: L, width: L * 0.66, thickness: L * 0.075 };
  const plan: Plan3D = {
    kind: 'platforms3d',
    N,
    T,
    S,
    duration,
    r,
    names: hits.map((h) => (h.notes.length ? noteName(h.notes[0].midi) : '')),
    col: hitColors(hits, st),
    startCol: startColor(st),
    P: [],
    n: [],
    standH: [],
    fl: [],
    pre: null,
    tail: null,
    cam: new Float32Array(0),
    camHz: CAM_HZ,
    tile,
  };
  if (!N) {
    plan.cam = new Float32Array((Math.ceil(duration * CAM_HZ) + 2) * 2);
    return plan;
  }
  // altura de cada placa: por altura de la nota (agudas más altas) o fija
  const midis = hits.map((h) => (h.notes.length ? Math.max(...h.notes.map((n) => n.midi)) : 60));
  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  plan.standH = midis.map((m) => (st.heightByPitch && hi > lo ? 0.6 + 0.7 * ((m - lo) / (hi - lo)) : 0.9));
  const yTop = (k: number) => plan.standH[k] + r; // centro de la bola apoyada

  // caída inicial desde 3 unidades por encima de la primera placa
  const D0 = 3;
  let g0 = 14 * st.gravity;
  let tf = Math.sqrt((2 * D0) / g0);
  if (tf > T[0]) {
    tf = T[0];
    g0 = (2 * D0) / (tf * tf);
  }
  const P0: V3 = [0, yTop(0), 0];
  plan.pre = { tRel: T[0] - tf, g: g0, from: [0, yTop(0) + D0, 0] };

  interface Node {
    x: number;
    z: number;
    vin: V3;
    n: V3;
    vout: V3;
    g: number;
    cost: number;
    parent: number;
    dx: number;
  }
  const BEAM = N > 240 ? 20 : 32;
  const ADV = [0.55, 0.75, 0.9, 1, 1.1, 1.3, 1.6];
  const DXN = 11;
  let beam: Node[] = [
    { x: 0, z: 0, vin: [0, -g0 * tf, 0], n: [0, 1, 0], vout: [0, 0, 0], g: g0, cost: 0, parent: -1, dx: 0 },
  ];
  const steps: Node[][] = [beam];
  const ancestors = (node: Node, k: number): { x: number; z: number }[] => {
    const out: { x: number; z: number }[] = [];
    let cur: Node | undefined = node;
    let kk = k;
    while (cur && out.length < 8 && kk >= 1) {
      const parent: Node = steps[kk - 1][cur.parent];
      out.push({ x: parent.x, z: parent.z });
      cur = parent;
      kk--;
    }
    return out;
  };
  for (let k = 0; k < N - 1; k++) {
    const dt = T[k + 1] - T[k];
    const hop = Math.max(0.35, Math.min(1.5, 1.0 * Math.sqrt(dt / 0.4)));
    const g = Math.max(4, Math.min(400, ((8 * hop) / (dt * dt)) * st.gravity));
    const advBase = Math.max(L * 1.15, st.pace3d * dt);
    const maxDx = Math.min(1.6 * advBase, st.spread3d);
    const dy = yTop(k + 1) - yTop(k);
    const cand: (Node & { pn: V3; pv: V3 })[] = [];
    for (let si = 0; si < beam.length; si++) {
      const s = beam[si];
      const prev = ancestors(s, k);
      for (const af of ADV) {
        const adv = advBase * af;
        for (let a = 0; a < DXN; a++) {
          const dx = maxDx * ((2 * a) / (DXN - 1) - 1);
          const nx = s.x + dx;
          if (Math.abs(nx) > st.spread3d) continue;
          const nz = s.z - adv;
          // sin solaparse con placas anteriores
          let ok = Math.hypot(dx, adv) >= L * 1.15;
          for (const p of prev) if (ok && Math.hypot(nx - p.x, nz - p.z) < L * 1.2) ok = false;
          if (!ok) continue;
          const vout: V3 = [dx / dt, dy / dt + 0.5 * g * dt, -adv / dt];
          const d: V3 = [vout[0] - s.vin[0], vout[1] - s.vin[1], vout[2] - s.vin[2]];
          const dm = Math.hypot(d[0], d[1], d[2]);
          if (dm < 1e-3) continue;
          const nrm: V3 = [d[0] / dm, d[1] / dm, d[2] / dm];
          if (nrm[1] < 0.55) continue; // placas mirando hacia arriba
          const vn = s.vin[0] * nrm[0] + s.vin[1] * nrm[1] + s.vin[2] * nrm[2];
          if (vn > -0.01) continue;
          const e = dm / -vn - 1;
          if (e < 0.4 || e > 1.6) continue;
          let c = ((e - 0.85) / 0.3) ** 2 + 0.8 * ((1 - nrm[1]) / 0.3) ** 2;
          c += ((adv - advBase) / (0.45 * advBase)) ** 2;
          c += 0.4 * ((Math.abs(dx) - 0.45 * maxDx) / (0.5 * maxDx)) ** 2;
          if (Math.abs(s.dx) > 1e-3 && Math.sign(dx) === Math.sign(s.dx)) c += 0.8 * (1 - st.chaos);
          c += 1.5 * st.chaos * rnd(k + 1, a * 10 + af);
          c += 1e-7 * (a + af);
          cand.push({
            x: nx,
            z: nz,
            vin: [vout[0], vout[1] - g * dt, vout[2]],
            n: [0, 1, 0],
            vout: [0, 0, 0],
            g,
            cost: s.cost + c,
            parent: si,
            dx,
            pn: nrm,
            pv: vout,
          });
        }
      }
    }
    if (!cand.length) {
      const s = beam[0];
      const vout: V3 = [0, dy / dt + 0.5 * g * dt, -advBase / dt];
      cand.push({
        x: s.x,
        z: s.z - advBase,
        vin: [0, vout[1] - g * dt, vout[2]],
        n: [0, 1, 0],
        vout: [0, 0, 0],
        g,
        cost: s.cost + 50,
        parent: 0,
        dx: 0,
        pn: [0, 1, 0],
        pv: vout,
      });
    }
    cand.sort((p, q) => p.cost - q.cost);
    const seen = new Set<string>();
    const next: Node[] = [];
    for (const c of cand) {
      const key = `${Math.round(c.x / 0.3)}:${Math.round(c.z / 0.3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(c);
      if (next.length >= BEAM) break;
    }
    beam = next;
    steps.push(beam);
  }
  const path: (Node & { pn?: V3; pv?: V3 })[] = new Array(N);
  let idx = 0;
  for (let k = N - 1; k >= 0; k--) {
    path[k] = steps[k][idx];
    idx = path[k].parent;
  }
  for (let k = 0; k < N - 1; k++) {
    path[k].n = path[k + 1].pn!;
    path[k].vout = path[k + 1].pv!;
  }
  // último choque: rebotes verticales amortiguados
  {
    const last = path[N - 1];
    const vin = Math.hypot(last.vin[0], last.vin[1], last.vin[2]) || 1;
    const dt = N > 1 ? T[N - 1] - T[N - 2] : 0.5;
    const g = Math.max(4, Math.min(400, ((8 * 1) / (dt * dt)) * st.gravity));
    last.n = [0, 1, 0];
    last.vout = [0, Math.min(vin * 0.8, Math.sqrt(2 * g * 1.2)), 0];
    plan.tail = { g, vy0: last.vout[1], e: 0.55 };
  }
  plan.P = path.map((p, k) => [p.x, yTop(k), p.z] as V3);
  plan.n = path.map((p) => p.n);
  for (let k = 0; k < N - 1; k++) plan.fl.push({ p: plan.P[k], v: path[k].vout, g: path[k + 1].g });
  void P0;
  // cámara: objetivo (x, z) que sigue el suelo bajo la bola con un muelle crítico
  const frames = Math.ceil(duration * CAM_HZ) + 2;
  const cam = new Float32Array(frames * 2);
  const floorAt = (t: number): [number, number] => {
    if (t <= T[0]) return [plan.P[0][0], plan.P[0][2]];
    if (t >= T[N - 1]) return [plan.P[N - 1][0], plan.P[N - 1][2]];
    const k = lastIndex(T, t);
    const f = (t - T[k]) / (T[k + 1] - T[k]);
    return [
      plan.P[k][0] + (plan.P[k + 1][0] - plan.P[k][0]) * f,
      plan.P[k][2] + (plan.P[k + 1][2] - plan.P[k][2]) * f,
    ];
  };
  let x = plan.P[0][0];
  let z = plan.P[0][2];
  let vx = 0;
  let vz = 0;
  const w = 4.5;
  const dtc = 1 / CAM_HZ;
  for (let i = 0; i < frames; i++) {
    const [tx, tz] = floorAt(i * dtc);
    vx += (w * w * (tx - x) - 2 * w * vx) * dtc;
    vz += (w * w * (tz - z) - 2 * w * vz) * dtc;
    x += vx * dtc;
    z += vz * dtc;
    cam[2 * i] = x;
    cam[2 * i + 1] = z;
  }
  plan.cam = cam;
  return plan;
}

export function cameraTarget3d(plan: Plan3D, t: number): [number, number] {
  const n = plan.cam.length / 2;
  if (!n) return [0, 0];
  const i = Math.max(0, t * plan.camHz);
  const i0 = Math.min(n - 1, Math.floor(i));
  const i1 = Math.min(n - 1, i0 + 1);
  const f = i - i0;
  return [
    plan.cam[2 * i0] + (plan.cam[2 * i1] - plan.cam[2 * i0]) * f,
    plan.cam[2 * i0 + 1] + (plan.cam[2 * i1 + 1] - plan.cam[2 * i0 + 1]) * f,
  ];
}

/** Posición del centro de la bola en el instante t. */
export function ballAt3d(plan: Plan3D, t: number): V3 {
  const { N, T } = plan;
  if (!N || !plan.pre) return [0, plan.r, 0];
  if (t < T[0]) {
    const dt = Math.max(0, t - plan.pre.tRel);
    const f = plan.pre.from;
    return [f[0], f[1] - 0.5 * plan.pre.g * dt * dt, f[2]];
  }
  if (t >= T[N - 1]) {
    const [x0, y0, z0] = plan.P[N - 1];
    const tail = plan.tail!;
    let tau = t - T[N - 1];
    let vy = tail.vy0;
    for (let b = 0; b < 12; b++) {
      const flight = (2 * vy) / tail.g;
      if (tau < flight || flight < 0.02) break;
      tau -= flight;
      vy *= tail.e;
    }
    return [x0, Math.max(y0, y0 + vy * tau - 0.5 * tail.g * tau * tau), z0];
  }
  const k = lastIndex(T, t);
  const f = plan.fl[k];
  const tau = t - T[k];
  return [f.p[0] + f.v[0] * tau, f.p[1] + f.v[1] * tau - 0.5 * f.g * tau * tau, f.p[2] + f.v[2] * tau];
}

/** Hundimiento de la placa k en el instante t (unidades a lo largo de -normal): muelle amortiguado. */
export function recoilAt(age: number, strength: number, amount: number): number {
  if (age < 0 || age > 1.2) return 0;
  return amount * (0.06 + 0.07 * strength) * Math.exp(-age / 0.16) * Math.cos(26 * age);
}
