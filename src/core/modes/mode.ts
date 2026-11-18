// Contrato de un modo visual. Para añadir uno: implementa esta interfaz y regístralo en index.ts.
import type { Hit } from '../types.ts';
import type { SceneStyle } from '../scene/style.ts';
import type { Ctx, DrawEnv } from '../scene/draw.ts';

export interface Mode<P = unknown> {
  id: string;
  name: string;
  description: string;
  /** Ajustes de estilo que obligan a recalcular el plan (los demás solo cambian el dibujo). */
  planKeys: (keyof SceneStyle)[];
  /** Calcula la trayectoria completa: un objeto JSON puro, igual en la web y en el motor. */
  plan(hits: Hit[], duration: number, style: SceneStyle): P;
  /** Dibuja el instante t (s) en un lienzo de 1080×1920. */
  draw(ctx: Ctx, t: number, plan: P, style: SceneStyle, env: DrawEnv): void;
}

export const COMMON_PLAN_KEYS: (keyof SceneStyle)[] = [
  'ballStart',
  'ballEnd',
  'gravity',
  'chaos',
  'colorMode',
  'palette',
  'colors',
];
