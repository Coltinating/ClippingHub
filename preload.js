const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipper', {
  // OS info — used by the renderer to filter platform-specific UI (codec/hwaccel
  // dropdowns etc.). Exposed as a plain string so the renderer can compare with
  // 'win32' / 'darwin' / 'linux' just like it would in a Node context.
  platform: process.platform,
  arch: process.arch,

  getProxyPort: () => ipcRenderer.invoke('get-proxy-port'),
  getChannelConfig: () => ipcRenderer.invoke('get-channel-config'),

  // App meta + auto-update
  getAppVersion:      () => ipcRenderer.invoke('app:getVersion'),
  quitApp:            () => ipcRenderer.invoke('app:quit'),
  exportAppConfig:    () => ipcRenderer.invoke('app:export-config'),
  importAppConfig:    () => ipcRenderer.invoke('app:import-config'),
  checkForUpdate:     () => ipcRenderer.invoke('update:check'),
  downloadUpdate:     () => ipcRenderer.invoke('update:download'),
  installUpdate:      () => ipcRenderer.invoke('update:install'),
  onUpdateChecking:   (cb) => ipcRenderer.on('update:checking', () => cb()),
  onUpdateAvailable:  (cb) => ipcRenderer.on('update:available', (_, d) => cb(d)),
  onUpdateNone:       (cb) => ipcRenderer.on('update:none', (_, d) => cb(d)),
  onUpdateProgress:   (cb) => ipcRenderer.on('update:progress', (_, d) => cb(d)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', () => cb()),
  onUpdateError:      (cb) => ipcRenderer.on('update:error', (_, msg) => cb(msg)),

  // M3U8 extraction (Electron-native hidden window)
  extractM3U8: (opts) => ipcRenderer.invoke('extract-m3u8', opts),

  // Built-in stream navigator window
  openNavigator: (opts) => ipcRenderer.invoke('open-navigator', opts || {}),
  closeNavigator: () => ipcRenderer.invoke('close-navigator'),

  // Main fires this when the navigator intercepts a stream
  onStreamFound: (cb) => ipcRenderer.on('stream-found', (_, data) => cb(data)),

  // Clips directory
  getClipsDir: () => ipcRenderer.invoke('get-clips-dir'),
  chooseClipsDir: () => ipcRenderer.invoke('choose-clips-dir'),
  openClipsFolder: () => ipcRenderer.invoke('open-clips-folder'),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),

  // Clip download
  downloadClip: (opts) => ipcRenderer.invoke('download-clip', opts),
  extractClipFirstFrame: (filePath) => ipcRenderer.invoke('extract-clip-first-frame', { filePath }),
  onClipProgress: (cb) => ipcRenderer.on('clip-progress', (_, d) => cb(d)),

  // Native drag-out (to social media etc.)
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

  // Watermark image picker
  chooseWatermarkImage: () => ipcRenderer.invoke('choose-watermark-image'),

  // Watermark preview
  previewWatermark: (opts) => ipcRenderer.invoke('preview-watermark', opts),
  showPreview: (filePath) => ipcRenderer.invoke('show-preview', { filePath }),

  // GPU transcription (whisper.cpp)
  whisperAvailable: () => ipcRenderer.invoke('whisper-available'),
  transcribeGpu: (opts) => ipcRenderer.invoke('transcribe-gpu', opts),

  // faster-whisper (Python + CTranslate2)
  fasterWhisperAvailable: () => ipcRenderer.invoke('faster-whisper-available'),
  transcribeFaster: (opts) => ipcRenderer.invoke('transcribe-faster', opts),
  onFwProgress: (cb) => ipcRenderer.on('fw-progress', (_, data) => cb(data)),

  // Debug
  sendDebugLog: (entry) => ipcRenderer.send('renderer-debug-log', entry),
  openDebugWindow: () => ipcRenderer.invoke('open-debug-window'),
  openClipFfmpegLog: (clipName) => ipcRenderer.invoke('open-clip-ffmpeg-log', clipName),

  // Cancel active download
  cancelClip: (clipName) => ipcRenderer.invoke('cancel-clip', { clipName }),

  // Open URL in default browser
  openExternal: (url) => ipcRenderer.invoke('open-external-url', url),

  // Delete clip file (for Re-Stage)
  deleteClipFile: (filePath) => ipcRenderer.invoke('delete-clip-file', { filePath }),

  // Detachable hub window
  openHubWindow: () => ipcRenderer.invoke('open-hub-window'),
  closeHubWindow: () => ipcRenderer.invoke('close-hub-window'),
  onHubReattached: (cb) => ipcRenderer.on('hub-reattached', () => cb()),
  sendHubStateUpdate: (state) => ipcRenderer.send('hub-state-update', state),
  onHubAction: (cb) => ipcRenderer.on('hub-action', (_, action) => cb(action)),
  openPostCaptionWindow: (opts) => ipcRenderer.invoke('open-post-caption-window', opts || {}),
  closePostCaptionWindow: () => ipcRenderer.invoke('close-post-caption-window'),
  sendPostCaptionStateUpdate: (state) => ipcRenderer.send('post-caption-state-update', state),
  onPostCaptionAction: (cb) => ipcRenderer.on('post-caption-action', (_, action) => cb(action)),

  // Batch testing (dev)
  openBatchProgress: () => ipcRenderer.invoke('open-batch-progress'),
  sendBatchProgress: (data) => ipcRenderer.send('batch-progress-update', data),
  closeBatchProgress: () => ipcRenderer.invoke('close-batch-progress'),

  // Collab server connection config (renderer talks WebSocket directly)
  serverGetConfig: () => ipcRenderer.invoke('server-get-config'),
  serverSetConfig: (cfg) => ipcRenderer.invoke('server-set-config', cfg),

  // Floating panel windows
  floatCreate: (opts) => ipcRenderer.invoke('float:create', opts),
  floatClose: (floatId) => ipcRenderer.invoke('float:close', floatId),
  floatDock: (floatId) => ipcRenderer.invoke('float:dock', floatId),
  floatShow: (floatId) => ipcRenderer.invoke('float:show', floatId),
  floatSendState: (floatId, state) => ipcRenderer.send('float:send-state', { floatId, state }),
  onFloatClosed: (cb) => ipcRenderer.on('float:closed', (_, floatId) => cb(floatId)),
  onFloatMoved: (cb) => ipcRenderer.on('float:moved', (_, data) => cb(data)),
  onFloatResized: (cb) => ipcRenderer.on('float:resized', (_, data) => cb(data)),
  onFloatMessage: (cb) => ipcRenderer.on('float:message', (_, data) => cb(data)),

  // Layout config files
  getBuiltinLayouts: () => ipcRenderer.invoke('layouts:get-builtins'),
  listPanelLayouts: () => ipcRenderer.invoke('layouts:list'),
  savePanelLayout: (payload) => ipcRenderer.invoke('layouts:save', payload),
  deletePanelLayout: (key) => ipcRenderer.invoke('layouts:delete', key),
  loadPanelLayoutState: () => ipcRenderer.invoke('layouts:load-state'),
  savePanelLayoutState: (state) => ipcRenderer.invoke('layouts:save-state', state),
  savePanelCurrentLayout: (layout) => ipcRenderer.invoke('layouts:save-current', layout),
  loadPanelCurrentLayout: () => ipcRenderer.invoke('layouts:load-current'),
  clearPanelCurrentLayout: () => ipcRenderer.invoke('layouts:clear-current'),
});
