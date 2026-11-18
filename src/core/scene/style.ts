// Estilo visual común a todos los modos (lo que se toca en el panel "Escena").
import { PALETTES, hexToRgb, type RGB } from '../color.ts';
import { pitchColor } from '../music/names.ts';
import type { Hit } from '../types.ts';

export interface SceneStyle {
  mode: string;
  colorMode: 'nota' | 'paleta';
  palette: string;
  colors: string[];
  startColor: string;
  bgTop: string;
  bgBottom: string;
  ballStart: number;
  ballEnd: number;
  trail: number;
  particles: number;
  glow: number;
  outline: boolean;
  gravity: number;
  chaos: number;
  title: string;
  subtitle: string;
  handle: string;
  textColor: string;
  counter: boolean;
  noteNames: boolean;
  // modo aro
  ringY: number;
  ringRadius: number;
  ringWidth: number;
  ringMode: 'cambia' | 'fijo';
  ringColor: string;
  // modo plataformas
  platformLength: number;
  platformThickness: number;
  descent: number; // px/s de bajada media
  spread: number; // 0..1 anchura usada de la pantalla
}

export const DEFAULT_STYLE: SceneStyle = {
  mode: 'platforms',
  colorMode: 'nota',
  palette: 'arcoiris',
  colors: ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff'],
  startColor: '#ffffff',
  bgTop: '#0f1020',
  bgBottom: '#040406',
  ballStart: 26,
  ballEnd: 26,
  trail: 0.18,
  particles: 1,
  glow: 1,
  outline: true,
  gravity: 1,
  chaos: 0.3,
  title: '',
  subtitle: '',
  handle: '',
  textColor: '#ffffff',
  counter: false,
  noteNames: true,
  ringY: 1010,
  ringRadius: 430,
  ringWidth: 10,
  ringMode: 'cambia',
  ringColor: '#ffffff',
  platformLength: 120,
  platformThickness: 20,
  descent: 300,
  spread: 0.7,
};

/** Color de cada choque según el modo de color. */
export function hitColors(hits: Hit[], style: SceneStyle): RGB[] {
  const pal = PALETTES[style.palette] ?? PALETTES.arcoiris;
  return hits.map((h, k) =>
    style.colorMode === 'nota' && h.notes.length ? pitchColor(h.notes[0].midi) : pal.at(k, style.colors),
  );
}

export const startColor = (style: SceneStyle): RGB => hexToRgb(style.startColor);
