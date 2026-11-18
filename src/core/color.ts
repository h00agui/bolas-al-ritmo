// Colores en OKLCH (mismo brillo percibido para todos los tonos) y utilidades.
export type RGB = [number, number, number];

function oklchRaw(L: number, C: number, hd: number): number[] {
  const h = (hd * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055));
}

/** OKLCH → RGB 0..255, bajando el croma hasta que el color quepa en sRGB. */
export function oklch(L: number, C: number, h: number): RGB {
  for (let c = C; c > 0; c -= 0.004) {
    const v = oklchRaw(L, c, h);
    if (v.every((x) => x >= 0 && x <= 1)) return v.map((x) => Math.round(x * 255)) as RGB;
  }
  return oklchRaw(L, 0, h).map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255)) as RGB;
}

export function hexToRgb(hex: string): RGB {
  const h = String(hex).replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.padEnd(6, '0');
  const v = parseInt(full, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export const rgbToHex = (c: RGB): string =>
  '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

export const mix = (a: RGB, b: RGB, f: number): RGB => a.map((v, i) => v + (b[i] - v) * f) as RGB;

export const rgba = (c: RGB, a: number): string =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Luminancia relativa 0..1 de un color. */
export const luminance = (c: RGB): number => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

const GOLD = 137.508;

export interface Palette {
  name: string;
  /** Color del choque k (k = 0, 1, 2…) */
  at: (k: number, custom: string[]) => RGB;
}

export const PALETTES: Record<string, Palette> = {
  arcoiris: { name: 'Arcoíris', at: (k) => oklch(0.77, 0.2, (20 + GOLD * k) % 360) },
  neon: { name: 'Neón', at: (k) => oklch(0.83, 0.32, (330 + GOLD * k) % 360) },
  pastel: { name: 'Pastel', at: (k) => oklch(0.88, 0.09, (20 + GOLD * k) % 360) },
  fuego: {
    name: 'Fuego',
    at: (k) => oklch([0.72, 0.8, 0.88, 0.68, 0.84][k % 5], 0.2, [28, 48, 88, 18, 62][k % 5]),
  },
  hielo: {
    name: 'Hielo',
    at: (k) => oklch([0.82, 0.74, 0.9, 0.7, 0.86][k % 5], 0.13, [205, 235, 190, 265, 220][k % 5]),
  },
  personalizada: {
    name: 'Mis colores',
    at: (k, custom) => hexToRgb(custom.length ? custom[k % custom.length] : '#ffffff'),
  },
};
