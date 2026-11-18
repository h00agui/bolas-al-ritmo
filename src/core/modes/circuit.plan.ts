// Planificador del Circuito 3D: un marble run de pared. Las piezas cuelgan de un fondo vertical y las
// bolas caen de arriba abajo por gravedad, de pieza en pieza, llegando exactas a cada nota.
// Sin WebGL: se prueba en Node. Unidades: 1 ≈ el largo de una tecla. y hacia arriba, z hacia la cámara.
import type { RGB } from '../color.ts';
import { noteName } from '../music/names.ts';
import { mergeBallHits, splitHitsIntoBalls } from '../music/voices.ts';
import { lastIndex, rnd } from '../scene/draw.ts';
import { hitColors, startColor, type SceneStyle } from '../scene/style.ts';
import type { Hit } from '../types.ts';

export type V3 = [number, number, number];
export type PieceKind = 'key' | 'plate' | 'bar' | 'drum' | 'bumper';
export const PIECE_KINDS: PieceKind[] = ['key', 'plate', 'bar', 'drum', 'bumper'];

export interface Piece {
  kind: PieceKind;
  ball: number;
  k: number; // índice del choque dentro de su bola
  t: number;
  P: V3; // centro de la bola en el choque
  n: V3; // normal de la superficie
  size: number; // largo (tecla/placa/barra) o radio (tambor/bumper)
  black: boolean; // tecla negra (sostenido)
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
  tail: { g: number; vy0: number; e: number; hold: number } | null;
  pieces: number[]; // índice en plan.pieces de cada choque
}

export type ShotKind = 'front' | 'left' | 'right' | 'low' | 'high' | 'wide';
export interface Segment {
  start: number;
  end: number;
  kind: PieceKind;
  shot: ShotKind;
  cut: boolean;
}

export interface CircuitPlan {
  kind: 'platforms3d';
  duration: number;
  r: number;
  balls: BallPlan[];
  pieces: Piece[];
  segments: Segment[];
  audioHits: Hit[];
  audioT: number[];
  /** cámara a CAM_HZ: por fotograma [px, py, pz, lx, ly, lz, fov] */
  cam: Float32Array;
  camHz: number;
  startCol: RGB;
  wallZ: number;
  seed: number;
}

export interface PlanOptions {
  minGap: number;
}

const CAM_HZ = 60;
export const WALL_Z = -1.2;
/** az: giro horizontal (grados), el: inclinación (positivo = desde arriba), dist: factor de distancia, down: cuánto baja el punto de mira */
export const SHOTS: Record<ShotKind, { az: number; el: number; dist: number; down: number }> = {
  front: { az: 0, el: 28, dist: 1, down: 0.25 },
  left: { az: -32, el: 30, dist: 1.02, down: 0.25 },
  right: { az: 30, el: 24, dist: 1.02, down: 0.25 },
  low: { az: 10, el: 6, dist: 1.05, down: 0.1 },
  high: { az: -12, el: 46, dist: 1.08, down: 0.4 },
  wide: { az: 14, el: 28, dist: 1.35, down: 0.28 },
};
const KIND_MIN_NY: Record<PieceKind, number> = { key: 0.85, plate: 0.6, bar: 0.78, drum: 0.9, bumper: 0.65 };
const KIND_CLEAR: Record<PieceKind, number> = { key: 0.9, plate: 1.15, bar: 1.25, drum: 1.3, bumper: 0.95 };

const sr = (seed: number, k: number) => rnd(seed * 0.173 + 1, k + 0.5);
/** altura del bote entre dos golpes separados dt segundos (bajo para que domine la caída) */
const hopHeight = (dt: number) => Math.max(0.2, Math.min(1.2, 0.6 * Math.sqrt(dt / 0.4)));
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

/** Divide los choques en tramos por frases (silencios) o cada ~7 s, y asigna pieza y plano a cada tramo. */
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
  const shotOrder: ShotKind[] = ['front', 'left', 'high', 'right', 'low', 'front', 'wide'];
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
      else if (density > 5) kind = r < 0.55 ? 'bumper' : 'key';
      else if (meanMidi > 70) kind = r < 0.5 ? 'bar' : 'key';
      else kind = r < 0.5 ? 'key' : r < 0.75 ? 'bar' : 'plate';
      if (kind === prevKind)
        kind = (['key', 'bar', 'plate', 'drum', 'bumper'] as PieceKind[]).find(
          (x) => x !== prevKind && (x !== 'drum' || meanMidi < 68),
        )!;
    }
    prevKind = kind;
    let shot: ShotKind = shotOrder[(i + Math.floor(sr(seed, i + 100) * 2)) % shotOrder.length];
    if (i === 0) shot = 'front';
    segments.push({ start: a, end: b, kind, shot, cut: i > 0 && sr(seed, i + 300) < 0.6 });
  }
  return segments;
}

function kindSize(kind: PieceKind, midi: number, lo: number, hi: number, st: SceneStyle): number {
  const f = hi > lo ? (midi - lo) / (hi - lo) : 0.5;
  switch (kind) {
    case 'key':
      return st.tileSize * (isBlack(midi) ? 1.1 : 1.7);
    case 'bar':
      return st.tileSize * (1.5 - 0.7 * f);
    case 'drum':
      return st.tileSize * (0.58 - 0.12 * f);
    case 'bumper':
      return st.tileSize * 0.34;
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
    wallZ: WALL_Z,
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
  const laneGap = nb > 1 ? Math.min(1.6, (2 * st.spread3d) / nb) : 0;
  const pace = st.pace3d; // unidades/s de caída media
  const yTarget = (t: number) => -pace * t;
  const placed: { x: number; y: number; clear: number }[] = [];

  for (let b = 0; b < nb; b++) {
    const bh = split[b].hits;
    const N = bh.length;
    const T = bh.map((h) => h.t);
    const S = bh.map((h) => h.strength);
    const col = hitColors(bh, st);
    const kinds = bh.map((h) => segAt(h.t).kind);
    const midis = bh.map((h) => Math.max(...h.notes.map((n) => n.midi)));
    const sizes = bh.map((_, k) => kindSize(kinds[k], midis[k], lo, hi, st));
    const laneX = nb > 1 ? (b - (nb - 1) / 2) * laneGap : 0;
    const laneHalf = nb > 1 ? laneGap * 0.6 : st.spread3d;
    const ball: BallPlan = { T, S, col, P: [], fl: [], pre: null, tail: null, pieces: [] };
    plan.balls.push(ball);
    if (!N) continue;
    // profundidad de cada pieza (pequeña variación para que no sea un plano)
    const depth = (k: number) => 0.25 * (rnd(k + 11, b + st.seed) - 0.5);
    // caída inicial: entra por arriba (fuera de plano) y llega a la primera pieza justo en su nota
    const D0 = 4.5;
    let g0 = 14 * st.gravity;
    let tf = Math.sqrt((2 * D0) / g0);
    if (tf > T[0]) {
      tf = T[0];
      g0 = (2 * D0) / (tf * tf);
    }
    const x0 = laneX + (nb > 1 ? 0.4 * (sr(st.seed, b) - 0.5) : 0);
    const y0 = yTarget(T[0]);
    ball.pre = { tRel: T[0] - tf, g: g0, from: [x0, y0 + D0, depth(0)] };

    interface Node {
      x: number;
      y: number;
      vin: V3;
      cost: number;
      parent: number;
      dx: number;
      pn: V3;
      pv: V3;
    }
    const BEAM = N > 240 ? 18 : 28;
    const DXN = 13;
    let beam: Node[] = [
      { x: x0, y: y0, vin: [0, -g0 * tf, 0], cost: 0, parent: -1, dx: 0, pn: [0, 1, 0], pv: [0, 0, 0] },
    ];
    const steps: Node[][] = [beam];
    const nearPlaced = (x: number, y: number, clear: number): boolean => {
      for (const p of placed)
        if (Math.abs(p.y - y) < 2.5 && Math.hypot(p.x - x, p.y - y) < Math.max(clear, p.clear)) return true;
      return false;
    };
    const ancestors = (node: Node, k: number) => {
      const out: { x: number; y: number }[] = [];
      let cur: Node | undefined = node;
      let kk = k;
      while (cur && out.length < 8 && kk >= 1) {
        const parent: Node = steps[kk - 1][cur.parent];
        out.push({ x: parent.x, y: parent.y });
        cur = parent;
        kk--;
      }
      return out;
    };
    for (let k = 0; k < N - 1; k++) {
      const dt = T[k + 1] - T[k];
      const kindNext = kinds[k + 1];
      const clear = Math.max(KIND_CLEAR[kindNext], KIND_CLEAR[kinds[k]]) * L;
      const hop = hopHeight(dt);
      const g = Math.max(4, Math.min(400, ((8 * hop) / (dt * dt)) * st.gravity));
      const dz = depth(k + 1) - depth(k);
      const cand: Node[] = [];
      // si con las reglas normales no hay salida, se relajan (inclinación, restitución, carril) antes de forzar
      for (let relax = 0; relax < 4 && !cand.length; relax++) {
        const minNy = relax < 3 ? KIND_MIN_NY[kinds[k]] - 0.15 * relax : 0.2;
        const eMin = relax < 3 ? (relax ? 0.3 : 0.4) : 0.1;
        const eMax = relax < 3 ? (relax ? 2.0 : 1.6) : 4;
        const laneLimit = relax < 2 ? laneHalf : st.spread3d;
        for (let si = 0; si < beam.length; si++) {
          const s = beam[si];
          const prev = ancestors(s, k);
          const yt = yTarget(T[k + 1]);
          const dropBase = Math.max(0.25, s.y - yt);
          const maxDx = Math.min(2.2 * dropBase + 0.4 + relax, laneLimit);
          for (const df of [0.6, 0.8, 1, 1.2, 1.45, 1.8]) {
            const drop = dropBase * df;
            for (let a = 0; a < DXN; a++) {
              const dx = maxDx * ((2 * a) / (DXN - 1) - 1);
              const nx = s.x + dx;
              if (Math.abs(nx - laneX) > laneLimit || Math.abs(nx) > st.spread3d) continue;
              const ny = s.y - drop;
              let ok = Math.hypot(dx, drop) >= clear;
              for (const p of prev) if (ok && Math.hypot(nx - p.x, ny - p.y) < clear) ok = false;
              if (!ok || nearPlaced(nx, ny, clear)) continue;
              const vout: V3 = [dx / dt, -drop / dt + 0.5 * g * dt, dz / dt];
              const d: V3 = [vout[0] - s.vin[0], vout[1] - s.vin[1], vout[2] - s.vin[2]];
              const dm = Math.hypot(d[0], d[1], d[2]);
              if (dm < 1e-3) continue;
              const nrm: V3 = [d[0] / dm, d[1] / dm, d[2] / dm];
              if (nrm[1] < minNy) continue;
              const vn = s.vin[0] * nrm[0] + s.vin[1] * nrm[1] + s.vin[2] * nrm[2];
              if (vn > -0.01) continue;
              const e = dm / -vn - 1;
              if (e < eMin || e > eMax) continue;
              let c = ((e - 0.85) / 0.3) ** 2 + 1.2 * ((1 - nrm[1]) / 0.25) ** 2;
              c += ((ny - yt) / 0.7) ** 2; // seguir el ritmo de caída común
              c += 0.3 * ((Math.abs(dx) - 0.4 * maxDx) / (0.5 * maxDx + 1e-6)) ** 2;
              if (Math.abs(s.dx) > 1e-3 && Math.sign(dx) === Math.sign(s.dx)) c += 0.35 * (1 - st.chaos);
              c += (0.3 + 1.5 * st.chaos) * rnd(k + 1 + st.seed * 7, a * 10 + df + b);
              c += 1e-7 * (a + df) + 3 * relax;
              cand.push({
                x: nx,
                y: ny,
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
      }
      if (!cand.length) {
        // sin salida posible con física creíble: el primer hueco libre por debajo (no debería pasar)
        const s = beam[0];
        const prev = ancestors(s, k);
        let best: { x: number; y: number } | null = null;
        for (let drop = clear; drop < clear * 4 && !best; drop += clear * 0.25)
          for (let a = 0; a < DXN && !best; a++) {
            const dx = (a % 2 ? -1 : 1) * Math.ceil(a / 2) * 0.3;
            const nx = s.x + dx;
            const ny = s.y - drop;
            if (Math.abs(nx) > st.spread3d) continue;
            if (prev.some((p) => Math.hypot(nx - p.x, ny - p.y) < clear) || nearPlaced(nx, ny, clear))
              continue;
            best = { x: nx, y: ny };
          }
        const nx = best ? best.x : s.x;
        const ny = best ? best.y : s.y - clear * 4;
        const vout: V3 = [(nx - s.x) / dt, -(s.y - ny) / dt + 0.5 * g * dt, dz / dt];
        cand.push({
          x: nx,
          y: ny,
          vin: [vout[0], vout[1] - g * dt, vout[2]],
          cost: s.cost + 50,
          parent: 0,
          dx: nx - s.x,
          pn: [0, 1, 0],
          pv: vout,
        });
      }
      cand.sort((p, q) => p.cost - q.cost);
      const seen = new Set<string>();
      const next: Node[] = [];
      for (const c of cand) {
        const key = `${Math.round(c.x / 0.25)}:${Math.round(c.y / 0.25)}`;
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
      // último choque: un par de botes en la pieza y después cae fuera de plano
      const last = path[N - 1];
      const vin = Math.hypot(last.vin[0], last.vin[1], last.vin[2]) || 1;
      const g = 14 * st.gravity;
      vouts[N - 1] = [0, Math.min(vin * 0.6, Math.sqrt(2 * g * 0.8)), 0];
      ball.tail = { g, vy0: vouts[N - 1][1], e: 0.5, hold: 1.1 };
    }
    ball.P = path.map((p, k) => [p.x, p.y, depth(k)] as V3);
    for (let k = 0; k < N - 1; k++) {
      const dt = T[k + 1] - T[k];
      const hop = hopHeight(dt);
      ball.fl.push({
        p: ball.P[k],
        v: vouts[k],
        g: Math.max(4, Math.min(400, ((8 * hop) / (dt * dt)) * st.gravity)),
      });
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
        size: sizes[k],
        black: isBlack(midis[k]),
        col: col[k],
        name: bh[k].notes.length ? noteName(bh[k].notes[0].midi) : '',
        strength: S[k],
      });
      placed.push({ x: path[k].x, y: path[k].y, clear: KIND_CLEAR[kinds[k]] * L });
    }
  }
  plan.cam = planCamera(plan, st);
  return plan;
}

/** ¿Está la bola en escena en el instante t? (entra al caer; sale un poco después de su último golpe) */
export function ballActive(b: BallPlan, t: number): boolean {
  if (!b.T.length || !b.pre) return false;
  const last = b.T[b.T.length - 1];
  return t >= b.pre.tRel && t <= last + (b.tail?.hold ?? 1) + 1.2;
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
    if (tau > tail.hold) {
      // cae fuera de plano
      const tf = tau - tail.hold;
      return [x0, y0 - 0.5 * tail.g * tf * tf, z0];
    }
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

/** Cámara: encuadra siempre a todas las bolas en escena (y sus próximas piezas), con el ángulo del plano.
 *  Se calcula entera por adelantado: el centro se suaviza con una ventana simétrica (anticipa los movimientos)
 *  y la distancia se filtra con máximo + media, lo que garantiza que ninguna bola se salga del encuadre. */
function planCamera(plan: CircuitPlan, st: SceneStyle): Float32Array {
  const HZ = CAM_HZ;
  const frames = Math.ceil(plan.duration * HZ) + 2;
  const cam = new Float32Array(frames * 7);
  const dtc = 1 / HZ;
  const FOV = 36;
  const aspect = 9 / 16;
  const tanV = Math.tan((FOV * Math.PI) / 360);
  const tanH = tanV * aspect;
  const SAFE = 0.9; // fracción del encuadre que pueden ocupar los puntos de interés
  const LOOK = 0.7; // s de antelación con que la cámara espera a una bola nueva

  // 1) puntos de interés por fotograma: [x, y, z, margen, ...]
  const pts: number[][] = new Array(frames);
  const cx = new Float64Array(frames);
  const cy = new Float64Array(frames);
  const hh = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i * dtc;
    let list: number[] = [];
    for (const b of plan.balls) {
      if (!b.T.length || !b.pre) continue;
      const last = b.T[b.T.length - 1];
      if (t > last + (b.tail?.hold ?? 1)) continue; // al acabar cae y sale de plano
      const active = ballActive(b, t);
      const soon = !active && t >= b.pre.tRel - LOOK;
      if (!active && !soon) continue;
      const p = ballAtPlan(b, plan, Math.max(t, b.pre.tRel));
      list.push(p[0], p[1], p[2], plan.r + 0.45);
      const k = lastIndex(b.T, t);
      // la pieza siguiente solo cuenta si la bola va a llegar pronto (si no, el encuadre se abre de más)
      for (const j of [k + 1, k + 2])
        if (j >= 0 && j < b.T.length && b.T[j] - t < (j === k + 1 ? 1.5 : 0.8))
          list.push(b.P[j][0], b.P[j][1], b.P[j][2], j === k + 1 ? 0.5 : 0.3);
    }
    if (!list.length) {
      if (i > 0) list = pts[i - 1];
      else {
        const b = plan.balls.find((x) => x.T.length);
        const q = b ? b.P[0] : [0, 0, 0];
        list = [q[0], q[1], q[2], 1];
      }
    }
    pts[i] = list;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j < list.length; j += 4) {
      const m = list[j + 3];
      minX = Math.min(minX, list[j] - m);
      maxX = Math.max(maxX, list[j] + m);
      minY = Math.min(minY, list[j + 1] - m);
      maxY = Math.max(maxY, list[j + 1] + m);
    }
    cx[i] = (minX + maxX) / 2;
    cy[i] = (minY + maxY) / 2;
    hh[i] = Math.max(1.2, (maxY - minY) / 2);
  }

  // 2) tramos entre cortes (los filtros no cruzan un corte)
  const segStarts = plan.segments.map((sg) => sg.start);
  const spanStart = new Int32Array(frames);
  const spanEnd = new Int32Array(frames);
  {
    const cuts = new Set<number>();
    for (const sg of plan.segments)
      if (sg.cut) cuts.add(Math.min(frames - 1, Math.max(0, Math.round(sg.start * HZ))));
    let start = 0;
    for (let i = 0; i < frames; i++) {
      if (i > 0 && cuts.has(i)) start = i;
      spanStart[i] = start;
    }
    let end = frames - 1;
    for (let i = frames - 1; i >= 0; i--) {
      if (i < frames - 1 && cuts.has(i + 1)) end = i;
      spanEnd[i] = end;
    }
  }
  const W = Math.round(0.5 * HZ);
  const filter = (src: Float64Array, mode: 'mean' | 'max'): Float64Array => {
    const out = new Float64Array(frames);
    for (let i = 0; i < frames; i++) {
      const lo = Math.max(spanStart[i], i - W);
      const hi = Math.min(spanEnd[i], i + W);
      if (mode === 'max') {
        let m = -Infinity;
        for (let j = lo; j <= hi; j++) if (src[j] > m) m = src[j];
        out[i] = m;
      } else {
        let acc = 0;
        for (let j = lo; j <= hi; j++) acc += src[j];
        out[i] = acc / (hi - lo + 1);
      }
    }
    return out;
  };
  const scx = filter(cx, 'mean');
  const scy = filter(cy, 'mean');
  const shh = filter(filter(hh, 'max'), 'mean');

  // 3) parámetros del plano por fotograma (corte: cambio inmediato; si no, transición suave)
  const cur = { ...SHOTS.front };
  let lastSeg = -1;
  const az = new Float64Array(frames);
  const el = new Float64Array(frames);
  const df = new Float64Array(frames);
  const dn = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i * dtc;
    const si = Math.max(0, lastIndex(segStarts, t));
    const seg = plan.segments[si];
    const want = st.cameraDirector
      ? SHOTS[seg.shot]
      : { az: st.cameraAzimuth, el: st.cameraElevation - 36, dist: st.cameraDistance / 13, down: 0.25 };
    if (si !== lastSeg) {
      if (seg.cut || lastSeg < 0) Object.assign(cur, want);
      lastSeg = si;
    }
    const kk = 1 - Math.exp(-dtc / 0.45);
    for (const key of ['az', 'el', 'dist', 'down'] as const) cur[key] += (want[key] - cur[key]) * kk;
    az[i] = (cur.az * Math.PI) / 180;
    el[i] = (cur.el * Math.PI) / 180;
    df[i] = Math.max(0.6, cur.dist);
    dn[i] = cur.down;
  }

  // 4) distancia mínima para que todos los puntos quepan, luego filtro máximo + media (nunca por debajo de la mínima)
  const need = new Float64Array(frames);
  const dir = (i: number): V3 => [
    Math.sin(az[i]) * Math.cos(el[i]),
    Math.sin(el[i]),
    Math.cos(az[i]) * Math.cos(el[i]),
  ];
  const lookAt = (i: number): V3 => [scx[i], scy[i] - dn[i] * shh[i], 0];
  for (let i = 0; i < frames; i++) {
    const d = dir(i);
    const fw: V3 = [-d[0], -d[1], -d[2]];
    const rt: V3 = [-fw[2], 0, fw[0]];
    const rl = Math.hypot(rt[0], rt[2]) || 1;
    rt[0] /= rl;
    rt[2] /= rl;
    const upv: V3 = [
      rt[1] * fw[2] - rt[2] * fw[1],
      rt[2] * fw[0] - rt[0] * fw[2],
      rt[0] * fw[1] - rt[1] * fw[0],
    ];
    const look = lookAt(i);
    let req = 3;
    const list = pts[i];
    for (let j = 0; j < list.length; j += 4) {
      const rx = list[j] - look[0];
      const ry = list[j + 1] - look[1];
      const rz = list[j + 2] - look[2];
      const m = list[j + 3];
      const xr = rx * rt[0] + ry * rt[1] + rz * rt[2];
      const yr = rx * upv[0] + ry * upv[1] + rz * upv[2];
      const zf = rx * fw[0] + ry * fw[1] + rz * fw[2];
      req = Math.max(req, (Math.abs(xr) + m) / (SAFE * tanH) - zf, (Math.abs(yr) + m) / (SAFE * tanV) - zf);
    }
    need[i] = req * df[i];
  }
  const dist = filter(filter(need, 'max'), 'mean');
  for (let i = 0; i < frames; i++) {
    const d = dir(i);
    const look = lookAt(i);
    cam.set(
      [
        look[0] + dist[i] * d[0],
        look[1] + dist[i] * d[1],
        look[2] + dist[i] * d[2],
        look[0],
        look[1],
        look[2],
        FOV,
      ],
      i * 7,
    );
  }
  return cam;
}

export function cameraAt(plan: CircuitPlan, t: number): { pos: V3; look: V3; fov: number } {
  const n = plan.cam.length / 7;
  if (!n) return { pos: [0, 2, 10], look: [0, 0, 0], fov: 36 };
  const i = Math.max(0, t * plan.camHz);
  const i0 = Math.min(n - 1, Math.floor(i));
  const i1 = Math.min(n - 1, i0 + 1);
  const f = i - i0;
  const g = (j: number) => plan.cam[i0 * 7 + j] + (plan.cam[i1 * 7 + j] - plan.cam[i0 * 7 + j]) * f;
  return { pos: [g(0), g(1), g(2)], look: [g(3), g(4), g(5)], fov: g(6) };
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
