// Planificador del Circuito 3D: un marble run de pared hecho solo de teclas de piano y carriles.
//
// La bola sigue un trazado fluido que va de un lado a otro de la pared según las frases del MIDI: en cada
// frase lleva un rumbo (más o menos horizontal) y entre frases lo cambia con una curva suave. Cómo salta
// lo decide el ritmo:
//  - notas muy seguidas: zigzag entre dos hileras de teclas inclinadas hacia dentro (un "pozo"); en los
//    pasajes rápidos largos las hileras se vuelven paredes rectas con barra un rato, y luego se sueltan;
//  - notas a ritmo medio: salta de tecla en tecla avanzando en horizontal y bajando poco a poco;
//  - notas lejanas: un carril recto e inclinado por el que rueda; al llegar al borde una curva en U la
//    lleva al carril de vuelta (como en los marble runs), y al final sale volando hasta la tecla siguiente.
// Las teclas quedan sueltas pero colocadas con intención (curvas, tramos rectos solo a ratos, pequeñas
// variaciones de ángulo). Todo llega exacto a cada nota. Sin WebGL: se prueba en Node.
// Unidades: 1 ≈ el largo de una tecla. y hacia arriba, z hacia la cámara (la pared está en z = WALL_Z).
import type { RGB } from '../color.ts';
import { noteName } from '../music/names.ts';
import { mergeBallHits, splitHitsIntoBalls } from '../music/voices.ts';
import { lastIndex, rnd } from '../scene/draw.ts';
import { hitColors, startColor, type SceneStyle } from '../scene/style.ts';
import type { Hit } from '../types.ts';

export type V3 = [number, number, number];

export interface Piece {
  kind: 'key';
  ball: number;
  k: number; // índice del choque dentro de su bola
  t: number;
  P: V3; // centro de la bola en el choque
  n: V3; // normal de la cara superior de la tecla
  tip: 1 | -1; // lado hacia el que se inclina la tecla (en el pozo, hacia dentro)
  size: number; // largo de la tecla
  black: boolean; // tecla negra (sostenido)
  shaft: boolean; // tecla de una pared del pozo
  col: RGB;
  name: string;
  strength: number;
}

/** Carril por el que rueda una bola entre dos notas lejanas (rectas inclinadas y curvas en U). */
export interface Rail {
  ball: number;
  k: number; // intervalo (entre el choque k y el k+1)
  tA: number; // entra en el carril
  tB: number; // lo deja
  pts: V3[]; // centro de la bola a lo largo del carril
  times: number[]; // instante en cada punto (absoluto)
  turns: [number, number][]; // tramos de curva en U: índices [desde, hasta] de las muestras
}

/** Pozo: dos paredes de teclas entre las que rebota la bola. */
export interface Shaft {
  ball: number;
  xL: number; // posición de la barra de la pared izquierda
  xR: number;
  yTop: number;
  yBottom: number;
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

export interface CircuitPlan {
  kind: 'platforms3d';
  duration: number;
  r: number;
  balls: BallPlan[];
  pieces: Piece[];
  rails: Rail[];
  shafts: Shaft[];
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
const G0 = 14; // gravedad "real" (unidades/s²) con gravity = 1
/** notas separadas como mucho esto van en un pozo de dos paredes */
export const FAST_DT = 0.3;
/** a partir de esta separación entre notas la bola va por carril */
export const RAIL_DT = 0.9;
const RAIL_IN = 0.25; // s del salto desde la tecla al carril
const RAIL_OUT = 0.22; // s de la salida del carril a la tecla
const RAIL_VMAX = 4.5; // unidades/s
const RAIL_MU = 0.1; // rozamiento al rodar
const U_RADIUS = 0.34; // radio de las curvas en U
const WAVE_AMP = 0.2; // amplitud de las ondas de las tuberías
const WAVE_LEN = 2.4; // longitud de onda (unidades de avance)
const SHAFT_GAP = 1.3; // distancia horizontal entre los puntos de contacto de las dos hileras
const SHAFT_TILT = 38; // inclinación (grados) de las teclas del pozo hacia dentro
const KEY_LEN_WHITE = 1.3;
const KEY_LEN_BLACK = 0.9;
/** separación mínima entre teclas para que no se pisen en pantalla (horizontal o vertical) */
const KEY_MIN_DX = 0.6;
const KEY_MIN_DY = 0.9;

const sr = (seed: number, k: number) => rnd(seed * 0.173 + 1, k + 0.5);
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface RailBuild {
  rail: Omit<Rail, 'ball' | 'k'>;
  vOut: V3; // velocidad al dejar la tecla k
  exit: { p: V3; v: V3; g: number };
  vinNext: V3; // velocidad al llegar a la tecla k+1
  Pn: V3; // dónde cae la bola (tecla k+1)
  dir: 1 | -1; // sentido de avance al salir
}

/**
 * Construye el carril desde la tecla k (Pk, instante tk, avanzando en `dir`) hasta la nota siguiente (tn):
 * rectas inclinadas y curvas en U al llegar al borde; el carril termina justo cuando toca salir volando
 * hacia la tecla siguiente, que se coloca donde cae la bola.
 */
function buildRail(
  Pk: V3,
  tk: number,
  tn: number,
  dirIn: 1 | -1,
  bounds: { lo: number; hi: number },
  g0: number,
  alphaDeg: number,
  zNext: number,
): RailBuild {
  const tA = tk + RAIL_IN;
  const tB = tn - RAIL_OUT;
  const D = Math.max(0.1, tB - tA);
  let dir0 = dirIn;
  // si la tecla está ya junto al borde, el carril arranca hacia el centro
  if (dir0 > 0 ? Pk[0] > bounds.hi - 1.4 : Pk[0] < bounds.lo + 1.4) dir0 = (dir0 * -1) as 1 | -1;
  const A: V3 = [Pk[0] + 0.45 * dir0, Pk[1] - 0.45, Pk[2]];
  const vOut: V3 = [(A[0] - Pk[0]) / RAIL_IN, (A[1] - Pk[1] + 0.5 * g0 * RAIL_IN * RAIL_IN) / RAIL_IN, 0];
  const vA: V3 = [vOut[0], vOut[1] - g0 * RAIL_IN, 0];
  let v = clamp(Math.hypot(vA[0], vA[1]), 1.6, 3.2);
  const alpha = (clamp(alphaDeg, 10, 55) * Math.PI) / 180; // inclinación de las rectas
  const ds = 0.04;
  const pts: V3[] = [A];
  const times: number[] = [tA];
  const turns: [number, number][] = [];
  let x = A[0];
  let y = A[1];
  let dir = dir0;
  let t = tA;
  const zA = A[2];
  const zStep = (zNext - zA) / Math.max(1, D); // la profundidad cambia muy despacio a lo largo del carril
  const accel = (tx: number, ty: number) => {
    // tangente unitaria (tx, ty): aceleración al rodar con rozamiento, acotada por una velocidad máxima
    const sinA = -ty;
    const cosA = Math.abs(tx);
    return g0 * (5 / 7) * (sinA - RAIL_MU * cosA);
  };
  const push = (nx: number, ny: number, tx: number, ty: number) => {
    const a = accel(tx, ty);
    v = clamp(Math.sqrt(Math.max(0.6, v * v + 2 * a * ds)), 1.4, RAIL_VMAX);
    t += ds / v;
    x = nx;
    y = ny;
    pts.push([x, y, zA + zStep * (t - tA)]);
    times.push(t);
  };
  // margen en el borde para que la tecla de llegada quepa dentro del circuito
  const margin = Math.min(1.1, 0.25 * (bounds.hi - bounds.lo));
  const edge = (d: 1 | -1) => (d > 0 ? bounds.hi - margin : bounds.lo + margin);
  let guard = 0;
  let endTangent: [number, number] = [dir * Math.cos(alpha), -Math.sin(alpha)];
  let wavePhase = Math.PI * 2 * rnd(Math.round(Pk[0] * 7) + 17, Math.round(Pk[1] * 10)); // cada tubería ondula distinto
  while (t < tB && guard++ < 20000) {
    // tramo ondulado hasta el borde (o hasta que se acabe el tiempo): baja con la pendiente media y
    // ondea arriba y abajo (la bola frena en las crestas y corre en los valles)
    const slopeT = Math.tan(alpha);
    const kw = (2 * Math.PI) / WAVE_LEN;
    const y0w = y;
    let u = 0;
    while (t < tB && dir * x < dir * edge(dir)) {
      const du = ds * Math.cos(alpha);
      u += du;
      const ny = y0w - slopeT * u + WAVE_AMP * (Math.sin(kw * u + wavePhase) - Math.sin(wavePhase));
      const dy = -slopeT + WAVE_AMP * kw * Math.cos(kw * u + wavePhase);
      const l = Math.hypot(1, dy);
      const tx = dir / l;
      const ty = dy / l;
      push(x + dir * du, ny, tx, ty);
      endTangent = [tx, ty];
    }
    wavePhase += kw * u + Math.PI; // la siguiente tubería arranca donde quedó la onda
    if (t >= tB) break;
    // ¿queda tiempo para una curva en U entera y algo de recta después? si no, termina aquí
    const uTime = (Math.PI * U_RADIUS) / Math.max(1, v);
    if (tB - t < uTime + 0.25) break;
    // curva en U hacia abajo: de avanzar en `dir` a avanzar en -dir
    const cx = x;
    const cy = y - U_RADIUS;
    const steps = Math.max(8, Math.round((Math.PI * U_RADIUS) / ds));
    const turnStart = pts.length - 1;
    for (let i = 1; i <= steps && t < tB; i++) {
      const th = Math.PI / 2 - (Math.PI * i) / steps;
      const nx = cx + dir * U_RADIUS * Math.cos(th);
      const ny = cy + U_RADIUS * Math.sin(th);
      const tx2 = -dir * Math.sin(th);
      const ty2 = Math.cos(th);
      push(nx, ny, tx2, ty2);
      endTangent = [tx2, ty2];
    }
    turns.push([turnStart, pts.length - 1]);
    dir = (dir * -1) as 1 | -1;
    v *= 0.97; // la curva frena un poco
  }
  // (nunca menos de tres muestras: un tramito recto aunque el tiempo fuera mínimo)
  while (pts.length < 3) push(x + endTangent[0] * ds, y + endTangent[1] * ds, endTangent[0], endTangent[1]);
  // el carril acaba donde está la bola cuando toca salir: sale volando con la velocidad que lleva
  const B: V3 = pts[pts.length - 1];
  times[times.length - 1] = tB;
  const vE = Math.max(1.5, v);
  const vExit: V3 = [vE * endTangent[0], vE * endTangent[1], 0];
  const Pn: V3 = [
    B[0] + vExit[0] * RAIL_OUT,
    B[1] + vExit[1] * RAIL_OUT - 0.5 * g0 * RAIL_OUT * RAIL_OUT,
    zNext,
  ];
  // si cae fuera del circuito (salió en plena recta junto al borde), se acorta la salida hacia dentro
  if (Pn[0] > bounds.hi - 0.3 || Pn[0] < bounds.lo + 0.3) {
    Pn[0] = clamp(Pn[0], bounds.lo + 0.3, bounds.hi - 0.3);
    vExit[0] = (Pn[0] - B[0]) / RAIL_OUT;
  }
  const dirOut = (vExit[0] >= 0 ? 1 : -1) as 1 | -1;
  return {
    rail: { tA, tB, pts, times, turns },
    vOut,
    exit: { p: B, v: vExit, g: g0 },
    vinNext: [vExit[0], vExit[1] - g0 * RAIL_OUT, 0],
    Pn,
    dir: dirOut,
  };
}

export function planCircuit(
  hits: Hit[],
  duration: number,
  st: SceneStyle,
  opts: PlanOptions = { minGap: 0.1 },
): CircuitPlan {
  const r = st.ballSize3d;
  const split = splitHitsIntoBalls(hits, { maxBalls: st.maxBalls, minGap: opts.minGap });
  const audioHits = mergeBallHits(split);
  const plan: CircuitPlan = {
    kind: 'platforms3d',
    duration,
    r,
    balls: [],
    pieces: [],
    rails: [],
    shafts: [],
    audioHits,
    audioT: audioHits.map((h) => h.t),
    cam: new Float32Array(0),
    camHz: CAM_HZ,
    camDist: 8,
    startCol: startColor(st),
    wallZ: WALL_Z,
    seed: st.seed,
  };
  const nb = split.length;
  const g0 = G0 * st.gravity;
  const slope = st.pace3d; // factor de pendiente (1 = normal)
  const W = Math.max(1.5, st.spread3d); // semianchura del circuito
  const lenW = KEY_LEN_WHITE * st.tileSize;
  const lenB = KEY_LEN_BLACK * st.tileSize;

  // frases del MIDI: en cada una la bola lleva un rumbo; entre frases lo cambia con una curva suave
  const phraseStarts = (T: number[]): number[] => {
    const out = [0];
    let start = T[0] ?? 0;
    for (let i = 1; i < T.length; i++) {
      const gap = T[i] - T[i - 1];
      if ((gap >= 0.55 && T[i] - start > 1.6) || T[i] - start > 6.5) {
        out.push(i);
        start = T[i];
      }
    }
    return out;
  };

  // con varias bolas, la primera marca el ritmo de bajada y las demás lo siguen (si no, se separan)
  let refT: number[] = [];
  let refY: number[] = [];
  const yRef = (t: number): number | null => {
    if (refT.length < 2) return null;
    const i = Math.max(0, lastIndex(refT, t));
    const j = Math.min(refT.length - 1, i + 1);
    if (j === i) return refY[i];
    const f = clamp((t - refT[i]) / Math.max(1e-6, refT[j] - refT[i]), 0, 1);
    return refY[i] + (refY[j] - refY[i]) * f;
  };

  for (let b = 0; b < nb; b++) {
    const bh = split[b].hits;
    const N = bh.length;
    const T = bh.map((h) => h.t);
    const S = bh.map((h) => h.strength);
    const col = hitColors(bh, st);
    const midis = bh.map((h) => Math.max(...h.notes.map((n) => n.midi)));
    const black = midis.map(isBlack);
    const lens = black.map((bk) => (bk ? lenB : lenW));
    // con varias bolas, cada una tiene su franja horizontal
    const bandW = nb > 1 ? (2 * W) / nb - 0.3 : 2 * W;
    const bandC = nb > 1 ? -W + ((2 * W) / nb) * (b + 0.5) : 0;
    const bounds = { lo: bandC - bandW / 2, hi: bandC + bandW / 2 };
    const shaftLen = clamp((bandW - SHAFT_GAP - 0.5) / 2, 0, lenW);
    const shaftOk = shaftLen >= 0.5;
    const ball: BallPlan = { T, S, col, P: [], fl: [], pre: null, tail: null, pieces: [] };
    plan.balls.push(ball);
    if (!N) continue;
    const depth = (k: number) => 0.12 * (rnd(k + 11, b + st.seed) - 0.5);

    // ---- rumbo por frases: u ∈ [-1, 1] es la parte horizontal del avance (signo = lado) ----
    const phrases = phraseStarts(T);
    const uOf: number[] = new Array(N).fill(0); // rumbo "deseado" en cada choque (sin suavizar)
    {
      let lastSign = sr(st.seed, b + 3) < 0.5 ? 1 : -1;
      let cx = bandC - lastSign * bandW * 0.3;
      for (let pi = 0; pi < phrases.length; pi++) {
        const k0 = phrases[pi];
        const k1 = pi + 1 < phrases.length ? phrases[pi + 1] : N;
        // lado: hacia el centro si estamos cerca de un borde; si no, alterna
        let sign = Math.abs(cx - bandC) > 0.3 * bandW ? -Math.sign(cx - bandC) : -lastSign;
        if (sign === 0) sign = -lastSign;
        const mag = 0.45 + 0.5 * sr(st.seed + 11, k0 + b * 1000);
        for (let k = k0; k < k1; k++) uOf[k] = sign * mag;
        // estimación del avance de la frase para decidir el lado de la siguiente
        let adv = 0;
        for (let k = k0; k < k1 - 1; k++) adv += clamp(1.9 * (T[k + 1] - T[k]), 0.5, 1.5) * mag;
        cx += sign * Math.min(adv, bandW * 0.8);
        cx = clamp(cx, bounds.lo, bounds.hi);
        lastSign = sign;
      }
    }

    // ---- estado del recorrido ----
    let dir: 1 | -1 = uOf[0] >= 0 ? 1 : -1;
    let u = uOf[0]; // rumbo suavizado
    const x0 = bandC - dir * bandW * 0.3;
    const y0 = yRef(T[0]) ?? 0; // las bolas secundarias entran a la altura que lleva la primera
    // caída inicial: entra por arriba (fuera de plano) y llega a la primera tecla justo en su nota
    const D0 = 4.5;
    let gPre = g0;
    let tf = Math.sqrt((2 * D0) / gPre);
    if (tf > T[0]) {
      tf = T[0];
      gPre = (2 * D0) / (tf * tf);
    }
    ball.pre = { tRel: T[0] - tf, g: gPre, from: [x0, y0 + D0, depth(0)] };
    const P: V3[] = [[x0, y0, depth(0)]];
    const vins: V3[] = [[0, -gPre * tf, 0]];
    const vouts: V3[] = [];
    const tips: (1 | -1)[] = [];
    const inShaft: boolean[] = [];
    const railAt: (RailBuild | null)[] = [];
    let shaft: { start: number; side: 1 | -1; xs: number[]; fixedUntil: number } | null = null;
    const closeShaft = (k: number) => {
      if (!shaft) return;
      // barras solo en la parte recta del pozo (mientras el centro no se movía)
      const fixedKeys = shaft.xs.filter((_, i) => T[shaft!.start + i] <= shaft!.fixedUntil);
      if (fixedKeys.length >= 6) {
        const xs = fixedKeys.reduce((a, c) => a + c, 0) / fixedKeys.length;
        const kEnd = shaft.start + fixedKeys.length - 1;
        // las barras van justo por fuera de las dos hileras (las teclas apuntan a la cámara)
        plan.shafts.push({
          ball: b,
          xL: xs - SHAFT_GAP / 2 - 0.32,
          xR: xs + SHAFT_GAP / 2 + 0.32,
          yTop: P[shaft.start][1] + 0.5,
          yBottom: P[Math.min(k, kEnd)][1] - 0.5,
        });
      }
      shaft = null;
    };
    const fastAhead = (k: number) => {
      for (let j = k; j < Math.min(N - 1, k + 3); j++) if (T[j + 1] - T[j] > FAST_DT) return false;
      return k + 3 <= N - 1;
    };

    for (let k = 0; k < N - 1; k++) {
      const dt = T[k + 1] - T[k];
      const [x, y] = P[k];
      const z1 = depth(k + 1);
      // el rumbo se acerca al deseado poco a poco (curvas suaves entre frases)
      u += (uOf[k] - u) * clamp(dt / 0.9, 0.12, 0.6);
      // ---------- carril ----------
      if (dt >= RAIL_DT) {
        closeShaft(k);
        // inclinación: la normal (según la pendiente elegida) o la que haga falta para seguir a la primera bola
        const want = yRef(T[k + 1]);
        let alphaDeg = 20 * clamp(slope, 0.5, 2);
        if (want !== null) {
          const D = Math.max(0.3, dt - RAIL_IN - RAIL_OUT);
          alphaDeg = (Math.asin(clamp((y - want + 0.3) / (3.6 * D), 0.2, 0.8)) * 180) / Math.PI;
        }
        const rb = buildRail(P[k], T[k], T[k + 1], u >= 0 ? 1 : -1, bounds, g0, alphaDeg, z1);
        railAt[k] = rb;
        vouts[k] = rb.vOut;
        tips[k] = rb.dir;
        inShaft[k] = false;
        P.push(rb.Pn);
        vins.push(rb.vinNext);
        dir = rb.dir;
        u = dir * Math.max(0.5, Math.abs(u));
        continue;
      }
      railAt[k] = null;
      // ---------- pozo: zigzag entre dos hileras de teclas inclinadas hacia dentro ----------
      const stayInShaft = shaft && dt <= FAST_DT * 1.25;
      if (shaftOk && (stayInShaft || (dt <= FAST_DT && fastAhead(k)))) {
        if (!shaft) {
          const xs = clamp(
            x + dir * (SHAFT_GAP / 2),
            bounds.lo + SHAFT_GAP / 2 + shaftLen + 0.25,
            bounds.hi - SHAFT_GAP / 2 - shaftLen - 0.25,
          );
          // los primeros segundos el pozo es recto (paredes con barra); después el centro vuelve a fluir
          shaft = { start: k, side: (x < xs ? -1 : 1) as 1 | -1, xs: [xs], fixedUntil: T[k] + 3.5 };
        }
        const fixed = T[k + 1] <= shaft.fixedUntil;
        const prevXs = shaft.xs[shaft.xs.length - 1];
        const xs = fixed
          ? prevXs
          : clamp(
              prevXs + u * 0.55 * dt,
              bounds.lo + SHAFT_GAP / 2 + shaftLen * 0.5 + 0.2,
              bounds.hi - SHAFT_GAP / 2 - shaftLen * 0.5 - 0.2,
            );
        shaft.xs.push(xs);
        const side = (shaft.side * -1) as 1 | -1; // la bola va a la otra hilera
        // un poco de variación lateral para que no sea una cremallera perfecta
        const nx = xs + side * (SHAFT_GAP / 2) + 0.18 * (sr(st.seed + 21, k + b * 333) - 0.5);
        let d = clamp(0.4 + 0.45 * dt, KEY_MIN_DY / 2 + 0.03, 0.58) * clamp(slope, 0.6, 1.6);
        const want = yRef(T[k + 1]);
        if (want !== null) d = clamp(y - want, d, d + 1.0);
        // gravedad del rebote entre hileras: la que deja las teclas inclinadas SHAFT_TILT grados hacia dentro
        const g = clamp((2 * SHAFT_GAP) / (dt * dt * Math.tan((SHAFT_TILT * Math.PI) / 180)), g0, 400);
        const vout: V3 = [(nx - x) / dt, -d / dt + 0.5 * g * dt, (z1 - P[k][2]) / dt];
        vouts[k] = vout;
        tips[k] = (shaft.side * -1) as 1 | -1;
        inShaft[k] = k > shaft.start;
        P.push([nx, y - d, z1]);
        vins.push([vout[0], vout[1] - g * dt, vout[2]]);
        shaft.side = side;
        dir = u >= 0 ? 1 : -1;
        continue;
      }
      closeShaft(k);
      // ---------- rampa: salto de tecla en tecla siguiendo el rumbo ----------
      const hx = clamp(1.9 * dt, 0.5, 1.5) * clamp(st.tileSize, 0.7, 1.4);
      let dx = u * hx + 0.08 * hx * (sr(st.seed + 5, k + b * 777) - 0.5);
      // sin sitio por delante: el rumbo se da la vuelta (curva) y este salto ya va hacia dentro
      if (x + dx > bounds.hi - 0.35 || x + dx < bounds.lo + 0.35) {
        const back = x + dx > bounds.hi - 0.35 ? -1 : 1;
        for (let j = k; j < N; j++) uOf[j] = back * Math.max(0.5, Math.abs(uOf[j]));
        u = back * Math.max(0.35, Math.abs(u) * 0.6);
        dx = u * hx;
        dx = clamp(dx, bounds.lo + 0.35 - x, bounds.hi - 0.35 - x);
      }
      const nx = x + dx;
      let d = Math.max(0.3, 0.36 * Math.abs(dx)) * clamp(slope, 0.5, 2);
      // si la tecla queda casi encima de la anterior (o de la de dos atrás), baja lo bastante para no pisarla
      for (const j of [k, k - 1])
        if (j >= 0 && Math.abs(nx - P[j][0]) < KEY_MIN_DX) d = Math.max(d, KEY_MIN_DY - (P[j][1] - y));
      {
        const want = yRef(T[k + 1]);
        if (want !== null) d = clamp(y - want, d, d + 2.5 + 3 * dt);
      }
      const g = g0;
      const vout: V3 = [(nx - x) / dt, -d / dt + 0.5 * g * dt, (z1 - P[k][2]) / dt];
      vouts[k] = vout;
      tips[k] = dx >= 0 ? 1 : -1;
      inShaft[k] = false;
      dir = dx >= 0 ? 1 : -1;
      P.push([nx, y - d, z1]);
      vins.push([vout[0], vout[1] - g * dt, vout[2]]);
    }
    closeShaft(N - 1);
    // último choque: un par de botes en la tecla y después cae fuera de plano
    {
      const vin = Math.hypot(...vins[N - 1]) || 1;
      vouts[N - 1] = [0, Math.min(vin * 0.6, Math.sqrt(2 * g0 * 0.8)), 0];
      tips[N - 1] = dir;
      inShaft[N - 1] = !!shaft;
      ball.tail = { g: g0, vy0: vouts[N - 1][1], e: 0.5, hold: 1.1 };
    }
    ball.P = P;
    if (b === 0) {
      refT = T.slice();
      refY = P.map((p) => p[1]);
    }
    for (let k = 0; k < N - 1; k++) {
      const rb = railAt[k];
      const dt = T[k + 1] - T[k];
      if (rb) {
        const railIndex = plan.rails.length;
        plan.rails.push({ ball: b, k, ...rb.rail });
        ball.fl.push({ p: P[k], v: vouts[k], g: g0, rail: railIndex, exit: rb.exit });
      } else {
        // la gravedad del salto es la que cumple la parábola planificada
        const vy = vouts[k][1];
        const dy = P[k + 1][1] - P[k][1];
        const g = Math.max(g0 * 0.999, (2 * (vy * dt - dy)) / (dt * dt));
        ball.fl.push({ p: P[k], v: vouts[k], g });
      }
    }
    for (let k = 0; k < N; k++) {
      // todas las teclas van perfectamente alineadas (horizontales): la bola bota en su cara superior
      const n: V3 = [0, 1, 0];
      ball.pieces.push(plan.pieces.length);
      plan.pieces.push({
        kind: 'key',
        ball: b,
        k,
        t: T[k],
        P: P[k],
        n,
        tip: tips[k],
        size: inShaft[k] ? shaftLen * (black[k] ? 0.6 : 0.78) : lens[k],
        black: black[k],
        shaft: inShaft[k],
        col: col[k],
        name: bh[k].notes.length ? noteName(bh[k].notes[0].midi) : '',
        strength: S[k],
      });
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

/** Índice (fraccionario) de la muestra del carril en la que está la bola en el instante t. */
export function railIndexAt(rail: Rail, t: number): number {
  const { times } = rail;
  const n = times.length;
  if (t <= times[0]) return 0;
  if (t >= times[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - times[lo]) / Math.max(1e-9, times[hi] - times[lo]);
}

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

/**
 * Cámara frontal a distancia fija (sin zoom) que sigue a las bolas con suavidad para que queden siempre
 * en la zona central de la pantalla. Se calcula entera por adelantado: el centro es la posición de las
 * bolas filtrada tres veces con una ventana simétrica (sigue sin retraso ni tirones y no tiembla con cada
 * salto), y la distancia es fija: la que da el encuadre elegido, o más si hiciera falta para que ninguna
 * bola se salga.
 */
function planCamera(plan: CircuitPlan, st: SceneStyle): { cam: Float32Array; dist: number } {
  const HZ = CAM_HZ;
  const frames = Math.ceil(plan.duration * HZ) + 2;
  const cam = new Float32Array(frames * 7);
  const dtc = 1 / HZ;
  const FOV = 36;
  const aspect = 9 / 16;
  const tanV = Math.tan((FOV * Math.PI) / 360);
  const tanH = tanV * aspect;
  const SAFE = 0.92;
  const DOWN = 0.1; // el punto de mira queda un pelín por debajo de las bolas: se ve hacia dónde van
  const FRAME_W = 5.2; // anchura del encuadre (unidades) con "Distancia de cámara" = 1

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
      list.push(p[0], p[1], p[2], plan.r + 0.6);
      const k = lastIndex(b.T, t);
      const j = k + 1;
      if (j < b.T.length && b.T[j] - t < 0.6) extra.push(b.P[j][0], b.P[j][1], b.P[j][2], 0.3);
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
  const W = Math.round(0.3 * HZ);
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

  // 3) ángulo: frontal (con el giro y la altura elegidos) y, si se quiere, un vaivén muy sutil
  const az = new Float64Array(frames);
  const el = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i * dtc;
    const swayA = st.cameraDirector ? 2.5 * Math.sin((2 * Math.PI * t) / 23) : 0;
    const swayE = st.cameraDirector ? 1.2 * Math.sin((2 * Math.PI * t) / 31 + 1) : 0;
    az[i] = ((st.cameraAzimuth + swayA) * Math.PI) / 180;
    el[i] = ((st.cameraElevation + swayE) * Math.PI) / 180;
  }

  // 4) distancia fija: la mínima que deja dentro del encuadre a todos los puntos en todos los fotogramas
  const dir = (i: number): V3 => [
    Math.sin(az[i]) * Math.cos(el[i]),
    Math.sin(el[i]),
    Math.cos(az[i]) * Math.cos(el[i]),
  ];
  const lookAt = (i: number, dist: number): V3 => [scx[i], scy[i] - DOWN * dist * tanV, 0];
  const needed = (dist0: number): number => {
    let req = 6;
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
  const base = FRAME_W / (2 * tanH);
  let dist = Math.max(base, needed(base));
  dist = Math.max(dist, needed(dist)) * 1.03 * clamp(st.cameraDistance, 0.5, 3);
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

/** Hundimiento de una tecla tras el golpe: muelle amortiguado (unidades a lo largo de -normal). */
export function recoilAt(age: number, strength: number, amount: number): number {
  if (age < 0 || age > 1.2) return 0;
  return amount * (0.06 + 0.07 * strength) * Math.exp(-age / 0.16) * Math.cos(26 * age);
}
