const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whipApi', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  setTarget: (rect) => ipcRenderer.send('set-target', rect),
  cancelTarget: () => ipcRenderer.send('cancel-target'),
  dragUpdate: (rect) => ipcRenderer.send('drag-update', rect),
  onMascot: (cb) => ipcRenderer.on('mascot', (_e, m) => cb(m)),
  mascotHit: () => ipcRenderer.send('mascot-hit'),
  onDrag: (cb) => ipcRenderer.on('drag', (_e, r) => cb(r)),
});
