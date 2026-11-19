// Audio desde un enlace de YouTube para la app de escritorio: usa yt-dlp (se descarga solo la primera vez
// a la carpeta de datos de la app, y se puede actualizar desde el menú). La web no puede hacer esto.
import { app, net } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ASSET =
  process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp';
const LATEST = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}`;

function localBinary(): string {
  return path.join(app.getPath('userData'), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

/** Ruta de yt-dlp: la copia descargada, la incluida con la app, o la del sistema (null si no hay). */
export function findYtDlp(): string | null {
  const local = localBinary();
  if (fs.existsSync(local)) return local;
  const bundled = path.join(
    process.resourcesPath ?? '',
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
  );
  if (fs.existsSync(bundled)) return bundled;
  return null;
}

/** Descarga (o actualiza) yt-dlp a la carpeta de datos de la app. */
export async function downloadYtDlp(onProgress?: (text: string) => void): Promise<string> {
  onProgress?.('Descargando yt-dlp…');
  const r = await net.fetch(LATEST, { redirect: 'follow' });
  if (!r.ok) throw new Error(`No se pudo descargar yt-dlp (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  const dest = localBinary();
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest + '.tmp', buf);
  await fs.promises.rename(dest + '.tmp', dest);
  if (process.platform !== 'win32') await fs.promises.chmod(dest, 0o755);
  return dest;
}

export function isYoutubeUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|music\.youtube\.com)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Ejecuta un programa y devuelve su salida; informa del progreso de descarga con las líneas de yt-dlp. */
function run(bin: string, args: string[], onProgress?: (text: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      out += s;
      const m = s.match(/\[download\]\s+([\d.]+)%/);
      if (m) onProgress?.(`Descargando el audio… ${Math.round(+m[1])} %`);
    });
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(out);
      else
        reject(
          new Error((err || out).trim().split('\n').slice(-3).join(' ') || `yt-dlp terminó con ${code}`),
        );
    });
  });
}

/**
 * Descarga el audio de un vídeo de YouTube (sin recodificar: m4a o webm) y lo devuelve en memoria,
 * junto con el título, para convertirlo a MIDI en la ventana.
 */
export async function fetchYoutubeAudio(
  url: string,
  onProgress?: (text: string) => void,
): Promise<{ name: string; title: string; data: Uint8Array }> {
  if (!isYoutubeUrl(url)) throw new Error('Eso no parece un enlace de YouTube.');
  let bin = findYtDlp();
  if (!bin) bin = await downloadYtDlp(onProgress);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bolas-yt-'));
  try {
    onProgress?.('Buscando el audio…');
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--no-simulate',
      '--print',
      'title',
      '--print',
      'after_move:filepath',
      '-f',
      'bestaudio[ext=m4a]/bestaudio/best',
      '-o',
      path.join(dir, 'audio.%(ext)s'),
      url.trim(),
    ];
    let out: string;
    try {
      out = await run(bin, args, onProgress);
    } catch (e) {
      // yt-dlp se queda viejo cuando YouTube cambia: se prueba una vez con la última versión
      if (
        bin !== localBinary() ||
        !/Unable|unavailable|Sign in|extract|HTTP Error/i.test((e as Error).message)
      )
        throw e;
      bin = await downloadYtDlp(onProgress);
      out = await run(bin, args, onProgress);
    }
    const lines = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('['));
    const title = lines[0] || 'YouTube';
    const file =
      lines.find((l) => l.startsWith(dir)) ??
      (await fs.promises.readdir(dir)).map((f) => path.join(dir, f)).find((f) => /audio\./.test(f));
    if (!file || !fs.existsSync(file)) throw new Error('No se encontró el audio descargado.');
    const data = await fs.promises.readFile(file);
    return { name: path.basename(file), title, data: new Uint8Array(data) };
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
