// Catálogo de instrumentos (JS plano para que lo lean también los scripts sin compilar).
// gm: nombre en midi-js-soundfonts (FluidR3_GM, licencia MIT). range: notas MIDI incluidas.
// step: 1 = todas las notas; 2 = una de cada dos (la otra se obtiene resampleando).
export const INSTRUMENTS = [
  { id: 'piano', name: 'Piano', gm: 'acoustic_grand_piano', range: [21, 108], step: 1 },
  { id: 'piano-electrico', name: 'Piano eléctrico', gm: 'electric_piano_1', range: [28, 103], step: 2 },
  { id: 'caja-de-musica', name: 'Caja de música', gm: 'music_box', range: [48, 108], step: 1 },
  { id: 'celesta', name: 'Celesta', gm: 'celesta', range: [48, 108], step: 2 },
  { id: 'campanitas', name: 'Campanitas', gm: 'glockenspiel', range: [60, 108], step: 1 },
  { id: 'marimba', name: 'Marimba', gm: 'marimba', range: [36, 96], step: 2 },
  { id: 'xilofono', name: 'Xilófono', gm: 'xylophone', range: [48, 108], step: 2 },
  { id: 'vibrafono', name: 'Vibráfono', gm: 'vibraphone', range: [40, 100], step: 2 },
  { id: 'kalimba', name: 'Kalimba', gm: 'kalimba', range: [48, 96], step: 2 },
  { id: 'campanas', name: 'Campanas tubulares', gm: 'tubular_bells', range: [48, 96], step: 2 },
  { id: 'arpa', name: 'Arpa', gm: 'orchestral_harp', range: [24, 103], step: 2 },
  { id: 'guitarra', name: 'Guitarra', gm: 'acoustic_guitar_nylon', range: [40, 88], step: 2 },
  { id: '8-bit', name: '8-bit', gm: 'lead_1_square', range: [36, 96], step: 2 },
  { id: 'sintetizador', name: 'Sintetizador', gm: 'lead_2_sawtooth', range: [36, 96], step: 2 },
];
