// Compila el proceso principal y el preload a CommonJS (electron/dist/*.cjs).
import { build } from 'esbuild';

await Promise.all(
  ['main', 'preload'].map((name) =>
    build({
      entryPoints: [`electron/${name}.ts`],
      outfile: `electron/dist/${name}.cjs`,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron', 'electron-updater'],
      sourcemap: false,
      logLevel: 'info',
    }),
  ),
);
