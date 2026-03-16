const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipper', {
  getProxyPort: () => ipcRenderer.invoke('get-proxy-port'),

  // M3U8 extraction (Electron-native hidden window)
  extractM3U8: (opts) => ipcRenderer.invoke('extract-m3u8', opts),

  // Built-in Rumble navigator window
  openNavigator: (opts) => ipcRenderer.invoke('open-navigator', opts || {}),
  closeNavigator: () => ipcRenderer.invoke('close-navigator'),

  // Main fires this when the navigator intercepts a stream
  onStreamFound: (cb) => ipcRenderer.on('stream-found', (_, data) => cb(data)),

  // Clips directory
  getClipsDir: () => ipcRenderer.invoke('get-clips-dir'),
  chooseClipsDir: () => ipcRenderer.invoke('choose-clips-dir'),
  openClipsFolder: () => ipcRenderer.invoke('open-clips-folder'),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),

  // Clip download
  downloadClip: (opts) => ipcRenderer.invoke('download-clip', opts),
  onClipProgress: (cb) => ipcRenderer.on('clip-progress', (_, d) => cb(d)),

  // Live capture
  startLiveCapture: (opts) => ipcRenderer.invoke('start-live-capture', opts),
  stopLiveCapture: (opts) => ipcRenderer.invoke('stop-live-capture', opts),
  cancelLiveCapture: (opts) => ipcRenderer.invoke('cancel-live-capture', opts),

  // Native drag-out (to Twitter etc.)
  startDrag: (filePath) => ipcRenderer.send('ondragstart', filePath),
});
