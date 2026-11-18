# Bolas al ritmo

Vídeos verticales (TikTok, Reels, Shorts) de una bola que **toca una canción**: baja a saltos por plataformas, o rebota dentro de un aro, y en cada choque suena la nota que toca. La música sale del MIDI, nota a nota, con el instrumento que elijas.

- **Web**: sube un MIDI o una canción (se convierte a MIDI en el navegador), ajusta y descarga el MP4. Todo se procesa en tu navegador; no se sube nada a ningún servidor.
- **Motor de render** (Node + ffmpeg): el mismo núcleo, para renders por lotes o desde la línea de comandos.

## Cómo se usa la web

1. **Música**. _Subir MIDI_ (lo más fiable) o _Subir canción_: MP3, M4A, WAV o un vídeo MP4. La canción se convierte a MIDI con Basic Pitch; funciona mejor con piano, voz sola o un instrumento limpio. Con una mezcla completa (voz + batería) conviene subir la melodía como MIDI. Después:
   - Elige las **pistas** (las de percusión vienen desmarcadas).
   - **Qué notas**: _Melodía_ (una nota por choque, la más aguda), _Acordes_ (todas las notas simultáneas en el mismo choque) o _Bajo_.
   - **Empieza en** (toca el piano roll) y **Duración**; **Velocidad** para ralentizar o acelerar; **Separación mínima** para que la bola no tenga que chocar más rápido de lo que se ve bien.
2. **Sonido**: instrumento (piano, caja de música, marimba, 8-bit…), volumen, reverb y si las notas se dejan sonar o duran lo que dice el MIDI. El botón de reproducir suena en vivo.
3. **Escena**: modo _Plataformas_ o _Aro_, colores por nota o por paleta, tamaños, gravedad, estela, chispas, fondo, textos (título, artista, tu @usuario), nombre de las notas y contador.
4. **Descargar**: _Crear vídeo MP4_ (1080×1920, 30 fps). Después _Guardar MP4_ o, en el móvil, _Compartir…_ para mandarlo a TikTok. _Guardar proyecto_ deja un `.json` con todos los ajustes; _Descargar MIDI_ guarda la transcripción.

Navegadores: Chrome y Edge crean el MP4 en segundos (WebCodecs). Si al navegador le falta algún codificador, la web graba el vídeo en tiempo real (tarda lo que dura el vídeo; hay que quedarse en la pestaña). La conversión a MIDI usa la GPU si está disponible.

## Desarrollo

Requisitos: Node 20 o superior; `ffmpeg` en el PATH para el motor y las pruebas.

```bash
npm install
npm run dev          # web en http://localhost:5173
npm test             # pruebas unitarias (MIDI, choques, sampler)
npm run build        # genera dist/ (web lista para publicar)
npm run test:e2e     # prueba de punta a punta en Chrome sin pantalla (necesita Chrome y la build)
npm run lint         # ESLint + Prettier
```

### Motor de render

```bash
npm run render -- --midi cancion.mid --out video.mp4
npm run render -- --midi cancion.mid --mode ring --instrument caja-de-musica --title "Mi canción" --handle "@micuenta"
npm run render -- --midi cancion.mid --project proyecto.json --out video.mp4   # ajustes guardados desde la web
npm run render -- --midi cancion.mid --stills 1.5,10,20 --out revision          # fotogramas PNG para revisar
```

Opciones: `--mode platforms|ring`, `--instrument <id>` (ver `src/core/audio/catalog.js`), `--selection melody|chords|bass`, `--start`, `--duration`, `--speed`, `--min-gap`, `--title`, `--subtitle`, `--handle`, `--palette`, `--color-mode nota|paleta`.

## Cómo funciona

```
MIDI o canción ─► partitura (notas) ─► choques (cuándo y qué notas) ─► plan (dónde choca la bola)
                                            │                               │
                                            ▼                               ▼
                                   sampler (audio nota a nota)      dibujo de cada fotograma
                                            └──────────► MP4 ◄─────────────┘
```

1. **Partitura** (`src/core/midi/parse.ts`, `src/web/transcribe.ts`): `@tonejs/midi` lee los `.mid`; Basic Pitch (TensorFlow.js, en un worker) convierte el audio.
2. **Choques** (`src/core/music/hits.ts`): filtra pistas y alturas, agrupa acordes, elige melodía/acordes/bajo, aplica tramo, velocidad y separación mínima.
3. **Plan** (`src/core/modes/*.ts`): la canción manda _cuándo_ choca la bola; el planificador decide _dónde_. Para cada intervalo prueba cientos de destinos con gravedad y se queda con los rebotes creíbles (búsqueda en haz). En _Plataformas_, cada plataforma se inclina justo para que la bola salga hacia el siguiente destino; la cámara sigue el descenso.
4. **Audio** (`src/core/audio/sampler.ts`): cada choque toca sus notas con los samples del instrumento (envolvente, paneo por altura, reverb por convolución). El mismo código produce el audio de la exportación y del motor.
5. **Vídeo**: Canvas 2D estándar (`src/core/scene`), así que dibuja igual en el navegador y en Node. Exportación con WebCodecs + mp4-muxer en la web; fotogramas en bruto a ffmpeg en el motor.

## Añadir un modo visual

Un modo implementa la interfaz `Mode` de `src/core/modes/mode.ts`:

```ts
export const miModo: Mode<MiPlan> = {
  id: 'escalera',
  name: 'Escalera',
  description: '…',
  planKeys: [...COMMON_PLAN_KEYS, 'miAjuste'], // ajustes que obligan a recalcular el plan
  plan(hits, duration, style) {
    /* devuelve un objeto JSON con la trayectoria */
  },
  draw(ctx, t, plan, style, env) {
    /* dibuja el instante t en 1080×1920 */
  },
};
```

Regístralo en `src/core/modes/index.ts`. Si tiene ajustes propios, añádelos a `SceneStyle` (`src/core/scene/style.ts`), a `index.html` (con `data-mode="escalera"` para que solo se vean en ese modo) y a la tabla `CTLS` de `src/web/main.ts`. Ideas: telaraña (líneas entre choques), aros concéntricos que se rompen, varias bolas, espiral.

## Añadir un instrumento

Añade una entrada a `src/core/audio/catalog.js` con el nombre del instrumento General MIDI (lista en `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/names.json`) y ejecuta `npm run instruments -- <id>`. El pack queda en `public/instruments/`.

## Publicar la web

**Cloudflare Pages** (gratis, permite uso comercial):

- _Con el panel_: Workers & Pages → Create → Pages → Connect to Git → este repositorio. Build command `npm run build`, output `dist`. Cada push a `main` publica solo.
- _Con GitHub Actions_: añade los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` al repositorio y el workflow `deploy.yml` publica en cada push.

La web es estática (carpeta `dist/`), así que también vale cualquier otro hosting de archivos estáticos.

## Estructura

```
src/core/        núcleo compartido (sin DOM): midi/, music/, audio/, modes/, scene/, project.ts
src/web/         la web (Vite): main.ts, audio.ts (reproducción), export.ts, transcribe.ts + worker, pianoroll.ts
src/cli/         motor de render en Node
src/node/        utilidades Node (ffmpeg, caché de instrumentos)
public/          instrumentos, modelo de transcripción (lo copia `npm run assets`), ejemplo, cabeceras
scripts/         build-instruments.mjs, sync-assets.mjs, make-demo.ts
tests/unit/      Vitest · tests/e2e/ Chrome sin pantalla
.github/         CI (lint, tipos, pruebas, build, e2e) y despliegue
```

Licencia: privada (ver `LICENSE`). Componentes de terceros en `THIRD_PARTY.md`.
