const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('debugBridge', {
  onLog: (cb) => ipcRenderer.on('debug-log', (_, d) => cb(d)),
  onClipLogView: (cb) => ipcRenderer.on('show-clip-log', (_, d) => cb(d)),
  saveLog: (text, filterName) => ipcRenderer.invoke('save-debug-log', { text, filterName }),
  getLogPath: () => ipcRenderer.invoke('get-debug-log-path'),
  openLogFolder: () => ipcRenderer.invoke('open-debug-logs'),
});
