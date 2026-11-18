// Planificador del Circuito 3D: varias bolas, tramos con piezas distintas (placas, barras de
// xilófono, tambores, bumpers) y un director de cámara. Sin WebGL: se prueba en Node.
// Unidades: 1 ≈ el largo de una placa. La bola avanza hacia -z; el suelo es y = 0.
import type { RGB } from '../color.ts';
import { noteName } from '../music/names.ts';
import { mergeBallHits, splitHitsIntoBalls } from '../music/voices.ts';
import { lastIndex, rnd } from '../scene/draw.ts';
import { hitColors, startColor, type SceneStyle } from '../scene/style.ts';
import type { Hit } from '../types.ts';

export type V3 = [number, number, number];
export type PieceKind = 'plate' | 'bar' | 'drum' | 'bumper';
export const PIECE_KINDS: PieceKind[] = ['plate', 'bar', 'drum', 'bumper'];

export interface Piece {
  kind: PieceKind;
  ball: number;
  k: number; // índice del choque dentro de su bola
  t: number;
  P: V3; // centro de la bola en el choque
  n: V3; // normal de la superficie
  top: number; // altura de la superficie
  size: number; // largo (placa/barra) o radio (tambor/bumper)
  col: RGB;
  name: string;
  strength: number;
}

export interface Flight3 {
  p: V3;
  v: V3;
  g: number;
}

export interface BallPlan {
  T: number[];
  S: number[];
  col: RGB[];
  P: V3[];
  fl: Flight3[];
  pre: { tRel: number; g: number; from: V3 } | null;
  tail: { g: number; vy0: number; e: number } | null;
  pieces: number[]; // índice en plan.pieces de cada choque
}

export type ShotKind = 'follow' | 'low' | 'top' | 'side' | 'wide';
export interface Segment {
  start: number;
  end: number;
  kind: PieceKind;
  shot: ShotKind;
  cut: boolean; // corte seco al empezar (si no, transición suave)
}

export interface CircuitPlan {
  kind: 'platforms3d';
  duration: number;
  r: number;
  balls: BallPlan[];
  pieces: Piece[];
  segments: Segment[];
  /** choques de todas las bolas en orden (para el audio y los efectos) */
  audioHits: Hit[];
  audioT: number[];
  /** cámara a CAM_HZ: por fotograma [px, py, pz, lx, ly, lz, fov] */
  cam: Float32Array;
  camHz: number;
  startCol: RGB;
  tile: { length: number; width: number; thickness: number };
  seed: number;
}

export interface PlanOptions {
  minGap: number;
}

const CAM_HZ = 60;
export const SHOTS: Record<ShotKind, { az: number; el: number; dist: number; fov: number; ahead: number }> = {
  follow: { az: 35, el: 56, dist: 13, fov: 36, ahead: 2.2 },
  low: { az: 62, el: 36, dist: 11, fov: 40, ahead: 1.4 },
  top: { az: 12, el: 78, dist: 14, fov: 34, ahead: 1.2 },
  side: { az: 88, el: 28, dist: 10, fov: 42, ahead: 0.6 },
  wide: { az: 35, el: 50, dist: 20, fov: 32, ahead: 3 },
};
const KIND_MIN_NY: Record<PieceKind, number> = { plate: 0.55, bar: 0.75, drum: 0.9, bumper: 0.6 };
const KIND_CLEAR: Record<PieceKind, number> = { plate: 1.15, bar: 1.25, drum: 1.35, bumper: 0.95 };

const sr = (seed: number, k: number) => rnd(seed * 0.173 + 1, k + 0.5);

/** Divide los choques en tramos por frases (silencios) o cada ~6 s, y asigna pieza y plano a cada tramo. */
export function composeSegments(hits: Hit[], duration: number, st: SceneStyle): Segment[] {
  const seed = st.seed;
  const bounds: number[] = [0];
  let segStart = 0;
  for (let i = 1; i < hits.length; i++) {
    const gap = hits[i].t - hits[i - 1].t;
    const len = hits[i].t - segStart;
    if ((gap > 0.55 && len > 2.5) || len > 7) {
      bounds.push(hits[i].t - Math.min(gap, 0.3) / 2);
      segStart = hits[i].t;
    }
  }
  bounds.push(duration + 1);
  const segments: Segment[] = [];
  const shotOrder: ShotKind[] = ['follow', 'low', 'top', 'follow', 'side', 'wide'];
  let prevKind: PieceKind | null = null;
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const inSeg = hits.filter((h) => h.t >= a && h.t < b);
    const midis = inSeg.flatMap((h) => h.notes.map((n) => n.midi));
    const meanMidi = midis.length ? midis.reduce((x, y) => x + y, 0) / midis.length : 64;
    const density = inSeg.length / Math.max(1, b - a);
    let kind: PieceKind;
    if (st.pieces !== 'auto') kind = st.pieces;
    else {
      const r = sr(seed, i);
      if (meanMidi < 55) kind = r < 0.7 ? 'drum' : 'bumper';
      else if (density > 5) kind = r < 0.6 ? 'bumper' : 'plate';
      else if (meanMidi > 70) kind = r < 0.65 ? 'bar' : 'plate';
      else kind = r < 0.45 ? 'plate' : r < 0.8 ? 'bar' : 'drum';
      if (kind === prevKind)
        kind = (['plate', 'bar', 'drum', 'bumper'] as PieceKind[]).find(
          (x) => x !== prevKind && (x !== 'drum' || meanMidi < 68),
        )!;
    }
    prevKind = kind;
    let shot: ShotKind = shotOrder[(i + Math.floor(sr(seed, i + 100) * 2)) % shotOrder.length];
    if (kind === 'drum' && i > 0) shot = sr(seed, i + 200) < 0.6 ? 'low' : 'side';
    if (i === 0) shot = 'follow';
    segments.push({ start: a, end: b, kind, shot, cut: i > 0 && sr(seed, i + 300) < 0.6 });
  }
  return segments;
}

function kindTop(kind: PieceKind, midi: number, lo: number, hi: number, st: SceneStyle): number {
  const f = hi > lo ? (midi - lo) / (hi - lo) : 0.5;
  const byPitch = st.heightByPitch ? f : 0.5;
  switch (kind) {
    case 'bar':
      return 0.5 + 0.5 * byPitch;
    case 'drum':
      return 0.42 + 0.15 * byPitch;
    case 'bumper':
      return 0.55 + 0.3 * byPitch;
    default:
      return 0.6 + 0.7 * byPitch;
  }
}

function kindSize(kind: PieceKind, midi: number, lo: number, hi: number, st: SceneStyle): number {
  const f = hi > lo ? (midi - lo) / (hi - lo) : 0.5;
  switch (kind) {
    case 'bar':
      return st.tileSize * (1.5 - 0.7 * f);
    case 'drum':
      return st.tileSize * (0.62 - 0.14 * f);
    case 'bumper':
      return st.tileSize * 0.36;
    default:
      return st.tileSize;
  }
}

export function planCircuit(
  hits: Hit[],
  duration: number,
  st: SceneStyle,
  opts: PlanOptions = { minGap: 0.1 },
): CircuitPlan {
  const r = st.ballSize3d;
  const L = st.tileSize;
  const tile = { length: L, width: L * 0.66, thickness: L * 0.075 };
  const split = splitHitsIntoBalls(hits, { maxBalls: st.maxBalls, minGap: opts.minGap });
  const audioHits = mergeBallHits(split);
  const segments = composeSegments(audioHits, duration, st);
  const plan: CircuitPlan = {
    kind: 'platforms3d',
    duration,
    r,
    balls: [],
    pieces: [],
    segments,
    audioHits,
    audioT: audioHits.map((h) => h.t),
    cam: new Float32Array(0),
    camHz: CAM_HZ,
    startCol: startColor(st),
    tile,
    seed: st.seed,
  };
  const allMidis = audioHits.flatMap((h) => h.notes.map((n) => n.midi));
  const lo = allMidis.length ? Math.min(...allMidis) : 60;
  const hi = allMidis.length ? Math.max(...allMidis) : 72;
  const segAt = (t: number) =>
    segments[
      Math.max(
        0,
        lastIndex(
          segments.map((s) => s.start),
          t,
        ),
      )
    ];
  const nb = split.length;
  const laneGap = nb > 1 ? Math.min(1.8, (2 * st.spread3d) / nb) : 0;
  const pace = st.pace3d;
  const zTarget = (t: number) => -pace * t;
  const placed: { x: number; z: number; clear: number }[] = [];

  for (let b = 0; b < nb; b++) {
    const bh = split[b].hits;
    const N = bh.length;
    const T = bh.map((h) => h.t);
    const S = bh.map((h) => h.strength);
    const col = hitColors(bh, st);
    const kinds = bh.map((h) => segAt(h.t).kind);
    const midis = bh.map((h) => Math.max(...h.notes.map((n) => n.midi)));
    const tops = bh.map((_, k) => kindTop(kinds[k], midis[k], lo, hi, st));
    const sizes = bh.map((_, k) => kindSize(kinds[k], midis[k], lo, hi, st));
    const yTop = (k: number) => tops[k] + r;
    const laneX = nb > 1 ? (b - (nb - 1) / 2) * laneGap : 0;
    const laneHalf = nb > 1 ? laneGap * 0.55 : st.spread3d;
    const ball: BallPlan = { T, S, col, P: [], fl: [], pre: null, tail: null, pieces: [] };
    plan.balls.push(ball);
    if (!N) continue;
    // caída inicial
    const D0 = 3;
    let g0 = 14 * st.gravity;
    let tf = Math.sqrt((2 * D0) / g0);
    if (tf > T[0]) {
      tf = T[0];
      g0 = (2 * D0) / (tf * tf);
    }
    const x0 = laneX;
    const z0 = zTarget(T[0]) + (nb > 1 ? 0.6 * (b % 2 ? 1 : -1) : 0);
    ball.pre = { tRel: T[0] - tf, g: g0, from: [x0, yTop(0) + D0, z0] };

    interface Node {
      x: number;
      z: number;
      vin: V3;
      cost: number;
      parent: number;
      dx: number;
      pn: V3;
      pv: V3;
    }
    const BEAM = N > 240 ? 18 : 28;
    const DXN = 11;
    let beam: Node[] = [
      { x: x0, z: z0, vin: [0, -g0 * tf, 0], cost: 0, parent: -1, dx: 0, pn: [0, 1, 0], pv: [0, 0, 0] },
    ];
    const steps: Node[][] = [beam];
    const nearPlaced = (x: number, z: number, clear: number): boolean => {
      for (const p of placed)
        if (Math.abs(p.z - z) < 2.5 && Math.hypot(p.x - x, p.z - z) < Math.max(clear, p.clear)) return true;
      return false;
    };
    const ancestors = (node: Node, k: number) => {
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
      const kind = kinds[k + 1];
      const clear = KIND_CLEAR[kind] * L;
      const hop = Math.max(0.35, Math.min(1.6, 1.0 * Math.sqrt(dt / 0.4)));
      const g = Math.max(4, Math.min(400, ((8 * hop) / (dt * dt)) * st.gravity));
      const dy = yTop(k + 1) - yTop(k);
      const cand: Node[] = [];
      for (let si = 0; si < beam.length; si++) {
        const s = beam[si];
        const prev = ancestors(s, k);
        const zt = zTarget(T[k + 1]);
        const advBase = Math.max(clear, s.z - zt);
        const maxDx = Math.min(1.6 * advBase, laneHalf);
        for (const af of [0.7, 0.85, 1, 1.15, 1.35]) {
          const adv = advBase * af;
          for (let a = 0; a < DXN; a++) {
            const dx = maxDx * ((2 * a) / (DXN - 1) - 1);
            const nx = s.x + dx;
            if (Math.abs(nx - laneX) > laneHalf || Math.abs(nx) > st.spread3d) continue;
            const nz = s.z - adv;
            let ok = Math.hypot(dx, adv) >= clear;
            for (const p of prev) if (ok && Math.hypot(nx - p.x, nz - p.z) < clear) ok = false;
            if (!ok || nearPlaced(nx, nz, clear)) continue;
            const vout: V3 = [dx / dt, dy / dt + 0.5 * g * dt, -adv / dt];
            const d: V3 = [vout[0] - s.vin[0], vout[1] - s.vin[1], vout[2] - s.vin[2]];
            const dm = Math.hypot(d[0], d[1], d[2]);
            if (dm < 1e-3) continue;
            const nrm: V3 = [d[0] / dm, d[1] / dm, d[2] / dm];
            if (nrm[1] < KIND_MIN_NY[kinds[k]]) continue;
            const vn = s.vin[0] * nrm[0] + s.vin[1] * nrm[1] + s.vin[2] * nrm[2];
            if (vn > -0.01) continue;
            const e = dm / -vn - 1;
            if (e < 0.4 || e > 1.6) continue;
            let c = ((e - 0.85) / 0.3) ** 2 + 0.8 * ((1 - nrm[1]) / 0.3) ** 2;
            c += ((nz - zt) / 0.8) ** 2; // seguir el ritmo de avance común
            c += 0.4 * ((Math.abs(dx) - 0.45 * maxDx) / (0.5 * maxDx + 1e-6)) ** 2;
            if (Math.abs(s.dx) > 1e-3 && Math.sign(dx) === Math.sign(s.dx)) c += 0.8 * (1 - st.chaos);
            c += 1.5 * st.chaos * rnd(k + 1 + st.seed * 7, a * 10 + af + b);
            c += 1e-7 * (a + af);
            cand.push({
              x: nx,
              z: nz,
              vin: [vout[0], vout[1] - g * dt, vout[2]],
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
        const adv = Math.max(clear, s.z - zTarget(T[k + 1]));
        const vout: V3 = [0, dy / dt + 0.5 * g * dt, -adv / dt];
        cand.push({
          x: s.x,
          z: s.z - adv,
          vin: [0, vout[1] - g * dt, vout[2]],
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
    const path: Node[] = new Array(N);
    let idx = 0;
    for (let k = N - 1; k >= 0; k--) {
      path[k] = steps[k][idx];
      idx = path[k].parent;
    }
    const normals: V3[] = path.map((_, k) => (k < N - 1 ? path[k + 1].pn : [0, 1, 0]));
    const vouts: V3[] = path.map((_, k) => (k < N - 1 ? path[k + 1].pv : [0, 0, 0]));
    {
      const last = path[N - 1];
      const vin = Math.hypot(last.vin[0], last.vin[1], last.vin[2]) || 1;
      const dt = N > 1 ? T[N - 1] - T[N - 2] : 0.5;
      const g = Math.max(4, Math.min(400, ((8 * 1) / (dt * dt)) * st.gravity));
      vouts[N - 1] = [0, Math.min(vin * 0.8, Math.sqrt(2 * g * 1.2)), 0];
      ball.tail = { g, vy0: vouts[N - 1][1], e: 0.55 };
    }
    ball.P = path.map((p, k) => [p.x, yTop(k), p.z] as V3);
    for (let k = 0; k < N - 1; k++) ball.fl.push({ p: ball.P[k], v: vouts[k], g: 0 });
    // la gravedad de cada vuelo es la del tramo k->k+1 (recalculada igual que arriba)
    for (let k = 0; k < N - 1; k++) {
      const dt = T[k + 1] - T[k];
      const hop = Math.max(0.35, Math.min(1.6, 1.0 * Math.sqrt(dt / 0.4)));
      ball.fl[k].g = Math.max(4, Math.min(400, ((8 * hop) / (dt * dt)) * st.gravity));
    }
    for (let k = 0; k < N; k++) {
      ball.pieces.push(plan.pieces.length);
      plan.pieces.push({
        kind: kinds[k],
        ball: b,
        k,
        t: T[k],
        P: ball.P[k],
        n: normals[k],
        top: tops[k],
        size: sizes[k],
        col: col[k],
        name: bh[k].notes.length ? noteName(bh[k].notes[0].midi) : '',
        strength: S[k],
      });
      placed.push({ x: path[k].x, z: path[k].z, clear: KIND_CLEAR[kinds[k]] * L });
    }
  }
  plan.cam = planCamera(plan, st);
  return plan;
}

/** Centro de atención: media de las bolas en cada instante (en el suelo). */
function focusAt(plan: CircuitPlan, t: number): [number, number] {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const b of plan.balls) {
    if (!b.T.length) continue;
    const p = ballAtPlan(b, plan, t);
    x += p[0];
    z += p[2];
    n++;
  }
  return n ? [x / n, z / n] : [0, 0];
}

function planCamera(plan: CircuitPlan, st: SceneStyle): Float32Array {
  const frames = Math.ceil(plan.duration * CAM_HZ) + 2;
  const cam = new Float32Array(frames * 7);
  const dtc = 1 / CAM_HZ;
  // objetivo suavizado (muelle crítico) sobre el centro de las bolas
  const f0 = focusAt(plan, 0);
  let x = f0[0];
  let z = f0[1];
  let vx = 0;
  let vz = 0;
  const w = 4.5;
  // parámetros de plano actuales (mezclados suavemente salvo en los cortes)
  const cur = { ...SHOTS.follow };
  const segStarts = plan.segments.map((s) => s.start);
  let lastSeg = -1;
  for (let i = 0; i < frames; i++) {
    const t = i * dtc;
    const [tx, tz] = focusAt(plan, t);
    vx += (w * w * (tx - x) - 2 * w * vx) * dtc;
    vz += (w * w * (tz - z) - 2 * w * vz) * dtc;
    x += vx * dtc;
    z += vz * dtc;
    const si = Math.max(0, lastIndex(segStarts, t));
    const seg = plan.segments[si];
    const want = st.cameraDirector
      ? SHOTS[seg.shot]
      : { az: st.cameraAzimuth, el: st.cameraElevation, dist: st.cameraDistance, fov: 36, ahead: 2.2 };
    if (si !== lastSeg) {
      if (seg.cut || lastSeg < 0) Object.assign(cur, want);
      lastSeg = si;
    }
    const k = 1 - Math.exp(-dtc / 0.45); // transición suave ~0.45 s
    for (const key of ['az', 'el', 'dist', 'fov', 'ahead'] as const) cur[key] += (want[key] - cur[key]) * k;
    const az = (cur.az * Math.PI) / 180;
    const el = (cur.el * Math.PI) / 180;
    const look: V3 = [x, 0.9, z - cur.ahead];
    const pos: V3 = [
      look[0] + cur.dist * Math.sin(az) * Math.cos(el),
      look[1] + cur.dist * Math.sin(el),
      look[2] + cur.dist * Math.cos(az) * Math.cos(el),
    ];
    cam.set([pos[0], pos[1], pos[2], look[0], look[1], look[2], cur.fov], i * 7);
  }
  return cam;
}

export function cameraAt(plan: CircuitPlan, t: number): { pos: V3; look: V3; fov: number } {
  const n = plan.cam.length / 7;
  if (!n) return { pos: [0, 10, 10], look: [0, 0, 0], fov: 36 };
  const i = Math.max(0, t * plan.camHz);
  const i0 = Math.min(n - 1, Math.floor(i));
  const i1 = Math.min(n - 1, i0 + 1);
  const f = i - i0;
  const g = (j: number) => plan.cam[i0 * 7 + j] + (plan.cam[i1 * 7 + j] - plan.cam[i0 * 7 + j]) * f;
  return { pos: [g(0), g(1), g(2)], look: [g(3), g(4), g(5)], fov: g(6) };
}

/** Posición de una bola en el instante t. */
export function ballAtPlan(b: BallPlan, plan: CircuitPlan, t: number): V3 {
  const { T } = b;
  const N = T.length;
  if (!N || !b.pre) return [0, plan.r, 0];
  if (t < T[0]) {
    const dt = Math.max(0, t - b.pre.tRel);
    const f = b.pre.from;
    return [f[0], f[1] - 0.5 * b.pre.g * dt * dt, f[2]];
  }
  if (t >= T[N - 1]) {
    const [x0, y0, z0] = b.P[N - 1];
    const tail = b.tail!;
    let tau = t - T[N - 1];
    let vy = tail.vy0;
    for (let i = 0; i < 12; i++) {
      const flight = (2 * vy) / tail.g;
      if (tau < flight || flight < 0.02) break;
      tau -= flight;
      vy *= tail.e;
    }
    return [x0, Math.max(y0, y0 + vy * tau - 0.5 * tail.g * tau * tau), z0];
  }
  const k = lastIndex(T, t);
  const f = b.fl[k];
  const tau = t - T[k];
  return [f.p[0] + f.v[0] * tau, f.p[1] + f.v[1] * tau - 0.5 * f.g * tau * tau, f.p[2] + f.v[2] * tau];
}

/** Hundimiento de una pieza tras el golpe: muelle amortiguado (unidades a lo largo de -normal). */
export function recoilAt(age: number, strength: number, amount: number): number {
  if (age < 0 || age > 1.2) return 0;
  return amount * (0.06 + 0.07 * strength) * Math.exp(-age / 0.16) * Math.cos(26 * age);
}

/** Vibración de cámara por los golpes fuertes recientes (0..1). */
export function shakeAt(plan: CircuitPlan, t: number): number {
  let s = 0;
  const hits = plan.audioHits;
  for (let i = lastIndex(plan.audioT, t); i >= 0 && t - hits[i].t < 0.35; i--) {
    const a = t - hits[i].t;
    if (hits[i].strength > 0.75) s += (hits[i].strength - 0.75) * 4 * Math.exp(-a / 0.1);
  }
  return Math.min(1, s);
}
