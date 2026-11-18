# Cambios

## 0.1.2 — 2026-11-18

- Publicación de la app en una sola release por versión (la 0.1.1 quedó duplicada por una carrera al publicar).

## 0.1.1 — 2026-11-18

- Corregido: la aplicación de escritorio no arrancaba ("Cannot find module 'electron-updater'"): el módulo de actualizaciones no se incluía en el paquete.

## 0.1.0 — 2026-11-18

Primera versión.

- Aplicación de escritorio para Windows (Electron) con instalador, versión portable y actualizaciones automáticas desde las Releases de GitHub.
- Web: subir MIDI o canción (conversión a MIDI con Basic Pitch en el navegador), elección de pistas y notas (melodía, acordes, bajo), tramo, velocidad y separación mínima.
- Sonido: 14 instrumentos (FluidR3 GM), volumen, reverb y duración de las notas; vista previa con audio en vivo.
- Modos visuales: Plataformas en descenso (cámara que sigue a la bola, plataformas con el color y el nombre de cada nota) y Aro.
- Exportación MP4 1080×1920 en el navegador (WebCodecs; grabación en tiempo real como respaldo), compartir en el móvil, proyecto guardable y MIDI descargable.
- Motor de render en Node (`npm run render`) con ffmpeg, mismo núcleo que la web.
- Pruebas unitarias (MIDI, choques, sampler) y de punta a punta en Chrome; CI en GitHub Actions; despliegue en Cloudflare Pages.
