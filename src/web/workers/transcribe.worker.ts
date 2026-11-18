// Worker de transcripción: audio mono a 22050 Hz -> notas, con Basic Pitch (TensorFlow.js).
// Se carga bajo demanda (tfjs pesa) y corre fuera del hilo principal para no congelar la web.
export interface TranscribeRequest {
  type: 'transcribe';
  id: number;
  audio: Float32Array;
  onsetThresh: number;
  frameThresh: number;
  minNoteLen: number;
  modelUrl: string;
  backend?: 'webgl' | 'cpu';
}
export interface TranscribedNote {
  time: number;
  duration: number;
  midi: number;
  velocity: number;
}
export type TranscribeResponse =
  | { type: 'progress'; id: number; p: number; stage: string }
  | { type: 'done'; id: number; notes: TranscribedNote[]; backend: string }
  | { type: 'error'; id: number; message: string };

let loaded: Promise<{
  tf: typeof import('@tensorflow/tfjs');
  bp: typeof import('@spotify/basic-pitch');
}> | null = null;

function load() {
  if (!loaded)
    loaded = Promise.all([import('@tensorflow/tfjs'), import('@spotify/basic-pitch')]).then(([tf, bp]) => ({
      tf,
      bp,
    }));
  return loaded;
}

self.onmessage = async (ev: MessageEvent<TranscribeRequest>) => {
  const req = ev.data;
  if (req.type !== 'transcribe') return;
  const post = (m: TranscribeResponse) => self.postMessage(m);
  try {
    post({ type: 'progress', id: req.id, p: 0, stage: 'Cargando el modelo…' });
    const { tf, bp } = await load();
    let backend = 'cpu';
    for (const b of req.backend ? [req.backend, 'cpu'] : ['webgl', 'cpu']) {
      try {
        if (await tf.setBackend(b)) {
          await tf.ready();
          backend = b;
          break;
        }
      } catch {}
    }
    const model = new bp.BasicPitch(tf.loadGraphModel(req.modelUrl) as unknown as string);
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];
    await model.evaluateModel(
      req.audio,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      (p) => post({ type: 'progress', id: req.id, p: 0.05 + 0.9 * p, stage: 'Escuchando las notas…' }),
    );
    post({ type: 'progress', id: req.id, p: 0.96, stage: 'Escribiendo el MIDI…' });
    const events = bp.noteFramesToTime(
      bp.addPitchBendsToNoteEvents(
        contours,
        bp.outputToNotesPoly(
          frames,
          onsets,
          req.onsetThresh,
          req.frameThresh,
          req.minNoteLen,
          true,
          null,
          null,
          true,
        ),
      ),
    );
    const notes = events
      .map((n) => ({
        time: n.startTimeSeconds,
        duration: n.durationSeconds,
        midi: n.pitchMidi,
        velocity: Math.max(0.1, Math.min(1, n.amplitude)),
      }))
      .sort((a, b) => a.time - b.time || a.midi - b.midi);
    post({ type: 'done', id: req.id, notes, backend });
  } catch (e) {
    post({ type: 'error', id: req.id, message: (e as Error)?.message || String(e) });
  }
};
