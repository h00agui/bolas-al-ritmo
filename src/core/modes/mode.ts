// Contrato de un modo visual. Para añadir uno: implementa esta interfaz y regístralo en index.ts.
import type { Hit } from '../types.ts';
import type { SceneStyle } from '../scene/style.ts';
import type { Ctx, DrawEnv } from '../scene/draw.ts';

export interface PlanOptions {
  /** separación mínima entre golpes de una misma bola (s) */
  minGap: number;
}

export interface Mode<P = unknown> {
  id: string;
  name: string;
  description: string;
  /** Ajustes de estilo que obligan a recalcular el plan (los demás solo cambian el dibujo). */
  planKeys: (keyof SceneStyle)[];
  /** Necesita WebGL (solo web y app; el motor de Node no lo dibuja). */
  requiresWebGL?: boolean;
  /** Reparte los choques entre varias bolas (style.maxBalls). */
  multiBall?: boolean;
  /** Carga lo que el dibujo necesita (p. ej. la escena WebGL) antes de la primera llamada a draw. */
  prepare?: (env: DrawEnv) => Promise<void>;
  /** Calcula la trayectoria completa: un objeto JSON puro, igual en la web y en el motor. */
  plan(hits: Hit[], duration: number, style: SceneStyle, opts?: PlanOptions): P;
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
