// Modo Aro: la bola rebota con gravedad dentro de un círculo y crece con cada choque.
import { hexToRgb, mix, rgba, type RGB } from '../color.ts';
import { noteName } from '../music/names.ts';
import { VIDEO_H as H, VIDEO_W as W } from '../types.ts';
import type { Hit } from '../types.ts';
import {
  background,
  drawBall,
  drawCounter,
  drawHud,
  drawRipple,
  drawSparks,
  drawTrail,
  FONT,
  frameTime,
  fxBlend,
  lastIndex,
  visibleHit,
  type Ctx,
  type DrawEnv,
} from '../scene/draw.ts';
import { hitColors, startColor, type SceneStyle } from '../scene/style.ts';
import { COMMON_PLAN_KEYS, type Mode } from './mode.ts';

interface Flight {
  px: number;
  py: number;
  vx: number;
  vy: number;
  g: number;
}

export interface RingPlan {
  kind: 'ring';
  cx: number;
  cy: number;
  R: number;
  rw: number;
  Rin: number;
  N: number;
  T: number[];
  S: number[];
  names: string[];
  r0: number;
  rA: number[];
  ang: number[];
  contact: [number, number][];
  fl: Flight[];
  pre: { tRel: number; y0: number; g: number } | null;
  col: RGB[];
  startCol: RGB;
  duration: number;
}

const pct = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

export function planRing(hits: Hit[], duration: number, st: SceneStyle): RingPlan {
  const cx = W / 2;
  const cy = st.ringY;
  const R = st.ringRadius;
  const rw = st.ringWidth;
  const Rin = R - rw / 2;
  const N = hits.length;
  const T = hits.map((h) => h.t);
  const S = hits.map((h) => h.strength);
  const r0 = st.ballStart;
  const r1 = Math.max(st.ballStart, Math.min(st.ballEnd, Rin * 0.6));
  const rA = T.map((_, k) => r0 * Math.pow(r1 / r0, (k + 1) / Math.max(1, N)));
  const rho0 = Rin - r0;
  const iv = T.slice(1).map((t, k) => t - T[k]);
  const Tref = iv.length ? pct(iv, 0.85) : 0.5;
  const g0 = st.gravity * Math.min((9.6 * rho0) / (Tref * Tref), (2 * 3200) / Tref);
  const plan: RingPlan = {
    kind: 'ring',
    cx,
    cy,
    R,
    rw,
    Rin,
    N,
    T,
    S,
    r0,
    rA,
    duration,
    names: hits.map((h) => (h.notes.length ? noteName(h.notes[0].midi) : '')),
    col: hitColors(hits, st),
    startCol: startColor(st),
    ang: [],
    contact: [],
    fl: [],
    pre: null,
  };
  if (!N) return plan;
  const tf = Math.sqrt((2 * rho0) / g0);
  const pre =
    T[0] >= tf
      ? { tRel: T[0] - tf, y0: cy, g: g0 }
      : { tRel: 0, y0: cy + rho0 - 0.5 * g0 * T[0] ** 2, g: g0 };
  plan.pre = pre;

  const M = N > 220 ? 120 : 180;
  const cs = new Float64Array(M);
  const sn = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    cs[j] = Math.cos((2 * Math.PI * j) / M);
    sn[j] = Math.sin((2 * Math.PI * j) / M);
  }
  const sigA = 0.32 + 0.6 * st.chaos;
  const sigS = 0.45 + 0.4 * st.chaos;
  const VMAX = 5200;
  const VCOMF = 2300;
  const BEAM = N > 220 ? 24 : 40;
  interface Node {
    j: number;
    vx: number;
    vy: number;
    ox: number;
    oy: number;
    g: number;
    cost: number;
    parent: number;
  }
  let beam: Node[] = [
    { j: M / 4, vx: 0, vy: pre.g * (T[0] - pre.tRel), ox: 0, oy: 0, g: g0, cost: 0, parent: -1 },
  ];
  const steps: Node[][] = [beam];
  for (let k = 0; k < N - 1; k++) {
    const rho = Rin - rA[k];
    const Tk = iv[k];
    let g = Math.min((g0 * rho) / rho0, (12.8 * rho) / (Tk * Tk));
    const cand: Node[] = [];
    for (let attempt = 0; attempt < 8 && !cand.length; attempt++, g *= 0.6) {
      if (attempt === 7) g = 0;
      for (let si = 0; si < beam.length; si++) {
        const s = beam[si];
        const nx = cs[s.j];
        const ny = sn[s.j];
        const px = cx + rho * nx;
        const py = cy + rho * ny;
        const d = s.vx * nx + s.vy * ny;
        const rx = s.vx - 2 * d * nx;
        const ry = s.vy - 2 * d * ny;
        const rm = Math.hypot(rx, ry) || 1;
        for (let j = 0; j < M; j++) {
          const vx = (cx + rho * cs[j] - px) / Tk;
          const vy = (cy + rho * sn[j] - py) / Tk - 0.5 * g * Tk;
          const vm = Math.hypot(vx, vy);
          if (vm < 1 || vx * nx + vy * ny > -0.17 * vm) continue;
          const ay = vy + g * Tk;
          const am = Math.hypot(vx, ay);
          if (vx * cs[j] + ay * sn[j] < 0.1 * am) continue;
          let ok = true;
          for (let i = 1; i < 14; i++) {
            const tau = (Tk * i) / 14;
            const xx = px + vx * tau - cx;
            const yy = py + vy * tau + 0.5 * g * tau * tau - cy;
            if (xx * xx + yy * yy > (rho + 1.5) ** 2) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const ang = Math.acos(Math.max(-1, Math.min(1, (vx * rx + vy * ry) / (vm * rm))));
          let c = (ang / sigA) ** 2 + (Math.log(vm / rm) / sigS) ** 2;
          if (vm > VMAX) c += ((vm - VMAX) / 600) ** 2;
          if (vm > VCOMF) c += ((vm - VCOMF) / 1400) ** 2;
          const dj = Math.min(Math.abs(j - s.j), M - Math.abs(j - s.j));
          if (dj <= 2) c += 1.5;
          c += 1e-7 * j;
          cand.push({ j, vx, vy: ay, ox: vx, oy: vy, g, cost: s.cost + c, parent: si });
        }
      }
    }
    cand.sort((a, b) => a.cost - b.cost);
    const seen = new Set<number>();
    const next: Node[] = [];
    for (const c of cand) {
      if (seen.has(c.j)) continue;
      seen.add(c.j);
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
  plan.ang = path.map((p) => (2 * Math.PI * p.j) / M);
  plan.contact = plan.ang.map((a, k) => {
    const rho = Rin - (k ? rA[k - 1] : r0);
    return [cx + rho * Math.cos(a), cy + rho * Math.sin(a)] as [number, number];
  });
  for (let k = 0; k < N - 1; k++) {
    const rho = Rin - rA[k];
    const p = path[k + 1];
    plan.fl.push({
      px: cx + rho * Math.cos(plan.ang[k]),
      py: cy + rho * Math.sin(plan.ang[k]),
      vx: p.ox,
      vy: p.oy,
      g: p.g,
    });
  }
  return plan;
}

export function ringBallAt(plan: RingPlan, t: number): { x: number; y: number; r: number } {
  const { N, T, cx, cy } = plan;
  if (!N || !plan.pre) return { x: cx, y: cy, r: plan.r0 };
  if (t < T[0]) {
    const p = plan.pre;
    const dt = Math.max(0, t - p.tRel);
    return { x: cx, y: p.y0 + 0.5 * p.g * dt * dt, r: plan.r0 };
  }
  if (t >= T[N - 1]) {
    const a = plan.ang[N - 1];
    const r = plan.rA[N - 1];
    const rho = plan.Rin - r;
    const f = Math.min(1, (t - T[N - 1]) / 1.2);
    const e = 1 - (1 - f) ** 3;
    return { x: cx + rho * Math.cos(a) * (1 - e), y: cy + rho * Math.sin(a) * (1 - e), r };
  }
  const k = lastIndex(T, t);
  const f = plan.fl[k];
  const tau = t - T[k];
  return { x: f.px + f.vx * tau, y: f.py + f.vy * tau + 0.5 * f.g * tau * tau, r: plan.rA[k] };
}

export function drawRing(ctx: Ctx, t: number, plan: RingPlan, st: SceneStyle, env: DrawEnv): void {
  const { cx, cy, R, rw, Rin, N, T } = plan;
  const fps = env.fps;
  const FX = fxBlend(st);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(background(st, env) as unknown as CanvasImageSource, 0, 0);
  const k = visibleHit(T, t, fps);
  const col = k >= 0 ? plan.col[k] : plan.startCol;
  const age = k >= 0 ? t - frameTime(T[k], fps) : 99;
  const sk = k >= 0 ? plan.S[k] : 0;

  if (st.counter && k >= 0)
    drawCounter(ctx, cx, cy + R * 0.04, R * 0.62, st.noteNames ? plan.names[k] : String(k + 1), st);

  const ringCol = st.ringMode === 'fijo' ? hexToRgb(st.ringColor) : col;
  const ring = (c: RGB, a: number, w: number) => {
    ctx.strokeStyle = rgba(c, a);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
  };
  ctx.globalCompositeOperation = FX;
  if (st.ringMode !== 'fijo') {
    ring(ringCol, 0.05 * st.glow, rw * 5);
    ring(ringCol, 0.09 * st.glow, rw * 2.6);
    ring(ringCol, 0.18 * st.glow, rw * 1.6);
  }
  ctx.globalCompositeOperation = 'source-over';
  ring(
    st.ringMode === 'fijo' ? ringCol : mix(ringCol, [255, 255, 255], FX === 'lighter' ? 0.15 : 0),
    0.95,
    rw,
  );
  ctx.globalCompositeOperation = FX;
  if (k >= 0) {
    const a = Math.exp(-age / 0.1) * (0.45 + 0.4 * sk);
    if (a > 0.01) {
      if (FX === 'lighter') ring([255, 255, 255], a * 0.6, rw);
      ring(col, a * 0.35 * st.glow, rw * 4);
    }
  }
  for (let j = Math.max(0, k - 20); j <= k; j++) {
    const aj = t - frameTime(T[j], fps);
    if (aj > 1.2) continue;
    const th = plan.ang[j];
    const c = plan.col[j];
    const s = plan.S[j];
    const a = Math.exp(-aj / 0.3);
    const span = (((8 + 6 * s) * Math.PI) / 180) * (1 + 0.5 * (1 - a));
    for (const [w, m] of [
      [rw * 4, 0.25 * st.glow],
      [rw * 1.4, 0.95],
    ] as [number, number][]) {
      ctx.strokeStyle = rgba(mix(c, [255, 255, 255], 0.3), a * m);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(cx, cy, R, th - span, th + span);
      ctx.stroke();
    }
    const qx = cx + Rin * Math.cos(th);
    const qy = cy + Rin * Math.sin(th);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, Rin, 0, Math.PI * 2);
    ctx.clip();
    drawRipple(ctx, qx, qy, c, aj, s);
    ctx.restore();
    drawSparks(ctx, qx, qy, th + Math.PI, c, aj, s, st.particles, j);
    if (st.noteNames && j === k && aj < 0.9 && plan.names[j]) {
      const lx = cx + (R + 60) * Math.cos(th);
      const ly = cy + (R + 60) * Math.sin(th);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(mix(c, [255, 255, 255], 0.4), Math.min(1, 1.2 - aj / 0.9));
      ctx.font = `700 38px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(plan.names[j], lx, ly);
      ctx.globalCompositeOperation = FX;
    }
  }
  let b = ringBallAt(plan, t);
  for (const j of [k, k + 1])
    if (j >= 0 && j < N && Math.abs(t - T[j]) < 0.5 / fps)
      b = { ...b, x: plan.contact[j][0], y: plan.contact[j][1] };
  drawTrail(ctx, t, st.trail, (s) => {
    const p = ringBallAt(plan, s);
    const kk = visibleHit(T, s, fps);
    return { ...p, color: kk >= 0 ? plan.col[kk] : plan.startCol };
  });
  drawBall(ctx, {
    x: b.x,
    y: b.y,
    r: b.r * (1 + 0.1 * sk * Math.exp(-age / 0.07)),
    color: col,
    age,
    strength: sk,
    squashAngle: k >= 0 ? plan.ang[k] : 0,
    style: st,
    blend: FX,
  });
  drawHud(ctx, st, false);
  ctx.restore();
}

export const ringMode: Mode<RingPlan> = {
  id: 'ring',
  name: 'Aro',
  description: 'La bola rebota dentro de un círculo y crece con cada nota.',
  planKeys: [...COMMON_PLAN_KEYS, 'ringY', 'ringRadius', 'ringWidth'],
  plan: planRing,
  draw: drawRing,
};

export const RING_H = H;
