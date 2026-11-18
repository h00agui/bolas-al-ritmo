import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseMidi } from '@core/midi/parse.ts';
import { scoreToHits, hitsDuration } from '@core/music/hits.ts';
import { renderHits, DEFAULT_SOUND, encodeWav } from '@core/audio/sampler.ts';
import { analyzeAudio, detectOnsets, ANALYSIS_SR } from '@core/audio/onsets.ts';
import { readPack } from '@core/audio/instruments.ts';
import { loadInstrumentNode } from '../../src/node/audio.ts';

describe('instrumentos y sampler', () => {
  it('el pack del piano tiene 88 notas', () => {
    const { index } = readPack(fs.readFileSync('public/instruments/piano.pack'));
    expect(index.notes.length).toBe(88);
    expect(index.notes[0].midi).toBe(21);
  });

  it('cada choque produce un ataque audible justo en su instante', async () => {
    const piano = await loadInstrumentNode('piano');
    expect(piano.samples.size).toBe(88);
    const score = parseMidi(fs.readFileSync('public/demo/para-elisa.mid'), 'demo');
    const hits = scoreToHits(score, { selection: 'melody', duration: 12, minGap: 0.15 });
    const dur = hitsDuration(hits);
    const [l, r] = await renderHits(hits, piano, { ...DEFAULT_SOUND, reverb: 0.2 }, dur, ANALYSIS_SR);
    expect(l.length).toBe(Math.ceil(dur * ANALYSIS_SR));
    let peak = 0;
    for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
    expect(peak).toBeGreaterThan(0.6);
    expect(peak).toBeLessThanOrEqual(1);
    const mono = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) mono[i] = 0.5 * (l[i] + r[i]);
    const onsets = detectOnsets(await analyzeAudio(mono), { sens: 60, minGap: 0.08 });
    let matched = 0;
    let err = 0;
    for (const h of hits) {
      const near = onsets.reduce((b, o) => (Math.abs(o.t - h.t) < Math.abs(b - h.t) ? o.t : b), -9);
      if (Math.abs(near - h.t) <= 0.03) {
        matched++;
        err += near - h.t;
      }
    }
    expect(matched / hits.length).toBeGreaterThan(0.9);
    expect(Math.abs(err / matched)).toBeLessThan(0.015);
    fs.mkdirSync('out', { recursive: true });
    fs.writeFileSync('out/test-sampler.wav', encodeWav(l, r, ANALYSIS_SR));
  });
});
