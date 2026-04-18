const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('postCaptionBridge', {
  onStateUpdate: (cb) => ipcRenderer.on('post-caption-state-update', (_, d) => cb(d)),
  onOpenContext: (cb) => ipcRenderer.on('post-caption-open-context', (_, d) => cb(d)),
  sendAction: (action) => ipcRenderer.send('post-caption-action', action),
  extractClipFirstFrame: (filePath) => ipcRenderer.invoke('extract-clip-first-frame', { filePath }),
  closeWindow: () => ipcRenderer.invoke('close-post-caption-window'),
});
