import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseMidi, writeMidi } from '@core/midi/parse.ts';
import { groupChords, hitsDuration, scoreToHits } from '@core/music/hits.ts';
import { noteName, pitchColor } from '@core/music/names.ts';

const demo = parseMidi(fs.readFileSync('public/demo/para-elisa.mid'), 'demo');

describe('parseMidi', () => {
  it('lee el ejemplo con sus dos pistas', () => {
    expect(demo.tracks).toHaveLength(2);
    expect(demo.notes.length).toBe(206);
    expect(demo.duration).toBeGreaterThan(37);
    expect(demo.notes[0]).toMatchObject({ midi: 76, track: 0 });
  });

  it('escribe y vuelve a leer sin perder notas', () => {
    const bytes = writeMidi(demo.notes, 'copia');
    const again = parseMidi(bytes, 'copia');
    expect(again.notes.length).toBe(demo.notes.length);
    for (let i = 0; i < 20; i++) {
      expect(again.notes[i].midi).toBe(demo.notes[i].midi);
      expect(Math.abs(again.notes[i].time - demo.notes[i].time)).toBeLessThan(0.002);
    }
  });
});

describe('scoreToHits', () => {
  it('melodía: una nota por choque, la más aguda del acorde', () => {
    const hits = scoreToHits(demo, { selection: 'melody', duration: 0, lead: 0.5 });
    expect(hits[0].t).toBe(0.5);
    expect(hits.every((h) => h.notes.length === 1)).toBe(true);
    const chord = demo.notes.filter((n) => Math.abs(n.time - 2.0) < 0.01); // A2 + A4 juntos
    expect(chord.length).toBe(2);
    const hit = hits.find((h) => Math.abs(h.t - 2.5) < 0.01)!;
    expect(hit.notes[0].midi).toBe(Math.max(...chord.map((n) => n.midi)));
  });

  it('acordes: las notas simultáneas suenan en el mismo choque', () => {
    const hits = scoreToHits(demo, { selection: 'chords', duration: 0 });
    expect(hits.some((h) => h.notes.length === 2)).toBe(true);
  });

  it('respeta la separación mínima uniendo notas demasiado seguidas', () => {
    const hits = scoreToHits(demo, { selection: 'chords', duration: 0, minGap: 0.35 });
    for (let i = 1; i < hits.length; i++)
      expect(hits[i].t - hits[i - 1].t).toBeGreaterThanOrEqual(0.35 - 1e-6);
  });

  it('recorta por tiempo y aplica velocidad', () => {
    const hits = scoreToHits(demo, { start: 10, duration: 5, speed: 0.5, lead: 0 });
    expect(hits[0].t).toBeGreaterThanOrEqual(0);
    expect(hits[hits.length - 1].t).toBeLessThan(5);
    expect(hitsDuration(hits)).toBeGreaterThan(hits[hits.length - 1].t);
  });

  it('filtra pistas y alturas', () => {
    const bass = scoreToHits(demo, { tracks: [1], duration: 0 });
    expect(bass.every((h) => h.notes[0].midi <= 60)).toBe(true);
    const high = scoreToHits(demo, { lowest: 72, duration: 0, selection: 'all' });
    expect(high.every((h) => h.notes.every((n) => n.midi >= 72))).toBe(true);
  });
});

describe('utilidades', () => {
  it('agrupa acordes por ventana', () => {
    const g = groupChords([
      { time: 0, duration: 1, midi: 60, velocity: 1, track: 0 },
      { time: 0.01, duration: 1, midi: 64, velocity: 1, track: 0 },
      { time: 0.5, duration: 1, midi: 67, velocity: 1, track: 0 },
    ]);
    expect(g.map((x) => x.length)).toEqual([2, 1]);
  });
  it('nombra notas y les da color', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(69, 'es')).toBe('La4');
    expect(pitchColor(60)).not.toEqual(pitchColor(66));
    expect(pitchColor(60)).toEqual(pitchColor(72));
  });
});
