const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('detachedAPI', {
  postMark:    (payload) => ipcRenderer.send('detached-mark', payload),
  onStreamUrl: (cb) => ipcRenderer.on('detached-stream-url', (_e, data) => cb(data)),
  onClose:     (cb) => ipcRenderer.on('detached-close', () => cb()),
});
