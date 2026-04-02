const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('batchBridge', {
  onUpdate: (cb) => ipcRenderer.on('batch-update', (_, d) => cb(d)),
  close: () => ipcRenderer.invoke('close-batch-progress'),
  openFolder: (p) => ipcRenderer.invoke('open-batch-folder', p),
});
