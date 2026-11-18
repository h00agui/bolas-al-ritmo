// Modo Plataformas: la bola baja a saltos por plataformas inclinadas colocadas donde cae en cada
// nota. La cámara la sigue. Cada plataforma lleva el color (y el nombre) de su nota.
import { mix, rgba, type RGB } from '../color.ts';
import { noteName } from '../music/names.ts';
import { VIDEO_H as H, VIDEO_W as W } from '../types.ts';
import type { Hit } from '../types.ts';
import {
  background,
  drawBall,
  drawHud,
  drawRipple,
  drawSparks,
  drawTrail,
  FONT,
  frameTime,
  fxBlend,
  lastIndex,
  rnd,
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

export interface PlatformsPlan {
  kind: 'platforms';
  N: number;
  T: number[];
  S: number[];
  names: string[];
  col: RGB[];
  startCol: RGB;
  duration: number;
  r: number[]; // radio de la bola en cada choque
  r0: number;
  P: [number, number][]; // centro de la bola en cada choque (mundo)
  n: [number, number][]; // normal de cada plataforma (hacia la bola)
  fl: Flight[]; // vuelo k -> k+1
  pre: { tRel: number; g: number; x: number } | null; // caída inicial desde y = 0
  tail: { g: number; vy0: number; e: number } | null; // botes finales sobre la última plataforma
  cam: Float32Array; // altura de la cámara (mundo) muestreada a CAM_HZ
  camHz: number;
  platformLength: number;
  platformThickness: number;
}

const CAM_HZ = 60;
const CAM_ANCHOR = 0.56; // fracción de la pantalla donde está el "suelo" de la bola

export function planPlatforms(hits: Hit[], duration: number, st: SceneStyle): PlatformsPlan {
  const N = hits.length;
  const T = hits.map((h) => h.t);
  const S = hits.map((h) => h.strength);
  const r0 = st.ballStart;
  const r1 = Math.max(st.ballStart, st.ballEnd);
  const r = T.map((_, k) => r0 * Math.pow(r1 / r0, (k + 1) / Math.max(1, N)));
  const plan: PlatformsPlan = {
    kind: 'platforms',
    N,
    T,
    S,
    r,
    r0,
    duration,
    names: hits.map((h) => (h.notes.length ? noteName(h.notes[0].midi) : '')),
    col: hitColors(hits, st),
    startCol: startColor(st),
    P: [],
    n: [],
    fl: [],
    pre: null,
    tail: null,
    cam: new Float32Array(0),
    camHz: CAM_HZ,
    platformLength: st.platformLength,
    platformThickness: st.platformThickness,
  };
  if (!N) {
    plan.cam = new Float32Array(Math.ceil(duration * CAM_HZ) + 2).fill(-CAM_ANCHOR * H);
    return plan;
  }
  // caída inicial: desde y = 0 hasta el primer choque, unos 480 px
  const D0 = 480;
  let g0 = 6000 * st.gravity;
  let tf = Math.sqrt((2 * D0) / g0);
  if (tf > T[0]) {
    tf = T[0];
    g0 = (2 * D0) / (tf * tf);
  }
  plan.pre = { tRel: T[0] - tf, g: g0, x: W / 2 };
  const P0: [number, number] = [W / 2, D0];
  const L = st.platformLength;
  const th = st.platformThickness;
  const xMin = W * (0.5 - st.spread / 2) + L / 2;
  const xMax = W * (0.5 + st.spread / 2) - L / 2;

  interface Node {
    x: number;
    y: number;
    vinx: number; // velocidad de llegada a este choque
    viny: number;
    nx: number; // normal elegida en este choque (se fija al elegir la salida)
    ny: number;
    ox: number; // velocidad de salida
    oy: number;
    g: number;
    cost: number;
    parent: number;
    dx: number; // desplazamiento horizontal del vuelo que llegó a este choque
  }
  const DX = 21;
  const DYF = [-0.35, 0, 0.3, 0.6, 0.85, 1, 1.2, 1.5, 1.9, 2.4];
  const BEAM = N > 240 ? 20 : 32;
  let beam: Node[] = [
    {
      x: P0[0],
      y: P0[1],
      vinx: 0,
      viny: g0 * tf,
      nx: 0,
      ny: -1,
      ox: 0,
      oy: 0,
      g: g0,
      cost: 0,
      parent: -1,
      dx: 0,
    },
  ];
  const steps: Node[][] = [beam];
  const platsOf = (node: Node, k: number): { x: number; y: number; nx: number; ny: number }[] => {
    // plataformas anteriores (hasta 10) siguiendo los padres
    const out: { x: number; y: number; nx: number; ny: number }[] = [];
    let cur: Node | undefined = node;
    let kk = k;
    while (cur && out.length < 10 && kk >= 1) {
      const parent: Node = steps[kk - 1][cur.parent];
      out.push({ x: parent.x, y: parent.y, nx: parent.nx, ny: parent.ny });
      cur = parent;
      kk--;
    }
    return out;
  };
  for (let k = 0; k < N - 1; k++) {
    const dt = T[k + 1] - T[k];
    const rb = r[k];
    const hop = Math.max(50, Math.min(230, 165 * Math.sqrt(dt / 0.4)));
    const g = Math.max(1200, Math.min(80000, ((8 * hop) / (dt * dt)) * st.gravity));
    const dyBase = Math.max(8, st.descent * dt);
    const maxDx = Math.max(70, Math.min(1400 * dt, (xMax - xMin) * 0.6));
    const cand: Node[] = [];
    for (let si = 0; si < beam.length; si++) {
      const s = beam[si];
      const prev = platsOf(s, k);
      for (let a = 0; a < DX; a++) {
        const dx = maxDx * ((2 * a) / (DX - 1) - 1);
        const nx2 = s.x + dx;
        if (nx2 < xMin || nx2 > xMax) continue;
        for (const f of DYF) {
          const dy = dyBase * f;
          const ox = dx / dt;
          const oy = dy / dt - 0.5 * g * dt;
          // reflexión en este choque: normal y restitución que explican el cambio de velocidad
          const ddx = ox - s.vinx;
          const ddy = oy - s.viny;
          const dm = Math.hypot(ddx, ddy);
          if (dm < 1) continue;
          const nx = ddx / dm;
          const ny = ddy / dm;
          if (ny > -0.2) continue; // la plataforma tiene que mirar hacia arriba
          const vn = s.vinx * nx + s.viny * ny;
          if (vn > -1) continue; // tiene que llegar contra la plataforma
          const e = dm / -vn - 1;
          if (e < 0.35 || e > 1.9) continue;
          // el vuelo no atraviesa plataformas anteriores
          let ok = true;
          for (let i = 1; i <= 12 && ok; i++) {
            const tau = (dt * i) / 12;
            const px = s.x + ox * tau;
            const py = s.y + oy * tau + 0.5 * g * tau * tau;
            for (const p of prev) {
              const tx = -p.ny;
              const ty = p.nx;
              const u = (px - p.x) * tx + (py - p.y) * ty;
              const v = (px - p.x) * p.nx + (py - p.y) * p.ny + rb; // centro de la plataforma está a rb por debajo del centro de la bola
              if (Math.abs(u) < L / 2 + rb && Math.abs(v) < th / 2 + rb) {
                ok = false;
                break;
              }
            }
          }
          if (!ok) continue;
          let c = ((e - 0.85) / 0.3) ** 2 + 0.6 * (nx / 0.9) ** 2;
          c += ((dy - dyBase) / (0.6 * dyBase)) ** 2;
          c += 0.5 * ((Math.abs(dx) - 0.55 * maxDx) / (0.5 * maxDx)) ** 2;
          const edge = Math.min(nx2 - xMin, xMax - nx2) / (xMax - xMin);
          if (edge < 0.12) c += ((0.12 - edge) / 0.06) ** 2;
          // en zigzag (escalera) salvo que el caos diga otra cosa
          if (Math.abs(s.dx) > 1 && Math.sign(dx) === Math.sign(s.dx)) c += 0.9 * (1 - st.chaos);
          c += 1.5 * st.chaos * rnd(k + 1, a * 10 + f);
          c += 1e-7 * (a + f);
          cand.push({
            x: nx2,
            y: s.y + dy,
            vinx: ox,
            viny: oy + g * dt,
            nx: 0,
            ny: -1,
            ox: 0,
            oy: 0,
            g,
            cost: s.cost + c,
            parent: si,
            dx,
          });
          // la normal y la salida pertenecen al choque k (al nodo padre): se guardan en el candidato para fijarlas al elegir
          const last = cand[cand.length - 1];
          (last as Node & { pnx: number; pny: number; pox: number; poy: number }).pnx = nx;
          (last as Node & { pnx: number; pny: number }).pny = ny;
          (last as Node & { pox: number }).pox = ox;
          (last as Node & { poy: number }).poy = oy;
        }
      }
    }
    if (!cand.length) {
      // sin salida válida: caída recta (no debería pasar; evita romper el plan)
      const s = beam[0];
      cand.push({
        x: s.x,
        y: s.y + dyBase,
        vinx: 0,
        viny: g * dt,
        nx: 0,
        ny: -1,
        ox: 0,
        oy: dyBase / dt - 0.5 * g * dt,
        g,
        cost: s.cost + 50,
        parent: 0,
        dx: 0,
      });
      const last = cand[0] as Node & { pnx: number; pny: number; pox: number; poy: number };
      last.pnx = 0;
      last.pny = -1;
      last.pox = 0;
      last.poy = dyBase / dt - 0.5 * g * dt;
    }
    cand.sort((a, b) => a.cost - b.cost);
    const seen = new Set<string>();
    const next: Node[] = [];
    for (const c of cand) {
      const key = `${Math.round(c.x / 40)}:${Math.round(c.y / 25)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(c);
      if (next.length >= BEAM) break;
    }
    beam = next;
    steps.push(beam);
  }
  // mejor camino hacia atrás, fijando normal y salida de cada choque desde el hijo elegido
  const path: Node[] = new Array(N);
  let idx = 0;
  for (let k = N - 1; k >= 0; k--) {
    path[k] = steps[k][idx];
    idx = path[k].parent;
  }
  for (let k = 0; k < N - 1; k++) {
    const child = path[k + 1] as Node & { pnx: number; pny: number; pox: number; poy: number };
    path[k].nx = child.pnx;
    path[k].ny = child.pny;
    path[k].ox = child.pox;
    path[k].oy = child.poy;
  }
  // último choque: rebote vertical amortiguado sobre su plataforma
  const lastN = path[N - 1];
  {
    const vin = Math.hypot(lastN.vinx, lastN.viny) || 1;
    const dt = N > 1 ? T[N - 1] - T[N - 2] : 0.5;
    const g = Math.max(1200, Math.min(80000, ((8 * 120) / (dt * dt)) * st.gravity));
    lastN.nx = 0;
    lastN.ny = -1;
    lastN.ox = 0;
    lastN.oy = -Math.min(vin * 0.8, Math.sqrt(2 * g * 140));
    plan.tail = { g, vy0: lastN.oy, e: 0.55 };
  }
  plan.P = path.map((p) => [p.x, p.y]);
  plan.n = path.map((p) => [p.nx, p.ny]);
  for (let k = 0; k < N - 1; k++)
    plan.fl.push({ px: path[k].x, py: path[k].y, vx: path[k].ox, vy: path[k].oy, g: path[k + 1].g });
  // cámara: sigue el "suelo" (altura de los choques) con un muelle crítico, solo hacia abajo
  const frames = Math.ceil(duration * CAM_HZ) + 2;
  const cam = new Float32Array(frames);
  const floorAt = (t: number) => {
    if (t <= T[0]) return P0[1];
    if (t >= T[N - 1]) return plan.P[N - 1][1];
    const k = lastIndex(T, t);
    const f = (t - T[k]) / (T[k + 1] - T[k]);
    return plan.P[k][1] + (plan.P[k + 1][1] - plan.P[k][1]) * f;
  };
  let y = P0[1] - CAM_ANCHOR * H;
  let v = 0;
  const w = 7;
  const dtc = 1 / CAM_HZ;
  for (let i = 0; i < frames; i++) {
    const target = floorAt(i * dtc) - CAM_ANCHOR * H;
    const acc = w * w * (target - y) - 2 * w * v;
    v += acc * dtc;
    const ny = y + v * dtc;
    if (ny < y) v = 0;
    y = Math.max(y, ny);
    cam[i] = y;
  }
  plan.cam = cam;
  return plan;
}

export function cameraY(plan: PlatformsPlan, t: number): number {
  const i = Math.max(0, t * plan.camHz);
  const i0 = Math.min(plan.cam.length - 1, Math.floor(i));
  const i1 = Math.min(plan.cam.length - 1, i0 + 1);
  return plan.cam[i0] + (plan.cam[i1] - plan.cam[i0]) * (i - i0);
}

/** Posición de la bola en coordenadas del mundo. */
export function platformsBallAt(plan: PlatformsPlan, t: number): { x: number; y: number; r: number } {
  const { N, T } = plan;
  if (!N || !plan.pre) return { x: W / 2, y: 0, r: plan.r0 };
  if (t < T[0]) {
    const dt = Math.max(0, t - plan.pre.tRel);
    return { x: plan.pre.x, y: 0.5 * plan.pre.g * dt * dt, r: plan.r0 };
  }
  if (t >= T[N - 1]) {
    const [x0, y0] = plan.P[N - 1];
    const tail = plan.tail!;
    let tau = t - T[N - 1];
    let vy = tail.vy0;
    for (let b = 0; b < 12; b++) {
      const flight = (-2 * vy) / tail.g; // tiempo hasta volver al suelo
      if (tau < flight || flight < 0.02) break;
      tau -= flight;
      vy *= tail.e;
    }
    const yy = y0 + vy * tau + 0.5 * tail.g * tau * tau;
    return { x: x0, y: Math.min(yy, y0), r: plan.r[N - 1] };
  }
  const k = lastIndex(T, t);
  const f = plan.fl[k];
  const tau = t - T[k];
  return { x: f.px + f.vx * tau, y: f.py + f.vy * tau + 0.5 * f.g * tau * tau, r: plan.r[k] };
}

function roundRect(x: Ctx, w: number, h: number, rr: number): void {
  x.beginPath();
  x.moveTo(-w / 2 + rr, -h / 2);
  x.lineTo(w / 2 - rr, -h / 2);
  x.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + rr);
  x.lineTo(w / 2, h / 2 - rr);
  x.quadraticCurveTo(w / 2, h / 2, w / 2 - rr, h / 2);
  x.lineTo(-w / 2 + rr, h / 2);
  x.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - rr);
  x.lineTo(-w / 2, -h / 2 + rr);
  x.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + rr, -h / 2);
  x.closePath();
}

export function drawPlatforms(ctx: Ctx, t: number, plan: PlatformsPlan, st: SceneStyle, env: DrawEnv): void {
  const { N, T } = plan;
  const fps = env.fps;
  const FX = fxBlend(st);
  const dark = FX === 'lighter';
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(background(st, env) as unknown as CanvasImageSource, 0, 0);
  const cam = cameraY(plan, t);
  const k = visibleHit(T, t, fps);
  const col = k >= 0 ? plan.col[k] : plan.startCol;
  const age = k >= 0 ? t - frameTime(T[k], fps) : 99;
  const sk = k >= 0 ? plan.S[k] : 0;

  // puntos de fondo con paralaje para que se note el descenso
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const par = cam * 0.35;
  for (let i = 0; i < 70; i++) {
    const px = rnd(i, 1) * W;
    const py = ((((rnd(i, 2) * H * 2 - par) % (H * 2)) + H * 2) % (H * 2)) - H / 2;
    const rr = 1 + 2.5 * rnd(i, 3);
    ctx.beginPath();
    ctx.arc(px, py, rr, 0, Math.PI * 2);
    ctx.fill();
  }

  const L = plan.platformLength;
  const th = plan.platformThickness;
  // plataformas visibles (pasadas y futuras)
  for (let j = 0; j < N; j++) {
    const [px, py] = plan.P[j];
    const [nx, ny] = plan.n[j];
    const sy = py - cam;
    if (sy < -L || sy > H + L) continue;
    const c = plan.col[j];
    const hitAge = t - frameTime(T[j], fps);
    const lit = j <= k;
    const press = lit ? 7 * Math.exp(-Math.max(0, hitAge) / 0.08) : 0;
    const rb = j ? plan.r[j - 1] : plan.r0;
    const cx = px - nx * rb - nx * press;
    const cy = sy - ny * rb - ny * press;
    const ang = Math.atan2(ny, nx) + Math.PI / 2;
    const widthFactor = 1 + 0.25 * plan.S[j];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    if (lit) {
      ctx.globalCompositeOperation = FX;
      const glow = Math.exp(-Math.max(0, hitAge) / 0.35) * st.glow;
      if (glow > 0.02) {
        ctx.shadowColor = rgba(c, 0.9 * glow);
        ctx.shadowBlur = 40 * glow;
      }
      ctx.globalCompositeOperation = 'source-over';
      roundRect(ctx, L * widthFactor, th, th / 2);
      ctx.fillStyle = rgba(c, 1);
      ctx.fill();
      ctx.shadowBlur = 0;
      // borde superior iluminado
      ctx.fillStyle = rgba(mix(c, [255, 255, 255], 0.55), 0.9);
      ctx.fillRect((-L * widthFactor) / 2 + th / 2, -th / 2, L * widthFactor - th, 3);
    } else {
      roundRect(ctx, L * widthFactor, th, th / 2);
      ctx.fillStyle = rgba(c, dark ? 0.16 : 0.22);
      ctx.fill();
      ctx.strokeStyle = rgba(c, 0.55);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (st.noteNames && plan.names[j]) {
      ctx.font = `700 27px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = lit ? 'rgba(0,0,0,0.65)' : rgba(c, 0.9);
      ctx.fillText(plan.names[j], 0, 1);
    }
    ctx.restore();
  }

  // efectos de impacto de los choques recientes
  ctx.globalCompositeOperation = FX;
  for (let j = Math.max(0, k - 12); j <= k; j++) {
    const aj = t - frameTime(T[j], fps);
    if (aj > 0.7) continue;
    const [px, py] = plan.P[j];
    const [nx, ny] = plan.n[j];
    const rb = j ? plan.r[j - 1] : plan.r0;
    const qx = px - nx * rb;
    const qy = py - cam - ny * rb;
    drawRipple(ctx, qx, qy, plan.col[j], aj, plan.S[j]);
    drawSparks(ctx, qx, qy, Math.atan2(ny, nx), plan.col[j], aj, plan.S[j], st.particles, j);
  }

  // bola
  let b = platformsBallAt(plan, t);
  for (const j of [k, k + 1])
    if (j >= 0 && j < N && Math.abs(t - T[j]) < 0.5 / fps) b = { ...b, x: plan.P[j][0], y: plan.P[j][1] };
  drawTrail(ctx, t, st.trail, (s) => {
    const p = platformsBallAt(plan, s);
    const kk = visibleHit(T, s, fps);
    return { x: p.x, y: p.y - cam, r: p.r, color: kk >= 0 ? plan.col[kk] : plan.startCol };
  });
  const sqAng = k >= 0 ? Math.atan2(plan.n[k][1], plan.n[k][0]) : -Math.PI / 2;
  drawBall(ctx, {
    x: b.x,
    y: b.y - cam,
    r: b.r,
    color: col,
    age,
    strength: sk,
    squashAngle: sqAng,
    style: st,
    blend: FX,
  });

  drawHud(ctx, st, env);
  // contador arriba a la derecha
  if (st.counter) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(mix(col, [255, 255, 255], 0.3), 0.85);
    ctx.font = `700 40px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${Math.max(0, k + 1)} / ${N}`, W - 60, 120);
  }
  ctx.restore();
}

export const platformsMode: Mode<PlatformsPlan> = {
  id: 'platforms',
  name: 'Plataformas',
  description: 'La bola baja a saltos por plataformas que aparecen donde cae cada nota.',
  planKeys: [...COMMON_PLAN_KEYS, 'platformLength', 'platformThickness', 'descent', 'spread'],
  plan: planPlatforms,
  draw: drawPlatforms,
};
