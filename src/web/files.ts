// Archivos: guardar descargas (con la capacidad "downloads" de Claude cuando existe) y nombres seguros.

interface ClaudeDownloads {
  save(req: { filename: string; data: Blob | string | ArrayBuffer }): Promise<{ status: string }>;
}
interface ClaudeApi {
  use?: (name: string) => Promise<ClaudeDownloads | null> | ClaudeDownloads | null;
}

let downloadsPromise: Promise<ClaudeDownloads | null> | null = null;

function getDownloads(): Promise<ClaudeDownloads | null> {
  if (!downloadsPromise) {
    const api = (window as unknown as { claude?: ClaudeApi }).claude;
    downloadsPromise =
      api && api.use
        ? Promise.race([
            Promise.resolve(api.use('downloads')).catch(() => null),
            new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
          ])
        : Promise.resolve(null);
  }
  return downloadsPromise;
}

export type SaveResult = 'saved' | 'declined' | 'busy' | 'error';

/** Ofrece un archivo al usuario. Dentro de Claude pide confirmación; fuera, descarga directa. */
export async function saveFile(data: Blob | string, filename: string): Promise<SaveResult> {
  const dl = await getDownloads();
  if (dl) {
    try {
      await dl.save({ filename, data });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'declined') return 'declined';
      if (code === 'rate_limited') return 'busy';
      return 'error';
    }
  }
  const blob = data instanceof Blob ? data : new Blob([data]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'saved';
}

/** Comparte un archivo con la hoja de compartir del sistema (móvil). */
export async function shareFile(blob: Blob, filename: string, title: string): Promise<boolean> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare || !nav.canShare({ files: [file] })) return false;
  try {
    await nav.share({ files: [file], title });
    return true;
  } catch {
    return false;
  }
}

export function canShareFiles(): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare) return false;
  try {
    return nav.canShare({ files: [new File([new Blob(['x'])], 'x.mp4', { type: 'video/mp4' })] });
  } catch {
    return false;
  }
}

export function slug(s: string): string {
  return (
    (s || 'bolas')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'bolas'
  );
}

export const stripExt = (name: string): string => name.replace(/\.[^.]+$/, '');
