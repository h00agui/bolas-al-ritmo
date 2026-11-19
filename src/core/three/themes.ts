// Temas del fondo del Circuito 3D: texturas generadas al vuelo (degradados, vetas, madera, estrellas…)
// y los colores de luz ambiente que les van bien. Solo necesita un lienzo 2D.
import { rnd } from '../scene/draw.ts';

export interface Theme3D {
  id: string;
  name: string;
  /** color medio (para la luz de rebote y para la vista previa del selector) */
  base: string;
}

export const THEMES_3D: Theme3D[] = [
  { id: 'verde', name: 'Verde fieltro', base: '#3c6e55' },
  { id: 'noche', name: 'Noche estrellada', base: '#141a33' },
  { id: 'estudio', name: 'Estudio claro', base: '#dfe2e8' },
  { id: 'madera', name: 'Madera', base: '#8a5a3a' },
  { id: 'marmol', name: 'Mármol blanco', base: '#ecebe8' },
  { id: 'neon', name: 'Neón', base: '#1a1230' },
  { id: 'pastel', name: 'Pastel', base: '#f6d9dc' },
  { id: 'cielo', name: 'Cielo', base: '#a9d3ff' },
  { id: 'grafito', name: 'Grafito', base: '#24272d' },
  { id: 'arena', name: 'Arena', base: '#e1cfa8' },
  { id: 'oceano', name: 'Océano', base: '#0f5f6e' },
  { id: 'lavanda', name: 'Lavanda', base: '#c9b9f2' },
  { id: 'burdeos', name: 'Burdeos', base: '#5a1f2e' },
  { id: 'menta', name: 'Menta', base: '#bfe8d8' },
  { id: 'personalizado', name: 'Color personalizado', base: '#3c6e55' },
];

export function themeById(id: string): Theme3D {
  return THEMES_3D.find((t) => t.id === id) ?? THEMES_3D[0];
}

type Ctx2D = CanvasRenderingContext2D;

function hexToRgbArr(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const rgbStr = (c: [number, number, number], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (
  a: [number, number, number],
  b: [number, number, number],
  f: number,
): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * f),
  Math.round(a[1] + (b[1] - a[1]) * f),
  Math.round(a[2] + (b[2] - a[2]) * f),
];
const lighten = (c: [number, number, number], f: number) => mix(c, [255, 255, 255], f);
const darken = (c: [number, number, number], f: number) => mix(c, [0, 0, 0], f);

/** Degradado vertical de arriba (más claro) a abajo (más oscuro). */
function gradient(
  x: Ctx2D,
  size: number,
  top: [number, number, number],
  bottom: [number, number, number],
): void {
  const g = x.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, rgbStr(top));
  g.addColorStop(1, rgbStr(bottom));
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
}

/** Grano fino (ruido) con la opacidad dada. */
function grain(x: Ctx2D, size: number, amount: number, seed: number): void {
  const cells = 256;
  const c = document.createElement('canvas');
  c.width = cells;
  c.height = cells;
  const cx = c.getContext('2d')!;
  const img = cx.createImageData(cells, cells);
  for (let i = 0; i < cells * cells; i++) {
    const v = Math.round(255 * rnd(i % cells, ((i / cells) | 0) + seed));
    img.data[4 * i] = v;
    img.data[4 * i + 1] = v;
    img.data[4 * i + 2] = v;
    img.data[4 * i + 3] = Math.round(255 * amount);
  }
  cx.putImageData(img, 0, 0);
  const pat = x.createPattern(c, 'repeat')!;
  x.globalCompositeOperation = 'overlay';
  x.fillStyle = pat;
  x.fillRect(0, 0, size, size);
  x.globalCompositeOperation = 'source-over';
}

/** Viñeta suave en los bordes. */
function vignette(x: Ctx2D, size: number, strength: number): void {
  const g = x.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
}

function glow(x: Ctx2D, cx: number, cy: number, r: number, color: string): void {
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
}

/**
 * Dibuja el fondo de un tema en un lienzo cuadrado. `custom` es el color del tema personalizado.
 * El lienzo cubre toda la pared visible (no se repite), así que los degradados se ven enteros.
 */
export function drawTheme(c: HTMLCanvasElement, id: string, custom: string, seed = 1): void {
  const size = c.width;
  const x = c.getContext('2d')!;
  x.globalCompositeOperation = 'source-over';
  const base = hexToRgbArr(themeById(id).base);
  switch (id) {
    case 'noche': {
      gradient(x, size, [30, 38, 74], [6, 8, 20]);
      glow(x, size * 0.3, size * 0.25, size * 0.45, 'rgba(90,110,200,0.25)');
      for (let i = 0; i < 420; i++) {
        const sx = rnd(i, seed) * size;
        const sy = rnd(i + 1000, seed) * size;
        const r = 0.6 + 1.8 * rnd(i + 2000, seed) ** 3;
        x.fillStyle = `rgba(255,255,255,${0.35 + 0.65 * rnd(i + 3000, seed)})`;
        x.beginPath();
        x.arc(sx, sy, r, 0, Math.PI * 2);
        x.fill();
      }
      grain(x, size, 0.05, seed);
      break;
    }
    case 'estudio':
      gradient(x, size, [238, 240, 244], [196, 200, 208]);
      vignette(x, size, 0.18);
      grain(x, size, 0.05, seed);
      break;
    case 'madera': {
      gradient(x, size, lighten(base, 0.08), darken(base, 0.12));
      // vetas: líneas onduladas más oscuras, y juntas entre tablas
      const boards = 6;
      for (let bI = 0; bI < boards; bI++) {
        const x0 = (bI * size) / boards;
        const w = size / boards;
        const tone = mix(base, [0, 0, 0], 0.1 * rnd(bI, seed));
        x.fillStyle = rgbStr(tone, 0.35);
        x.fillRect(x0, 0, w, size);
        for (let v = 0; v < 26; v++) {
          const amp = 6 + 14 * rnd(v, bI + seed);
          const ph = rnd(v + 50, bI + seed) * Math.PI * 2;
          const fx = x0 + w * (0.05 + 0.9 * rnd(v + 90, bI + seed));
          x.strokeStyle = rgbStr(darken(base, 0.35), 0.1 + 0.2 * rnd(v + 130, bI + seed));
          x.lineWidth = 1 + 3 * rnd(v + 170, bI + seed);
          x.beginPath();
          for (let yy = 0; yy <= size; yy += 12) {
            const xx = fx + amp * Math.sin((yy / size) * Math.PI * 2 * (1 + rnd(v, 3)) + ph);
            if (yy === 0) x.moveTo(xx, yy);
            else x.lineTo(xx, yy);
          }
          x.stroke();
        }
        x.fillStyle = 'rgba(0,0,0,0.35)';
        x.fillRect(x0 - 2, 0, 4, size);
      }
      grain(x, size, 0.08, seed);
      break;
    }
    case 'marmol': {
      gradient(x, size, [246, 245, 242], [226, 224, 220]);
      for (let v = 0; v < 34; v++) {
        x.strokeStyle = `rgba(120,125,135,${0.08 + 0.22 * rnd(v, seed)})`;
        x.lineWidth = 0.8 + 2.4 * rnd(v + 20, seed);
        x.beginPath();
        let px = rnd(v + 40, seed) * size;
        let py = 0;
        x.moveTo(px, py);
        while (py < size) {
          py += 20 + 60 * rnd(v + py, seed);
          px += (rnd(v + py + 7, seed) - 0.5) * 120;
          x.lineTo(px, py);
        }
        x.stroke();
      }
      grain(x, size, 0.04, seed);
      break;
    }
    case 'neon':
      gradient(x, size, [28, 20, 52], [10, 8, 24]);
      glow(x, size * 0.2, size * 0.3, size * 0.5, 'rgba(255,60,200,0.35)');
      glow(x, size * 0.85, size * 0.75, size * 0.55, 'rgba(40,220,255,0.3)');
      grain(x, size, 0.06, seed);
      break;
    case 'pastel':
      gradient(x, size, [255, 221, 226], [255, 236, 205]);
      glow(x, size * 0.75, size * 0.2, size * 0.5, 'rgba(255,255,255,0.35)');
      grain(x, size, 0.04, seed);
      break;
    case 'cielo': {
      gradient(x, size, [120, 180, 255], [222, 240, 255]);
      for (let i = 0; i < 40; i++) {
        const cx = rnd(i, seed) * size;
        const cy = rnd(i + 70, seed) * size;
        const r = size * (0.04 + 0.12 * rnd(i + 140, seed));
        glow(x, cx, cy, r, `rgba(255,255,255,${0.25 + 0.4 * rnd(i + 210, seed)})`);
      }
      break;
    }
    case 'grafito':
      gradient(x, size, [46, 49, 56], [22, 24, 28]);
      vignette(x, size, 0.25);
      grain(x, size, 0.1, seed);
      break;
    case 'arena':
      gradient(x, size, [236, 220, 184], [214, 192, 148]);
      grain(x, size, 0.12, seed);
      break;
    case 'oceano':
      gradient(x, size, [20, 120, 140], [6, 50, 66]);
      glow(x, size * 0.5, size * 0.1, size * 0.6, 'rgba(120,230,230,0.2)');
      grain(x, size, 0.05, seed);
      break;
    case 'lavanda':
      gradient(x, size, [222, 210, 255], [176, 158, 232]);
      glow(x, size * 0.3, size * 0.25, size * 0.5, 'rgba(255,255,255,0.3)');
      grain(x, size, 0.04, seed);
      break;
    case 'burdeos':
      gradient(x, size, [110, 40, 60], [50, 14, 26]);
      vignette(x, size, 0.25);
      grain(x, size, 0.07, seed);
      break;
    case 'menta':
      gradient(x, size, [206, 240, 226], [166, 220, 200]);
      grain(x, size, 0.05, seed);
      break;
    case 'personalizado': {
      const cc = hexToRgbArr(custom);
      gradient(x, size, lighten(cc, 0.12), darken(cc, 0.18));
      grain(x, size, 0.06, seed);
      break;
    }
    default: {
      // verde fieltro
      gradient(x, size, [76, 134, 106], [46, 88, 68]);
      vignette(x, size, 0.12);
      grain(x, size, 0.08, seed);
    }
  }
}

/** Color medio del tema (para la luz ambiente), como [r, g, b] en 0..255. */
export function themeBase(id: string, custom: string): [number, number, number] {
  return hexToRgbArr(id === 'personalizado' ? custom : themeById(id).base);
}
