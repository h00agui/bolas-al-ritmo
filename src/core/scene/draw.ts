// Dibujo compartido por los modos: fondo, textos, bola, estela, chispas. Canvas 2D estándar,
// así que funciona igual en el navegador y en Node (@napi-rs/canvas).
import { hexToRgb, luminance, mix, rgba, type RGB } from '../color.ts';
import { VIDEO_H as H, VIDEO_W as W } from '../types.ts';
import type { SceneStyle } from './style.ts';

export type Ctx = CanvasRenderingContext2D;
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Ctx | null;
}

/** Entorno de dibujo: cómo crear lienzos auxiliares, caché y fps (decide en qué fotograma cae cada choque). */
export interface DrawEnv {
  makeCanvas: (w: number, h: number) => CanvasLike;
  cache: Record<string, unknown>;
  fps: number;
}

export const FONT = 'Inter, "Inter Tight", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Modo de mezcla de los efectos de luz: aditivo sobre fondos oscuros, normal sobre claros. */
export function fxBlend(style: SceneStyle): GlobalCompositeOperation {
  const bg = mix(hexToRgb(style.bgTop), hexToRgb(style.bgBottom), 0.5);
  return luminance(bg) > 0.55 ? 'source-over' : 'lighter';
}

/** Ruido determinista 0..1 (para chispas iguales en la web y en el motor). */
export const rnd = (a: number, b: number): number => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Fondo degradado, cacheado por estilo. */
export function background(style: SceneStyle, env: DrawEnv, extra = ''): CanvasLike {
  const key = JSON.stringify([style.bgTop, style.bgBottom, extra]);
  if (env.cache.bgKey === key) return env.cache.bg as CanvasLike;
  const c = (env.cache.bg as CanvasLike | undefined) ?? env.makeCanvas(W, H);
  const x = c.getContext('2d')!;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, style.bgTop);
  g.addColorStop(1, style.bgBottom);
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  env.cache.bg = c;
  env.cache.bgKey = key;
  return c;
}

/** Textos fijos (título, subtítulo, usuario) sobre bandas degradadas para que se lean encima de la escena. */
export function drawHud(x: Ctx, style: SceneStyle, bands = true): void {
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  if (bands && (style.title || style.subtitle)) {
    const top = hexToRgb(style.bgTop);
    const g = x.createLinearGradient(0, 0, 0, 420);
    g.addColorStop(0, rgba(top, 0.95));
    g.addColorStop(0.6, rgba(top, 0.75));
    g.addColorStop(1, rgba(top, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, W, 420);
  }
  if (bands && style.handle) {
    const bottom = hexToRgb(style.bgBottom);
    const g = x.createLinearGradient(0, H - 300, 0, H);
    g.addColorStop(0, rgba(bottom, 0));
    g.addColorStop(1, rgba(bottom, 0.9));
    x.fillStyle = g;
    x.fillRect(0, H - 300, W, 300);
  }
  drawTexts(x, style);
}

export function drawTexts(x: Ctx, style: SceneStyle): void {
  const tc = hexToRgb(style.textColor);
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  if (style.title) {
    x.fillStyle = rgba(tc, 1);
    x.font = `800 92px ${FONT}`;
    x.fillText(style.title, W / 2, 230, W - 100);
  }
  if (style.subtitle) {
    x.fillStyle = rgba(tc, 0.6);
    x.font = `500 44px ${FONT}`;
    x.fillText(style.subtitle, W / 2, style.title ? 300 : 230, W - 100);
  }
  if (style.handle) {
    x.fillStyle = rgba(tc, 0.7);
    x.font = `600 40px ${FONT}`;
    x.fillText(style.handle, W / 2, H - 150, W - 100);
  }
}

export interface BallOpts {
  x: number;
  y: number;
  r: number;
  color: RGB;
  age: number; // s desde el último choque (grande si ninguno)
  strength: number;
  squashAngle: number; // dirección de la normal del choque
  style: SceneStyle;
  blend: GlobalCompositeOperation;
}

/** Bola con halo, aplastamiento y destello al chocar. */
export function drawBall(x: Ctx, o: BallOpts): void {
  const { r, color: col, age, style } = o;
  const boost = 1 + 1.3 * Math.exp(-age / 0.12);
  x.globalCompositeOperation = o.blend;
  const gr = r * 1.6 + 60;
  let g = x.createRadialGradient(o.x, o.y, r * 0.5, o.x, o.y, gr);
  g.addColorStop(0, rgba(col, 0.45 * boost * style.glow));
  g.addColorStop(0.4, rgba(col, 0.14 * boost * style.glow));
  g.addColorStop(1, rgba(col, 0));
  x.fillStyle = g;
  x.beginPath();
  x.arc(o.x, o.y, gr, 0, Math.PI * 2);
  x.fill();
  x.globalCompositeOperation = 'source-over';
  x.save();
  x.translate(o.x, o.y);
  if (age < 0.25) {
    const sq = 0.18 * Math.exp(-age / 0.06) * (0.6 + 0.6 * o.strength);
    x.rotate(o.squashAngle);
    x.scale(1 - sq, 1 + 0.55 * sq);
    x.rotate(-o.squashAngle);
  }
  const fl = 0.7 * Math.exp(-age / 0.05);
  x.fillStyle = rgba(mix(col, [255, 255, 255], fl), 1);
  x.beginPath();
  x.arc(0, 0, r, 0, Math.PI * 2);
  x.fill();
  g = x.createRadialGradient(-r * 0.35, -r * 0.4, 0, -r * 0.35, -r * 0.4, r);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fill();
  if (style.outline) {
    x.strokeStyle = 'rgba(255,255,255,0.8)';
    x.lineWidth = Math.max(2, r * 0.08);
    x.stroke();
  }
  x.restore();
}

/** Chispas que salen del punto de impacto en la dirección de la normal. */
export function drawSparks(
  x: Ctx,
  px: number,
  py: number,
  normalAngle: number,
  color: RGB,
  age: number,
  strength: number,
  amount: number,
  seed: number,
): void {
  if (age < 0 || age > 0.65 || amount <= 0) return;
  const n = Math.round((10 + 8 * strength) * amount);
  const f = age / 0.65;
  for (let i = 0; i < n; i++) {
    const an = normalAngle + (rnd(seed, i) - 0.5) * 2.4;
    const sp = (260 + 620 * rnd(i, seed + 7)) * (0.6 + 0.6 * strength);
    const d = (sp / 4.5) * (1 - Math.exp(-4.5 * age));
    x.fillStyle = rgba(i % 4 === 0 ? [255, 255, 255] : color, (1 - f) ** 1.6);
    x.beginPath();
    x.arc(
      px + d * Math.cos(an),
      py + d * Math.sin(an),
      (2 + 4 * rnd(seed + 3, i)) * (1 - f) + 0.5,
      0,
      Math.PI * 2,
    );
    x.fill();
  }
}

/** Onda circular que se expande desde el impacto. */
export function drawRipple(x: Ctx, px: number, py: number, color: RGB, age: number, strength: number): void {
  if (age < 0 || age > 0.5) return;
  const f = age / 0.5;
  x.strokeStyle = rgba(color, 0.7 * (1 - f) ** 1.5);
  x.lineWidth = 5 * (1 - f) + 1;
  x.beginPath();
  x.arc(px, py, 20 + (80 + 70 * strength) * (1 - (1 - f) ** 3), 0, Math.PI * 2);
  x.stroke();
}

/** Estela: posiciones pasadas de la bola con el color que tenía entonces. */
export function drawTrail(
  x: Ctx,
  t: number,
  seconds: number,
  at: (s: number) => { x: number; y: number; r: number; color: RGB },
): void {
  if (seconds <= 0) return;
  const n = 28;
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const p = at(t - seconds * (1 - f));
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 1.5) continue;
    prev = p;
    x.fillStyle = rgba(p.color, 0.3 * f ** 1.6);
    x.beginPath();
    x.arc(p.x, p.y, p.r * (0.2 + 0.7 * f), 0, Math.PI * 2);
    x.fill();
  }
}

/** Contador grande y tenue en el centro de la escena. */
export function drawCounter(
  x: Ctx,
  cx: number,
  cy: number,
  size: number,
  text: string,
  style: SceneStyle,
): void {
  x.fillStyle = rgba(hexToRgb(style.textColor), 0.13);
  x.font = `800 ${Math.round(size)}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, cx, cy);
}

/** Último índice k con T[k] <= t (búsqueda binaria), -1 si ninguno. */
export function lastIndex(T: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = T.length - 1;
  let r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (T[m] <= t) {
      r = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return r;
}

/** Fotograma en el que "se ve" el choque k: el más cercano a su instante. */
export const frameTime = (t: number, fps: number): number => Math.round(t * fps) / fps;

/** Índice del último choque ya visible en el instante t (teniendo en cuenta el redondeo a fotogramas). */
export function visibleHit(T: ArrayLike<number>, t: number, fps: number): number {
  let k = lastIndex(T, t + 0.5 / fps);
  if (k >= 0 && frameTime(T[k], fps) > t + 1e-6) k--;
  return k;
}
