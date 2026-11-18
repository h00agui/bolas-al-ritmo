// Planificador del Circuito 3D: un marble run de pared. Las piezas cuelgan de un fondo vertical y las
// bolas caen de arriba abajo por gravedad, de pieza en pieza, llegando exactas a cada nota. Cuando entre
// dos notas pasan más de unas décimas, la bola no flota: baja rodando por un carril (serpentina) hasta la
// pieza siguiente. Sin WebGL: se prueba en Node. Unidades: 1 ≈ el largo de una placa. y hacia arriba,
// z hacia la cámara (la pared está en z = WALL_Z).
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

/** Carril por el que rueda una bola entre dos notas lejanas. */
export interface Rail {
  ball: number;
  k: number; // intervalo (entre el choque k y el k+1)
  tA: number; // entra en el carril
  tB: number; // lo deja
  pts: V3[]; // centro de la bola a lo largo del carril
  times: number[]; // instante en cada punto (absoluto)
}

export interface Flight3 {
  p: V3;
  v: V3;
  g: number;
  rail?: number; // índice en plan.rails: p/v/g describen el salto hasta el carril
  exit?: { p: V3; v: V3; g: number }; // parábola de salida del carril hasta la pieza siguiente
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

export type ShotKind = 'front' | 'left' | 'right' | 'high' | 'low';
export interface Segment {
  start: number;
  end: number;
  kind: PieceKind;
  shot: ShotKind;
}

export interface CircuitPlan {
  kind: 'platforms3d';
  duration: number;
  r: number;
  balls: BallPlan[];
  pieces: Piece[];
  rails: Rail[];
  segments: Segment[];
  audioHits: Hit[];
  audioT: number[];
  /** cámara a CAM_HZ: por fotograma [px, py, pz, lx, ly, lz, fov] */
  cam: Float32Array;
  camHz: number;
  camDist: number; // distancia fija de la cámara (no hay zoom)
  startCol: RGB;
  wallZ: number;
  seed: number;
}

export interface PlanOptions {
  minGap: number;
}

const CAM_HZ = 60;
export const WALL_Z = -1.2;
/** a partir de esta separación entre notas la bola va por carril */
export const RAIL_DT = 0.7;
const RAIL_IN = 0.25; // s del salto desde la pieza al carril
const RAIL_OUT = 0.2; // s de la salida del carril a la pieza
const RAIL_VMAX = 4.8; // unidades/s
const RAIL_ACC = 3; // aceleración efectiva rodando (gravedad con rozamiento)
/** ángulos de cámara suaves: az giro horizontal, el inclinación (grados) */
export const SHOTS: Record<ShotKind, { az: number; el: number }> = {
  front: { az: 0, el: 26 },
  left: { az: -16, el: 30 },
  right: { az: 16, el: 22 },
  high: { az: -8, el: 38 },
  low: { az: 6, el: 14 },
};
const KIND_MIN_NY: Record<PieceKind, number> = { key: 0.85, plate: 0.6, bar: 0.78, drum: 0.9, bumper: 0.65 };
const KIND_CLEAR: Record<PieceKind, number> = { key: 0.9, plate: 1.15, bar: 1.25, drum: 1.3, bumper: 0.95 };

const sr = (seed: number, k: number) => rnd(seed * 0.173 + 1, k + 0.5);
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
/** altura del bote entre dos golpes separados dt segundos (bajo para que domine la caída) */
const hopHeight = (dt: number) => Math.max(0.2, Math.min(1.2, 0.6 * Math.sqrt(dt / 0.4)));
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Divide los choques en tramos por frases (silencios) o cada ~7 s, y asigna pieza y plano a cada tramo. */
export function composeSegments(hits: Hit[], duration: number, st: SceneStyle, compact = false): Segment[] {
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
  const shotOrder: ShotKind[] = ['front', 'left', 'high', 'right', 'low', 'front'];
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
    else if (compact) kind = sr(seed, i) < 0.6 ? 'key' : 'bumper';
    else {
      const r = sr(seed, i);
      if (meanMidi < 55) kind = r < 0.7 ? 'drum' : 'bumper';
      else if (density > 5) kind = r < 0.55 ? 'bumper' : 'key';
      else if (meanMidi > 70) kind = r < 0.5 ? 'bar' : 'key';
      else kind = r < 0.5 ? 'key' : r < 0.75 ? 'bar' : 'plate';
      if (kind === prevKind && !compact)
        kind = (['key', 'bar', 'plate', 'drum', 'bumper'] as PieceKind[]).find(
          (x) => x !== prevKind && (x !== 'drum' || meanMidi < 68),
        )!;
    }
    prevKind = kind;
    let shot: ShotKind = shotOrder[(i + Math.floor(sr(seed, i + 100) * 2)) % shotOrder.length];
    if (i === 0) shot = 'front';
    segments.push({ start: a, end: b, kind, shot });
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

/** Muestra una Catmull-Rom uniforme por los puntos dados (sin los dos extremos, que solo fijan tangentes). */
function catmullRom(pts: V3[], per: number): V3[] {
  const out: V3[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2];
    for (let s = 0; s < per; s++) {
      const u = s / per;
      const u2 = u * u;
      const u3 = u2 * u;
      const q: V3 = [0, 0, 0];
      for (let c = 0; c < 3; c++)
        q[c] =
          0.5 *
          (2 * p1[c] +
            (-p0[c] + p2[c]) * u +
            (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u2 +
            (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u3);
      out.push(q);
    }
  }
  out.push([...pts[pts.length - 2]] as V3);
  return out;
}

interface RailEnv {
  laneX: number;
  laneHalf: number;
  spread: number;
  g0: number;
  seed: number;
  ball: number;
  blocked: (x: number, y: number, clear: number) => boolean;
}

interface RailBuild {
  rail: Omit<Rail, 'ball' | 'k'>;
  vOut: V3; // velocidad al dejar la pieza k
  exit: { p: V3; v: V3; g: number };
  vinNext: V3; // velocidad al llegar a la pieza k+1
}

/** Construye el carril entre la pieza k (en Pk, instante tk) y la siguiente (Pn, tn). */
function buildRail(Pk: V3, Pn: V3, tk: number, tn: number, k: number, env: RailEnv): RailBuild {
  const g0 = env.g0;
  const tA = tk + RAIL_IN;
  const tB = tn - RAIL_OUT;
  const D = Math.max(0.05, tB - tA);
  const sA =
    Math.abs(Pk[0] - env.laneX) > env.laneHalf * 0.5
      ? env.laneX >= Pk[0]
        ? 1
        : -1
      : Pn[0] >= Pk[0]
        ? 1
        : -1;
  const A: V3 = [Pk[0] + 0.4 * sA, Pk[1] - 0.5, Pk[2]];
  const vOut: V3 = [
    (A[0] - Pk[0]) / RAIL_IN,
    (A[1] - Pk[1] + 0.5 * g0 * RAIL_IN * RAIL_IN) / RAIL_IN,
    (A[2] - Pk[2]) / RAIL_IN,
  ];
  const vA: V3 = [vOut[0], vOut[1] - g0 * RAIL_IN, vOut[2]];
  const v0 = Math.max(1.5, Math.min(3.5, Math.hypot(vA[0], vA[1], vA[2])));
  const dirA = norm(vA);
  // sale del carril hacia la pieza siguiente desde el lado del centro del carril (para no salirse de él)
  const sE = Pn[0] >= env.laneX ? 1 : -1;
  const dirE = norm([0.55 * sE, -0.83, 0]);
  const endPoint = (vE: number): V3 => [
    Pn[0] - vE * dirE[0] * RAIL_OUT,
    Pn[1] - vE * dirE[1] * RAIL_OUT + 0.5 * g0 * RAIL_OUT * RAIL_OUT,
    Pn[2],
  ];
  const ampMax = Math.max(0.3, Math.min(env.laneHalf * 0.75, env.spread - 0.2, 0.9));

  interface Cand {
    pts: V3[];
    times: number[];
    kappa: number;
    bad: number;
    vEnd: number;
    n: number;
  }
  const build = (B: V3, amp: number, n: number, flip: number): Cand => {
    const ctrl: V3[] = [[A[0] - dirA[0] * 0.5, A[1] - dirA[1] * 0.5, A[2]], A];
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const sgn = (i % 2 ? sA : -sA) * flip;
      const x = Math.max(env.laneX - env.laneHalf, Math.min(env.laneX + env.laneHalf, env.laneX + sgn * amp));
      const wob = 0.18 * (rnd(k + 3, i + env.ball + env.seed) - 0.5);
      ctrl.push([x, A[1] + (B[1] - A[1]) * f + wob, A[2] + (B[2] - A[2]) * f]);
    }
    ctrl.push(B, [B[0] + dirE[0] * 0.5, B[1] + dirE[1] * 0.5, B[2]]);
    const pts = catmullRom(ctrl, 14);
    // perfil de velocidad: gana velocidad al bajar (con rozamiento) hasta un máximo
    const v: number[] = pts.map((p) =>
      Math.min(RAIL_VMAX, Math.sqrt(v0 * v0 + 2 * RAIL_ACC * Math.max(0, A[1] - p[1]))),
    );
    const tt: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const ds = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
      tt.push(tt[i - 1] + ds / (0.5 * (v[i] + v[i - 1])));
    }
    const kappa = tt[tt.length - 1] / D;
    let bad = 0;
    for (let i = 0; i < pts.length; i += 2) if (env.blocked(pts[i][0], pts[i][1], 0.6)) bad++;
    return { pts, times: tt.map((x) => tA + x / kappa), kappa, bad, vEnd: v[v.length - 1], n };
  };
  const score = (c: Cand) => Math.abs(Math.log(c.kappa)) + 2 * c.bad;
  /** la amplitud se ajusta por bisección para que el tiempo físico coincida con el disponible */
  const fit = (B: V3, n: number, flip: number): Cand => {
    let lo = 0.15;
    let hi = ampMax;
    let c = build(B, hi, n, flip);
    // kappa > 1: el recorrido es más largo de lo que la bola puede rodar en el tiempo disponible → menos amplitud
    if (c.kappa > 1)
      for (let it = 0; it < 10; it++) {
        const mid = (lo + hi) / 2;
        const cm = build(B, mid, n, flip);
        if (cm.kappa > 1) hi = mid;
        else lo = mid;
        c = cm;
      }
    return c;
  };
  // nº de curvas de la serpentina según el recorrido que hace falta para no ir ni muy lento ni muy rápido
  let B = endPoint(4);
  const dy = Math.max(0.3, A[1] - B[1]);
  const lNeed = D * Math.min(RAIL_VMAX, v0 + 0.5 * RAIL_ACC * Math.min(D, 1.5));
  const lateral = Math.sqrt(Math.max(0, lNeed * lNeed - dy * dy));
  // carriles cortos: una sola curva (una serpentina apretada parece un alambre)
  // (y cada curva debe tener al menos ~1,2 unidades de caída para que no parezca un muelle)
  const nMax = Math.max(1, Math.min(8, Math.floor(dy / 1.2)));
  const nBase = D < 0.8 ? 1 : Math.max(1, Math.min(nMax, Math.round(lateral / (2 * ampMax) + 0.5)));
  let best: Cand | null = null;
  for (const n of D < 0.8
    ? [1, Math.min(2, nMax)]
    : [nBase, Math.min(nMax, nBase + 1), Math.max(1, nBase - 1)])
    for (const flip of [1, -1]) {
      const c = fit(B, n, flip);
      if (!best || score(c) < score(best)) best = c;
    }
  // segunda pasada con la velocidad real de salida (ajusta el punto final)
  const vE = Math.max(2, Math.min(RAIL_VMAX, best!.vEnd / Math.max(0.5, best!.kappa)));
  B = endPoint(vE);
  let fin: Cand | null = null;
  for (const flip of [1, -1]) {
    const c = fit(B, best!.n, flip);
    if (!fin || score(c) < score(fin)) fin = c;
  }
  const vExit: V3 = [vE * dirE[0], vE * dirE[1], vE * dirE[2]];
  return {
    rail: { tA, tB, pts: fin!.pts, times: fin!.times },
    vOut,
    exit: { p: B, v: vExit, g: g0 },
    vinNext: [vExit[0], vExit[1] - g0 * RAIL_OUT, vExit[2]],
  };
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
  const segments = composeSegments(audioHits, duration, st, split.length > 1);
  const plan: CircuitPlan = {
    kind: 'platforms3d',
    duration,
    r,
    balls: [],
    pieces: [],
    rails: [],
    segments,
    audioHits,
    audioT: audioHits.map((h) => h.t),
    cam: new Float32Array(0),
    camHz: CAM_HZ,
    camDist: 8,
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
  // con varias bolas, cada una baja por su propio carril (sin solaparse con los demás)
  const laneGap = 1.0;
  const pace = st.pace3d; // unidades/s de caída media
  const yTarget = (t: number) => -pace * t;
  const g0 = 14 * st.gravity;
  // piezas y carriles ya colocados: entre piezas de la misma bola se respeta la holgura estética; con las de
  // otras bolas (en su propio carril) basta con que no se toquen
  const placed: { x: number; y: number; clear: number; ball: number }[] = [];
  let curBall = 0;
  const nearPlaced = (x: number, y: number, clear: number): boolean => {
    for (const p of placed) {
      if (Math.abs(p.y - y) > 2.5) continue;
      const need = p.ball === curBall ? 0.5 * (clear + p.clear) : 0.55;
      if (Math.hypot(p.x - x, p.y - y) < need) return true;
    }
    return false;
  };

  for (let b = 0; b < nb; b++) {
    const bh = split[b].hits;
    const N = bh.length;
    const T = bh.map((h) => h.t);
    const S = bh.map((h) => h.strength);
    const col = hitColors(bh, st);
    const kinds = bh.map((h) => segAt(h.t).kind);
    const midis = bh.map((h) => Math.max(...h.notes.map((n) => n.midi)));
    const sizes = bh.map((_, k) => kindSize(kinds[k], midis[k], lo, hi, st));
    curBall = b;
    const laneX = nb > 1 ? (b - (nb - 1) / 2) * laneGap : 0;
    const laneHalf = nb > 1 ? laneGap * 0.45 : st.spread3d;
    const ball: BallPlan = { T, S, col, P: [], fl: [], pre: null, tail: null, pieces: [] };
    plan.balls.push(ball);
    if (!N) continue;
    // profundidad de cada pieza (pequeña variación para que no sea un plano)
    const depth = (k: number) => 0.25 * (rnd(k + 11, b + st.seed) - 0.5);
    // caída inicial: entra por arriba (fuera de plano) y llega a la primera pieza justo en su nota
    const D0 = 4.5;
    let gPre = g0;
    let tf = Math.sqrt((2 * D0) / gPre);
    if (tf > T[0]) {
      tf = T[0];
      gPre = (2 * D0) / (tf * tf);
    }
    const x0 = laneX + (nb > 1 ? 0.6 * (sr(st.seed, b) - 0.5) : 0);
    const y0 = yTarget(T[0]);
    ball.pre = { tRel: T[0] - tf, g: gPre, from: [x0, y0 + D0, depth(0)] };

    interface Node {
      x: number;
      y: number;
      vin: V3;
      cost: number;
      parent: number;
      dx: number;
      pn: V3; // normal de la pieza anterior
      pv: V3; // velocidad al dejar la pieza anterior
      rail?: RailBuild; // el intervalo anterior fue por carril
    }
    const BEAM = N > 240 ? 18 : 28;
    const DXN = 13;
    let beam: Node[] = [
      { x: x0, y: y0, vin: [0, -gPre * tf, 0], cost: 0, parent: -1, dx: 0, pn: [0, 1, 0], pv: [0, 0, 0] },
    ];
    const steps: Node[][] = [beam];
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
    const railEnv: RailEnv = {
      laneX,
      laneHalf,
      spread: st.spread3d,
      g0,
      seed: st.seed,
      ball: b,
      blocked: nearPlaced,
    };
    for (let k = 0; k < N - 1; k++) {
      const dt = T[k + 1] - T[k];
      const kindNext = kinds[k + 1];
      const clear = Math.max(KIND_CLEAR[kindNext], KIND_CLEAR[kinds[k]]) * L;
      const dz = depth(k + 1) - depth(k);
      if (dt >= RAIL_DT) {
        // ---- carril: la bola baja rodando hasta la pieza siguiente ----
        const s = beam[0];
        const yt = Math.min(yTarget(T[k + 1]), s.y - Math.max(0.8, 0.5 * dt));
        const prev = ancestors(s, k);
        let nx = s.x;
        let bestScore = Infinity;
        for (let a = 0; a < 9; a++) {
          const u = (a / 8) * 2 - 1;
          const x = Math.max(-st.spread3d, Math.min(st.spread3d, laneX + u * laneHalf * 0.9));
          if (nearPlaced(x, yt, clear) || prev.some((p) => Math.hypot(x - p.x, yt - p.y) < clear)) continue;
          const score = Math.abs(u - (sr(st.seed + b, k + 50) * 2 - 1)) + (Math.abs(x - s.x) < 0.4 ? 1 : 0);
          if (score < bestScore) {
            bestScore = score;
            nx = x;
          }
        }
        const Pk: V3 = [s.x, s.y, depth(k)];
        const Pn: V3 = [nx, yt, depth(k + 1)];
        const rb = buildRail(Pk, Pn, T[k], T[k + 1], k, railEnv);
        const d: V3 = [rb.vOut[0] - s.vin[0], rb.vOut[1] - s.vin[1], rb.vOut[2] - s.vin[2]];
        let nrm = norm(d);
        if (nrm[1] < KIND_MIN_NY[kinds[k]])
          nrm = norm([nrm[0] * 0.5, KIND_MIN_NY[kinds[k]] + 0.05, nrm[2] * 0.5]);
        beam = [
          {
            x: nx,
            y: yt,
            vin: rb.vinNext,
            cost: s.cost,
            parent: 0,
            dx: nx - s.x,
            pn: nrm,
            pv: rb.vOut,
            rail: rb,
          },
        ];
        steps.push(beam);
        continue;
      }
      // ---- salto: parábola corta entre dos piezas (gravedad real como mínimo) ----
      const hop = hopHeight(dt);
      const g = Math.max(g0, Math.min(400, ((8 * hop) / (dt * dt)) * st.gravity));
      const cand: Node[] = [];
      // si con las reglas normales no hay salida, se relajan (inclinación, restitución, carril) antes de forzar
      for (let relax = 0; relax < 4 && !cand.length; relax++) {
        const minNy = relax < 3 ? KIND_MIN_NY[kinds[k]] - 0.15 * relax : 0.2;
        const eMin = relax < 3 ? (relax ? 0.3 : 0.4) : 0.1;
        const eMax = relax < 3 ? (relax ? 2.0 : 1.6) : 4;
        const laneLimit = relax < 2 ? laneHalf : Math.min(st.spread3d, laneHalf + 0.3);
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
        const yt = yTarget(T[k + 1]);
        let best: { x: number; y: number; score: number } | null = null;
        for (let a = 0; a < 25; a++) {
          const dx = (a % 2 ? -1 : 1) * Math.ceil(a / 2) * 0.15;
          const nx = s.x + dx;
          if (Math.abs(nx - laneX) > laneHalf + 0.3 || Math.abs(nx) > st.spread3d + 0.3) continue;
          for (let drop = Math.max(0.3, s.y - yt) * 0.7; drop < clear * 4; drop += 0.15) {
            const ny = s.y - drop;
            if (Math.hypot(dx, drop) < clear) continue;
            if (prev.some((p) => Math.hypot(nx - p.x, ny - p.y) < clear) || nearPlaced(nx, ny, clear))
              continue;
            const score = Math.abs(ny - yt) + 0.3 * Math.abs(nx - laneX);
            if (!best || score < best.score) best = { x: nx, y: ny, score };
            break;
          }
        }
        const nx = best ? best.x : s.x;
        const ny = best ? best.y : s.y - clear * 2;
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
      vouts[N - 1] = [0, Math.min(vin * 0.6, Math.sqrt(2 * g0 * 0.8)), 0];
      ball.tail = { g: g0, vy0: vouts[N - 1][1], e: 0.5, hold: 1.1 };
    }
    ball.P = path.map((p, k) => [p.x, p.y, depth(k)] as V3);
    for (let k = 0; k < N - 1; k++) {
      const dt = T[k + 1] - T[k];
      const rb = path[k + 1].rail;
      if (rb) {
        const railIndex = plan.rails.length;
        plan.rails.push({ ball: b, k, ...rb.rail });
        ball.fl.push({ p: ball.P[k], v: vouts[k], g: g0, rail: railIndex, exit: rb.exit });
        for (let i = 0; i < rb.rail.pts.length; i += 6)
          placed.push({ x: rb.rail.pts[i][0], y: rb.rail.pts[i][1], clear: 0.55, ball: b });
      } else {
        const hop = hopHeight(dt);
        ball.fl.push({
          p: ball.P[k],
          v: vouts[k],
          g: Math.max(g0, Math.min(400, ((8 * hop) / (dt * dt)) * st.gravity)),
        });
      }
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
      placed.push({ x: path[k].x, y: path[k].y, clear: KIND_CLEAR[kinds[k]] * L, ball: b });
    }
  }
  const cam = planCamera(plan, st);
  plan.cam = cam.cam;
  plan.camDist = cam.dist;
  return plan;
}

/** ¿Está la bola en escena en el instante t? (entra al caer; sale un poco después de su último golpe) */
export function ballActive(b: BallPlan, t: number): boolean {
  if (!b.T.length || !b.pre) return false;
  const last = b.T[b.T.length - 1];
  return t >= b.pre.tRel && t <= last + (b.tail?.hold ?? 1) + 1.2;
}

const parabola = (p: V3, v: V3, g: number, tau: number): V3 => [
  p[0] + v[0] * tau,
  p[1] + v[1] * tau - 0.5 * g * tau * tau,
  p[2] + v[2] * tau,
];

/** Posición sobre un carril en el instante t (interpolación entre muestras). */
export function railAt(rail: Rail, t: number): V3 {
  const { pts, times } = rail;
  if (t <= times[0]) return pts[0];
  const n = times.length;
  if (t >= times[n - 1]) return pts[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - times[lo]) / Math.max(1e-9, times[hi] - times[lo]);
  const a = pts[lo];
  const c = pts[hi];
  return [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
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
  if (f.rail !== undefined) {
    const rail = plan.rails[f.rail];
    if (t < rail.tA) return parabola(f.p, f.v, f.g, t - T[k]);
    if (t < rail.tB) return railAt(rail, t);
    return parabola(f.exit!.p, f.exit!.v, f.exit!.g, t - rail.tB);
  }
  return parabola(f.p, f.v, f.g, t - T[k]);
}

/** ¿Va la bola por un carril en el instante t? */
export function onRail(b: BallPlan, plan: CircuitPlan, t: number): boolean {
  const k = lastIndex(b.T, t);
  if (k < 0 || k >= b.fl.length) return false;
  const f = b.fl[k];
  if (f.rail === undefined) return false;
  const rail = plan.rails[f.rail];
  return t >= rail.tA && t <= rail.tB;
}

/** Cámara: distancia fija (sin zoom), sigue con suavidad a todas las bolas en escena y cambia de ángulo
 *  muy despacio. Se calcula entera por adelantado: el centro se filtra tres veces con una ventana simétrica
 *  (anticipa sin tirones) y la distancia es la mínima que mantiene a las bolas dentro del encuadre
 *  durante todo el vídeo. */
function planCamera(plan: CircuitPlan, st: SceneStyle): { cam: Float32Array; dist: number } {
  const HZ = CAM_HZ;
  const frames = Math.ceil(plan.duration * HZ) + 2;
  const cam = new Float32Array(frames * 7);
  const dtc = 1 / HZ;
  const FOV = 36;
  const aspect = 9 / 16;
  const tanV = Math.tan((FOV * Math.PI) / 360);
  const tanH = tanV * aspect;
  const SAFE = 0.92; // fracción del encuadre que pueden ocupar los puntos de interés
  const DOWN = 0.15; // el punto de mira queda por debajo de las bolas: se ve hacia dónde caen

  // 1) puntos de interés por fotograma: [x, y, z, margen, ...]
  const pts: number[][] = new Array(frames);
  const cx = new Float64Array(frames);
  const cy = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i * dtc;
    let list: number[] = [];
    const extra: number[] = [];
    for (const b of plan.balls) {
      if (!b.T.length || !b.pre) continue;
      const last = b.T[b.T.length - 1];
      if (t > last + (b.tail?.hold ?? 1)) continue; // al acabar cae y sale de plano
      if (!ballActive(b, t)) continue;
      const p = ballAtPlan(b, plan, t);
      if (t < b.T[0] && p[1] > b.P[0][1] + 1.3) continue; // entra por arriba del plano
      list.push(p[0], p[1], p[2], plan.r + 0.2);
      const k = lastIndex(b.T, t);
      // la pieza siguiente solo cuenta (y no para el centro) si la bola va a llegar enseguida
      const j = k + 1;
      if (j < b.T.length && b.T[j] - t < 0.6) extra.push(b.P[j][0], b.P[j][1], b.P[j][2], 0.2);
    }
    if (!list.length) {
      if (i > 0) list = pts[i - 1];
      else {
        const b = plan.balls.find((x) => x.T.length);
        const q = b ? b.P[0] : [0, 0, 0];
        list = [q[0], q[1], q[2], 1];
      }
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j < list.length; j += 4) {
      minX = Math.min(minX, list[j]);
      maxX = Math.max(maxX, list[j]);
      minY = Math.min(minY, list[j + 1]);
      maxY = Math.max(maxY, list[j + 1]);
    }
    cx[i] = (minX + maxX) / 2;
    cy[i] = (minY + maxY) / 2;
    pts[i] = list.concat(extra);
  }

  // 2) centro suavizado: tres medias móviles simétricas (≈ gaussiana, sin escalones ni tirones)
  const W = Math.round(0.35 * HZ);
  const mean = (src: Float64Array): Float64Array => {
    const out = new Float64Array(frames);
    const pre = new Float64Array(frames + 1);
    for (let i = 0; i < frames; i++) pre[i + 1] = pre[i] + src[i];
    for (let i = 0; i < frames; i++) {
      const lo = Math.max(0, i - W);
      const hi = Math.min(frames - 1, i + W);
      out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
    }
    return out;
  };
  const scx = mean(mean(mean(cx)));
  const scy = mean(mean(mean(cy)));

  // 3) ángulo por fotograma: transición muy lenta entre los ángulos de cada tramo, más un vaivén sutil
  const segStarts = plan.segments.map((sg) => sg.start);
  const az = new Float64Array(frames);
  const el = new Float64Array(frames);
  {
    const first = plan.segments[0] ? SHOTS[plan.segments[0].shot] : SHOTS.front;
    const cur = st.cameraDirector
      ? { ...first }
      : { az: st.cameraAzimuth, el: Math.max(5, Math.min(60, st.cameraElevation - 30)) };
    const kk = 1 - Math.exp(-dtc / 3);
    for (let i = 0; i < frames; i++) {
      const t = i * dtc;
      if (st.cameraDirector) {
        const seg = plan.segments[Math.max(0, lastIndex(segStarts, t))];
        const want = SHOTS[seg.shot];
        cur.az += (want.az - cur.az) * kk;
        cur.el += (want.el - cur.el) * kk;
      }
      const swayA = st.cameraDirector ? 3 * Math.sin((2 * Math.PI * t) / 19) : 0;
      const swayE = st.cameraDirector ? 1.5 * Math.sin((2 * Math.PI * t) / 27 + 1) : 0;
      az[i] = ((cur.az + swayA) * Math.PI) / 180;
      el[i] = ((cur.el + swayE) * Math.PI) / 180;
    }
  }

  // 4) distancia fija: la mínima que deja dentro del encuadre a todos los puntos en todos los fotogramas
  const dir = (i: number): V3 => [
    Math.sin(az[i]) * Math.cos(el[i]),
    Math.sin(el[i]),
    Math.cos(az[i]) * Math.cos(el[i]),
  ];
  const lookAt = (i: number, dist: number): V3 => [scx[i], scy[i] - DOWN * dist * tanV, 0];
  const needed = (dist0: number): number => {
    let req = 4;
    for (let i = 0; i < frames; i++) {
      const d = dir(i);
      const fw: V3 = [-d[0], -d[1], -d[2]];
      const rt: V3 = norm([-fw[2], 0, fw[0]]);
      const upv: V3 = [
        rt[1] * fw[2] - rt[2] * fw[1],
        rt[2] * fw[0] - rt[0] * fw[2],
        rt[0] * fw[1] - rt[1] * fw[0],
      ];
      const look = lookAt(i, dist0);
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
    }
    return req;
  };
  let dist = needed(8);
  dist = Math.max(dist, needed(dist)) * 1.03;
  if (!st.cameraDirector) dist = Math.max(dist, (st.cameraDistance / 13) * 8);
  for (let i = 0; i < frames; i++) {
    const d = dir(i);
    const look = lookAt(i, dist);
    cam.set(
      [look[0] + dist * d[0], look[1] + dist * d[1], look[2] + dist * d[2], look[0], look[1], look[2], FOV],
      i * 7,
    );
  }
  return { cam, dist };
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

/** Intensidad de los golpes fuertes recientes (0..1); sirve para efectos sutiles, la cámara no vibra. */
export function shakeAt(plan: CircuitPlan, t: number): number {
  let s = 0;
  const hits = plan.audioHits;
  for (let i = lastIndex(plan.audioT, t); i >= 0 && t - hits[i].t < 0.35; i--) {
    const a = t - hits[i].t;
    if (hits[i].strength > 0.75) s += (hits[i].strength - 0.75) * 4 * Math.exp(-a / 0.1);
  }
  return Math.min(1, s);
}
