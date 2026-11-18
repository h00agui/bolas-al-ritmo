import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // BASE_PATH=/bolas-al-ritmo/ para GitHub Pages; '/' para un dominio propio (Cloudflare Pages)
  base: process.env.BASE_PATH || '/',
  resolve: {
    alias: { '@core': fileURLToPath(new URL('./src/core', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@tensorflow') || id.includes('@spotify/basic-pitch')) return 'tfjs';
          return undefined;
        },
      },
    },
  },
  worker: { format: 'es' },
  server: { port: 5173 },
  preview: { port: 4173 },
});
