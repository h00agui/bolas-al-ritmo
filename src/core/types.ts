// Tipos compartidos por la web, el motor de render y las pruebas.

/** Una nota musical tal y como viene del MIDI (o de la transcripción). Tiempos en segundos. */
export interface Note {
  time: number;
  duration: number;
  midi: number;
  velocity: number; // 0..1
  track: number;
}

export interface TrackInfo {
  index: number;
  name: string;
  instrument: string;
  channel: number;
  noteCount: number;
  lowest: number;
  highest: number;
}

/** Partitura completa: todas las notas de todas las pistas. */
export interface Score {
  name: string;
  duration: number;
  tracks: TrackInfo[];
  notes: Note[];
  /** Origen: archivo MIDI, transcripción automática o detección de golpes en el audio. */
  source: 'midi' | 'transcription' | 'audio';
}

/** Una nota que suena en un choque. */
export interface HitNote {
  midi: number;
  velocity: number;
  duration: number;
}

/** Un choque: instante en el vídeo (s), notas que suenan y fuerza visual 0..1. */
export interface Hit {
  t: number;
  notes: HitNote[];
  strength: number;
}

export type NoteSelection = 'melody' | 'chords' | 'bass' | 'all';

/** Ajustes musicales: de qué notas salen los choques. */
export interface MusicSettings {
  tracks: number[] | 'all';
  selection: NoteSelection;
  minGap: number; // s entre choques
  start: number; // s dentro de la partitura
  duration: number; // s de vídeo (0 = hasta el final)
  speed: number; // 1 = tempo original
  minVelocity: number; // 0..1, descarta notas más flojas
  lowest: number; // midi
  highest: number; // midi
  lead: number; // s de silencio al principio antes del primer choque
}

export interface SoundSettings {
  instrument: string;
  volume: number; // 0..1
  reverb: number; // 0..1
  sustain: 'midi' | 'ring'; // duración del MIDI o dejar sonar
  release: number; // s
}

export const SAMPLE_RATE = 48000;
export const VIDEO_W = 1080;
export const VIDEO_H = 1920;
export const FPS = 30;
