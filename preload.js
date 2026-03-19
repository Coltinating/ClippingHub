const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipper', {
  getProxyPort: () => ipcRenderer.invoke('get-proxy-port'),
  getChannelConfig: () => ipcRenderer.invoke('get-channel-config'),

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

  // Native drag-out (to Twitter etc.)
  startDrag: (filePath) => ipcRenderer.send('ondragstart', filePath),

  // ── Config management ─────────────────────────────────────────
  loadUserConfig: () => ipcRenderer.invoke('load-user-config'),
  saveUserConfig: (config) => ipcRenderer.invoke('save-user-config', config),
  exportUserConfig: () => ipcRenderer.invoke('export-user-config'),
  importUserConfig: () => ipcRenderer.invoke('import-user-config'),

  // Watermark config (universal, cached in Roaming)
  loadWatermarkConfig: () => ipcRenderer.invoke('load-watermark-config'),
  saveWatermarkConfig: (config) => ipcRenderer.invoke('save-watermark-config', config),

  // Channel config
  saveChannelConfig: (config) => ipcRenderer.invoke('save-channel-config', config),
  deleteChannelConfig: () => ipcRenderer.invoke('delete-channel-config'),

  // Outro file picker
  chooseOutroFile: () => ipcRenderer.invoke('choose-outro-file'),
});
