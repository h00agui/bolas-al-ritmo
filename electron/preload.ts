// Puente seguro entre la web y el proceso principal: window.bolasDesktop
import { contextBridge, ipcRenderer } from 'electron';

export interface BolasDesktop {
  version: string;
  saveFile(
    name: string,
    data: Uint8Array,
  ): Promise<{ status: 'saved'; path: string } | { status: 'declined' }>;
  showInFolder(path: string): Promise<void>;
  openFile(): Promise<{ name: string; data: Uint8Array } | null>;
  onMenu(cb: (action: string) => void): void;
  onUpdate(cb: (text: string) => void): void;
}

const api: BolasDesktop = {
  version: process.env.npm_package_version || '',
  saveFile: (name, data) => ipcRenderer.invoke('save-file', name, data),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  openFile: () => ipcRenderer.invoke('open-file'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action: string) => cb(action)),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, text: string) => cb(text)),
};
contextBridge.exposeInMainWorld('bolasDesktop', api);
