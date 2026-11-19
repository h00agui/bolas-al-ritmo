// Proceso principal de la aplicación de escritorio: ventana, protocolo app://, diálogos de
// archivo y actualizaciones automáticas desde las Releases de GitHub.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { downloadYtDlp, fetchYoutubeAudio } from './youtube.ts';

const DIST = path.join(__dirname, '..', '..', 'dist');
const DEV_URL = process.env.BOLAS_DEV_URL; // p. ej. http://localhost:5173 con `npm run dev`

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

function serveDist(): void {
  // app://bolas/<ruta> -> dist/<ruta>
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return new Response('No encontrado', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).href);
  });
}

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 600,
    title: 'Bolas al ritmo',
    backgroundColor: '#111113',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.on('closed', () => (win = null));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadURL('app://bolas/');
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Abrir MIDI o canción…',
          accelerator: 'CmdOrCtrl+O',
          click: () => win?.webContents.send('menu', 'open'),
        },
        {
          label: 'Desde un enlace de YouTube…',
          accelerator: 'CmdOrCtrl+Y',
          click: () => win?.webContents.send('menu', 'youtube'),
        },
        {
          label: 'Guardar proyecto…',
          accelerator: 'CmdOrCtrl+S',
          click: () => win?.webContents.send('menu', 'save-project'),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'resetZoom', label: 'Tamaño normal' },
        { role: 'zoomIn', label: 'Ampliar' },
        { role: 'zoomOut', label: 'Reducir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Buscar actualizaciones', click: () => void checkUpdates(true) },
        {
          label: 'Actualizar el descargador de YouTube (yt-dlp)',
          click: () =>
            void downloadYtDlp()
              .then(() => dialog.showMessageBox({ message: 'yt-dlp actualizado.' }))
              .catch((e: Error) => dialog.showMessageBox({ type: 'warning', message: e.message })),
        },
        {
          label: 'Código en GitHub',
          click: () => void shell.openExternal('https://github.com/h00agui/bolas-al-ritmo'),
        },
        { label: `Versión ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- diálogos de archivo (los pide la web a través del preload) ----------
ipcMain.handle('save-file', async (_e, name: string, data: Uint8Array) => {
  const filters = /\.mp4$/i.test(name)
    ? [{ name: 'Vídeo MP4', extensions: ['mp4'] }]
    : /\.webm$/i.test(name)
      ? [{ name: 'Vídeo WebM', extensions: ['webm'] }]
      : /\.json$/i.test(name)
        ? [{ name: 'Proyecto', extensions: ['json'] }]
        : /\.midi?$/i.test(name)
          ? [{ name: 'MIDI', extensions: ['mid'] }]
          : [];
  const r = await dialog.showSaveDialog(win!, {
    defaultPath: path.join(app.getPath('videos'), name),
    filters,
  });
  if (r.canceled || !r.filePath) return { status: 'declined' as const };
  await fs.promises.writeFile(r.filePath, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  return { status: 'saved' as const, path: r.filePath };
});
ipcMain.handle('show-in-folder', (_e, p: string) => shell.showItemInFolder(p));
ipcMain.handle('youtube-audio', (_e, url: string) =>
  fetchYoutubeAudio(url, (text) => win?.webContents.send('youtube-progress', text)),
);
ipcMain.handle('open-file', async () => {
  const r = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [
      {
        name: 'MIDI o canción',
        extensions: ['mid', 'midi', 'mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac', 'mp4', 'mov'],
      },
      { name: 'Todos', extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { name: path.basename(p), data: await fs.promises.readFile(p) };
});

// ---------- actualizaciones ----------
let updateNotified = false;
async function checkUpdates(manual: boolean): Promise<void> {
  if (!app.isPackaged) {
    if (manual)
      await dialog.showMessageBox({ message: 'Las actualizaciones solo funcionan en la versión instalada.' });
    return;
  }
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    const r = await autoUpdater.checkForUpdates();
    if (manual && !r?.updateInfo) await dialog.showMessageBox({ message: 'No hay actualizaciones.' });
  } catch (e) {
    if (manual)
      await dialog.showMessageBox({
        type: 'warning',
        message: `No se pudo comprobar: ${(e as Error).message}`,
      });
  }
}
autoUpdater.on('update-downloaded', (info) => {
  if (updateNotified) return;
  updateNotified = true;
  void dialog
    .showMessageBox({
      type: 'info',
      buttons: ['Reiniciar ahora', 'Más tarde'],
      defaultId: 0,
      message: `Hay una versión nueva (${info.version}) descargada.`,
      detail: 'Se instalará al cerrar la aplicación. ¿Quieres reiniciar ahora?',
    })
    .then((r) => r.response === 0 && autoUpdater.quitAndInstall());
});
autoUpdater.on('update-available', (info) =>
  win?.webContents.send('update', `Descargando la versión ${info.version}…`),
);

app.whenReady().then(() => {
  serveDist();
  buildMenu();
  createWindow();
  setTimeout(() => void checkUpdates(false), 4000);
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
