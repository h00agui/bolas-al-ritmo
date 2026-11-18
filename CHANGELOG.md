# Cambios

## 0.3.0 — 2026-11-18

- El modo 3D pasa a ser **Circuito 3D**: la canción se divide en tramos y cada tramo usa una pieza distinta (placas cromadas, barras de xilófono con el largo de su nota, tambores, bumpers de pinball); selector de piezas (automático o una fija) y **variante** (semilla) para otro trazado con la misma canción.
- **Varias bolas**: los golpes se reparten entre hasta 6 bolas según la separación mínima; los acordes caen a la vez en bolas distintas.
- **Director de cámara**: planos de seguimiento, bajos, cenitales, laterales y generales con cortes o transiciones en los límites de los tramos; vibración en los golpes fuertes.
- Resplandor (bloom) ajustable y textura sutil en el suelo.

## 0.2.0 — 2026-11-18

- Nuevo modo **Plataformas 3D** (three.js): suelo con sombras suaves, placas cromadas sobre varillas que rebotan como un muelle al golpe, bola tipo canica, chispas y cámara diagonal que sigue a la bola. Ajustes de suelo, material, cámara, luz, avance, anchura, tamaño de placa y de bola, rebote y "agudos más altos".
- Rótulos estilo **etiqueta** (píldora oscura en cursiva arriba a la izquierda) y **logo propio** (imagen subida por el usuario) en todos los modos.
- El motor de línea de comandos avisa de que el modo 3D se exporta desde la web o la app.

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
