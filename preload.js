const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipper', {
  getProxyPort: () => ipcRenderer.invoke('get-proxy-port'),
  getChannelConfig: () => ipcRenderer.invoke('get-channel-config'),

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

  // Clip download
  downloadClip: (opts) => ipcRenderer.invoke('download-clip', opts),
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

  // Delete clip file (for Re-Stage)
  deleteClipFile: (filePath) => ipcRenderer.invoke('delete-clip-file', { filePath }),

  // Detachable hub window
  openHubWindow: () => ipcRenderer.invoke('open-hub-window'),
  closeHubWindow: () => ipcRenderer.invoke('close-hub-window'),
  onHubReattached: (cb) => ipcRenderer.on('hub-reattached', () => cb()),
  sendHubStateUpdate: (state) => ipcRenderer.send('hub-state-update', state),
  onHubAction: (cb) => ipcRenderer.on('hub-action', (_, action) => cb(action)),

  // Batch testing (dev)
  openBatchProgress: () => ipcRenderer.invoke('open-batch-progress'),
  sendBatchProgress: (data) => ipcRenderer.send('batch-progress-update', data),
  closeBatchProgress: () => ipcRenderer.invoke('close-batch-progress'),

  // Collaboration lobby (cross-process via main + shared files)
  collabCreateLobby: (payload) => ipcRenderer.invoke('collab-create-lobby', payload),
  collabJoinLobby: (payload) => ipcRenderer.invoke('collab-join-lobby', payload),
  collabLeaveLobby: (payload) => ipcRenderer.invoke('collab-leave-lobby', payload),
  collabGetLobby: (payload) => ipcRenderer.invoke('collab-get-lobby', payload),
  collabAddChat: (payload) => ipcRenderer.invoke('collab-add-chat', payload),
  collabUpsertRange: (payload) => ipcRenderer.invoke('collab-upsert-range', payload),

  // Floating panel windows
  floatCreate: (opts) => ipcRenderer.invoke('float:create', opts),
  floatClose: (floatId) => ipcRenderer.invoke('float:close', floatId),
  floatDock: (floatId) => ipcRenderer.invoke('float:dock', floatId),
  floatSendState: (floatId, state) => ipcRenderer.send('float:send-state', { floatId, state }),
  onFloatClosed: (cb) => ipcRenderer.on('float:closed', (_, floatId) => cb(floatId)),
  onFloatMoved: (cb) => ipcRenderer.on('float:moved', (_, data) => cb(data)),
  onFloatResized: (cb) => ipcRenderer.on('float:resized', (_, data) => cb(data)),
  onFloatMessage: (cb) => ipcRenderer.on('float:message', (_, data) => cb(data)),

  // Layout config files
  getBuiltinLayouts: () => ipcRenderer.invoke('layouts:get-builtins'),
});
