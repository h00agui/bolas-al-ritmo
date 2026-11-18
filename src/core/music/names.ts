// Nombres de notas y colores por altura.
import { oklch } from '../color.ts';

export const NOTE_NAMES_ES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
export const NOTE_NAMES_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi: number, style: 'es' | 'en' = 'en'): string {
  const names = style === 'es' ? NOTE_NAMES_ES : NOTE_NAMES_EN;
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** Color de cada nota: círculo cromático por clase de altura (Do = rojo, Fa# = cian). */
export function pitchColor(midi: number, chroma = 0.2, lightness = 0.78): [number, number, number] {
  const hue = (((midi % 12) + 12) % 12) * 30;
  return oklch(lightness, chroma, hue);
}
