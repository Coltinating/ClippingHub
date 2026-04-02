const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hubBridge', {
  onStateUpdate: (cb) => ipcRenderer.on('hub-state-update', (_, d) => cb(d)),
  onClipProgress: (cb) => ipcRenderer.on('clip-progress', (_, d) => cb(d)),
  sendAction: (action) => ipcRenderer.send('hub-action', action),
  openDebugWindow: () => ipcRenderer.invoke('open-debug-window'),
  startDrag: (filePath) => ipcRenderer.send('ondragstart', filePath),
  chooseOutroFile: () => ipcRenderer.invoke('choose-outro-file'),
  chooseWatermarkImage: () => ipcRenderer.invoke('choose-watermark-image'),
  chooseClipsDir: () => ipcRenderer.invoke('choose-clips-dir'),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  openClipFfmpegLog: (clipName) => ipcRenderer.invoke('open-clip-ffmpeg-log', clipName),
  deleteClipFile: (filePath) => ipcRenderer.invoke('delete-clip-file', { filePath }),
});
