const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('whipApi', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  setTarget: (rect) => ipcRenderer.send('set-target', rect),
  cancelTarget: () => ipcRenderer.send('cancel-target'),
});
