// Un proyecto = todo lo necesario para reproducir un vídeo: música, sonido y escena.
import { DEFAULT_SOUND } from './audio/sampler.ts';
import { getMode } from './modes/index.ts';
import { DEFAULT_MUSIC, hitsDuration, scoreToHits } from './music/hits.ts';
import { DEFAULT_STYLE, type SceneStyle } from './scene/style.ts';
import type { Hit, MusicSettings, Score, SoundSettings } from './types.ts';

export interface Project {
  app: 'bolas-al-ritmo';
  version: 1;
  name: string;
  /** archivo de origen (solo informativo) */
  source: { kind: 'midi' | 'transcription' | 'audio'; file?: string } | null;
  music: MusicSettings;
  sound: SoundSettings;
  style: SceneStyle;
  /** choques ya calculados (opcional): permiten renderizar sin la partitura */
  hits?: Hit[];
  duration?: number;
}

export function defaultProject(): Project {
  return {
    app: 'bolas-al-ritmo',
    version: 1,
    name: 'Sin título',
    source: null,
    music: { ...DEFAULT_MUSIC },
    sound: { ...DEFAULT_SOUND },
    style: { ...DEFAULT_STYLE, colors: [...DEFAULT_STYLE.colors] },
  };
}

/** Rellena un proyecto parcial (p. ej. leído de un JSON antiguo) con los valores por defecto. */
export function normalizeProject(p: Partial<Project> | null | undefined): Project {
  const d = defaultProject();
  if (!p || p.app !== 'bolas-al-ritmo') return d;
  return {
    ...d,
    name: p.name ?? d.name,
    source: p.source ?? null,
    music: { ...d.music, ...(p.music ?? {}) },
    sound: { ...d.sound, ...(p.sound ?? {}) },
    style: { ...d.style, ...(p.style ?? {}) },
    hits: p.hits,
    duration: p.duration,
  };
}

export interface Built {
  hits: Hit[];
  duration: number;
  plan: unknown;
}

/** Choques, duración y plan de un proyecto a partir de su partitura (o de sus choques guardados). */
export function buildProject(project: Project, score: Score | null): Built {
  const mode = getMode(project.style.mode);
  const multi = !!mode.multiBall && project.style.maxBalls > 1;
  // con varias bolas, los choques se extraen sin unir notas cercanas: el reparto entre bolas aplica la separación
  const music = multi ? { ...project.music, minGap: 0.03 } : project.music;
  let hits = score ? scoreToHits(score, music) : (project.hits ?? []);
  let duration = hitsDuration(hits);
  const plan = mode.plan(hits, duration, project.style, { minGap: project.music.minGap });
  const audio = (plan as { audioHits?: Hit[] }).audioHits;
  if (audio) {
    hits = audio;
    duration = Math.max(duration, hitsDuration(hits));
  }
  return { hits, duration, plan };
}

export function musicChanged(a: MusicSettings, b: MusicSettings): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function planChanged(mode: string, a: SceneStyle, b: SceneStyle): boolean {
  if (a.mode !== b.mode) return true;
  return getMode(mode).planKeys.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export type { SoundSettings, MusicSettings, SceneStyle };
