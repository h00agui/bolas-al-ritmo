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
  // rótulo y logo
  textStyle: 'simple' | 'etiqueta';
  logo: string; // imagen (data URL) o ''
  logoSize: number; // 0..1 fracción del ancho
  // modo plataformas 3D
  floorColor: string;
  material3d: 'cromo' | 'color' | 'mate';
  cameraAzimuth: number; // grados
  cameraElevation: number; // grados
  cameraDistance: number; // unidades
  lightAngle: number; // grados (de dónde viene la luz)
  shadowSoftness: number; // 0..1
  pace3d: number; // unidades/s de avance
  spread3d: number; // unidades de anchura lateral
  heightByPitch: boolean; // varillas más altas para notas agudas
  tileSize: number; // unidades (largo de la placa)
  recoil: number; // 0..2 fuerza del rebote de la placa
  ballSize3d: number; // radio en unidades
}

export const DEFAULT_STYLE: SceneStyle = {
  mode: 'platforms3d',
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
  textStyle: 'simple',
  logo: '',
  logoSize: 0.42,
  floorColor: '#3c6e55',
  material3d: 'cromo',
  cameraAzimuth: 35,
  cameraElevation: 56,
  cameraDistance: 13,
  lightAngle: 35,
  shadowSoftness: 0.6,
  pace3d: 2.4,
  spread3d: 2.2,
  heightByPitch: true,
  tileSize: 1,
  recoil: 1,
  ballSize3d: 0.2,
};

/** Color de cada choque según el modo de color. */
export function hitColors(hits: Hit[], style: SceneStyle): RGB[] {
  const pal = PALETTES[style.palette] ?? PALETTES.arcoiris;
  return hits.map((h, k) =>
    style.colorMode === 'nota' && h.notes.length ? pitchColor(h.notes[0].midi) : pal.at(k, style.colors),
  );
}

export const startColor = (style: SceneStyle): RGB => hexToRgb(style.startColor);
