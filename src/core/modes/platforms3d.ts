// Modo Plataformas 3D: planifica en Node o en la web; dibuja solo donde hay WebGL (web y app).
import { hexToRgb, rgba } from '../color.ts';
import { drawHud, FONT, type Ctx, type DrawEnv } from '../scene/draw.ts';
import type { SceneStyle } from '../scene/style.ts';
import { VIDEO_H as H, VIDEO_W as W } from '../types.ts';
import { COMMON_PLAN_KEYS, type Mode } from './mode.ts';
import { planCircuit, type CircuitPlan } from './circuit.plan.ts';
import type { Scene3D } from '../three/scene3d.ts';

export const platforms3dMode: Mode<CircuitPlan> = {
  id: 'platforms3d',
  name: 'Circuito 3D',
  description:
    'Las bolas caen por gravedad por un circuito de pared: teclas de piano (o placas, barras, tambores y bumpers) y carriles entre notas lejanas; la cámara sigue suave, sin cortes ni zoom.',
  planKeys: [
    ...COMMON_PLAN_KEYS,
    'pace3d',
    'spread3d',
    'heightByPitch',
    'tileSize',
    'ballSize3d',
    'maxBalls',
    'pieces',
    'cameraDirector',
    'seed',
    'cameraAzimuth',
    'cameraElevation',
    'cameraDistance',
  ],
  requiresWebGL: true,
  multiBall: true,
  plan: planCircuit,
  async prepare(env: DrawEnv) {
    if (env.cache.scene3d) return;
    const { Scene3D } = await import('../three/scene3d.ts');
    env.cache.scene3d = new Scene3D();
  },
  draw(ctx: Ctx, t: number, plan: CircuitPlan, st: SceneStyle, env: DrawEnv) {
    const scene = env.cache.scene3d as Scene3D | undefined;
    const m = ctx.getTransform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    if (!scene) {
      ctx.fillStyle = '#0f1020';
      ctx.fillRect(0, 0, cw, ch);
      ctx.setTransform(m);
      ctx.fillStyle = rgba(hexToRgb('#ffffff'), 0.8);
      ctx.font = `600 44px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('El modo 3D necesita WebGL (navegador o app)', W / 2, H / 2);
      return;
    }
    scene.setSize(cw, ch);
    scene.render(t, plan, st, env.fps);
    ctx.drawImage(scene.canvas, 0, 0, cw, ch);
    ctx.setTransform(m);
    drawHud(ctx, st, env, false);
  },
};
