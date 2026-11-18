// Conversión de una canción a MIDI desde el hilo principal: decodifica, remuestrea a 22050 Hz y
// delega en el worker. Devuelve una partitura.
import type { Note, Score } from '@core/types.ts';
import type { TranscribeRequest, TranscribeResponse } from './workers/transcribe.worker.ts';

export interface TranscribeOptions {
  onsetThresh: number; // 0.2..0.8 (más bajo = más notas)
  minNoteLen: number; // fotogramas del modelo (~11.6 ms cada uno)
}

export const DEFAULT_TRANSCRIBE: TranscribeOptions = { onsetThresh: 0.5, minNoteLen: 11 };

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker {
  if (!worker)
    worker = new Worker(new URL('./workers/transcribe.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/** Decodifica cualquier audio a mono 22050 Hz (lo que espera el modelo). */
export async function decodeForModel(data: ArrayBuffer): Promise<{ audio: Float32Array; duration: number }> {
  const OAC =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  const probe = new OAC(1, 1, 44100);
  const buf = await probe.decodeAudioData(data.slice(0));
  const sr = 22050;
  const oc = new OAC(1, Math.ceil(buf.duration * sr), sr);
  const src = oc.createBufferSource();
  src.buffer = buf;
  src.connect(oc.destination);
  src.start();
  const out = await oc.startRendering();
  return { audio: out.getChannelData(0), duration: buf.duration };
}

export function transcribe(
  audio: Float32Array,
  name: string,
  opts: TranscribeOptions,
  onProgress: (p: number, stage: string) => void,
): Promise<{ score: Score; backend: string }> {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent<TranscribeResponse>) => {
      const m = ev.data;
      if (m.id !== id) return;
      if (m.type === 'progress') onProgress(m.p, m.stage);
      else {
        w.removeEventListener('message', onMsg);
        if (m.type === 'error') reject(new Error(m.message));
        else {
          const notes: Note[] = m.notes.map((n) => ({ ...n, track: 0 }));
          const duration = notes.reduce((d, n) => Math.max(d, n.time + n.duration), 0);
          const lo = notes.reduce((a, n) => Math.min(a, n.midi), 127);
          const hi = notes.reduce((a, n) => Math.max(a, n.midi), 0);
          resolve({
            score: {
              name,
              duration,
              notes,
              source: 'transcription',
              tracks: [
                {
                  index: 0,
                  name: 'Transcripción',
                  instrument: '',
                  channel: 0,
                  noteCount: notes.length,
                  lowest: lo,
                  highest: hi,
                },
              ],
            },
            backend: m.backend,
          });
        }
      }
    };
    w.addEventListener('message', onMsg);
    const req: TranscribeRequest = {
      type: 'transcribe',
      id,
      audio,
      onsetThresh: opts.onsetThresh,
      frameThresh: 0.3,
      minNoteLen: opts.minNoteLen,
      modelUrl: new URL(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`, location.href).href,
    };
    const forced = new URLSearchParams(location.search).get('backend');
    if (forced === 'cpu' || forced === 'webgl') req.backend = forced;
    w.postMessage(req);
  });
}
