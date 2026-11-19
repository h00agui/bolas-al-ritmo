# Cambios

## 0.7.1 — 2026-11-19

- **Teclas oscuras con el reborde de neón** del color de su nota; al golpe se enciende la tecla entera y se apaga poco a poco.
- **Carriles = tuberías**: todo el carril es una tubería transparente de una sola pieza, con las aristas de neón (la luz acompaña a la bola) y un reborde grueso de neón en la boca y en la salida; sin aros intermedios.
- Resplandor algo mayor por defecto.

## 0.7.0 — 2026-11-19

- **Teclas perfectamente alineadas** (todas horizontales, mirando a la cámara, sin giros) y sin pisarse: si una tecla cae casi encima de otra, baja lo suficiente.
- **Teclas de neón** del color de su nota, que se encienden mucho más al golpe y se apagan despacio.
- **Carriles de neón** (color configurable) cuya luz acompaña a la bola y deja un rastro que se apaga detrás; las **curvas en U** son tuberías transparentes con el reborde y los anillos de neón, que también se iluminan al paso de la bola.
- Con varias bolas, las secundarias siguen la altura de la primera (rampas, pozos y carriles ajustan su bajada); por defecto una sola bola.

## 0.6.0 — 2026-11-19

- **Trazado nuevo del Circuito 3D**: solo teclas y carriles. La bola sigue un recorrido fluido de un lado a otro de la pared según las frases del MIDI (curvas suaves entre frases, tramos rectos solo a ratos); con notas rápidas zigzaguea entre dos hileras de teclas inclinadas hacia dentro (paredes rectas con barra solo los primeros segundos), a ritmo medio salta de tecla en tecla avanzando en horizontal, y con notas lejanas baja por carriles rectos con curvas en U. Las teclas llevan pequeñas variaciones de ángulo para que queden sueltas pero bonitas.
- **Cámara frontal ladeada**, fija y más lejos (se ve el entorno); ajustes de altura, giro, distancia y vaivén sutil.
- **Canica de cristal** con vetas (dos colores configurables) como bola por defecto; la bola nunca cambia de aspecto al golpear. Otros aspectos: brillante, cromo, cristal liso, mate, neón.
- **Teclas limpias** que se encienden del color de su nota con una subida suave y se apagan despacio.
- **15 fondos** a elegir (fieltro, noche estrellada, madera, mármol, neón, cielo, grafito, arena, océano, lavanda…) y uno personalizado por color.
- **Inicio y fin exactos** del tramo del MIDI (deslizadores y campos mm:ss.d, botón "Entera").
- **Enlace de YouTube** (app de escritorio): pega el enlace y la app descarga el audio con yt-dlp (se baja solo la primera vez y se actualiza desde el menú Ayuda) y lo convierte a MIDI.

## 0.5.0 — 2026-11-19

- **Cámara suave de verdad**: distancia fija durante todo el vídeo (sin zoom), sin cortes ni vibración; sigue a las bolas con un filtro simétrico que anticipa el movimiento y cambia de ángulo muy despacio por tramos (opción "Cámara con ángulo cambiante"; si se apaga, ángulo fijo).
- **Carriles**: cuando entre dos notas pasan más de 0,7 s la bola no flota: baja rodando por un carril cromado (serpentina con soportes a la pared) a velocidad creíble y sale justo a tiempo a la pieza siguiente. Entre notas cercanas, los saltos tienen gravedad real como mínimo.
- **Teclas limpias** (sin nombre de nota) que **se iluminan del color de su nota** al golpe y se van apagando poco a poco; placas y barras también se tiñen.
- **Estela de la bola** configurable (largo) y **aspecto de la bola** a elegir: brillante, cromo, cristal, mate o neón; color de la bola el de cada nota o uno fijo.
- Con varias bolas, cada una baja por su propio carril vertical (sin solaparse) y, en automático, se usan piezas compactas (teclas y bumpers).
- Corregido: al retroceder en la vista previa, las piezas golpeadas volvían a verse encendidas; las filas de ajustes comunes a Plataformas y Aro no se mostraban.

## 0.4.0 — 2026-11-18

- **Circuito vertical**: las piezas cuelgan de una pared y las bolas caen de arriba abajo por gravedad, de pieza en pieza, llegando exactas a cada nota (la caída inicial entra por arriba del plano). Ajustes "Velocidad de caída" y "Anchura del circuito".
- **Teclas de piano** con grosor (blancas para las notas naturales y negras para los sostenidos), que se hunden sobre su bisagra al golpe; son la pieza por defecto y se pueden mezclar con placas, barras, tambores y bumpers desde "Piezas del circuito".
- **Cámara que nunca pierde las bolas**: el encuadre se calcula por adelantado para contener a todas las bolas en escena y la pieza siguiente, anticipa los movimientos y mantiene los cortes de plano entre tramos.
- Las bolas secundarias solo aparecen cuando empiezan a caer hacia su primera pieza y salen de plano tras su último golpe.
- Iluminación más suave (sin teclas quemadas), bolas algo mayores y con el color de su siguiente nota desde el principio.
- `scripts/frames.mjs`: captura fotogramas (y opcionalmente exporta el vídeo) de la vista previa en Chrome sin pantalla, para revisar el aspecto.

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
