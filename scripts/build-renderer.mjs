// Construye la web para la app de escritorio (rutas relativas, sin mapas de código).
import { build } from 'vite';
process.env.BASE_PATH = './';
await build({ build: { sourcemap: false } });
