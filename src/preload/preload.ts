// Sandboxed preload: bundled into a single file, so it may import shared code.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type WhipApi } from '../shared/ipc';

const listen = <T>(channel: string) => (cb: (v: T) => void) => {
  ipcRenderer.on(channel, (_e, v: T) => cb(v));
};

const api: WhipApi = {
  onState: listen(IPC.state),
  onCursor: listen(IPC.cursor),
  onMascot: listen(IPC.mascot),
  onDrag: listen(IPC.drag),
  setTarget: (rect) => ipcRenderer.send(IPC.setTarget, rect),
  cancelTarget: () => ipcRenderer.send(IPC.cancelTarget),
  dragUpdate: (rect) => ipcRenderer.send(IPC.dragUpdate, rect),
  mascotHit: () => ipcRenderer.send(IPC.mascotHit),
};

contextBridge.exposeInMainWorld('whipApi', api);
