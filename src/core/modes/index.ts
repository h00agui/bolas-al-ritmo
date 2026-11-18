// Registro de modos visuales. Añade aquí los nuevos.
import type { Mode } from './mode.ts';
import { platformsMode } from './platforms.ts';
import { ringMode } from './ring.ts';

export const MODES: Record<string, Mode<unknown>> = {
  [platformsMode.id]: platformsMode as Mode<unknown>,
  [ringMode.id]: ringMode as Mode<unknown>,
};

export const DEFAULT_MODE = platformsMode.id;

export function getMode(id: string): Mode<unknown> {
  return MODES[id] ?? MODES[DEFAULT_MODE];
}

export type { Mode } from './mode.ts';
