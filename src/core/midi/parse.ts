// Lectura y escritura de archivos MIDI (.mid) con @tonejs/midi.
import { Midi } from '@tonejs/midi';
import type { Note, Score, TrackInfo } from '../types.ts';

/** Lee un .mid y devuelve la partitura. Las pistas de percusión (canal 10) se marcan en el nombre. */
export function parseMidi(data: ArrayBuffer | Uint8Array, name = 'midi'): Score {
  const midi = new Midi(data instanceof Uint8Array ? data : new Uint8Array(data));
  const notes: Note[] = [];
  const tracks: TrackInfo[] = [];
  midi.tracks.forEach((track, index) => {
    if (!track.notes.length) return;
    let lowest = 127;
    let highest = 0;
    for (const n of track.notes) {
      if (n.duration <= 0 && n.midi < 0) continue;
      notes.push({
        time: n.time,
        duration: Math.max(0.03, n.duration),
        midi: n.midi,
        velocity: Math.max(0.05, Math.min(1, n.velocity)),
        track: index,
      });
      if (n.midi < lowest) lowest = n.midi;
      if (n.midi > highest) highest = n.midi;
    }
    const isDrums = track.channel === 9;
    tracks.push({
      index,
      name: track.name?.trim() || (isDrums ? 'Percusión' : `Pista ${index + 1}`),
      instrument: isDrums ? 'drums' : track.instrument?.name || '',
      channel: track.channel,
      noteCount: track.notes.length,
      lowest,
      highest,
    });
  });
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  const duration = notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
  return { name: midi.name || name, duration, tracks, notes, source: 'midi' };
}

/** Escribe una partitura (o un subconjunto de notas) como archivo .mid. */
export function writeMidi(notes: Note[], name = 'Bolas al ritmo', bpm = 120): Uint8Array {
  const midi = new Midi();
  midi.name = name;
  midi.header.setTempo(bpm);
  const byTrack = new Map<number, Note[]>();
  for (const n of notes) {
    const list = byTrack.get(n.track) ?? [];
    list.push(n);
    byTrack.set(n.track, list);
  }
  for (const [, list] of [...byTrack.entries()].sort((a, b) => a[0] - b[0])) {
    const track = midi.addTrack();
    for (const n of list) track.addNote({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity });
  }
  return midi.toArray();
}
