(function () {
'use strict';

/* ─── Utilities ─────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const fmtDur = window.Player.utils.fmtDur;
const fmtHMS = window.Player.utils.fmtHMS;
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function escAttr(s) { return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
const X_PREVIEW_CHAR_LIMIT = 280;
const clipFrameThumbCache = new Map();

function toFileUrl(filePath) {
  if (!filePath) return '';
  if (/^file:\/\//i.test(filePath)) return filePath;
  let normalized = String(filePath).replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) normalized = '/' + normalized;
  return encodeURI('file://' + normalized);
}

function getClipStartFrameDataUrl(filePath) {
  if (!filePath) return Promise.resolve(null);
  if (clipFrameThumbCache.has(filePath)) return Promise.resolve(clipFrameThumbCache.get(filePath) || null);
  const captureFromVideo = () => new Promise(resolve => {
    let settled = false;
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      clearTimeout(timeoutId);
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch (_) {}
    };
    const finish = (dataUrl) => {
      if (settled) return;
      settled = true;
      clipFrameThumbCache.set(filePath, dataUrl || '');
      cleanup();
      resolve(dataUrl || null);
    };
    const capture = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish(null);
        return;
      }
      const maxWidth = 1280;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      const width = Math.round(video.videoWidth * scale);
      const height = Math.round(video.videoHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        finish(null);
        return;
      }
      ctx.drawImage(video, 0, 0, width, height);
      let dataUrl = null;
      try {
        dataUrl = canvas.toDataURL('image/jpeg', 0.86);
      } catch (_) {
        dataUrl = null;
      }
      finish(dataUrl);
    };

    const timeoutId = setTimeout(() => finish(null), 7000);
    video.addEventListener('loadeddata', capture, { once: true });
    video.addEventListener('error', () => finish(null), { once: true });
    try {
      video.src = toFileUrl(filePath);
      video.load();
    } catch (_) {
      finish(null);
    }
  });

  if (window.clipper && window.clipper.extractClipFirstFrame) {
    return window.clipper.extractClipFirstFrame(filePath).then((res) => {
      if (res && res.success && res.dataUrl) {
        clipFrameThumbCache.set(filePath, res.dataUrl);
        return res.dataUrl;
      }
      return captureFromVideo();
    }).catch(() => captureFromVideo());
  }

  return captureFromVideo();
}

/* ─── Debug Logger (always capturing, detached window) ──── */
function dbg(category, message, data) {
  // Forward to main process → file log + debug window
  if (window.clipper?.sendDebugLog) {
    window.clipper.sendDebugLog({ category, message, data });
  }
}
// Expose for external modules (batch-testing.js etc.)
window.dbg = dbg;

// Debug button opens detached window
const _debugToggle = document.getElementById('debugToggleBtn');
if (_debugToggle) {
  _debugToggle.onclick = () => {
    dbg('ACTION', 'Open debug window');
    if (window.clipper?.openDebugWindow) window.clipper.openDebugWindow();
  };
}

dbg('SESSION', 'Renderer initialized');

// Batch test suite button (wired after batch module loads)
document.addEventListener('DOMContentLoaded', () => {
  const suiteBtn = document.getElementById('batchSuiteBtn');
  if (suiteBtn) {
    suiteBtn.onclick = () => {
      // Use batch reference clip, or fall back to first pending clip
      const refClip = window._batchTestClip || (pendingClips.length > 0 ? pendingClips[0] : null);
      if (!refClip) {
        alert('Mark IN/OUT first to define the test clip, then open Test Suite.');
        return;
      }
      dbg('ACTION', 'Open batch test suite modal');
      if (window._batchTesting?.openTestSuiteModal) {
        window._batchTesting.openTestSuiteModal(refClip);
      }
    };
  }
});

/* ─── State ─────────────────────────────────────────────────── */
// Player state is managed by window.Player.state — aliases for convenience
const PS = window.Player.state;
let markingIn = false;
let pendingInTime = null;
let pendingMarkRangeId = null;
let pendingInFrameDataUrl = null;
let pendingClips = [];
let downloadingClips = [];
let completedClips = [];
let captionTimelineClips = [];
let selectedPostCaptionClipId = null;
const postCaptionThumbInflight = new Map();
let activeDownloadId = null;   // id of clip currently being processed
let repickState = null;        // { idx, field } when re-picking IN/OUT

// Batch testing mode (dev)
let batchModeEnabled = false;
let batchModeActive = false;

/* ─── User Config (persisted to Roaming) ─────────────────────── */
let userConfig = {
  buttons: {
    jumpToIn: true,
    jumpToEnd: false,
    watermark: true,
    appendOutro: true,
  },
  defaultChannel: { enabled: false, channel_id: '' },
  ffmpeg: {
    hwaccel: '',
    hwaccelOutputFormat: '',
    hwaccelDevice: '',
    videoCodec: 'libx264',
    preset: 'fast',
    crf: '18',
    nvencPreset: 'p4',
    audioCodec: 'aac',
    audioBitrate: '192k',
  },
  keybinds: {
    markIn: 'g',
    markOut: 'k',
    editIn: 'h',
    editOut: 'j',
    playPause: ' ',
    seekBackSmall: 'ArrowLeft',
    seekForwardSmall: 'ArrowRight',
    seekBackMedium: 'shift+ArrowLeft',
    seekForwardMedium: 'shift+ArrowRight',
    seekBackLarge: 'ctrl+ArrowLeft',
    seekForwardLarge: 'ctrl+ArrowRight',
    jumpSizeSmall: 5,
    jumpSizeMedium: 30,
    jumpSizeLarge: 60,
  },
  catchUpSpeed: 1.5,
  transcriptionBackend: 'cpu', // 'cpu' (WASM Whisper) or 'gpu' (whisper.cpp CUDA)
  devFeatures: {
    ffmpegLogs: false,
    keepTempFiles: false,
    logFfmpegCommands: false,
  },
};

// Universal watermark config (cached separately)
let universalWatermark = null;
let universalImageWatermark = null;
// Universal outro config
let universalOutro = { enabled: false, filePath: '' };

/* ─── Browse / Player mode ──────────────────────────────────── */
let inBrowseMode = true;
const browserWrap    = $('browserWrap');
const channelBrowser = $('channelBrowser');
const backBtn        = $('backBtn');

function isRumbleVideo(url) {
  return /rumble\.com\/[^/]+\.html/i.test(url);
}

function showPlayerView() {
  if (!inBrowseMode) return;
  inBrowseMode = false;
  browserWrap.style.display = 'none';
  $('dockRoot').style.display = '';
  $('playerWrap').style.display = '';
  $('markerState').style.display = '';
  backBtn.classList.add('on');
}

function showBrowserView() {
  if (PS.videoLoaded) {
    if (!confirm('Are you sure you want to go back? The current video will be unloaded.')) return;
  }
  inBrowseMode = true;
  browserWrap.style.display = '';
  $('dockRoot').style.display = 'none';
  $('playerWrap').style.display = 'none';
  $('markerState').style.display = 'none';
  backBtn.classList.remove('on');

  window.Player.stream.resetPlayer();
  pendingInTime = null;
  markingIn = false;
  $('urlIn').value = '';
}

backBtn.onclick = () => { dbg('ACTION', 'Back to channel browser clicked'); showBrowserView(); };

/* ─── Init ──────────────────────────────────────────────────── */
// Initialize the Player module
window.Player.init($);

// Listen for player events
window.Player.on('showplayer', () => showPlayerView());
window.Player.on('timeupdate', () => renderProgressMarkers());
if (window.CollabUI && window.CollabUI.subscribe) {
  window.CollabUI.subscribe(() => renderProgressMarkers());
}

(async () => {
  PS.proxyPort = await window.clipper.getProxyPort();
  const dir = await window.clipper.getClipsDir();
  $('outputPath').textContent = dir;

  // Load saved config
  const savedConfig = await window.clipper.loadUserConfig();
  if (savedConfig) {
    userConfig = mergeDeep(userConfig, savedConfig);
  }

  // Load universal watermark config
  const savedWm = await window.clipper.loadWatermarkConfig();
  if (savedWm) {
    universalWatermark = savedWm.watermark || null;
    universalImageWatermark = savedWm.imageWatermark || null;
    universalOutro = savedWm.outro || { enabled: false, filePath: '' };
  }

  applyConfig();

  // Apply saved transcription backend
  if (userConfig.transcriptionBackend) {
    window.Player.transcription.setBackend(userConfig.transcriptionBackend);
  }

  // Persist backend changes from the dropdown
  window.Player.on('transcription-backend-changed', (data) => {
    userConfig.transcriptionBackend = data.backend;
    saveConfig();
  });

  window.clipper.onClipProgress(({ clipName, progress }) => {
    const dl = downloadingClips.find(d => d.name === clipName);
    if (dl) { dl.progress = progress; renderDownloadingClips(); }
  });

  window.clipper.onStreamFound(({ m3u8, isLive: live }) => {
    dbg('STREAM', 'Stream found via navigator', { m3u8: m3u8?.slice(0, 120), isLive: live });
    showPlayerView();
    urlIn.value = m3u8;
    window.Player.stream.setStatus('ok', 'Stream grabbed from navigator!');
    PS.currentM3U8 = m3u8;
    window.Player.stream.loadStream(m3u8, live);
    PS.videoLoaded = true;
  });

  // Load channel config and set up the embedded browser
  const config = await window.clipper.getChannelConfig();
  if (userConfig.defaultChannel.enabled && userConfig.defaultChannel.channel_id) {
    channelBrowser.src = `https://rumble.com/c/${userConfig.defaultChannel.channel_id}`;
  } else if (config && config.channel_id) {
    channelBrowser.src = `https://rumble.com/c/${config.channel_id}`;
  } else {
    channelBrowser.src = 'https://rumble.com';
  }

  window.Player.stream.setStatus('', 'Browse the channel and click a video to load it');

  channelBrowser.addEventListener('will-navigate', (e) => {
    if (inBrowseMode && isRumbleVideo(e.url)) {
      setTimeout(() => channelBrowser.stop(), 50);
      urlIn.value = e.url;
      window.Player.stream.handleURL(e.url);
    }
  });

  channelBrowser.addEventListener('new-window', (e) => {
    e.preventDefault();
    if (isRumbleVideo(e.url)) {
      urlIn.value = e.url;
      window.Player.stream.handleURL(e.url);
    } else if (/rumble\.com/i.test(e.url)) {
      channelBrowser.loadURL(e.url);
    }
  });

  channelBrowser.addEventListener('did-start-navigation', (e) => {
    if (inBrowseMode && e.isMainFrame && isRumbleVideo(e.url)) {
      channelBrowser.stop();
      urlIn.value = e.url;
      window.Player.stream.handleURL(e.url);
    }
  });
})();

function mergeDeep(target, source) {
  const out = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
      out[key] = mergeDeep(target[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

function applyConfig() {
  // Apply button visibility to pending clips header toggles
  // (this is called after config load and after config changes)
}

async function saveConfig() {
  await window.clipper.saveUserConfig(userConfig);
}

async function saveUniversalConfigs() {
  await window.clipper.saveWatermarkConfig({
    watermark: universalWatermark,
    imageWatermark: universalImageWatermark,
    outro: universalOutro,
  });
}

/* ─── Stream loading (delegated to Player module) ──────────── */
const urlIn      = $('urlIn');
const loadBtn    = $('loadBtn');
const postCaptionEditorBtn = $('postCaptionEditorBtn');
const navBtn     = $('navBtn');
const importBtn  = $('importBtn');
const vid        = $('vid');
const playerWrap = $('playerWrap');

loadBtn.onclick = () => { dbg('ACTION', 'Load Stream clicked', { url: urlIn.value.trim().slice(0, 120) }); window.Player.stream.handleURL(urlIn.value.trim()); };
if (postCaptionEditorBtn) {
  postCaptionEditorBtn.onclick = () => {
    dbg('ACTION', 'Open Post Caption Editor from header');
    openPostCaptionWindow(undefined, { tab: 'clips', source: 'header-button' });
  };
}
urlIn.onkeydown = e => { if (e.key === 'Enter') { dbg('ACTION', 'URL submitted via Enter', { url: urlIn.value.trim().slice(0, 120) }); window.Player.stream.handleURL(urlIn.value.trim()); } };

if (navBtn) navBtn.onclick = () => {
  const url = urlIn.value.trim();
  dbg('ACTION', 'Browse Streams clicked', { url: url || '(none)' });
  window.clipper.openNavigator({ url: window.Player.stream.isRumble(url) ? url : undefined });
  window.Player.stream.setStatus('', 'Stream navigator open — play any video to grab the stream');
};

importBtn && (importBtn.onclick = () => {
  dbg('ACTION', 'Import local file clicked');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*,.m3u8,.m3u';
  input.onchange = () => {
    const f = input.files[0];
    if (!f) return;
    if (f.name.endsWith('.m3u8') || f.name.endsWith('.m3u')) {
      window.Player.stream.handleURL(f.path || f.name);
    } else {
      PS.currentM3U8 = null;
      const objectUrl = URL.createObjectURL(f);
      window.Player.stream.loadLocalFile(objectUrl, f.name);
    }
  };
  input.click();
});

/* ─── Player controls are now handled by src/player/ modules ─ */
const progTrack = $('progressTrack');
const collabRangeIndicator = $('collabRangeIndicator');
const timelineCollabIndicator = $('timelineCollabIndicator');
const playerWrapEl = $('playerWrap');

/* ─── Customizable Keybinds ─────────────────────────────────── */
const matchKeybind = window.Player.keybinds.matchKeybind;

document.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;

  // Cancel re-pick mode on Escape
  if (e.key === 'Escape' && repickState) {
    repickState = null;
    cancelMarking();
    markerState.classList.remove('repicking');
    return;
  }

  const kb = userConfig.keybinds;

  // Mark IN/OUT (clip-management keybinds — stay here)
  if (matchKeybind(e, kb.markIn)) { e.preventDefault(); handleMarkIn(); return; }
  if (matchKeybind(e, kb.markOut)) { e.preventDefault(); handleMarkOut(); return; }

  // Edit IN/OUT (re-pick most recent pending clip)
  if (matchKeybind(e, kb.editIn) && pendingClips.length > 0) {
    e.preventDefault();
    enterRepickMode(pendingClips.length - 1, 'inTime');
    return;
  }
  if (matchKeybind(e, kb.editOut) && pendingClips.length > 0) {
    e.preventDefault();
    enterRepickMode(pendingClips.length - 1, 'outTime');
    return;
  }

  // Batch mode toggle: press B (only when enabled in settings)
  if ((e.key === 'b' || e.key === 'B') && batchModeEnabled) {
    e.preventDefault();
    batchModeActive = !batchModeActive;
    $('batchPanel').style.display = batchModeActive ? '' : 'none';
    dbg('ACTION', 'Batch mode ' + (batchModeActive ? 'ON' : 'OFF'));
    return;
  }

  // All other player keybinds (play/pause, seek, volume, speed, fullscreen, PiP, catch-up)
  if (window.Player.keybinds.handlePlayerKeybind(e, kb, userConfig.catchUpSpeed)) return;
});

/* ─── IN / OUT markers (CLIPPER'S EXACT LOGIC) ──────────────── */
const markInBtn   = $('markInBtn');
const markOutBtn  = $('markOutBtn');
const markerState = $('markerState');

markInBtn.onclick  = handleMarkIn;
markOutBtn.onclick = handleMarkOut;
if (window._panelBus && window._panelBus.on) {
  window._panelBus.on('collab:jump-to-time', function (payload) {
    if (!payload || !isFinite(payload.time)) return;
    vid.currentTime = Number(payload.time);
  });
}

function captureCurrentVideoFrameDataUrl(videoEl) {
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return null;
  const maxWidth = 1280;
  const scale = Math.min(1, maxWidth / videoEl.videoWidth);
  const width = Math.round(videoEl.videoWidth * scale);
  const height = Math.round(videoEl.videoHeight * scale);
  if (width <= 0 || height <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(videoEl, 0, 0, width, height);
  try {
    return canvas.toDataURL('image/jpeg', 0.86);
  } catch (_) {
    return null;
  }
}

function getCollabMarkContext() {
  if (window.CollabUI && window.CollabUI.getMarkContext) {
    const ctx = window.CollabUI.getMarkContext();
    if (ctx) return ctx;
  }
  const collabState = window.CollabUI && window.CollabUI.getState ? window.CollabUI.getState() : null;
  const name = collabState && collabState.me ? collabState.me.name : 'You';
  const userId = collabState && collabState.me ? collabState.me.id : null;
  return {
    userId,
    userName: name,
    clipperId: userId,
    clipperName: name,
    helperId: null,
    helperName: ''
  };
}

function upsertCollabClipRange(rangePatch) {
  if (!window.CollabUI || !window.CollabUI.upsertClipRange) return null;
  const ctx = getCollabMarkContext();
  return window.CollabUI.upsertClipRange(Object.assign({
    userId: ctx.userId,
    userName: ctx.userName,
    clipperId: ctx.clipperId,
    clipperName: ctx.clipperName,
    helperId: ctx.helperId,
    helperName: ctx.helperName
  }, rangePatch || {}));
}

function updateCollabClipStage(clip, status, extra) {
  if (!clip || !clip.collabRangeId || !window.CollabUI || !window.CollabUI.upsertClipRange) return;
  const meta = {};
  if (clip.collabClipperId) meta.clipperId = clip.collabClipperId;
  if (clip.collabClipperName) meta.clipperName = clip.collabClipperName;
  if (clip.collabHelperId) meta.helperId = clip.collabHelperId;
  if (clip.collabHelperName) meta.helperName = clip.collabHelperName;
  upsertCollabClipRange(Object.assign({
    id: clip.collabRangeId,
    inTime: clip.inTime,
    outTime: clip.outTime,
    pendingOut: false,
    status: status
  }, meta, extra || {}));
}

function handleMarkIn() {
  if (vid.style.display === 'none') return;
  // Re-pick mode: block normal IN logic for ANY repick state
  if (repickState) {
    if (repickState.field === 'inTime') {
      pendingClips[repickState.idx].inTime = vid.currentTime;
      dbg('ACTION', 'Re-picked IN', { idx: repickState.idx, newTime: vid.currentTime });
      repickState = null;
      cancelMarking();
      renderPendingClips();
    }
    return;  // Block normal IN logic for ANY repick state
  }
  if (markingIn) { dbg('ACTION', 'Mark IN cancelled (toggled off)'); cancelMarking({ removePendingRange: true }); return; }

  pendingInTime = vid.currentTime;
  dbg('ACTION', 'Mark IN pressed', { currentTime: pendingInTime });
  markingIn = true;
  pendingInFrameDataUrl = captureCurrentVideoFrameDataUrl(vid);
  markInBtn.classList.add('active');
  markOutBtn.disabled = false;
  markerState.classList.add('marking');
  markerState.querySelector('.marker-state-label').textContent = 'IN set at ' + fmtHMS(pendingInTime);
  markerState.querySelector('.marker-state-hint').innerHTML = 'Press <kbd>O</kbd> to set OUT, or <kbd>I</kbd> to cancel';

  const seekable = vid.seekable;
  // Use LocalPlaylist's fixed offset for live streams (stable timeline),
  // fall back to current seekable.start(0) if LocalPlaylist isn't active
  if (window.LocalPlaylist && window.LocalPlaylist.isActive()) {
    markerState._seekableStart = window.LocalPlaylist.getMediaTimeOffset();
  } else {
    markerState._seekableStart = seekable.length > 0 ? seekable.start(0) : 0;
  }
  const collabRange = upsertCollabClipRange({
    id: pendingMarkRangeId || undefined,
    inTime: pendingInTime,
    outTime: pendingInTime,
    pendingOut: true,
    status: 'marking'
  });
  if (collabRange && collabRange.id) pendingMarkRangeId = collabRange.id;
  dbg('MARK', 'IN set', { inTime: pendingInTime, seekableStart: markerState._seekableStart, seekableEnd: seekable.length > 0 ? seekable.end(seekable.length-1) : null, isLive: PS.isLive, currentTime: vid.currentTime });
  renderProgressMarkers();
}

function handleMarkOut() {
  // Re-pick mode: update existing clip's OUT time
  if (repickState && repickState.field === 'outTime') {
    pendingClips[repickState.idx].outTime = vid.currentTime;
    dbg('ACTION', 'Re-picked OUT', { idx: repickState.idx, newTime: vid.currentTime });
    repickState = null;
    cancelMarking();
    renderPendingClips();
    return;
  }
  if (!markingIn || pendingInTime === null) return;
  const outTime = vid.currentTime;
  dbg('ACTION', 'Mark OUT pressed', { currentTime: outTime, inTime: pendingInTime });
  if (outTime <= pendingInTime) { dbg('ACTION', 'Mark OUT rejected — before IN'); alert('OUT must be after IN.'); return; }

  // Snapshot the local playlist text now — if user switches streams later,
  // this clip still has the correct segment data from its original stream
  const localM3u8Text = (window.LocalPlaylist && window.LocalPlaylist.isActive() && PS.isLive)
    ? window.LocalPlaylist.getPlaylistText()
    : null;
  const markCtx = getCollabMarkContext();
  const clipObj = {
    id: uid(),
    name: 'Clip ' + (pendingClips.length + completedClips.length + 1),
    caption: '',
    postCaption: '',
    inTime: pendingInTime,
    outTime,
    m3u8Url: PS.currentM3U8,
    m3u8Text: localM3u8Text,
    isLive: PS.isLive,
    seekableStart: markerState._seekableStart || 0,
    postThumbnailDataUrl: pendingInFrameDataUrl || '',
    collabClipperId: markCtx.clipperId || null,
    collabClipperName: markCtx.clipperName || '',
    collabHelperId: markCtx.helperId || null,
    collabHelperName: markCtx.helperName || '',
  };
  if (window.CollabUI && window.CollabUI.upsertClipRange) {
    const collabRange = upsertCollabClipRange({
      id: pendingMarkRangeId || undefined,
      clipperId: clipObj.collabClipperId,
      clipperName: clipObj.collabClipperName,
      helperId: clipObj.collabHelperId,
      helperName: clipObj.collabHelperName,
      inTime: clipObj.inTime,
      outTime: clipObj.outTime,
      pendingOut: false,
      status: 'queued'
    });
    if (collabRange) {
      clipObj.collabRangeId = collabRange.id;
      clipObj.collabClipperId = collabRange.clipperId || clipObj.collabClipperId;
      clipObj.collabClipperName = collabRange.clipperName || clipObj.collabClipperName;
      clipObj.collabHelperId = collabRange.helperId || clipObj.collabHelperId;
      clipObj.collabHelperName = collabRange.helperName || clipObj.collabHelperName;
    }
  }
  dbg('MARK', 'OUT set — clip created', { name: clipObj.name, inTime: clipObj.inTime, outTime: clipObj.outTime, duration: outTime - pendingInTime, seekableStart: clipObj.seekableStart, isLive: PS.isLive, m3u8: PS.currentM3U8?.slice(0, 80) });

  if (batchModeActive) {
    // Batch mode: store reference clip for test suite, do NOT add to pending list
    window._batchTestClip = clipObj;
    dbg('ACTION', 'Batch: IN/OUT captured for test suite', { inTime: clipObj.inTime, outTime: clipObj.outTime, duration: outTime - pendingInTime });
    // Auto-open the test suite modal
    if (window._batchTesting?.openTestSuiteModal) {
      window._batchTesting.openTestSuiteModal(clipObj);
    }
  } else {
    pendingClips.push(clipObj);
    renderPendingClips();
  }

  cancelMarking({ removePendingRange: false });
}

function cancelMarking(opts) {
  var options = Object.assign({ removePendingRange: true }, opts || {});
  var rangeId = pendingMarkRangeId;
  markingIn = false; pendingInTime = null;
  pendingMarkRangeId = null;
  pendingInFrameDataUrl = null;
  markInBtn.classList.remove('active');
  markOutBtn.disabled = true;
  markerState.classList.remove('marking');
  markerState.classList.remove('repicking');
  markerState.querySelector('.marker-state-label').textContent = 'Ready to mark';
  markerState.querySelector('.marker-state-hint').innerHTML = 'Press <kbd>I</kbd> to set IN point during playback';
  markerState._seekableStart = null;
  if (options.removePendingRange && rangeId && window.CollabUI && window.CollabUI.removeClipRange) {
    window.CollabUI.removeClipRange(rangeId);
  }
  renderProgressMarkers();
}

/* ─── Progress bar markers ──────────────────────────────────── */
function renderProgressMarkers() {
  progTrack.querySelectorAll('.progress-marker, .progress-marker-range').forEach(el => el.remove());

  let rangeStart = 0, rangeLen = 0;
  if (PS.isLive && vid.seekable.length > 0) {
    rangeStart = vid.seekable.start(0);
    rangeLen = vid.seekable.end(vid.seekable.length - 1) - rangeStart;
  } else if (isFinite(vid.duration) && vid.duration > 0) {
    rangeLen = vid.duration;
  }
  if (rangeLen <= 0) {
    updateCollabIndicators(vid.currentTime);
    return;
  }

  const toPct = t => ((t - rangeStart) / rangeLen * 100);

  pendingClips.forEach(clip => {
    const inPct  = toPct(clip.inTime);
    const outPct = toPct(clip.outTime);

    const rng = Object.assign(document.createElement('div'), { className: 'progress-marker-range' });
    rng.style.cssText = `left:${inPct}%;width:${outPct-inPct}%`;
    progTrack.appendChild(rng);

    [['in', inPct], ['out', outPct]].forEach(([cls, pct]) => {
      const m = Object.assign(document.createElement('div'), { className: `progress-marker ${cls}` });
      m.style.left = pct + '%';
      progTrack.appendChild(m);
    });
  });

  if (markingIn && pendingInTime !== null) {
    const m = Object.assign(document.createElement('div'), { className: 'progress-marker in' });
    m.style.left = toPct(pendingInTime) + '%';
    progTrack.appendChild(m);
  }

  if (window.CollabUI && window.CollabUI.getClipRanges) {
    const ranges = window.CollabUI.getClipRanges();
    ranges.forEach(range => {
      const color = (window.CollabUI.getUserColor && window.CollabUI.getUserColor(range.userId, range.userName)) || '#7fb7ff';
      const inPct = toPct(range.inTime);
      const outPct = toPct(range.outTime);
      const clampedIn = Math.max(0, Math.min(100, inPct));
      const clampedOut = Math.max(0, Math.min(100, outPct));
      if (range.pendingOut) {
        if (clampedIn < 0 || clampedIn > 100) return;
        const marker = Object.assign(document.createElement('div'), { className: 'progress-marker in ghost' });
        marker.style.left = clampedIn + '%';
        marker.style.background = color;
        progTrack.appendChild(marker);
        return;
      }
      if (clampedOut <= 0 || clampedIn >= 100 || clampedOut <= clampedIn) return;

      const ghostRange = Object.assign(document.createElement('div'), { className: 'progress-marker-range ghost' });
      ghostRange.style.cssText = `left:${clampedIn}%;width:${clampedOut - clampedIn}%`;
      ghostRange.style.background = hexToRgba(color, 0.2);
      ghostRange.style.borderTopColor = hexToRgba(color, 0.65);
      ghostRange.style.borderBottomColor = hexToRgba(color, 0.65);
      progTrack.appendChild(ghostRange);

      [['in', clampedIn], ['out', clampedOut]].forEach(([cls, pct]) => {
        const marker = Object.assign(document.createElement('div'), { className: `progress-marker ${cls} ghost` });
        marker.style.left = pct + '%';
        marker.style.background = color;
        progTrack.appendChild(marker);
      });
    });
  }

  updateCollabIndicators(vid.currentTime);
}

function updateCollabIndicators(currentTime) {
  if (!window.CollabUI || !window.CollabUI.getIndicatorAtTime) {
    if (collabRangeIndicator) collabRangeIndicator.style.display = 'none';
    if (timelineCollabIndicator) timelineCollabIndicator.style.display = 'none';
    if (playerWrapEl) playerWrapEl.classList.remove('collab-active-glow');
    return;
  }

  const active = window.CollabUI.getIndicatorAtTime(currentTime);
  if (!active) {
    if (collabRangeIndicator) collabRangeIndicator.style.display = 'none';
    if (timelineCollabIndicator) timelineCollabIndicator.style.display = 'none';
    if (playerWrapEl) playerWrapEl.classList.remove('collab-active-glow');
    return;
  }

  if (collabRangeIndicator) collabRangeIndicator.style.display = 'none';
  if (timelineCollabIndicator) {
    timelineCollabIndicator.textContent = active.text;
    timelineCollabIndicator.style.display = 'inline-flex';
  }
  if (playerWrapEl) playerWrapEl.classList.add('collab-active-glow');
}

function hexToRgba(hex, alpha) {
  const clean = String(hex || '').replace('#', '');
  if (clean.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ─── Clip Hub — Pending (with watermark/outro buttons) ────── */
function renderPendingClips() {
  const list = $('pendingClipList');
  if (pendingClips.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No clips yet</p><small>Mark IN/OUT points while watching to create clips</small></div>';
    updateClipCount(); return;
  }

  const btns = userConfig.buttons;

  list.innerHTML = pendingClips.map((clip, idx) => `
    <div class="clip-card">
      <div class="clip-card-header">
        <input class="clip-card-name" type="text" value="${escAttr(clip.name)}" data-idx="${idx}" placeholder="Clip name...">
        <button class="clip-card-remove" data-idx="${idx}">&times;</button>
      </div>
      <div class="clip-card-times">
        <span><span class="label">IN</span> <span class="in-val timestamp-editable" data-field="inTime" data-idx="${idx}" title="Click to edit">${fmtHMS(clip.inTime)}</span><button class="repick-btn" data-action="repickIn" data-idx="${idx}" title="Re-pick IN from video">&#9998;</button></span>
        <span><span class="label">OUT</span> <span class="out-val timestamp-editable" data-field="outTime" data-idx="${idx}" title="Click to edit">${fmtHMS(clip.outTime)}</span><button class="repick-btn" data-action="repickOut" data-idx="${idx}" title="Re-pick OUT from video">&#9998;</button></span>
        <span><span class="label">DUR</span> <span class="dur-val">${fmtDur(clip.outTime - clip.inTime)}</span></span>
      </div>
      <textarea class="clip-card-caption" data-idx="${idx}" placeholder="Caption / summary idea..." rows="1">${escH(clip.caption)}</textarea>
      <div class="clip-card-actions">
        <button class="btn btn-success btn-xs" data-action="download" data-idx="${idx}">&#11015; Download</button>
        ${(clip.watermark || clip.imageWatermark || universalWatermark || universalImageWatermark) ? `<button class="btn btn-ghost btn-xs" data-action="preview" data-idx="${idx}" title="Preview watermark placement">Preview</button>` : ''}
        ${btns.jumpToIn ? `<button class="btn btn-ghost btn-xs" data-action="jumpin" data-idx="${idx}">Jump to IN</button>` : ''}
        ${btns.jumpToEnd ? `<button class="btn btn-ghost btn-xs" data-action="jumpout" data-idx="${idx}">Jump to OUT</button>` : ''}
        ${btns.watermark ? `<button class="btn btn-accent btn-xs wm-btn-icon" data-action="watermark" data-idx="${idx}" title="Watermark${(clip.watermark || clip.imageWatermark) ? ' (configured)' : ''}">
          <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          ${(clip.watermark || clip.imageWatermark) ? '<span class="wm-dot"></span>' : ''}
        </button>` : ''}
        ${btns.appendOutro ? `<button class="btn btn-ghost btn-xs" data-action="outro" data-idx="${idx}" title="Add Outro${clip.outro ? ' (set)' : ''}">Add Outro${clip.outro ? ' *' : ''}</button>` : ''}
      </div>
    </div>
  `).join('');

  list.onclick = e => {
    // Handle timestamp click-to-edit
    const tsEl = e.target.closest('.timestamp-editable');
    if (tsEl) { startInlineTimestampEdit(tsEl, parseInt(tsEl.dataset.idx), tsEl.dataset.field); return; }

    const btn = e.target.closest('[data-action], .clip-card-remove');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    if (btn.classList.contains('clip-card-remove')) {
      const removed = pendingClips[idx];
      dbg('ACTION', 'Remove clip', { idx, name: removed?.name });
      pendingClips.splice(idx, 1);
      if (removed && removed.collabRangeId && window.CollabUI && window.CollabUI.removeClipRange) {
        window.CollabUI.removeClipRange(removed.collabRangeId);
      }
      renderPendingClips();
      return;
    }
    if (btn.dataset.action === 'download') { dbg('ACTION', 'Download clip clicked', { idx, name: pendingClips[idx]?.name }); downloadClip(idx); }
    if (btn.dataset.action === 'preview') { dbg('ACTION', 'Preview watermark clicked', { idx, name: pendingClips[idx]?.name }); previewClip(idx, btn); }
    if (btn.dataset.action === 'jumpin') { dbg('ACTION', 'Jump to IN', { idx, time: pendingClips[idx]?.inTime }); vid.currentTime = pendingClips[idx].inTime; }
    if (btn.dataset.action === 'jumpout') { dbg('ACTION', 'Jump to OUT', { idx, time: pendingClips[idx]?.outTime }); vid.currentTime = pendingClips[idx].outTime; }
    if (btn.dataset.action === 'watermark') { dbg('ACTION', 'Open watermark modal', { idx }); openWatermarkModal(idx); }
    if (btn.dataset.action === 'outro') { dbg('ACTION', 'Open outro modal', { idx }); openOutroModal(idx); }
    if (btn.dataset.action === 'repickIn') { enterRepickMode(idx, 'inTime'); }
    if (btn.dataset.action === 'repickOut') { enterRepickMode(idx, 'outTime'); }
  };
  list.oninput = e => {
    const idx = parseInt(e.target.dataset.idx);
    if (isNaN(idx)) return;
    if (e.target.classList.contains('clip-card-name'))    pendingClips[idx].name    = e.target.value;
    if (e.target.classList.contains('clip-card-caption')) pendingClips[idx].caption = e.target.value;
  };

  updateClipCount();
  syncHubState();
  syncPostCaptionState();
}

/* ─── Inline Timestamp Editing ─────────────────────────────────── */
function startInlineTimestampEdit(el, idx, field) {
  const clip = pendingClips[idx];
  if (!clip) return;
  const currentVal = fmtHMS(clip[field]);
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentVal;
  input.className = 'timestamp-edit-input';
  el.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    const val = input.value.trim();
    const parts = val.split(':').map(Number);
    let seconds;
    if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else seconds = parseFloat(val);
    if (!isNaN(seconds) && seconds >= 0) {
      clip[field] = seconds;
      dbg('ACTION', `Edited ${field}`, { idx, newValue: seconds, formatted: fmtHMS(seconds) });
    }
    renderPendingClips();
  }
  let committed = false;
  input.onblur = () => { if (!committed) { committed = true; commit(); } };
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); committed = true; commit(); }
    if (e.key === 'Escape') { renderPendingClips(); }
  };
}

/* ─── Re-pick Mode ─────────────────────────────────────────────── */
function enterRepickMode(idx, field) {
  const clip = pendingClips[idx];
  if (!clip) return;
  repickState = { idx, field };
  if (field === 'outTime') markOutBtn.disabled = false;
  dbg('ACTION', `Enter re-pick mode for ${field}`, { idx, clipName: clip.name });
  markerState.style.display = '';
  markerState.classList.remove('marking');
  markerState.classList.add('repicking');
  markerState.querySelector('.marker-state-label').textContent =
    `Re-picking ${field === 'inTime' ? 'IN' : 'OUT'} for "${clip.name}"`;
  markerState.querySelector('.marker-state-hint').innerHTML =
    `Navigate to the desired point, then press <kbd>${field === 'inTime' ? userConfig.keybinds.markIn.toUpperCase() : userConfig.keybinds.markOut.toUpperCase()}</kbd> · <kbd>Esc</kbd> to cancel`;
}

/* ═══════════════════════════════════════════════════════════════
   ── Watermark Modal (from ClipperWATERMARKTESTING) ──────────
   ═══════════════════════════════════════════════════════════════ */
function openWatermarkModal(idx) {
  const clip = pendingClips[idx];
  if (!clip) return;

  const old = document.querySelector('.wm-modal-overlay');
  if (old) old.remove();

  // Determine initial mode: image if clip has imageWatermark, else text
  const hasImgWm = !!clip.imageWatermark;
  const initMode = hasImgWm ? 'image' : 'text';

  // Text watermark defaults
  const wm = clip.watermark || universalWatermark || {
    text: '', fontFamily: 'Arial', fontSize: 48, opacity: 0.7,
    color: '#ffffff', position: 'bottom-right'
  };

  // Image watermark defaults
  const iwm = clip.imageWatermark || universalImageWatermark || {
    imagePath: '', opacity: 0.7, position: 'bottom-right', width: '', height: ''
  };

  const overlay = document.createElement('div');
  overlay.className = 'wm-modal-overlay';
  overlay.innerHTML = `
    <div class="wm-modal">
      <div class="wm-modal-title">Watermark Settings</div>
      <div class="wm-modal-body">
        <div class="wm-type-toggle">
          <button class="wm-type-btn${initMode==='text'?' active':''}" data-type="text">Text</button>
          <button class="wm-type-btn${initMode==='image'?' active':''}" data-type="image">Image</button>
        </div>

        <div id="wmTextFields" style="display:${initMode==='text'?'block':'none'}">
          <label class="wm-label">Text
            <input class="wm-input" id="wmText" type="text" value="${escAttr(wm.text)}" placeholder="Your watermark text...">
          </label>
          <div class="wm-row">
            <label class="wm-label wm-half">Font
              <select class="wm-select" id="wmFont">
                ${['Arial','Impact','Georgia','Courier New','Verdana','Tahoma','Trebuchet MS','Comic Sans MS'].map(f =>
                  `<option value="${f}"${wm.fontFamily===f?' selected':''}>${f}</option>`
                ).join('')}
              </select>
            </label>
            <label class="wm-label wm-half">Color
              <input class="wm-color" id="wmColor" type="color" value="${wm.color}">
            </label>
          </div>
          <div class="wm-row">
            <label class="wm-label wm-half">Size <span class="wm-val" id="wmSizeVal">${wm.fontSize}px</span>
              <input class="wm-range" id="wmSize" type="range" min="16" max="120" value="${wm.fontSize}">
            </label>
          </div>
        </div>

        <div id="wmImageFields" style="display:${initMode==='image'?'block':'none'}">
          <label class="wm-label">Image File</label>
          <div class="wm-row" style="gap:8px; align-items:center;">
            <button class="btn btn-accent btn-sm" id="wmChooseImage">Choose Image...</button>
            <span class="wm-val" id="wmImageName" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${iwm.imagePath ? iwm.imagePath.split(/[/\\]/).pop() : 'No image selected'}</span>
          </div>
          <input type="hidden" id="wmImagePath" value="${escAttr(iwm.imagePath || '')}">
          <label class="wm-label">Scale <span class="wm-val" id="wmScaleVal">${Math.round((iwm.scale || 1) * 100)}%</span></label>
          <input class="wm-range" id="wmScale" type="range" min="10" max="200" value="${Math.round((iwm.scale || 1) * 100)}">
        </div>

        <label class="wm-label">Opacity <span class="wm-val" id="wmOpacityVal">${Math.round((initMode==='image'?iwm.opacity:wm.opacity)*100)}%</span></label>
        <input class="wm-range" id="wmOpacity" type="range" min="10" max="100" value="${Math.round((initMode==='image'?iwm.opacity:wm.opacity)*100)}">

        <label class="wm-label">Position</label>
        <div class="wm-position-grid${initMode==='image'?' wm-pos-corners':''}" id="wmPosGrid">
          ${['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right'].map(pos =>
            `<button class="wm-pos${(initMode==='image'?iwm.position:wm.position)===pos?' active':''}" data-pos="${pos}">${
              {
                'top-left':'&#8598;','top-center':'&#8593;','top-right':'&#8599;',
                'center-left':'&#8592;','center':'&#9679;','center-right':'&#8594;',
                'bottom-left':'&#8601;','bottom-center':'&#8595;','bottom-right':'&#8600;'
              }[pos]
            }</button>`
          ).join('')}
        </div>

        <div class="wm-preview-wrap">
          <div class="wm-preview" id="wmPreview">
            <span class="wm-preview-text" id="wmPreviewText" style="display:${initMode==='text'?'block':'none'}">${escH(wm.text || 'Preview')}</span>
            <span class="wm-preview-img" id="wmPreviewImg" style="display:${initMode==='image'?'block':'none'}; position:absolute; font-size:10px; color:var(--green); opacity:0.8;">IMG</span>
          </div>
        </div>
      </div>
      <div class="wm-modal-actions">
        <button class="btn btn-ghost btn-sm" id="wmClear">Clear Watermark</button>
        <div class="wm-modal-actions-right">
          <button class="btn btn-ghost btn-sm" id="wmCancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="wmApply">Apply</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let currentMode = initMode;
  const txtIn = overlay.querySelector('#wmText');
  const fontSel = overlay.querySelector('#wmFont');
  const colorIn = overlay.querySelector('#wmColor');
  const sizeIn = overlay.querySelector('#wmSize');
  const opacIn = overlay.querySelector('#wmOpacity');
  const prevText = overlay.querySelector('#wmPreviewText');
  const prevImg = overlay.querySelector('#wmPreviewImg');
  const posGrid = overlay.querySelector('#wmPosGrid');
  const imgPathIn = overlay.querySelector('#wmImagePath');
  const imgNameEl = overlay.querySelector('#wmImageName');

  let selectedPos = (initMode === 'image' ? iwm.position : wm.position) || 'bottom-right';

  // ── Type toggle ──
  overlay.querySelectorAll('.wm-type-btn').forEach(btn => {
    btn.onclick = () => {
      overlay.querySelectorAll('.wm-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.type;
      overlay.querySelector('#wmTextFields').style.display = currentMode === 'text' ? 'block' : 'none';
      overlay.querySelector('#wmImageFields').style.display = currentMode === 'image' ? 'block' : 'none';
      prevText.style.display = currentMode === 'text' ? 'block' : 'none';
      prevImg.style.display = currentMode === 'image' ? 'block' : 'none';
      posGrid.classList.toggle('wm-pos-corners', currentMode === 'image');
      updatePreview();
    };
  });

  // ── Image picker ──
  overlay.querySelector('#wmChooseImage').onclick = async () => {
    const result = await window.clipper.chooseWatermarkImage();
    if (result && result.success) {
      imgPathIn.value = result.filePath;
      imgNameEl.textContent = result.filePath.split(/[/\\]/).pop();
    }
  };

  function updatePreview() {
    opacIn && (overlay.querySelector('#wmOpacityVal').textContent = opacIn.value + '%');
    if (sizeIn) overlay.querySelector('#wmSizeVal').textContent = sizeIn.value + 'px';
    const scaleEl = overlay.querySelector('#wmScaleVal');
    const scaleIn = overlay.querySelector('#wmScale');
    if (scaleEl && scaleIn) scaleEl.textContent = scaleIn.value + '%';

    if (currentMode === 'text') {
      const txt = txtIn.value || 'Preview';
      prevText.textContent = txt;
      prevText.style.fontFamily = fontSel.value;
      prevText.style.fontSize = sizeIn.value / 2 + 'px';
      prevText.style.color = colorIn.value;
      prevText.style.opacity = opacIn.value / 100;
    } else {
      prevImg.style.opacity = opacIn.value / 100;
    }

    // Position the active preview element
    const el = currentMode === 'text' ? prevText : prevImg;
    el.style.position = 'absolute';
    const [vy, vx] = selectedPos.includes('-') ? selectedPos.split('-') : ['center', selectedPos === 'center' ? 'center' : selectedPos];
    el.style.top = vy === 'top' ? '8px' : vy === 'bottom' ? '' : '50%';
    el.style.bottom = vy === 'bottom' ? '8px' : '';
    el.style.left = vx === 'left' ? '8px' : vx === 'center' ? '50%' : '';
    el.style.right = vx === 'right' ? '8px' : '';
    el.style.transform = (vy === 'center' && vx === 'center') ? 'translate(-50%,-50%)'
      : vy === 'center' ? 'translateY(-50%)' : vx === 'center' ? 'translateX(-50%)' : 'none';
  }

  txtIn.oninput = updatePreview;
  fontSel.onchange = updatePreview;
  colorIn.oninput = updatePreview;
  sizeIn.oninput = updatePreview;
  opacIn.oninput = updatePreview;
  const scaleSlider = overlay.querySelector('#wmScale');
  if (scaleSlider) scaleSlider.oninput = updatePreview;

  posGrid.onclick = e => {
    const btn = e.target.closest('[data-pos]');
    if (!btn) return;
    posGrid.querySelectorAll('.wm-pos').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedPos = btn.dataset.pos;
    updatePreview();
  };

  updatePreview();

  overlay.querySelector('#wmCancel').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  overlay.querySelector('#wmClear').onclick = () => {
    delete pendingClips[idx].watermark;
    delete pendingClips[idx].imageWatermark;
    overlay.remove();
    renderPendingClips();
  };

  overlay.querySelector('#wmApply').onclick = () => {
    if (currentMode === 'text') {
      const text = txtIn.value.trim();
      if (!text) {
        delete pendingClips[idx].watermark;
      } else {
        pendingClips[idx].watermark = {
          text,
          fontFamily: fontSel.value,
          fontSize: parseInt(sizeIn.value),
          opacity: parseInt(opacIn.value) / 100,
          color: colorIn.value,
          position: selectedPos
        };
      }
      delete pendingClips[idx].imageWatermark;
    } else {
      const imagePath = imgPathIn.value.trim();
      if (!imagePath) {
        delete pendingClips[idx].imageWatermark;
      } else {
        const scaleVal = parseInt(overlay.querySelector('#wmScale').value) / 100;
        pendingClips[idx].imageWatermark = {
          imagePath,
          opacity: parseInt(opacIn.value) / 100,
          position: selectedPos,
          ...(scaleVal && scaleVal !== 1 ? { scale: scaleVal } : {}),
        };
      }
      delete pendingClips[idx].watermark;
    }
    overlay.remove();
    renderPendingClips();
  };
}

/* ─── Watermark Preview ─────────────────────────────────────── */
async function previewClip(idx, btn) {
  const clip = pendingClips[idx];
  if (!clip) return;

  const watermark = clip.watermark || universalWatermark || null;
  const imageWatermark = clip.imageWatermark || universalImageWatermark || null;

  if (!watermark && !imageWatermark) {
    dbg('PREVIEW', 'No watermark configured, skipping');
    return;
  }

  // Loading state
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '...'; btn.disabled = true; }

  try {
    const previewStartSec = clip.m3u8Text ? clip.inTime - (clip.seekableStart || 0) : clip.inTime;
    dbg('PREVIEW', 'Requesting preview', { m3u8Url: clip.m3u8Url?.slice(0, 80), startSec: previewStartSec, fromCache: !!clip.m3u8Text });
    const result = await window.clipper.previewWatermark({
      m3u8Url: clip.m3u8Url,
      m3u8Text: clip.m3u8Text || null,
      startSec: previewStartSec,
      watermark,
      imageWatermark,
    });

    if (result.success) {
      dbg('PREVIEW', 'Preview ready, opening', { path: result.previewPath });
      await window.clipper.showPreview(result.previewPath);
    } else {
      dbg('ERROR', 'Preview failed', { error: result.error });
      alert('Preview failed: ' + (result.error || 'Unknown error'));
    }
  } catch (err) {
    dbg('ERROR', 'Preview error', { error: err.message });
    alert('Preview error: ' + err.message);
  } finally {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
  }
}

/* ─── Outro Modal ───────────────────────────────────────────── */
function openOutroModal(idx) {
  const clip = pendingClips[idx];
  if (!clip) return;

  const old = document.querySelector('.wm-modal-overlay');
  if (old) old.remove();

  const currentOutro = clip.outro || (universalOutro.enabled ? universalOutro : null);

  const overlay = document.createElement('div');
  overlay.className = 'wm-modal-overlay';
  overlay.innerHTML = `
    <div class="wm-modal">
      <div class="wm-modal-title">Outro Settings</div>
      <div class="wm-modal-body">
        <p style="color: var(--text-secondary); font-size: 12px; margin-bottom: 12px;">
          Select an MP4 video to append to the end of this clip.
        </p>
        <label class="wm-label">Outro Video File
          <div style="display:flex; gap:8px; align-items:center;">
            <input class="wm-input" id="outroPath" type="text" value="${escAttr(currentOutro?.filePath || '')}" placeholder="No file selected..." readonly style="flex:1; cursor:pointer;">
            <button class="btn btn-accent btn-sm" id="outroBrowse">Browse</button>
          </div>
        </label>
        ${currentOutro?.filePath ? `<p style="color: var(--green); font-size: 10px; margin-top: 4px;">Outro configured</p>` : ''}
      </div>
      <div class="wm-modal-actions">
        <button class="btn btn-ghost btn-sm" id="outroClear">Clear Outro</button>
        <div class="wm-modal-actions-right">
          <button class="btn btn-ghost btn-sm" id="outroCancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="outroApply">Apply</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const pathIn = overlay.querySelector('#outroPath');

  overlay.querySelector('#outroBrowse').onclick = async () => {
    const result = await window.clipper.chooseOutroFile();
    if (result.success) {
      pathIn.value = result.filePath;
    }
  };

  pathIn.onclick = async () => {
    const result = await window.clipper.chooseOutroFile();
    if (result.success) {
      pathIn.value = result.filePath;
    }
  };

  overlay.querySelector('#outroCancel').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  overlay.querySelector('#outroClear').onclick = () => {
    delete pendingClips[idx].outro;
    overlay.remove();
    renderPendingClips();
  };

  overlay.querySelector('#outroApply').onclick = () => {
    const fp = pathIn.value.trim();
    if (fp) {
      pendingClips[idx].outro = { filePath: fp };
    } else {
      delete pendingClips[idx].outro;
    }
    overlay.remove();
    renderPendingClips();
  };
}

/* ─── Downloading (queue-based, with cancel/pause) ────────── */
function downloadClip(idx) {
  const clip = pendingClips.splice(idx, 1)[0];
  if (!clip) return;
  updateCollabClipStage(clip, 'downloading');
  renderPendingClips();

  if (!clip.m3u8Url) { alert('No stream URL for this clip.'); return; }

  let startSec = clip.inTime - (clip.seekableStart || 0);
  dbg('CLIP', 'Download initiated', { name: clip.name, inTime: clip.inTime, outTime: clip.outTime, seekableStart: clip.seekableStart, computedStartSec: startSec, isLive: clip.isLive });
  if (startSec < 0) {
    const ok = confirm(
      'Segments for the IN point may have expired from the live buffer.\n' +
      'The clip may start later than expected.\n\nTry anyway?'
    );
    if (!ok) { pendingClips.push(clip); renderPendingClips(); return; }
    startSec = 0;
  }
  const durationSec = clip.outTime - clip.inTime;

  const dl = { id: clip.id, name: clip.name, progress: 0, clip, startSec, durationSec };
  downloadingClips.push(dl);
  renderDownloadingClips();
  syncPostCaptionState();
  processDownloadQueue();
}

async function processDownloadQueue() {
  if (activeDownloadId) return;
  const next = downloadingClips.find(dl => dl.progress === 0);
  if (!next) return;

  activeDownloadId = next.id;
  const clip = next.clip;

  const watermark = clip.watermark || universalWatermark || null;
  const imageWatermark = clip.imageWatermark || universalImageWatermark || null;
  const outro = clip.outro || (universalOutro.enabled && universalOutro.filePath ? universalOutro : null);
  const ffmpegOptions = { ...userConfig.ffmpeg };

  try {
    const dlParams = {
      m3u8Url: clip.m3u8Url,
      m3u8Text: clip.m3u8Text || null,
      startSec: next.startSec,
      durationSec: next.durationSec,
      clipName: clip.name,
      watermark,
      imageWatermark,
      outro,
      ffmpegOptions,
      keepTempFiles: userConfig.devFeatures?.keepTempFiles || false,
      logFfmpegCommands: userConfig.devFeatures?.logFfmpegCommands || false,
    };

    // Batch mode: add output dir override and manifest info
    if (clip._batchMode) {
      const cfg = userConfig.ffmpeg;
      const folderParts = [cfg.videoCodec, cfg.preset, 'crf' + cfg.crf, cfg.audioCodec, cfg.audioBitrate];
      if (cfg.hwaccel) folderParts.push('hw-' + cfg.hwaccel);
      dlParams.batchOutputDir = folderParts.join('_');
      dlParams.batchManifest = {
        batchId: clip._batchId, batchIndex: clip._batchIndex, batchTotal: clip._batchTotal,
        ffmpegConfig: { ...cfg }, hasWatermark: !!watermark, hasOutro: !!outro,
      };
    }

    dbg('CLIP', 'Sending to main process', { startSec: dlParams.startSec, durationSec: dlParams.durationSec, hasWatermark: !!watermark, hasOutro: !!outro, batch: !!clip._batchMode });
    const result = await window.clipper.downloadClip(dlParams);
    activeDownloadId = null;

    if (result && result.success) {
      downloadingClips = downloadingClips.filter(d => d.id !== clip.id);
      renderDownloadingClips();
      dbg('CLIP', 'Download succeeded', { name: clip.name, filePath: result.filePath, fileSize: result.fileSize });
      completedClips.unshift({
        id: clip.id, name: clip.name, caption: clip.caption, postCaption: clip.postCaption || '',
        stage: 'downloaded',
        filePath: result.filePath, displayPath: result.displayPath, fileName: result.fileName, fileSize: result.fileSize,
        // Preserve timing for Re-Stage
        inTime: clip.inTime, outTime: clip.outTime, m3u8Url: clip.m3u8Url, m3u8Text: clip.m3u8Text || null,
        isLive: clip.isLive, seekableStart: clip.seekableStart, collabRangeId: clip.collabRangeId,
        collabClipperId: clip.collabClipperId || null,
        collabClipperName: clip.collabClipperName || '',
        collabHelperId: clip.collabHelperId || null,
        collabHelperName: clip.collabHelperName || '',
        postThumbnailDataUrl: clip.postThumbnailDataUrl || '',
      });
      upsertCaptionTimelineClip(completedClips[0]);
      updateCollabClipStage(clip, 'done');
      if (clip.collabRangeId && window.CollabUI && window.CollabUI.updateClipRangeMetadata) {
        const done = completedClips[0];
        window.CollabUI.updateClipRangeMetadata(clip.collabRangeId, {
          fileName: done.fileName || '',
          filePath: done.filePath || '',
          displayPath: done.displayPath || '',
          postThumbnailDataUrl: done.postThumbnailDataUrl || '',
          status: 'done'
        });
      }
      renderCompletedClips();
    } else if (result && result.cancelled) {
      downloadingClips = downloadingClips.filter(d => d.id !== clip.id);
      renderDownloadingClips();
      syncPostCaptionState();
      updateCollabClipStage(clip, 'queued');
      dbg('CLIP', 'Download cancelled by user', { name: clip.name });
    } else {
      downloadingClips = downloadingClips.filter(d => d.id !== clip.id);
      renderDownloadingClips();
      syncPostCaptionState();
      updateCollabClipStage(clip, 'queued');
      dbg('ERROR', 'Download failed', { name: clip.name, error: result?.error });
      alert('Download failed: ' + (result?.error || 'Unknown error'));
    }
  } catch (err) {
    dbg('ERROR', 'Download exception', { name: clip.name, error: err.message });
    downloadingClips = downloadingClips.filter(d => d.id !== clip.id);
    activeDownloadId = null;
    renderDownloadingClips();
    syncPostCaptionState();
    updateCollabClipStage(clip, 'queued');
    alert('Download error: ' + err.message);
  }

  // Process next in queue
  processDownloadQueue();
}

function renderDownloadingClips() {
  const list = $('downloadingClipList');

  if (downloadingClips.length === 0) {
    list.innerHTML = '<div class="empty-state"><small>Clips being processed will appear here</small></div>';
    updateClipCount(); syncHubState(); return;
  }

  // Remove empty state if present
  const empty = list.querySelector('.empty-state');
  if (empty) empty.remove();

  // Remove cards for clips no longer downloading
  const currentIds = new Set(downloadingClips.map(dl => dl.id));
  list.querySelectorAll('.download-card').forEach(card => {
    if (!currentIds.has(card.dataset.clipId)) card.remove();
  });

  // Update or create cards
  downloadingClips.forEach(dl => {
    let card = list.querySelector(`.download-card[data-clip-id="${dl.id}"]`);
    if (card) {
      // IN-PLACE UPDATE — only touch progress bar and text
      const fill = card.querySelector('.download-progress-fill');
      if (fill) fill.style.width = dl.progress + '%';
      const text = card.querySelector('.download-progress-text');
      if (text) text.textContent = dl.progress + '% \u2014 processing with ffmpeg...';
    } else {
      // CREATE new card (with one-time fadeIn)
      card = document.createElement('div');
      card.className = 'download-card';
      card.dataset.clipId = dl.id;
      card.innerHTML = `
        <div class="download-card-header">
          <div class="download-card-name">${escH(dl.name)}</div>
        </div>
        <div class="download-progress"><div class="download-progress-fill" style="width:${dl.progress}%"></div></div>
        <div class="download-progress-text">${dl.progress}% \u2014 processing with ffmpeg...</div>
        <div class="download-card-actions">
          <button class="btn btn-danger btn-xs dl-cancel-btn" data-id="${dl.id}">\u2715 Cancel</button>
        </div>`;
      card.style.animation = 'fadeIn 0.15s ease';
      list.appendChild(card);
    }
  });

  updateClipCount(); syncHubState();
}

// ONE-TIME event delegation for downloading list (wired after DOM ready)
document.addEventListener('DOMContentLoaded', () => {
  $('downloadingClipList').addEventListener('click', e => {
    const cancelBtn = e.target.closest('.dl-cancel-btn');
    if (cancelBtn) {
      const id = cancelBtn.dataset.id;
      const dl = downloadingClips.find(d => d.id === id);
      if (dl) {
        dbg('ACTION', 'Cancel download', { name: dl.name });
        window.clipper.cancelClip(dl.name);
        downloadingClips = downloadingClips.filter(d => d.id !== id);
        if (activeDownloadId === id) activeDownloadId = null;
        renderDownloadingClips();
        processDownloadQueue();
      }
    }
  });
});

/* ─── Completed ─────────────────────────────────────────────── */
function renderCompletedClips() {
  const list = $('completedClipList');
  upsertCaptionTimelineFromCompleted();
  if (completedClips.length === 0) {
    list.innerHTML = '<div class="empty-state"><small>Downloaded clips appear here — drag to post!</small></div>';
    updateClipCount();
    syncHubState();
    syncPostCaptionState();
    return;
  }

  const showFfmpegLog = userConfig.devFeatures?.ffmpegLogs;

  list.innerHTML = completedClips.map((clip, idx) => `
    <div class="completed-card" draggable="true" data-path="${escAttr(clip.displayPath || clip.filePath)}">
      <div class="completed-card-main">
        <div class="completed-card-header">
          <span class="completed-card-icon">&#127916;</span>
          <div class="completed-card-info">
            <div class="completed-card-name" title="${escAttr(clip.name)}">${escH(clip.name)}</div>
            <div class="completed-card-summary${(clip.caption || '').trim() ? '' : ' empty'}" title="${escAttr((clip.caption || '').trim() || 'No caption/summary set')}">${escH((clip.caption || '').trim() || 'No caption/summary set')}</div>
            <div class="completed-card-file" title="${escAttr(clip.fileName || '')}">${escH(clip.fileName || '')}${clip.fileSize ? ` · ${fmtSize(clip.fileSize)}` : ''}</div>
          </div>
        </div>
        <div class="completed-card-actions-row">
          <button class="btn btn-ghost btn-xs completed-open-btn" data-action="show" data-idx="${idx}" title="Open in folder">Open Folder</button>
          <button class="btn btn-ghost btn-xs completed-open-btn" data-action="copycaption" data-idx="${idx}" title="Copy post caption">Copy Caption</button>
          <details class="completed-actions-menu">
            <summary class="btn btn-ghost btn-xs completed-actions-trigger" title="More actions">More ▾</summary>
            <div class="completed-actions-popover">
              <button class="completed-action-item action-x" data-action="postcaption" data-idx="${idx}" title="Open X post caption editor">&#120143; Caption</button>
              ${clip.m3u8Url ? `<button class="completed-action-item action-restage" data-action="restage" data-idx="${idx}" title="Send back to Pending">Re-Stage</button>` : ''}
              ${showFfmpegLog ? `<button class="completed-action-item action-log" data-action="ffmpeglog" data-idx="${idx}" title="View FFMPEG Log">FFMPEG Log</button>` : ''}
            </div>
          </details>
        </div>
      </div>
    </div>`).join('');

  list.querySelectorAll('.completed-card').forEach((card, idx) => {
    card.addEventListener('dragstart', e => { e.preventDefault(); window.clipper.startDrag(completedClips[idx].filePath); });
  });
  list.onclick = e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const ci = parseInt(btn.dataset.idx);
    const menu = btn.closest('.completed-actions-menu');
    if (menu && menu.hasAttribute('open')) menu.removeAttribute('open');
    if (btn.dataset.action === 'postcaption') { openPostCaptionWindow(ci, { tab: 'caption', source: 'clip-card' }); return; }
    if (btn.dataset.action === 'show') { dbg('ACTION', 'Show in folder', { name: completedClips[ci]?.name }); window.clipper.showInFolder(completedClips[ci].filePath); }
    if (btn.dataset.action === 'copycaption') {
      const clip = completedClips[ci];
      const text = clip ? (clip.postCaption || clip.caption || '').trim() : '';
      if (text && window.clipper && window.clipper.copyText) window.clipper.copyText(text);
    }
    if (btn.dataset.action === 'ffmpeglog') { dbg('ACTION', 'View FFMPEG log', { name: completedClips[ci]?.name }); window.clipper.openClipFfmpegLog(completedClips[ci].name); }
    if (btn.dataset.action === 'restage') { showRestageConfirmation(ci, completedClips[ci]); }
  };

  updateClipCount();
  syncHubState();
  syncPostCaptionState();
}

function updateClipCount() {
  const n = pendingClips.length + downloadingClips.length + completedClips.length;
  $('clipCount').textContent = n + (n === 1 ? ' clip' : ' clips');
}

function toPostCaptionRecord(clip) {
  if (!clip) return null;
  return {
    id: clip.id,
    name: clip.name || '',
    caption: clip.caption || '',
    postCaption: clip.postCaption || '',
    stage: clip.stage || 'downloaded',
    fileName: clip.fileName || '',
    fileSize: clip.fileSize || 0,
    filePath: clip.filePath || '',
    displayPath: clip.displayPath || '',
    postThumbnailDataUrl: clip.postThumbnailDataUrl || '',
    inTime: clip.inTime,
    outTime: clip.outTime,
  };
}

function upsertCaptionTimelineClip(clip) {
  const rec = toPostCaptionRecord(clip);
  if (!rec || !rec.id) return;
  const idx = captionTimelineClips.findIndex(c => c.id === rec.id);
  if (idx >= 0) {
    captionTimelineClips[idx] = { ...captionTimelineClips[idx], ...rec };
  } else {
    captionTimelineClips.unshift(rec);
  }
}

function upsertCaptionTimelineFromCompleted() {
  completedClips.forEach(c => upsertCaptionTimelineClip({ ...c, stage: 'downloaded' }));
}

function syncCaptionTimelineStages() {
  const liveMap = new Map();
  const stageRank = { pending: 1, downloading: 2, downloaded: 3 };
  const putLive = (clip, stage) => {
    const rec = toPostCaptionRecord({ ...clip, stage });
    if (!rec || !rec.id) return;
    const existing = liveMap.get(rec.id);
    if (!existing || stageRank[rec.stage] >= stageRank[existing.stage]) {
      liveMap.set(rec.id, rec);
    }
  };

  pendingClips.forEach(c => putLive(c, 'pending'));
  downloadingClips.forEach(d => putLive(d.clip || d, 'downloading'));
  completedClips.forEach(c => putLive(c, 'downloaded'));

  captionTimelineClips = captionTimelineClips.filter((clip) => {
    if (!clip || !clip.id) return false;
    if (clip.stage === 'pending' || clip.stage === 'downloading') {
      return liveMap.has(clip.id);
    }
    return true;
  });

  liveMap.forEach((rec) => {
    const idx = captionTimelineClips.findIndex(c => c.id === rec.id);
    if (idx >= 0) captionTimelineClips[idx] = { ...captionTimelineClips[idx], ...rec };
    else captionTimelineClips.unshift(rec);
  });
}

function getTimelineClipById(id) {
  if (!id) return null;
  return captionTimelineClips.find(c => c.id === id) || null;
}

function getPostCaptionSelectedClip() {
  if (selectedPostCaptionClipId) {
    const selected = completedClips.find(c => c.id === selectedPostCaptionClipId) || getTimelineClipById(selectedPostCaptionClipId);
    if (selected) return selected;
  }
  if (completedClips.length > 0) {
    selectedPostCaptionClipId = completedClips[0].id;
    return completedClips[0];
  }
  if (captionTimelineClips.length > 0) {
    selectedPostCaptionClipId = captionTimelineClips[0].id;
    return captionTimelineClips[0];
  }
  selectedPostCaptionClipId = null;
  return null;
}

function ensurePostCaptionThumb(clip) {
  if (!clip || !clip.filePath || clip.postThumbnailDataUrl) return;
  if (postCaptionThumbInflight.has(clip.id)) return;
  const pending = getClipStartFrameDataUrl(clip.filePath).then((dataUrl) => {
    if (!dataUrl) return;
    const latest = completedClips.find(c => c.id === clip.id) || getTimelineClipById(clip.id);
    if (!latest) return;
    latest.postThumbnailDataUrl = dataUrl;
    if (latest.collabRangeId && window.CollabUI && window.CollabUI.updateClipRangeMetadata) {
      window.CollabUI.updateClipRangeMetadata(latest.collabRangeId, {
        postThumbnailDataUrl: latest.postThumbnailDataUrl
      });
    }
    upsertCaptionTimelineClip(latest);
    syncPostCaptionState();
    syncHubState();
  }).finally(() => {
    postCaptionThumbInflight.delete(clip.id);
  });
  postCaptionThumbInflight.set(clip.id, pending);
}

function syncPostCaptionState() {
  syncCaptionTimelineStages();
  const selected = getPostCaptionSelectedClip();
  if (selected) ensurePostCaptionThumb(selected);
  try {
    window.clipper.sendPostCaptionStateUpdate({
      selectedClipId: selected ? selected.id : null,
      timelineClips: captionTimelineClips.map(c => toPostCaptionRecord(c)).filter(Boolean),
    });
  } catch (_) {}
}

function isHelperRole() {
  try {
    const ctx = window.CollabUI && window.CollabUI.getMarkContext && window.CollabUI.getMarkContext();
    return !!(ctx && ctx.helperId);
  } catch (_) { return false; }
}

function projectCollabRangesIntoCaptionTimeline() {
  if (!window.CollabUI || !window.CaptionSync) return;
  const st = window.CollabUI.getState ? window.CollabUI.getState() : null;
  const ranges = (st && st.clipRanges) || [];
  const ctx = window.CollabUI.getMarkContext && window.CollabUI.getMarkContext();
  const targetClipperId = ctx && ctx.clipperId;
  if (!targetClipperId) return;
  const projected = ranges
    .filter(r => r && r.clipperId === targetClipperId)
    .map(r => window.CaptionSync.projectRangeToTimelineClip(r))
    .filter(Boolean);
  captionTimelineClips = projected;
}

function applyRemoteCaptionEditsIntoLocalClips() {
  if (!window.CollabUI || !window.CaptionSync) return;
  const st = window.CollabUI.getState ? window.CollabUI.getState() : null;
  const ranges = (st && st.clipRanges) || [];
  const byRangeId = new Map(ranges.map(r => [r.id, r]));
  const applyTo = (clip) => {
    if (!clip || !clip.collabRangeId) return false;
    const remote = byRangeId.get(clip.collabRangeId);
    if (!remote) return false;
    const resolved = window.CaptionSync.resolveCaption({
      local: { value: clip.postCaption || '', updatedAt: clip.postCaptionUpdatedAt || 0 },
      remote: { value: remote.postCaption || '', updatedAt: remote.postCaptionUpdatedAt || 0 }
    });
    if (resolved.source === 'remote' && resolved.value !== (clip.postCaption || '')) {
      clip.postCaption = resolved.value;
      clip.postCaptionUpdatedAt = resolved.updatedAt;
      return true;
    }
    return false;
  };
  let changed = false;
  if (typeof pendingClips !== 'undefined') pendingClips.forEach(c => { if (applyTo(c)) changed = true; });
  if (typeof completedClips !== 'undefined') completedClips.forEach(c => { if (applyTo(c)) changed = true; });
  return changed;
}

function handleCollabRangeUpdate() {
  if (isHelperRole()) {
    projectCollabRangesIntoCaptionTimeline();
    syncPostCaptionState();
  } else {
    const changed = applyRemoteCaptionEditsIntoLocalClips();
    if (changed) {
      if (typeof renderPendingClips === 'function') renderPendingClips();
      if (typeof renderCompletedClips === 'function') renderCompletedClips();
      syncPostCaptionState();
    }
  }
}

function openPostCaptionWindow(idx, opts = {}) {
  if (typeof idx === 'number' && completedClips[idx]) {
    selectedPostCaptionClipId = completedClips[idx].id;
  }
  const selected = getPostCaptionSelectedClip();
  if (selected) ensurePostCaptionThumb(selected);
  syncPostCaptionState();
  if (window.clipper?.openPostCaptionWindow) {
    window.clipper.openPostCaptionWindow({
      tab: opts.tab === 'clips' ? 'clips' : 'caption',
      source: opts.source || 'clip-card',
    }).then(() => {
      syncPostCaptionState();
    }).catch(() => {});
  }
}

function showPostCaptionModal(idx) {
  openPostCaptionWindow(idx);
  return;
  const initialClip = completedClips[idx];
  if (!initialClip) return;
  const clipId = initialClip.id;
  const old = document.querySelector('.postcap-modal-overlay');
  if (old) old.remove();

  const clipDuration = fmtDur(Math.max(0, (initialClip.outTime || 0) - (initialClip.inTime || 0)));
  const overlay = document.createElement('div');
  overlay.className = 'wm-modal-overlay postcap-modal-overlay';
  overlay.innerHTML = `
    <div class="wm-modal postcap-modal">
      <div class="wm-modal-title postcap-modal-title"><span>Post Captioning</span><button class="postcap-close-x" id="postCaptionCloseX" type="button" aria-label="Close">X</button></div>
      <div class="postcap-subtitle">Editing caption for ${escH(initialClip.name)}</div>
      <div class="wm-modal-body postcap-layout">
        <div class="postcap-editor-pane">
          <label class="wm-label">X Post Caption</label>
          <textarea id="postCaptionInput" class="postcap-editor-input" spellcheck="false" placeholder="Write your post caption here..."></textarea>
          <div class="postcap-counter" id="postCaptionCounter"><span id="postCaptionCount">0</span> / ${X_PREVIEW_CHAR_LIMIT} preview chars</div>
          <div class="postcap-note">Timeline preview follows X behavior: text expands until 280 characters, then collapses behind "Show more".</div>
        </div>
        <div class="postcap-preview-pane">
          <div class="x-mock-timeline">
            <article class="x-mock-post">
              <div class="x-mock-avatar"></div>
              <div class="x-mock-main">
                <div class="x-mock-header"><span class="x-mock-name">Template Account</span><span class="x-mock-handle">@templatefeed - 2m</span></div>
                <div class="x-mock-text">Earlier post in the timeline for context.</div>
              </div>
            </article>
            <article class="x-mock-post focus">
              <div class="x-mock-avatar focus"></div>
              <div class="x-mock-main">
                <div class="x-mock-header"><span class="x-mock-name">Your Clip</span><span class="x-mock-handle">@clipstudiopost - now</span></div>
                <div class="x-mock-text placeholder" id="postCaptionPreviewText">Enter Post Caption...</div>
                <button class="x-show-more" id="postCaptionShowMore" type="button" style="display:none;">Show more</button>
                <div class="x-video-card" id="postCaptionThumb">
                  <span class="x-video-play">&#9658;</span>
                  <span class="x-video-duration">${escH(clipDuration)}</span>
                </div>
                <div class="x-engagement-row">
                  <span>2 Replies</span><span>2 Reposts</span><span>78 Likes</span><span>910 Views</span>
                </div>
              </div>
            </article>
            <article class="x-mock-post">
              <div class="x-mock-avatar"></div>
              <div class="x-mock-main">
                <div class="x-mock-header"><span class="x-mock-name">Template Account</span><span class="x-mock-handle">@templatefeed - 4m</span></div>
                <div class="x-mock-text">Another post below so the focused post sits in a realistic feed.</div>
              </div>
            </article>
          </div>
        </div>
      </div>
      <div class="wm-modal-actions">
        <button class="btn btn-ghost btn-sm" id="postCaptionClose">Close</button>
        <button class="btn btn-primary btn-sm" id="postCaptionDone">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const getClip = () => {
    const byId = completedClips.find(c => c.id === clipId);
    if (byId) return byId;
    return completedClips[idx] || null;
  };
  const input = overlay.querySelector('#postCaptionInput');
  const previewText = overlay.querySelector('#postCaptionPreviewText');
  const showMoreBtn = overlay.querySelector('#postCaptionShowMore');
  const thumb = overlay.querySelector('#postCaptionThumb');
  const counter = overlay.querySelector('#postCaptionCounter');
  const countEl = overlay.querySelector('#postCaptionCount');

  let expanded = false;
  let syncTimer = null;
  const queueSync = () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncHubState(), 140);
  };
  const autoSizeInput = () => {
    input.style.height = 'auto';
    const maxHeight = 360;
    input.style.height = Math.min(maxHeight, Math.max(140, input.scrollHeight)) + 'px';
  };
  const applyPreviewText = (caption) => {
    const raw = caption || '';
    countEl.textContent = String(raw.length);
    counter.classList.toggle('over', raw.length > X_PREVIEW_CHAR_LIMIT);
    if (!raw.length) {
      previewText.textContent = 'Enter Post Caption...';
      previewText.classList.add('placeholder');
      showMoreBtn.style.display = 'none';
      expanded = false;
      return;
    }
    previewText.classList.remove('placeholder');
    const isOverflow = raw.length > X_PREVIEW_CHAR_LIMIT;
    if (!isOverflow) expanded = false;
    previewText.textContent = (isOverflow && !expanded)
      ? (raw.slice(0, X_PREVIEW_CHAR_LIMIT).trimEnd() + '...')
      : raw;
    showMoreBtn.style.display = isOverflow ? 'inline-flex' : 'none';
    showMoreBtn.textContent = expanded ? 'Show less' : 'Show more';
  };
  const closeModal = () => {
    clearTimeout(syncTimer);
    syncHubState();
    document.removeEventListener('keydown', onEscClose);
    overlay.remove();
  };
  const onEscClose = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', onEscClose);

  input.addEventListener('input', () => {
    const clip = getClip();
    if (!clip) { closeModal(); return; }
    clip.postCaption = input.value;
    applyPreviewText(clip.postCaption);
    autoSizeInput();
    queueSync();
  });
  showMoreBtn.addEventListener('click', () => {
    expanded = !expanded;
    applyPreviewText(input.value || '');
  });
  overlay.querySelector('#postCaptionClose').onclick = closeModal;
  overlay.querySelector('#postCaptionCloseX').onclick = closeModal;
  overlay.querySelector('#postCaptionDone').onclick = closeModal;

  input.value = initialClip.postCaption || '';
  applyPreviewText(input.value);
  autoSizeInput();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const applyThumb = (dataUrl) => {
    if (!dataUrl) {
      thumb.classList.add('no-thumb');
      return;
    }
    thumb.classList.remove('no-thumb');
    thumb.classList.add('has-thumb');
    thumb.style.backgroundImage = 'url(' + JSON.stringify(dataUrl) + ')';
  };
  if (initialClip.postThumbnailDataUrl) {
    applyThumb(initialClip.postThumbnailDataUrl);
  } else {
    getClipStartFrameDataUrl(initialClip.filePath).then(dataUrl => {
      if (!document.body.contains(overlay)) return;
      const latestClip = getClip();
      if (!latestClip) return;
      if (dataUrl) {
        latestClip.postThumbnailDataUrl = dataUrl;
      }
      applyThumb(dataUrl);
    });
  }
}

/* ─── Re-Stage Confirmation ────────────────────────────────────── */
function showRestageConfirmation(idx, clip) {
  if (!clip || !clip.m3u8Url) {
    alert('Cannot re-stage: original stream data not available for this clip.');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'wm-modal-overlay';
  overlay.innerHTML = `
    <div class="wm-modal" style="width:380px;">
      <div class="wm-modal-title">Re-Stage Clip?</div>
      <div class="wm-modal-body">
        <p style="color: var(--text-secondary); font-size: 12px;">
          This will move <strong>${escH(clip.name)}</strong> back to Pending
          and <strong style="color:var(--red)">delete the downloaded file</strong>.
        </p>
        <p style="color: var(--dim); font-size: 11px; margin-top: 4px;">
          ${escH(clip.fileName)} (${fmtSize(clip.fileSize)})
        </p>
      </div>
      <div class="wm-modal-actions">
        <button class="btn btn-ghost btn-sm" id="restageCancel">Cancel</button>
        <button class="btn btn-danger btn-sm" id="restageConfirm">Delete &amp; Re-Stage</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#restageCancel').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.querySelector('#restageConfirm').onclick = async () => {
    dbg('ACTION', 'Re-stage confirmed', { name: clip.name });
    await window.clipper.deleteClipFile(clip.filePath);
    pendingClips.push({
      id: uid(), name: clip.name, caption: clip.caption || '',
      inTime: clip.inTime, outTime: clip.outTime,
      m3u8Url: clip.m3u8Url, m3u8Text: clip.m3u8Text || null, isLive: clip.isLive,
      seekableStart: clip.seekableStart || 0, collabRangeId: clip.collabRangeId || null,
      collabClipperId: clip.collabClipperId || null,
      collabClipperName: clip.collabClipperName || '',
      collabHelperId: clip.collabHelperId || null,
      collabHelperName: clip.collabHelperName || '',
      postThumbnailDataUrl: clip.postThumbnailDataUrl || '',
    });
    updateCollabClipStage(clip, 'queued');
    upsertCaptionTimelineClip(clip);
    completedClips.splice(idx, 1);
    renderPendingClips();
    renderCompletedClips();
    overlay.remove();
  };
}

/* ─── Clear Completed ──────────────────────────────────────────── */
$('clearCompleted').onclick = () => {
  if (completedClips.length === 0) return;
  dbg('ACTION', 'Clear downloaded clips list (keep caption timeline)');
  upsertCaptionTimelineFromCompleted();
  completedClips = [];
  renderCompletedClips();
};

/* ─── Hub Detach / Sync ────────────────────────────────────────── */
$('detachHubBtn').onclick = async () => {
  dbg('ACTION', 'Detach hub window');
  await window.clipper.openHubWindow();
  $('hubSection').classList.add('detached');
  syncHubState();
};

window.clipper.onHubReattached(() => {
  dbg('ACTION', 'Hub window closed, re-attaching');
  $('hubSection').classList.remove('detached');
});

function syncHubState() {
  try {
    window.clipper.sendHubStateUpdate({
      pendingClips: pendingClips.map(c => ({
        id: c.id, name: c.name, caption: c.caption,
        inTime: c.inTime, outTime: c.outTime,
        watermark: c.watermark || null,
        outro: c.outro || null,
      })),
      downloadingClips: downloadingClips.map(d => ({
        id: d.id, name: d.name, progress: d.progress
      })),
      completedClips: completedClips.map(c => ({
        id: c.id, name: c.name, caption: c.caption || '', postCaption: c.postCaption || '',
        stage: c.stage || 'downloaded',
        fileName: c.fileName, fileSize: c.fileSize,
        filePath: c.filePath, displayPath: c.displayPath,
        postThumbnailDataUrl: c.postThumbnailDataUrl || '',
        m3u8Url: c.m3u8Url, m3u8Text: c.m3u8Text || null, inTime: c.inTime, outTime: c.outTime,
        isLive: c.isLive, seekableStart: c.seekableStart,
      })),
      config: {
        buttons: userConfig.buttons,
        devFeatures: userConfig.devFeatures,
      },
      universalWatermark,
      universalImageWatermark,
      universalOutro,
      outputPath: $('outputPath')?.textContent || '',
    });
  } catch (_) { /* hub window may not be open */ }
}

// Handle actions sent from the detached hub window
window.clipper.onHubAction(async (action) => {
  switch (action.type) {
    case 'download': downloadClip(action.idx); break;
    case 'jumpin':
      if (pendingClips[action.idx]) { dbg('ACTION', 'Jump to IN from hub', { idx: action.idx, time: pendingClips[action.idx].inTime }); vid.currentTime = pendingClips[action.idx].inTime; }
      break;
    case 'jumpout':
      if (pendingClips[action.idx]) { dbg('ACTION', 'Jump to OUT from hub', { idx: action.idx, time: pendingClips[action.idx].outTime }); vid.currentTime = pendingClips[action.idx].outTime; }
      break;
    case 'repickIn':
      if (pendingClips[action.idx]) enterRepickMode(action.idx, 'inTime');
      break;
    case 'repickOut':
      if (pendingClips[action.idx]) enterRepickMode(action.idx, 'outTime');
      break;
    case 'cancel': {
      const dl = downloadingClips.find(d => d.id === action.id);
      if (dl) { window.clipper.cancelClip(dl.name); downloadingClips = downloadingClips.filter(d => d.id !== action.id); if (activeDownloadId === action.id) activeDownloadId = null; renderDownloadingClips(); syncPostCaptionState(); processDownloadQueue(); }
      break;
    }
    case 'remove': {
      if (action.idx >= 0 && action.idx < pendingClips.length) {
        const removed = pendingClips[action.idx];
        dbg('ACTION', 'Remove pending clip from hub', { idx: action.idx, name: removed.name });
        pendingClips.splice(action.idx, 1);
        if (removed && removed.collabRangeId && window.CollabUI && window.CollabUI.removeClipRange) {
          window.CollabUI.removeClipRange(removed.collabRangeId);
        }
        renderPendingClips();
      }
      break;
    }
    case 'editName':
      if (pendingClips[action.idx]) { pendingClips[action.idx].name = action.value; renderPendingClips(); }
      break;
    case 'editCaption':
      if (pendingClips[action.idx]) { pendingClips[action.idx].caption = action.value; renderPendingClips(); }
      break;
    case 'editTimestamp':
      if (pendingClips[action.idx]) { pendingClips[action.idx][action.field] = action.value; renderPendingClips(); }
      break;
    case 'setWatermark':
      if (pendingClips[action.idx]) { pendingClips[action.idx].watermark = action.watermark; renderPendingClips(); }
      break;
    case 'clearWatermark':
      if (pendingClips[action.idx]) { delete pendingClips[action.idx].watermark; renderPendingClips(); }
      break;
    case 'setImageWatermark':
      if (pendingClips[action.idx]) { pendingClips[action.idx].imageWatermark = action.imageWatermark; renderPendingClips(); }
      break;
    case 'clearImageWatermark':
      if (pendingClips[action.idx]) { delete pendingClips[action.idx].imageWatermark; renderPendingClips(); }
      break;
    case 'preview':
      previewClip(action.idx, null);
      break;
    case 'setOutro':
      if (pendingClips[action.idx]) { pendingClips[action.idx].outro = action.outro; renderPendingClips(); }
      break;
    case 'clearOutro':
      if (pendingClips[action.idx]) { delete pendingClips[action.idx].outro; renderPendingClips(); }
      break;
    case 'editPostCaption':
      if (completedClips[action.idx]) {
        completedClips[action.idx].postCaption = action.value || '';
        upsertCaptionTimelineClip(completedClips[action.idx]);
        syncHubState();
        syncPostCaptionState();
      }
      break;
    case 'openPostCaption':
      openPostCaptionWindow(action.idx, { tab: 'caption', source: 'hub-card' });
      break;
    case 'ffmpeglog':
      if (completedClips[action.idx]) window.clipper.openClipFfmpegLog(completedClips[action.idx].name);
      break;
    case 'restageConfirmed': {
      const clip = completedClips[action.idx];
      if (clip && clip.m3u8Url) {
        await window.clipper.deleteClipFile(clip.filePath);
        pendingClips.push({
          id: uid(),
          name: clip.name,
          caption: clip.caption || '',
          inTime: clip.inTime,
          outTime: clip.outTime,
          m3u8Url: clip.m3u8Url,
          m3u8Text: clip.m3u8Text || null,
          isLive: clip.isLive,
          seekableStart: clip.seekableStart || 0,
          collabRangeId: clip.collabRangeId || null,
          collabClipperId: clip.collabClipperId || null,
          collabClipperName: clip.collabClipperName || '',
          collabHelperId: clip.collabHelperId || null,
          collabHelperName: clip.collabHelperName || '',
          postThumbnailDataUrl: clip.postThumbnailDataUrl || ''
        });
        updateCollabClipStage(clip, 'queued');
        upsertCaptionTimelineClip(clip);
        completedClips.splice(action.idx, 1);
        renderPendingClips(); renderCompletedClips();
      }
      break;
    }
    case 'restage': showRestageConfirmation(action.idx, completedClips[action.idx]); break;
    case 'clearCompleted':
      upsertCaptionTimelineFromCompleted();
      completedClips = [];
      renderCompletedClips();
      break;
    case 'show': if (completedClips[action.idx]) window.clipper.showInFolder(completedClips[action.idx].filePath); break;
    case 'openDebug': if (window.clipper?.openDebugWindow) window.clipper.openDebugWindow(); break;
    case 'outputPathChanged':
      $('outputPath').textContent = action.path;
      syncHubState();
      break;
  }
});

window.clipper.onPostCaptionAction((action) => {
  if (!action || !action.type) return;
  var byId = function (id) {
    if (!id) return null;
    var inPending = pendingClips.find(c => c.id === id);
    if (inPending) return inPending;
    var inDownloading = downloadingClips.find(d => d.id === id);
    if (inDownloading && inDownloading.clip) return inDownloading.clip;
    var inCompleted = completedClips.find(c => c.id === id);
    if (inCompleted) return inCompleted;
    return getTimelineClipById(id);
  };
  if (action.type === 'selectClip') {
    if (action.id && (completedClips.some(c => c.id === action.id) || getTimelineClipById(action.id))) {
      selectedPostCaptionClipId = action.id;
      const selected = getPostCaptionSelectedClip();
      if (selected) ensurePostCaptionThumb(selected);
      syncPostCaptionState();
    }
    return;
  }
  if (action.type === 'requestThumb') {
    const clip = completedClips.find(c => c.id === action.id) || getTimelineClipById(action.id);
    if (clip) ensurePostCaptionThumb(clip);
    return;
  }
  if (action.type === 'editPostCaptionById') {
    const clip = byId(action.id);
    if (!clip) return;
    clip.postCaption = action.value || '';
    clip.postCaptionUpdatedAt = Date.now();
    upsertCaptionTimelineClip(clip);
    selectedPostCaptionClipId = clip.id;
    if (clip.collabRangeId && window.CollabUI && window.CollabUI.updateClipRangeCaption) {
      window.CollabUI.updateClipRangeCaption(clip.collabRangeId, clip.postCaption);
    }
    syncHubState();
    syncPostCaptionState();
    return;
  }
  if (action.type === 'showById') {
    const clip = byId(action.id);
    if (clip && clip.filePath) window.clipper.showInFolder(clip.filePath);
    return;
  }
  if (action.type === 'copyCaptionById') {
    const clip = byId(action.id);
    if (!clip) return;
    const text = (clip.postCaption || clip.caption || '').trim();
    if (!text) return;
    if (window.clipper && window.clipper.copyText) {
      window.clipper.copyText(text);
    }
  }
});

/* ─── Hub Resize Handles ──────────────────────────────────────── */
document.querySelectorAll('.hub-resize-handle').forEach(handle => {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const groups = [...document.querySelectorAll('#hubSection .hub-group')];
    const idx = parseInt(handle.dataset.resize);
    const above = groups[idx], below = groups[idx + 1];
    if (!above || !below) return;
    handle.classList.add('dragging');
    const startY = e.clientY;
    const startAbove = above.getBoundingClientRect().height;
    const startBelow = below.getBoundingClientRect().height;
    function onMove(e) {
      const delta = e.clientY - startY;
      above.style.flex = '0 0 ' + Math.max(60, startAbove + delta) + 'px';
      below.style.flex = '0 0 ' + Math.max(60, startBelow - delta) + 'px';
    }
    function onUp() {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
});

/* ═══════════════════════════════════════════════════════════════
   ── Config Settings Modal ────────────────────────────────────
   ═══════════════════════════════════════════════════════════════ */
function openConfigModal() {
  const old = document.querySelector('.config-modal-overlay');
  if (old) old.remove();

  const cfg = userConfig;
  const overlay = document.createElement('div');
  overlay.className = 'config-modal-overlay wm-modal-overlay';
  overlay.innerHTML = `
    <div class="config-modal wm-modal" style="width:520px; max-height:85vh; overflow-y:auto;">
      <div class="wm-modal-title">Settings</div>
      <div class="wm-modal-body" style="gap:16px;">

        <!-- Config Actions -->
        <div class="config-section">
          <div class="config-section-title">Configuration</div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-ghost btn-sm" id="cfgImport">Load / Import Config</button>
            <button class="btn btn-accent btn-sm" id="cfgExport">Export Config</button>
            <button class="btn btn-primary btn-sm" id="cfgSave">Save Config</button>
          </div>
        </div>

        <!-- Button Toggles -->
        <div class="config-section">
          <div class="config-section-title">Editor / Clipping Options</div>
          <p class="config-note">Toggle which buttons appear on pending clips. Download is always shown.</p>
          <label class="config-toggle"><input type="checkbox" id="cfgJumpIn" ${cfg.buttons.jumpToIn?'checked':''}> <span>Jump to IN</span> <span class="config-default">(on by default)</span></label>
          <label class="config-toggle"><input type="checkbox" id="cfgJumpEnd" ${cfg.buttons.jumpToEnd?'checked':''}> <span>Jump to OUT</span> <span class="config-default">(off by default)</span></label>
          <label class="config-toggle"><input type="checkbox" id="cfgWatermark" ${cfg.buttons.watermark?'checked':''}> <span>Watermark</span> <span class="config-default">(on by default)</span></label>
          <label class="config-toggle"><input type="checkbox" id="cfgOutro" ${cfg.buttons.appendOutro?'checked':''}> <span>Append Outro</span> <span class="config-default">(on by default)</span></label>
        </div>

        <!-- Universal Watermark Config -->
        <div class="config-section">
          <div class="config-section-title">Universal Watermark</div>
          <p class="config-note">Set a default watermark applied to all clips unless overridden per-clip.</p>
          <button class="btn btn-accent btn-sm" id="cfgEditWatermark">${(universalWatermark || universalImageWatermark) ? 'Edit Universal Watermark' : 'Configure Universal Watermark'}</button>
          ${universalWatermark ? `<span style="color:var(--green);font-size:10px;margin-left:8px;">Active: Text "${escH(universalWatermark.text)}"</span>` : ''}
          ${universalImageWatermark ? `<span style="color:var(--green);font-size:10px;margin-left:8px;">Active: Image "${escH(universalImageWatermark.imagePath.split(/[/\\\\]/).pop())}"</span>` : ''}
        </div>

        <!-- Universal Outro Config -->
        <div class="config-section">
          <div class="config-section-title">Universal Outro</div>
          <p class="config-note">Set a default outro video appended to all clips unless overridden per-clip.</p>
          <label class="config-toggle"><input type="checkbox" id="cfgOutroEnabled" ${universalOutro.enabled?'checked':''}> <span>Enable Universal Outro</span></label>
          <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
            <input class="wm-input" id="cfgOutroPath" type="text" value="${escAttr(universalOutro.filePath||'')}" placeholder="No outro file selected..." readonly style="flex:1; cursor:pointer; font-size:11px;">
            <button class="btn btn-ghost btn-sm" id="cfgOutroBrowse">Browse</button>
          </div>
        </div>

        <!-- Default Channel -->
        <div class="config-section">
          <div class="config-section-title">Default Channel</div>
          <p class="config-note">Set a default channel to navigate to on startup.</p>
          <label class="config-toggle"><input type="checkbox" id="cfgChannelEnabled" ${cfg.defaultChannel.enabled?'checked':''}> <span>Enable Default Channel</span></label>
          <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
            <input class="wm-input" id="cfgChannelId" type="text" value="${escAttr(cfg.defaultChannel.channel_id||'')}" placeholder="e.g. channelname" style="flex:1; font-size:11px;">
            <button class="btn btn-accent btn-sm" id="cfgChannelSave">Save</button>
            <button class="btn btn-ghost btn-sm" id="cfgChannelDelete">Delete</button>
          </div>
        </div>

        <!-- Keybinds -->
        <div class="config-section">
          <div class="config-section-title">Keybinds</div>
          <p class="config-note">Customize keyboard shortcuts. Use modifier+key format (e.g. shift+ArrowLeft).</p>
          <div class="config-grid">
            <label class="config-kb"><span>Mark IN</span><input class="wm-input config-kb-input" data-bind="markIn" value="${escAttr(cfg.keybinds.markIn)}"></label>
            <label class="config-kb"><span>Mark OUT</span><input class="wm-input config-kb-input" data-bind="markOut" value="${escAttr(cfg.keybinds.markOut)}"></label>
            <label class="config-kb"><span>Edit IN</span><input class="wm-input config-kb-input" data-bind="editIn" value="${escAttr(cfg.keybinds.editIn)}"></label>
            <label class="config-kb"><span>Edit OUT</span><input class="wm-input config-kb-input" data-bind="editOut" value="${escAttr(cfg.keybinds.editOut)}"></label>
            <label class="config-kb"><span>Play/Pause</span><input class="wm-input config-kb-input" data-bind="playPause" value="${escAttr(cfg.keybinds.playPause === ' ' ? 'Space' : cfg.keybinds.playPause)}"></label>
          </div>
          <div class="config-section-title" style="margin-top:12px; font-size:10px;">Jump Sizes (seconds)</div>
          <div class="config-grid">
            <label class="config-kb"><span>Small (Arrow)</span><input class="wm-input config-kb-input" type="number" data-size="jumpSizeSmall" value="${cfg.keybinds.jumpSizeSmall}" min="1" max="300"></label>
            <label class="config-kb"><span>Medium (Shift+Arrow)</span><input class="wm-input config-kb-input" type="number" data-size="jumpSizeMedium" value="${cfg.keybinds.jumpSizeMedium}" min="1" max="300"></label>
            <label class="config-kb"><span>Large (Ctrl+Arrow)</span><input class="wm-input config-kb-input" type="number" data-size="jumpSizeLarge" value="${cfg.keybinds.jumpSizeLarge}" min="1" max="300"></label>
          </div>
        </div>

        <!-- Catch-up Speed -->
        <div class="config-section">
          <div class="config-section-title">Catch-Up Mode</div>
          <p class="config-note">Press <kbd>C</kbd> during playback to toggle catch-up speed after clipping a live moment.</p>
          <label class="wm-label">Speed <span class="wm-val" id="cfgCatchUpVal">${cfg.catchUpSpeed}x</span>
            <input class="wm-range" id="cfgCatchUpSpeed" type="range" min="1.1" max="2.5" step="0.1" value="${cfg.catchUpSpeed}">
          </label>
        </div>

        <!-- FFmpeg Settings -->
        <div class="config-section">
          <div class="config-section-title">FFmpeg / Encoding Settings</div>
          <p class="config-note">Advanced settings for how clips are encoded. Leave defaults unless you know what you're doing.</p>
          <div class="config-grid">
            <label class="config-kb"><span>Video Codec</span>
              <select class="wm-select" id="cfgVideoCodec">
                <option value="libx264"${cfg.ffmpeg.videoCodec==='libx264'?' selected':''}>libx264 (CPU)</option>
                <option value="libx265"${cfg.ffmpeg.videoCodec==='libx265'?' selected':''}>libx265 (CPU)</option>
                <option value="h264_nvenc"${cfg.ffmpeg.videoCodec==='h264_nvenc'?' selected':''}>h264_nvenc (NVIDIA GPU)</option>
                <option value="hevc_nvenc"${cfg.ffmpeg.videoCodec==='hevc_nvenc'?' selected':''}>hevc_nvenc (NVIDIA GPU)</option>
              </select>
            </label>
            <label class="config-kb"><span>Preset</span>
              <select class="wm-select" id="cfgPreset">
                ${['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'].map(p =>
                  `<option value="${p}"${cfg.ffmpeg.preset===p?' selected':''}>${p}</option>`
                ).join('')}
              </select>
            </label>
            <label class="config-kb"><span>CRF/CQ</span><input class="wm-input config-kb-input" type="number" id="cfgCrf" value="${cfg.ffmpeg.crf}" min="0" max="51"></label>
            <label class="config-kb"><span>Audio Codec</span>
              <select class="wm-select" id="cfgAudioCodec">
                <option value="aac"${cfg.ffmpeg.audioCodec==='aac'?' selected':''}>AAC</option>
                <option value="libopus"${cfg.ffmpeg.audioCodec==='libopus'?' selected':''}>Opus</option>
                <option value="copy"${cfg.ffmpeg.audioCodec==='copy'?' selected':''}>Copy (no re-encode)</option>
              </select>
            </label>
            <label class="config-kb"><span>Audio Bitrate</span><input class="wm-input config-kb-input" id="cfgAudioBitrate" value="${escAttr(cfg.ffmpeg.audioBitrate)}"></label>
          </div>
        </div>

        <!-- GPU Acceleration -->
        <div class="config-section">
          <div class="config-section-title">GPU Acceleration</div>
          <p class="config-note">Enable hardware-accelerated decoding. Requires compatible GPU and drivers.</p>
          <div class="config-grid">
            <label class="config-kb"><span>HW Accel</span>
              <select class="wm-select" id="cfgHwaccel">
                <option value=""${!cfg.ffmpeg.hwaccel?' selected':''}>None (CPU only)</option>
                <option value="cuda"${cfg.ffmpeg.hwaccel==='cuda'?' selected':''}>CUDA (NVIDIA)</option>
                <option value="d3d11va"${cfg.ffmpeg.hwaccel==='d3d11va'?' selected':''}>D3D11VA (Windows)</option>
                <option value="dxva2"${cfg.ffmpeg.hwaccel==='dxva2'?' selected':''}>DXVA2 (Windows)</option>
                <option value="qsv"${cfg.ffmpeg.hwaccel==='qsv'?' selected':''}>QSV (Intel)</option>
              </select>
            </label>
            <label class="config-kb"><span>Output Format</span>
              <select class="wm-select" id="cfgHwaccelFormat">
                <option value=""${!cfg.ffmpeg.hwaccelOutputFormat?' selected':''}>Default</option>
                <option value="cuda"${cfg.ffmpeg.hwaccelOutputFormat==='cuda'?' selected':''}>cuda</option>
                <option value="d3d11"${cfg.ffmpeg.hwaccelOutputFormat==='d3d11'?' selected':''}>d3d11</option>
              </select>
            </label>
            <label class="config-kb"><span>Device ID</span><input class="wm-input config-kb-input" id="cfgHwaccelDevice" value="${escAttr(cfg.ffmpeg.hwaccelDevice||'')}" placeholder="e.g. 0 or 1"></label>
          </div>
          <label class="config-kb" style="margin-top:8px;"><span>NVENC Preset</span>
            <select class="wm-select" id="cfgNvencPreset">
              ${['p1','p2','p3','p4','p5','p6','p7'].map(p =>
                `<option value="${p}"${cfg.ffmpeg.nvencPreset===p?' selected':''}>${p}</option>`
              ).join('')}
            </select>
          </label>
        </div>

        <!-- Dev Features -->
        <div class="config-section" style="border:1px dashed #ef4444; border-radius:6px; padding:10px; margin-top:8px;">
          <div class="config-section-title" style="color:#ef4444;">Developer Features <span style="font-weight:400;color:#71717a;">(FOR DEVELOPMENT PURPOSES)</span></div>
          <p class="config-note">When enabled, press <kbd>B</kbd> to toggle batch mode. Creates N identical clips from a single IN/OUT for encoding comparison. Each batch outputs to a subfolder named after the ffmpeg config, with a manifest .txt documenting all commands.</p>
          <label class="config-toggle"><input type="checkbox" id="cfgBatchEnabled" ${batchModeEnabled?'checked':''}> <span>Enable Batch Testing Mode</span></label>
          <label class="config-toggle" style="margin-top:6px;"><input type="checkbox" id="cfgFfmpegLogs" ${cfg.devFeatures?.ffmpegLogs?'checked':''}> <span>Show "View FFMPEG Log" on completed clips</span></label>
          <label class="config-toggle" style="margin-top:6px;"><input type="checkbox" id="cfgKeepTempFiles" ${cfg.devFeatures?.keepTempFiles?'checked':''}> <span>Keep temp files after clip download</span></label>
          <label class="config-toggle" style="margin-top:6px;"><input type="checkbox" id="cfgLogFfmpegCommands" ${cfg.devFeatures?.logFfmpegCommands?'checked':''}> <span>Output all FFmpeg commands to debug log</span></label>
        </div>

      </div>
      <div class="wm-modal-actions">
        <button class="btn btn-ghost btn-sm" id="cfgClose">Close</button>
        <button class="btn btn-primary btn-sm" id="cfgApply">Apply & Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Snapshot all form inputs for dirty-checking
  function snapshotFormValues() {
    const snap = {};
    overlay.querySelectorAll('input, select, textarea').forEach(el => {
      const key = el.id || el.dataset.bind || el.dataset.size;
      if (!key) return;
      snap[key] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return snap;
  }
  const initialSnapshot = snapshotFormValues();

  function hasUnsavedChanges() {
    const current = snapshotFormValues();
    for (const key of Object.keys(initialSnapshot)) {
      if (initialSnapshot[key] !== current[key]) return true;
    }
    return false;
  }

  function tryClose() {
    if (hasUnsavedChanges()) {
      if (!confirm('You have unsaved changes! Close without saving?')) return;
    }
    overlay.remove();
  }

  // Wire up events
  overlay.querySelector('#cfgImport').onclick = async () => {
    const result = await window.clipper.importUserConfig();
    if (result.success) {
      userConfig = mergeDeep(userConfig, result.config);
      applyConfig();
      overlay.remove();
      openConfigModal(); // re-open with new values
    }
  };

  overlay.querySelector('#cfgExport').onclick = () => window.clipper.exportUserConfig();

  overlay.querySelector('#cfgEditWatermark').onclick = async () => {
    // Auto-save current config state before switching modals
    await collectAndSaveConfig();
    overlay.remove();
    openUniversalWatermarkModal();
  };

  overlay.querySelector('#cfgOutroBrowse').onclick = async () => {
    const result = await window.clipper.chooseOutroFile();
    if (result.success) overlay.querySelector('#cfgOutroPath').value = result.filePath;
  };

  overlay.querySelector('#cfgOutroPath').onclick = async () => {
    const result = await window.clipper.chooseOutroFile();
    if (result.success) overlay.querySelector('#cfgOutroPath').value = result.filePath;
  };

  overlay.querySelector('#cfgChannelSave').onclick = async () => {
    const chId = overlay.querySelector('#cfgChannelId').value.trim();
    if (chId) {
      await window.clipper.saveChannelConfig({ channel_id: chId });
      userConfig.defaultChannel.channel_id = chId;
    }
  };

  overlay.querySelector('#cfgChannelDelete').onclick = async () => {
    await window.clipper.deleteChannelConfig();
    overlay.querySelector('#cfgChannelId').value = '';
    userConfig.defaultChannel.channel_id = '';
    userConfig.defaultChannel.enabled = false;
    overlay.querySelector('#cfgChannelEnabled').checked = false;
  };

  overlay.querySelector('#cfgCatchUpSpeed').oninput = function() {
    overlay.querySelector('#cfgCatchUpVal').textContent = this.value + 'x';
  };

  overlay.querySelector('#cfgClose').onclick = () => tryClose();
  overlay.onclick = e => { if (e.target === overlay) tryClose(); };

  // Reusable save: collect all form values and persist
  async function collectAndSaveConfig() {
    // Buttons
    userConfig.buttons.jumpToIn = overlay.querySelector('#cfgJumpIn').checked;
    userConfig.buttons.jumpToEnd = overlay.querySelector('#cfgJumpEnd').checked;
    userConfig.buttons.watermark = overlay.querySelector('#cfgWatermark').checked;
    userConfig.buttons.appendOutro = overlay.querySelector('#cfgOutro').checked;

    // Channel
    userConfig.defaultChannel.enabled = overlay.querySelector('#cfgChannelEnabled').checked;
    userConfig.defaultChannel.channel_id = overlay.querySelector('#cfgChannelId').value.trim();

    // Keybinds
    overlay.querySelectorAll('[data-bind]').forEach(input => {
      let val = input.value.trim();
      if (val.toLowerCase() === 'space') val = ' ';
      userConfig.keybinds[input.dataset.bind] = val;
    });
    overlay.querySelectorAll('[data-size]').forEach(input => {
      userConfig.keybinds[input.dataset.size] = parseInt(input.value) || 5;
    });

    // Catch-up
    userConfig.catchUpSpeed = parseFloat(overlay.querySelector('#cfgCatchUpSpeed').value) || 1.5;

    // FFmpeg
    userConfig.ffmpeg.videoCodec = overlay.querySelector('#cfgVideoCodec').value;
    userConfig.ffmpeg.preset = overlay.querySelector('#cfgPreset').value;
    userConfig.ffmpeg.crf = overlay.querySelector('#cfgCrf').value;
    userConfig.ffmpeg.audioCodec = overlay.querySelector('#cfgAudioCodec').value;
    userConfig.ffmpeg.audioBitrate = overlay.querySelector('#cfgAudioBitrate').value;
    userConfig.ffmpeg.hwaccel = overlay.querySelector('#cfgHwaccel').value;
    userConfig.ffmpeg.hwaccelOutputFormat = overlay.querySelector('#cfgHwaccelFormat').value;
    userConfig.ffmpeg.hwaccelDevice = overlay.querySelector('#cfgHwaccelDevice').value;
    userConfig.ffmpeg.nvencPreset = overlay.querySelector('#cfgNvencPreset').value;

    // Universal outro
    universalOutro.enabled = overlay.querySelector('#cfgOutroEnabled').checked;
    universalOutro.filePath = overlay.querySelector('#cfgOutroPath').value.trim();

    // Dev features
    batchModeEnabled = overlay.querySelector('#cfgBatchEnabled').checked;
    if (!batchModeEnabled) { batchModeActive = false; $('batchPanel').style.display = 'none'; }
    if (!userConfig.devFeatures) userConfig.devFeatures = {};
    userConfig.devFeatures.ffmpegLogs = overlay.querySelector('#cfgFfmpegLogs').checked;
    userConfig.devFeatures.keepTempFiles = overlay.querySelector('#cfgKeepTempFiles').checked;
    userConfig.devFeatures.logFfmpegCommands = overlay.querySelector('#cfgLogFfmpegCommands').checked;

    dbg('ACTION', 'Settings saved', { videoCodec: userConfig.ffmpeg.videoCodec, hwaccel: userConfig.ffmpeg.hwaccel || 'none', catchUpSpeed: userConfig.catchUpSpeed, batchEnabled: batchModeEnabled, ffmpegLogs: userConfig.devFeatures.ffmpegLogs, keepTempFiles: userConfig.devFeatures.keepTempFiles, logFfmpegCommands: userConfig.devFeatures.logFfmpegCommands });
    await saveConfig();
    await saveUniversalConfigs();
    applyConfig();
    renderPendingClips();
    renderCompletedClips();
  }

  // Save buttons
  overlay.querySelector('#cfgSave').onclick = overlay.querySelector('#cfgApply').onclick = async () => {
    await collectAndSaveConfig();
    overlay.remove();
  };
}

/* ─── Universal Watermark Modal ─────────────────────────────── */
function openUniversalWatermarkModal() {
  const old = document.querySelector('.wm-modal-overlay');
  if (old) old.remove();

  const hasImgWm = !!universalImageWatermark;
  const initMode = hasImgWm ? 'image' : 'text';

  const wm = universalWatermark || {
    text: '', fontFamily: 'Arial', fontSize: 48, opacity: 0.7,
    color: '#ffffff', position: 'bottom-right'
  };
  const iwm = universalImageWatermark || {
    imagePath: '', opacity: 0.7, position: 'bottom-right', width: '', height: ''
  };

  const overlay = document.createElement('div');
  overlay.className = 'wm-modal-overlay';
  overlay.innerHTML = `
    <div class="wm-modal">
      <div class="wm-modal-title">Universal Watermark</div>
      <div class="wm-modal-body">
        <p style="color: var(--text-secondary); font-size: 11px; margin-bottom: 8px;">This watermark will be applied to all clips unless overridden per-clip.</p>
        <div class="wm-type-toggle">
          <button class="wm-type-btn${initMode==='text'?' active':''}" data-type="text">Text</button>
          <button class="wm-type-btn${initMode==='image'?' active':''}" data-type="image">Image</button>
        </div>

        <div id="wmTextFields" style="display:${initMode==='text'?'block':'none'}">
          <label class="wm-label">Text
            <input class="wm-input" id="wmText" type="text" value="${escAttr(wm.text)}" placeholder="Your watermark text...">
          </label>
          <div class="wm-row">
            <label class="wm-label wm-half">Font
              <select class="wm-select" id="wmFont">
                ${['Arial','Impact','Georgia','Courier New','Verdana','Tahoma','Trebuchet MS','Comic Sans MS'].map(f =>
                  `<option value="${f}"${wm.fontFamily===f?' selected':''}>${f}</option>`
                ).join('')}
              </select>
            </label>
            <label class="wm-label wm-half">Color
              <input class="wm-color" id="wmColor" type="color" value="${wm.color}">
            </label>
          </div>
          <div class="wm-row">
            <label class="wm-label wm-half">Size <span class="wm-val" id="wmSizeVal">${wm.fontSize}px</span>
              <input class="wm-range" id="wmSize" type="range" min="16" max="120" value="${wm.fontSize}">
            </label>
          </div>
        </div>

        <div id="wmImageFields" style="display:${initMode==='image'?'block':'none'}">
          <label class="wm-label">Image File</label>
          <div class="wm-row" style="gap:8px; align-items:center;">
            <button class="btn btn-accent btn-sm" id="wmChooseImage">Choose Image...</button>
            <span class="wm-val" id="wmImageName" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${iwm.imagePath ? iwm.imagePath.split(/[/\\]/).pop() : 'No image selected'}</span>
          </div>
          <input type="hidden" id="wmImagePath" value="${escAttr(iwm.imagePath || '')}">
          <label class="wm-label">Scale <span class="wm-val" id="wmScaleVal">${Math.round((iwm.scale || 1) * 100)}%</span></label>
          <input class="wm-range" id="wmScale" type="range" min="10" max="200" value="${Math.round((iwm.scale || 1) * 100)}">
        </div>

        <label class="wm-label">Opacity <span class="wm-val" id="wmOpacityVal">${Math.round((initMode==='image'?iwm.opacity:wm.opacity)*100)}%</span></label>
        <input class="wm-range" id="wmOpacity" type="range" min="10" max="100" value="${Math.round((initMode==='image'?iwm.opacity:wm.opacity)*100)}">

        <label class="wm-label">Position</label>
        <div class="wm-position-grid${initMode==='image'?' wm-pos-corners':''}" id="wmPosGrid">
          ${['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right'].map(pos =>
            `<button class="wm-pos${(initMode==='image'?iwm.position:wm.position)===pos?' active':''}" data-pos="${pos}">${
              {'top-left':'&#8598;','top-center':'&#8593;','top-right':'&#8599;','center-left':'&#8592;','center':'&#9679;','center-right':'&#8594;','bottom-left':'&#8601;','bottom-center':'&#8595;','bottom-right':'&#8600;'}[pos]
            }</button>`
          ).join('')}
        </div>

        <div class="wm-preview-wrap">
          <div class="wm-preview" id="wmPreview">
            <span class="wm-preview-text" id="wmPreviewText" style="display:${initMode==='text'?'block':'none'}">${escH(wm.text || 'Preview')}</span>
            <span class="wm-preview-img" id="wmPreviewImg" style="display:${initMode==='image'?'block':'none'}; position:absolute; font-size:10px; color:var(--green); opacity:0.8;">IMG</span>
          </div>
        </div>
      </div>
      <div class="wm-modal-actions">
        <button class="btn btn-ghost btn-sm" id="wmClear">Clear Universal Watermark</button>
        <div class="wm-modal-actions-right">
          <button class="btn btn-ghost btn-sm" id="wmCancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="wmApply">Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let currentMode = initMode;
  const txtIn = overlay.querySelector('#wmText');
  const fontSel = overlay.querySelector('#wmFont');
  const colorIn = overlay.querySelector('#wmColor');
  const sizeIn = overlay.querySelector('#wmSize');
  const opacIn = overlay.querySelector('#wmOpacity');
  const prevText = overlay.querySelector('#wmPreviewText');
  const prevImg = overlay.querySelector('#wmPreviewImg');
  const posGrid = overlay.querySelector('#wmPosGrid');
  const imgPathIn = overlay.querySelector('#wmImagePath');
  const imgNameEl = overlay.querySelector('#wmImageName');
  let selectedPos = (initMode === 'image' ? iwm.position : wm.position) || 'bottom-right';

  // ── Type toggle ──
  overlay.querySelectorAll('.wm-type-btn').forEach(btn => {
    btn.onclick = () => {
      overlay.querySelectorAll('.wm-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.type;
      overlay.querySelector('#wmTextFields').style.display = currentMode === 'text' ? 'block' : 'none';
      overlay.querySelector('#wmImageFields').style.display = currentMode === 'image' ? 'block' : 'none';
      prevText.style.display = currentMode === 'text' ? 'block' : 'none';
      prevImg.style.display = currentMode === 'image' ? 'block' : 'none';
      posGrid.classList.toggle('wm-pos-corners', currentMode === 'image');
      updatePreview();
    };
  });

  // ── Image picker ──
  overlay.querySelector('#wmChooseImage').onclick = async () => {
    const result = await window.clipper.chooseWatermarkImage();
    if (result && result.success) {
      imgPathIn.value = result.filePath;
      imgNameEl.textContent = result.filePath.split(/[/\\]/).pop();
    }
  };

  function updatePreview() {
    overlay.querySelector('#wmOpacityVal').textContent = opacIn.value + '%';
    if (sizeIn) overlay.querySelector('#wmSizeVal').textContent = sizeIn.value + 'px';
    const scaleValEl = overlay.querySelector('#wmScaleVal');
    const scaleIn = overlay.querySelector('#wmScale');
    if (scaleValEl && scaleIn) scaleValEl.textContent = scaleIn.value + '%';

    if (currentMode === 'text') {
      const txt = txtIn.value || 'Preview';
      prevText.textContent = txt;
      prevText.style.fontFamily = fontSel.value;
      prevText.style.fontSize = sizeIn.value / 2 + 'px';
      prevText.style.color = colorIn.value;
      prevText.style.opacity = opacIn.value / 100;
    } else {
      prevImg.style.opacity = opacIn.value / 100;
    }

    const el = currentMode === 'text' ? prevText : prevImg;
    el.style.position = 'absolute';
    const [vy, vx] = selectedPos.includes('-') ? selectedPos.split('-') : ['center', selectedPos === 'center' ? 'center' : selectedPos];
    el.style.top = vy === 'top' ? '8px' : vy === 'bottom' ? '' : '50%';
    el.style.bottom = vy === 'bottom' ? '8px' : '';
    el.style.left = vx === 'left' ? '8px' : vx === 'center' ? '50%' : '';
    el.style.right = vx === 'right' ? '8px' : '';
    el.style.transform = (vy === 'center' && vx === 'center') ? 'translate(-50%,-50%)'
      : vy === 'center' ? 'translateY(-50%)' : vx === 'center' ? 'translateX(-50%)' : 'none';
  }

  txtIn.oninput = updatePreview;
  fontSel.onchange = updatePreview;
  colorIn.oninput = updatePreview;
  sizeIn.oninput = updatePreview;
  opacIn.oninput = updatePreview;
  const scaleSlider = overlay.querySelector('#wmScale');
  if (scaleSlider) scaleSlider.oninput = updatePreview;
  posGrid.onclick = e => {
    const btn = e.target.closest('[data-pos]');
    if (!btn) return;
    posGrid.querySelectorAll('.wm-pos').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedPos = btn.dataset.pos;
    updatePreview();
  };
  updatePreview();

  overlay.querySelector('#wmCancel').onclick = () => { overlay.remove(); openConfigModal(); };
  overlay.onclick = e => { if (e.target === overlay) { overlay.remove(); openConfigModal(); } };

  overlay.querySelector('#wmClear').onclick = async () => {
    universalWatermark = null;
    universalImageWatermark = null;
    await saveUniversalConfigs();
    overlay.remove();
    openConfigModal();
  };

  overlay.querySelector('#wmApply').onclick = async () => {
    if (currentMode === 'text') {
      const text = txtIn.value.trim();
      if (!text) {
        universalWatermark = null;
      } else {
        universalWatermark = {
          text,
          fontFamily: fontSel.value,
          fontSize: parseInt(sizeIn.value),
          opacity: parseInt(opacIn.value) / 100,
          color: colorIn.value,
          position: selectedPos
        };
      }
      universalImageWatermark = null;
    } else {
      const imagePath = imgPathIn.value.trim();
      if (!imagePath) {
        universalImageWatermark = null;
      } else {
        const scaleVal = parseInt(overlay.querySelector('#wmScale').value) / 100;
        universalImageWatermark = {
          imagePath,
          opacity: parseInt(opacIn.value) / 100,
          position: selectedPos,
          ...(scaleVal && scaleVal !== 1 ? { scale: scaleVal } : {}),
        };
      }
      universalWatermark = null;
    }
    await saveUniversalConfigs();
    overlay.remove();
    openConfigModal();
  };
}

/* ─── Settings ──────────────────────────────────────────────── */
$('settingsBtn').onclick = $('outputPath').onclick = async () => {
  dbg('ACTION', 'Choose clips directory');
  const d = await window.clipper.chooseClipsDir();
  if (d) { dbg('ACTION', 'Clips directory changed', { path: d }); $('outputPath').textContent = d; }
};
$('openFolderBtn').onclick = $('openCompletedFolder').onclick = () => { dbg('ACTION', 'Open clips folder'); window.clipper.openClipsFolder(); };

// Config gear button
$('configBtn').onclick = () => { dbg('ACTION', 'Open settings modal'); openConfigModal(); };

/* ─── Initial renders ───────────────────────────────────────── */
renderPendingClips();
renderDownloadingClips();
renderCompletedClips();

/* ─── Collab caption sync subscription ──────────────────────── */
(function wireCollabSync() {
  if (!window.CollabUI || !window.CollabUI.subscribe) {
    setTimeout(wireCollabSync, 100);
    return;
  }
  window.CollabUI.subscribe(handleCollabRangeUpdate);
})();

})();


