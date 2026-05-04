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
// Replace the Windows/Unix home-folder username segment with "ANON" so
// the user's PC name doesn't leak into screenshots or shared screens.
// Display only — saved/used paths still keep the real value.
function pathForDisplay(p) {
  if (!p) return '';
  return String(p).replace(
    /([\/\\])(Users|home)([\/\\])([^\/\\]+)/i,
    '$1$2$3ANON'
  );
}

function renderSendUnsendButton(clip, idx) {
  if (!window.CollabUI) return '';
  if (window.CollabUI.canSendDelivery && window.CollabUI.canSendDelivery()) {
    if (clip.sentByRangeId) {
      return `<button class="btn btn-ghost btn-xs" data-action="unsend-delivery" data-idx="${idx}" title="Unsend from Clipper">Unsend</button>`;
    }
    return `<button class="btn btn-accent btn-xs" data-action="send-delivery" data-idx="${idx}" title="Send to assigned Clipper">Send to Clipper</button>`;
  }
  if (window.CollabUI.canConsumeDeliveries && window.CollabUI.canConsumeDeliveries() && clip.receivedFromDeliveryId) {
    return `<button class="btn btn-ghost btn-xs" data-action="revoke-delivery" data-idx="${idx}" title="Remove this clip locally">Revoke</button>`;
  }
  return '';
}

function renderAttributionBadge(clip) {
  if (!window.CollabUtils || typeof window.CollabUtils.formatClipAttribution !== 'function') return '';
  const clipperName = clip.collabClipperName || clip.clipperName || '';
  const helperName = clip.collabHelperName || clip.helperName || '';
  if (!clipperName) return '';
  const text = window.CollabUtils.formatClipAttribution({ clipperName, helperName });
  if (!text) return '';
  return `<span class="clip-card-attribution">${escH(text)}</span>`;
}
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
  // Fast-path: bail before any IPC work when logging is globally disabled.
  // Caller's payload object is already allocated at call site, but skipping
  // IPC saves the cross-process serialize/post in hot paths.
  if (window.dbgEnabled === false) return;
  if (window.clipper?.sendDebugLog) {
    window.clipper.sendDebugLog({ category, message, data });
  }
}
// Expose for external modules (batch-testing.js etc.)
window.dbg = dbg;
// Default: enabled. Set window.dbgEnabled = false to silence in hot paths.
if (typeof window.dbgEnabled === 'undefined') window.dbgEnabled = true;

// Header Debug button is wired below in the header dropdown wiring section.
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
    // Clipping
    markIn: 'g',
    markOut: 'k',
    editIn: 'h',
    editOut: 'j',
    // Playback
    playPause: ' ',
    volumeUp: 'ArrowUp',
    volumeDown: 'ArrowDown',
    mute: 'm',
    fullscreen: 'f',
    cycleSpeed: 's',
    playbackSpeedDown: 'shift+,',
    playbackSpeedUp: 'shift+.',
    frameStepBack: ',',
    frameStepForward: '.',
    toggleShortcutsOverlay: '?',
    toggleCatchUp: 'c',
    toggleTranscript: 't',
    // Seeking
    seekBackSmall: 'ArrowLeft',
    seekForwardSmall: 'ArrowRight',
    seekBackMedium: 'shift+ArrowLeft',
    seekForwardMedium: 'shift+ArrowRight',
    seekBackLarge: 'ctrl+ArrowLeft',
    seekForwardLarge: 'ctrl+ArrowRight',
    jumpSizeSmall: 5,
    jumpSizeMedium: 30,
    jumpSizeLarge: 60,
    // Layout (Advanced panel system only)
    resetLayout: 'ctrl+shift+r',
    saveLayout: 'ctrl+shift+l',
    // Header
    openClips: '',
    openDebug: '',
  },
  catchUpSpeed: 1.5,
  transcriptionBackend: 'cpu', // 'cpu' (WASM Whisper) or 'gpu' (whisper.cpp CUDA)
  devFeatures: {
    ffmpegLogs: false,
    keepTempFiles: false,
    logFfmpegCommands: false,
    advancedPanelSystem: false,
    frameAccurateClipping: false, // experimental — uses alt arg builder when true; off = main pipeline untouched
    shazamScan: false, // experimental — adds a Shazam button to each pending clip; needs music/.venv
  },
  musicOutputPath: '', // user-chosen .txt where Shazam scan results are appended (when shazamScan is on)
};

// Universal watermark config (cached separately)
let universalWatermark = null;
let universalImageWatermark = null;
// Whether the universal watermark is applied to all clips. Stored
// alongside the watermark/image-watermark configs so users can keep
// a configured watermark on disk while temporarily disabling it.
let universalWatermarkEnabled = false;
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
  if (backBtn) backBtn.classList.add('on');
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
  if (backBtn) backBtn.classList.remove('on');

  window.Player.stream.resetPlayer();
  pendingInTime = null;
  markingIn = false;
  const _u = $('urlIn'); if (_u) _u.value = '';
}

if (backBtn) backBtn.onclick = () => { dbg('ACTION', 'Back to channel browser clicked'); showBrowserView(); };

// Expose for header dropdown wiring (File > Rumble Browser) and for debugging.
window.showBrowserView = showBrowserView;
window.showPlayerView = showPlayerView;

/* ─── Init ──────────────────────────────────────────────────── */
// Initialize the Player module
window.Player.init($);

// Listen for player events
window.Player.on('showplayer', () => showPlayerView());
let _lastMarkerRender = 0;
window.Player.on('timeupdate', () => {
  // timeupdate fires ~40Hz; cap marker rebuilds to ~15Hz.
  const now = performance.now();
  if (now - _lastMarkerRender < 66) return;
  _lastMarkerRender = now;
  renderProgressMarkers();
});
if (window.CollabUI && window.CollabUI.subscribe) {
  // CollabUI fires far less often; let it through unthrottled.
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
  // Expose for cross-module readers (panels.js layout shortcuts, header-modals editor)
  window.userConfig = userConfig;

  // Load universal watermark config
  const savedWm = await window.clipper.loadWatermarkConfig();
  if (savedWm) {
    universalWatermark = savedWm.watermark || null;
    universalImageWatermark = savedWm.imageWatermark || null;
    // Default the enabled flag to true if a watermark was previously
    // configured but no flag was saved (older configs predate the toggle).
    universalWatermarkEnabled = (typeof savedWm.watermarkEnabled === 'boolean')
      ? savedWm.watermarkEnabled
      : !!(universalWatermark || universalImageWatermark);
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
  if (window._panels && window._panels.applyPanelSystemMode) {
    window._panels.applyPanelSystemMode();
  }
  // Shazam HUD show/hide tracks the dev feature toggle live.
  if (typeof shazamHudApplyVisibility === 'function') shazamHudApplyVisibility();
  if (typeof ensureShazamProgressBound === 'function' && userConfig.devFeatures?.shazamScan) {
    ensureShazamProgressBound();
  }
}

async function saveConfig() {
  await window.clipper.saveUserConfig(userConfig);
}

async function saveUniversalConfigs() {
  await window.clipper.saveWatermarkConfig({
    watermark: universalWatermark,
    imageWatermark: universalImageWatermark,
    watermarkEnabled: universalWatermarkEnabled,
    outro: universalOutro,
  });
}

/* ─── Stream loading (delegated to Player module) ──────────── */
const urlIn      = $('urlIn');
const loadBtn    = $('loadBtn');
const vid        = $('vid');
const playerWrap = $('playerWrap');

if (loadBtn) {
  loadBtn.onclick = () => {
    dbg('ACTION', 'Load Stream clicked', { url: urlIn.value.trim().slice(0, 120) });
    window.Player.stream.handleURL(urlIn.value.trim());
  };
}
if (urlIn) {
  urlIn.onkeydown = e => {
    if (e.key === 'Enter') {
      dbg('ACTION', 'URL submitted via Enter', { url: urlIn.value.trim().slice(0, 120) });
      window.Player.stream.handleURL(urlIn.value.trim());
    }
  };
}

/* ─── Player controls are now handled by src/player/ modules ─ */
const progTrack = $('progressTrack');
const collabRangeIndicator = $('collabRangeIndicator');
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

  // Shortcuts cheat-sheet toggle (UI concern — must come before player handler so '?' isn't swallowed)
  if (matchKeybind(e, kb.toggleShortcutsOverlay || '?')) {
    e.preventDefault();
    toggleShortcutsCheatsheet();
    return;
  }
  // Esc closes the cheat-sheet if it's open
  if (e.key === 'Escape') {
    var _cs = document.getElementById('shortcutsCheatsheet');
    if (_cs && !_cs.hidden) { e.preventDefault(); toggleShortcutsCheatsheet(false); return; }
  }

  // All other player keybinds (play/pause, seek, volume, speed, fullscreen, PiP, catch-up)
  if (window.Player.keybinds.handlePlayerKeybind(e, kb, userConfig.catchUpSpeed)) return;

  // Header shortcuts (off by default — user can assign in Keyboard Shortcuts editor)
  if (kb.openClips && matchKeybind(e, kb.openClips)) {
    e.preventDefault();
    if (typeof openPostCaptionWindow === 'function') {
      openPostCaptionWindow(undefined, { tab: 'clips', source: 'shortcut' });
    }
    return;
  }
  if (kb.openDebug && matchKeybind(e, kb.openDebug)) {
    e.preventDefault();
    if (window.clipper && window.clipper.openDebugWindow) window.clipper.openDebugWindow();
    return;
  }
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

function canMarkClips() {
  return !!(window.CollabUI && window.CollabUI.canMarkClips && window.CollabUI.canMarkClips());
}

function handleMarkIn() {
  if (vid.style.display === 'none') return;
  if (!canMarkClips()) { dbg('ACTION', 'Mark IN blocked — viewer role'); return; }
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
  if (!canMarkClips()) { dbg('ACTION', 'Mark OUT blocked — viewer role'); return; }
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
    if (collabRangeIndicator) collabRangeIndicator.classList.remove('visible');
    if (playerWrapEl) playerWrapEl.classList.remove('collab-active-glow');
    return;
  }

  const active = window.CollabUI.getIndicatorAtTime(currentTime);
  if (!active) {
    if (collabRangeIndicator) collabRangeIndicator.classList.remove('visible');
    if (playerWrapEl) playerWrapEl.classList.remove('collab-active-glow');
    return;
  }

  if (collabRangeIndicator) {
    if (collabRangeIndicator.textContent !== active.text) {
      collabRangeIndicator.textContent = active.text;
    }
    collabRangeIndicator.classList.add('visible');
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
function maybeScheduleResend(clip) {
  if (!clip || !clip.sentByRangeId) return;
  if (!window.CollabUI || !window.Delivery) return;
  clearTimeout(clip._resendTimer);
  clip._resendTimer = setTimeout(() => {
    const nextPayload = window.Delivery.buildClipDeliveryPayload(clip);
    const nextJson = JSON.stringify(nextPayload);
    if (clip._lastSentPayloadJson === nextJson) return;
    window.CollabUI.resendClipDelivery(clip);
  }, 500);
}

function renderPendingClips() {
  const list = $('pendingClipList');
  if (pendingClips.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No clips yet</p><small>Mark IN/OUT points while watching to create clips</small></div>';
    updateClipCount(); return;
  }

  const btns = userConfig.buttons;

  list.innerHTML = pendingClips.map((clip, idx) => {
    const isSent = !!clip.sentBy;
    const lockedPrefix = isSent && clip.sentByName ? clip.sentByName + ' - ' : '';
    const bareName = isSent && window.SendFlow
      ? window.SendFlow.stripLockedPrefix(clip.name || '', clip.sentByName)
      : (clip.name || '');
    const sentBorderColor = isSent && window.CollabUI
      ? window.CollabUI.getUserColor(clip.sentBy, clip.sentByName)
      : '';
    const cardStyle = sentBorderColor ? ` style="border-left:4px solid ${sentBorderColor};"` : '';
    return `
    <div class="clip-card${isSent ? ' clip-card-sent' : ''}"${cardStyle}>
      <div class="clip-card-header">
        ${isSent ? `<span class="clip-card-locked-prefix">${escH(lockedPrefix)}</span>` : ''}
        <input class="clip-card-name" type="text" value="${escAttr(bareName)}" data-idx="${idx}" placeholder="Clip name...">
        <button class="clip-card-remove" data-idx="${idx}">&times;</button>
        ${renderAttributionBadge(clip)}
      </div>
      <div class="clip-card-times">
        <span><span class="label">IN</span> <span class="in-val timestamp-editable" data-field="inTime" data-idx="${idx}" title="Click to edit">${fmtHMS(clip.inTime)}</span><button class="repick-btn" data-action="repickIn" data-idx="${idx}" title="Re-pick IN from video">&#9998;</button></span>
        <span><span class="label">OUT</span> <span class="out-val timestamp-editable" data-field="outTime" data-idx="${idx}" title="Click to edit">${fmtHMS(clip.outTime)}</span><button class="repick-btn" data-action="repickOut" data-idx="${idx}" title="Re-pick OUT from video">&#9998;</button></span>
        <span><span class="label">DUR</span> <span class="dur-val">${fmtDur(clip.outTime - clip.inTime)}</span></span>
      </div>
      <textarea class="clip-card-caption" data-idx="${idx}" placeholder="Caption / summary idea..." rows="1">${escH(clip.caption)}</textarea>
      <div class="clip-card-actions">
        <button class="btn btn-success btn-xs" data-action="download" data-idx="${idx}">&#11015; Download</button>
        ${(clip.watermark || clip.imageWatermark || (universalWatermarkEnabled && (universalWatermark || universalImageWatermark))) ? `<button class="btn btn-ghost btn-xs" data-action="preview" data-idx="${idx}" title="Preview watermark placement">Preview</button>` : ''}
        ${btns.jumpToIn ? `<button class="btn btn-ghost btn-xs" data-action="jumpin" data-idx="${idx}">Jump to IN</button>` : ''}
        ${btns.jumpToEnd ? `<button class="btn btn-ghost btn-xs" data-action="jumpout" data-idx="${idx}">Jump to OUT</button>` : ''}
        ${btns.watermark ? `<button class="btn btn-accent btn-xs wm-btn-icon" data-action="watermark" data-idx="${idx}" title="Watermark${(clip.watermark || clip.imageWatermark) ? ' (configured)' : ''}">
          <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          ${(clip.watermark || clip.imageWatermark) ? '<span class="wm-dot"></span>' : ''}
        </button>` : ''}
        ${btns.appendOutro ? `<button class="btn btn-ghost btn-xs" data-action="outro" data-idx="${idx}" title="Add Outro${clip.outro ? ' (set)' : ''}">Add Outro${clip.outro ? ' *' : ''}</button>` : ''}
        ${userConfig.devFeatures?.shazamScan ? `<button class="btn btn-ghost btn-xs" data-action="shazam" data-idx="${idx}" title="Scan this clip's IN&rarr;OUT range for music and append to your Shazam .txt">Shazam</button>` : ''}
        ${renderSendUnsendButton(clip, idx)}
      </div>
    </div>
    `;
  }).join('');

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
    if (btn.dataset.action === 'shazam') { dbg('ACTION', 'Shazam clicked', { idx, name: pendingClips[idx]?.name }); shazamScanClip(idx, btn); }
    if (btn.dataset.action === 'repickIn') { enterRepickMode(idx, 'inTime'); }
    if (btn.dataset.action === 'repickOut') { enterRepickMode(idx, 'outTime'); }
    if (btn.dataset.action === 'send-delivery') {
      const c = pendingClips[idx];
      dbg('ACTION', 'Send to Clipper clicked', { idx, clipId: c?.id, name: c?.name });
      if (c && window.CollabUI && window.CollabUI.sendClipDelivery) {
        window.CollabUI.sendClipDelivery(c).then(res => {
          if (res && res.success) {
            c.sentByRangeId = c.id;
            renderPendingClips();
          } else if (res) {
            dbg('ERROR', 'sendClipDelivery failed', { reason: res.reason, message: res.message, clipId: c.id });
            try { alert(res.message || 'Could not send clip'); } catch (_) {}
          }
        });
      }
    }
    if (btn.dataset.action === 'unsend-delivery') {
      const c = pendingClips[idx];
      dbg('ACTION', 'Unsend Clip clicked', { idx, clipId: c?.id });
      if (c && window.CollabUI && window.CollabUI.unsendClipDelivery) {
        window.CollabUI.unsendClipDelivery(c).then(res => {
          if (res && res.success) {
            c.sentByRangeId = '';
            delete c._lastSentPayloadJson;
            renderPendingClips();
          } else if (res) {
            dbg('ERROR', 'unsendClipDelivery failed', { reason: res.reason, clipId: c.id });
          }
        });
      }
    }
    if (btn.dataset.action === 'revoke-delivery') {
      pendingClips.splice(idx, 1);
      renderPendingClips();
    }
  };
  list.oninput = e => {
    const idx = parseInt(e.target.dataset.idx);
    if (isNaN(idx)) return;
    if (e.target.classList.contains('clip-card-name')) {
      const bare = e.target.value;
      if (pendingClips[idx].sentBy && window.SendFlow) {
        pendingClips[idx].name = window.SendFlow.buildLockedClipName(pendingClips[idx].sentByName, bare);
      } else {
        pendingClips[idx].name = bare;
      }
    }
    if (e.target.classList.contains('clip-card-caption')) pendingClips[idx].caption = e.target.value;
    maybeScheduleResend(pendingClips[idx]);
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
    maybeScheduleResend(clip);
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

  // Universal watermark is only applied if the user has the toggle on; the
  // per-clip override always wins regardless of the universal flag.
  const watermark = clip.watermark || (universalWatermarkEnabled ? universalWatermark : null) || null;
  const imageWatermark = clip.imageWatermark || (universalWatermarkEnabled ? universalImageWatermark : null) || null;

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

/* ─── Shazam scan (dev feature) ───────────────────────────── */
// Per-clip music recognition. Pipes the clip's IN→OUT segment range through
// ffmpeg → music/scan.py (shazamio) and appends recognized tracks to the
// user-chosen .txt. The clip stays in pendingClips — this is non-destructive.
//
// Two streams of feedback:
//   1. dbg('SHAZAM', ...) for the debug terminal — every action/status.
//   2. The Shazam HUD overlay in the top-left of #playerWrap — shows
//      recognized tracks live with click-to-open Spotify/YouTube links.
let _shazamProgressBound = false;
// In-memory list of recognized songs across all scans this session. Each entry
// is { artist, title, spotifyUrl, youtubeUrl, appleUrl, shazamUrl, offset }.
// Deduped by (artist|title) lowercase, same way songs-dedup.js works.
const shazamHudMatches = [];
const shazamHudKeys = new Set();

function shazamMatchKey(artist, title) {
  return (String(artist || '').trim().toLowerCase() + '|||' +
          String(title || '').trim().toLowerCase());
}

// Defensive URL synthesis. extract_links() in scan.py *should* always supply
// a URL (provider deeplink or fallback search URL), but if for any reason
// (older scan.py, older main.js still in-memory, schema change) the field
// arrives null, build a search URL right here so the HUD is ALWAYS clickable.
function shazamSpotifySearchUrl(artist, title) {
  const q = `${(artist || '').trim()} ${(title || '').trim()}`.trim();
  if (!q) return null;
  return `https://open.spotify.com/search/${encodeURIComponent(q)}`;
}
function shazamYoutubeSearchUrl(artist, title) {
  const q = `${(artist || '').trim()} ${(title || '').trim()}`.trim();
  if (!q) return null;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

function shazamLinkSvg(kind) {
  if (kind === 'spotify') {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.59 14.45c-.21.34-.65.45-.99.24-2.71-1.66-6.12-2.04-10.13-1.12-.39.09-.78-.16-.86-.55-.09-.39.16-.78.55-.86 4.41-1.01 8.18-.58 11.21 1.27.34.21.45.65.22.99v.03zm1.23-2.74c-.27.42-.81.55-1.23.28-3.1-1.91-7.83-2.46-11.51-1.34-.47.14-.97-.13-1.11-.6-.14-.47.13-.97.6-1.11 4.21-1.28 9.42-.66 13.01 1.55.42.26.55.81.24 1.22zm.11-2.85c-3.72-2.21-9.86-2.41-13.41-1.34-.57.17-1.16-.16-1.33-.73-.17-.57.15-1.16.73-1.33 4.07-1.23 10.85-1 15.13 1.55.51.3.68.97.37 1.48-.3.51-.97.68-1.49.37z"/></svg>';
  }
  if (kind === 'youtube') {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.5 6.2c-.3-1-1.1-1.9-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6c-1 .3-1.8 1.1-2.1 2.1C0 8.1 0 12 0 12s0 3.9.5 5.8c.3 1 1.1 1.9 2.1 2.1 1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6c1-.3 1.8-1.1 2.1-2.1.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg>';
  }
  return '';
}

function shazamHudShow() {
  const hud = document.getElementById('shazamHud');
  if (hud) hud.hidden = false;
}
function shazamHudHide() {
  const hud = document.getElementById('shazamHud');
  if (hud) hud.hidden = true;
  const panel = document.getElementById('shazamHudPanel');
  if (panel) panel.hidden = true;
}

function shazamHudRender() {
  const list = document.getElementById('shazamHudList');
  const count = document.getElementById('shazamHudCount');
  if (!list || !count) return;
  count.textContent = String(shazamHudMatches.length);
  if (shazamHudMatches.length === 0) {
    list.innerHTML = '';
    return;
  }
  // Newest first — easier to spot just-detected songs. Each row gets two
  // explicit text-pill links so the user sees them immediately. Spotify
  // primary (always shown — search URL fallback if no provider deeplink),
  // YouTube secondary (last resort).
  const items = shazamHudMatches.slice().reverse().map(m => {
    const artist = escH(m.artist);
    const title = escH(m.title);
    const sp = m.spotifyUrl || shazamSpotifySearchUrl(m.artist, m.title);
    const yt = m.youtubeUrl || shazamYoutubeSearchUrl(m.artist, m.title);
    const actions = [];
    if (sp) {
      actions.push(`<a class="shazam-hud-action spotify" href="${escAttr(sp)}" data-shazam-link="${escAttr(sp)}" title="${escAttr(sp)}">
        ${shazamLinkSvg('spotify')}<span>Spotify</span>
      </a>`);
    }
    if (yt) {
      actions.push(`<a class="shazam-hud-action youtube" href="${escAttr(yt)}" data-shazam-link="${escAttr(yt)}" title="${escAttr(yt)}">
        ${shazamLinkSvg('youtube')}<span>YouTube</span>
      </a>`);
    }
    return `
      <li class="shazam-hud-item">
        <div class="shazam-hud-song-title">${title}</div>
        <div class="shazam-hud-song-artist">${artist}</div>
        <div class="shazam-hud-actions">${actions.join('')}</div>
      </li>
    `;
  }).join('');
  list.innerHTML = items;
}

function shazamHudAddMatch(match) {
  if (!match || !match.artist || !match.title) return false;
  const key = shazamMatchKey(match.artist, match.title);
  if (shazamHudKeys.has(key)) return false;
  shazamHudKeys.add(key);
  const artist = String(match.artist).trim();
  const title = String(match.title).trim();
  // Belt-and-suspenders: prefer the URL from the IPC event, fall back to a
  // synthesized search URL if it's missing.
  const spotifyUrl = match.spotifyUrl || shazamSpotifySearchUrl(artist, title);
  const youtubeUrl = match.youtubeUrl || shazamYoutubeSearchUrl(artist, title);
  shazamHudMatches.push({
    artist,
    title,
    spotifyUrl,
    youtubeUrl,
    appleUrl: match.appleUrl || null,
    shazamUrl: match.shazamUrl || null,
    offset: match.offset || 0,
  });
  dbg('SHAZAM', 'HUD entry built', {
    artist, title,
    spotifyFromIpc: !!match.spotifyUrl,
    youtubeFromIpc: !!match.youtubeUrl,
    spotifyUrl: spotifyUrl ? spotifyUrl.slice(0, 80) : null,
    youtubeUrl: youtubeUrl ? youtubeUrl.slice(0, 80) : null,
  });
  shazamHudRender();
  // Brief pulse on the toggle so the user notices a new addition.
  const toggle = document.getElementById('shazamHudToggle');
  if (toggle) {
    toggle.classList.remove('has-new');
    void toggle.offsetWidth;  // force reflow so the animation re-fires
    toggle.classList.add('has-new');
  }
  return true;
}

function shazamHudClear() {
  shazamHudMatches.length = 0;
  shazamHudKeys.clear();
  shazamHudRender();
  dbg('SHAZAM', 'HUD list cleared by user', {});
}

function shazamHudInit() {
  const hud = document.getElementById('shazamHud');
  if (!hud || hud.dataset.bound === '1') return;
  hud.dataset.bound = '1';

  const toggle = document.getElementById('shazamHudToggle');
  const panel = document.getElementById('shazamHudPanel');
  const clearBtn = document.getElementById('shazamHudClear');
  const list = document.getElementById('shazamHudList');

  if (toggle && panel) {
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      dbg('ACTION', `Shazam HUD ${panel.hidden ? 'collapsed' : 'expanded'}`, { count: shazamHudMatches.length });
    });
  }
  if (clearBtn) clearBtn.addEventListener('click', shazamHudClear);

  // Click delegation for the link icons — route through openExternal so the
  // OS default browser handles them. (Spotify desktop will catch
  // open.spotify.com/search via its protocol handler if installed.)
  if (list) {
    list.addEventListener('click', (e) => {
      const a = e.target.closest('[data-shazam-link]');
      if (!a) return;
      e.preventDefault();
      const url = a.dataset.shazamLink;
      if (!url) return;
      dbg('ACTION', 'Shazam link clicked', { url, kind: a.classList.contains('spotify') ? 'spotify' : 'youtube' });
      try { window.clipper.openExternal(url); }
      catch (err) { dbg('SHAZAM', 'openExternal failed', { error: err?.message }); }
    });
  }

  shazamHudRender();
}

function shazamHudApplyVisibility() {
  // The HUD only appears when the dev feature is enabled. Toggling the
  // setting in Settings calls applyConfig() which re-runs this.
  if (userConfig.devFeatures?.shazamScan) shazamHudShow();
  else shazamHudHide();
}

function ensureShazamProgressBound() {
  if (_shazamProgressBound) return;
  if (!window.clipper?.onScanProgress) return;
  window.clipper.onScanProgress((data) => {
    const { clipName, phase } = data;
    if (phase === 'fetching') {
      dbg('SHAZAM', `[${clipName}] fetching segments`, { progress: data.progress, completedSegments: data.completedSegments, totalSegments: data.totalSegments });
    } else if (phase === 'recognizing') {
      const lastMatch = data.lastMatch;
      const lastError = data.lastError;
      dbg('SHAZAM', `[${clipName}] recognizing ${data.completed}/${data.total} (matches=${data.matches} new=${data.newAdds})`,
        lastMatch ? { lastMatch } : (lastError ? { lastError } : null));
      if (lastMatch) {
        const added = shazamHudAddMatch(lastMatch);
        if (added) dbg('SHAZAM', 'HUD added', { artist: lastMatch.artist, title: lastMatch.title });
      }
    } else if (phase === 'done') {
      dbg('SHAZAM', `[${clipName}] done`, { matches: data.matches, newAdds: data.newAdds, errors: data.errors, total: data.total, outputFile: data.outputFile });
    } else if (phase === 'error') {
      dbg('SHAZAM', `[${clipName}] error`, { error: data.error });
    }
  });
  _shazamProgressBound = true;
}

async function shazamScanClip(idx, btn) {
  const clip = pendingClips[idx];
  if (!clip) return;

  if (!userConfig.musicOutputPath) {
    // Prompt for output file on first use, save it, then proceed.
    if (window.toast) window.toast('Pick a Shazam output file...');
    dbg('SHAZAM', 'No output file configured — opening picker', { clipId: clip.id });
    const result = await window.clipper.chooseShazamOutput();
    if (!result || !result.success) {
      dbg('SHAZAM', 'Output picker cancelled — aborting scan', {});
      return;
    }
    userConfig.musicOutputPath = result.filePath;
    try { await saveConfig(); } catch (_) {}
  }

  ensureShazamProgressBound();

  // Compute the clip's segment range exactly the way downloadClip does.
  const startSec = clip.inTime - (clip.seekableStart || 0);
  const durationSec = clip.outTime - clip.inTime;
  if (!(durationSec > 0)) {
    if (window.toast) window.toast('Clip duration is zero — nothing to scan');
    dbg('SHAZAM', 'Aborted — duration <= 0', { clipId: clip.id, inTime: clip.inTime, outTime: clip.outTime });
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Shazam...'; }
  if (window.toast) window.toast(`Shazam: scanning ${clip.name}...`);
  dbg('SHAZAM', 'Invoking scanClipSongs', {
    clipId: clip.id, name: clip.name, startSec, durationSec,
    outputTxtPath: userConfig.musicOutputPath,
  });

  let result;
  try {
    result = await window.clipper.scanClipSongs({
      clipName: clip.name,
      m3u8Url: clip.m3u8Url,
      m3u8Text: clip.m3u8Text,
      startSec,
      durationSec,
      outputTxtPath: userConfig.musicOutputPath,
    });
  } catch (e) {
    dbg('SHAZAM', 'IPC threw', { error: e.message });
    if (window.toast) window.toast(`Shazam error: ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Shazam'; }
    return;
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Shazam'; }

  if (result && result.success) {
    const msg = `Shazam: +${result.newAdds} new (${result.matches} matched, ${result.total} chunks)`;
    if (window.toast) window.toast(msg);
    dbg('SHAZAM', 'Scan succeeded', result);
  } else {
    const err = result?.error || 'unknown error';
    if (window.toast) window.toast(`Shazam failed: ${err}`);
    dbg('SHAZAM', 'Scan failed', { error: err });
  }
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

  const watermark = clip.watermark || (universalWatermarkEnabled ? universalWatermark : null) || null;
  const imageWatermark = clip.imageWatermark || (universalWatermarkEnabled ? universalImageWatermark : null) || null;
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
          ${renderAttributionBadge(dl)}
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
  // Shazam HUD lives in the DOM as static markup; wire its handlers once the
  // DOM is ready and apply current visibility from userConfig.
  if (typeof shazamHudInit === 'function') shazamHudInit();
  if (typeof shazamHudApplyVisibility === 'function') shazamHudApplyVisibility();
  if (typeof ensureShazamProgressBound === 'function' && userConfig.devFeatures?.shazamScan) {
    ensureShazamProgressBound();
  }

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
            <div class="completed-card-name" title="${escAttr(clip.name)}">${escH(clip.name)}${renderAttributionBadge(clip)}</div>
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
    clipperId: clip.clipperId || clip.collabClipperId || '',
    clipperName: clip.clipperName || clip.collabClipperName || '',
    helperId: clip.helperId || clip.collabHelperId || null,
    helperName: clip.helperName || clip.collabHelperName || '',
    postCaptionUpdatedAt: Number(clip.postCaptionUpdatedAt) || 0,
    sentBy: clip.sentBy || '',
    sentByName: clip.sentByName || '',
    collabRangeId: clip.collabRangeId || clip.id || '',
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
      isHelper: isHelperRole(),
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

let _consumeInFlight = false;
async function consumeDeliveriesIntoPending() {
  if (_consumeInFlight) return;
  if (!window.CollabUI || !window.Delivery) return;
  const st = window.CollabUI.getState();
  if (!st.lobby || !window.CollabUI.canConsumeDeliveries()) return;
  _consumeInFlight = true;
  let deliveries = [];
  try {
    deliveries = await window.CollabUI.consumeMyDeliveries();
  } catch (err) {
    _consumeInFlight = false;
    return;
  }
  if (!deliveries.length) { _consumeInFlight = false; return; }

  let changed = false;
  for (const delivery of deliveries) {
    if (delivery.type === 'clip') {
      const existing = window.Delivery.matchExistingClipByDelivery(delivery, pendingClips);
      if (existing) {
        const fresh = window.Delivery.buildClipperClipFromDelivery(delivery);
        Object.assign(existing, {
          name: fresh.name,
          postCaption: fresh.postCaption,
          inTime: fresh.inTime, outTime: fresh.outTime,
          m3u8Url: fresh.m3u8Url, m3u8Text: fresh.m3u8Text,
          isLive: fresh.isLive, seekableStart: fresh.seekableStart,
          helperName: fresh.helperName, helperColor: fresh.helperColor, helperId: fresh.helperId,
          receivedFromDeliveryId: fresh.receivedFromDeliveryId
        });
      } else {
        pendingClips.push(window.Delivery.buildClipperClipFromDelivery(delivery));
      }
      changed = true;
    } else if (delivery.type === 'clipUnsend') {
      const idx = pendingClips.findIndex(c => c.sentByRangeId === delivery.rangeId);
      if (idx >= 0) { pendingClips.splice(idx, 1); changed = true; }
    }
  }
  if (changed) {
    renderPendingClips();
    syncPostCaptionState();
  }
  _consumeInFlight = false;
}

(function wireDeliveryConsumer() {
  if (!window.CollabUI || !window.CollabUI.subscribe) {
    setTimeout(wireDeliveryConsumer, 100);
    return;
  }
  window.CollabUI.subscribe(() => { consumeDeliveriesIntoPending(); });
})();

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
    if (clip.sentByRangeId && window.CollabUI && window.CollabUI.resendClipDelivery) {
      clearTimeout(clip._resendTimer);
      clip._resendTimer = setTimeout(() => window.CollabUI.resendClipDelivery(clip), 500);
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

// Tab definitions for the redesigned settings modal sidebar.
// Order matters — first tab is selected by default.
const SETTINGS_TABS = [
  { id: 'general',     label: 'General',           icon: '⚙', subtitle: 'Editor options, default channel, configuration' },
  { id: 'shortcuts',   label: 'Keyboard',          icon: '⌨', subtitle: 'Shortcut editor lives in Help > Keyboard Shortcuts' },
  { id: 'assets',      label: 'Stream Assets',     icon: '◫', subtitle: 'Universal watermark and outro applied to every clip' },
  { id: 'encoding',    label: 'Encoding',          icon: '⚡', subtitle: 'FFmpeg codecs, presets, and catch-up playback' },
  { id: 'performance', label: 'Hardware',          icon: '▤', subtitle: 'GPU acceleration and decoder tuning' },
  { id: 'developer',   label: 'Developer',         icon: '⚠', subtitle: 'Diagnostics and experimental features' },
];

// Strip <option data-platforms="..."> entries that don't apply to the current
// OS. If the currently-selected option is removed, fall back to the first
// remaining option so the dropdown isn't left with nothing selected.
function filterOptionsByPlatform(root) {
  const plat = (typeof window !== 'undefined' && window.clipper && window.clipper.platform)
             || (typeof process !== 'undefined' && process.platform)
             || 'win32';
  root.querySelectorAll('option[data-platforms]').forEach(opt => {
    const list = (opt.getAttribute('data-platforms') || '').split(',').map(s => s.trim());
    if (list.length && !list.includes(plat)) opt.remove();
  });
  // If a select lost its selected option, pick the first one.
  root.querySelectorAll('select').forEach(sel => {
    if (sel.selectedIndex === -1 && sel.options.length) sel.selectedIndex = 0;
  });
}

function decorateSettingsAsTabs(overlay) {
  const modal   = overlay.querySelector('.config-modal');
  const body    = overlay.querySelector('.wm-modal-body');
  const title   = overlay.querySelector('.wm-modal-title');
  const actions = overlay.querySelector('.wm-modal-actions');
  if (!modal || !body) return;

  // Hide options that don't apply to this OS before any tab grouping happens.
  filterOptionsByPlatform(overlay);

  // Switch to the new sidebar grid layout
  modal.classList.add('settings-modal-redesign');
  modal.style.width = '';
  modal.style.maxHeight = '';
  if (title) title.style.display = 'none';

  // Build the sidebar
  const sidebar = document.createElement('div');
  sidebar.className = 'settings-sidebar';
  sidebar.innerHTML =
    '<div class="settings-sidebar-title">Settings</div>' +
    SETTINGS_TABS.map((t, i) =>
      `<div class="settings-tab${i === 0 ? ' active' : ''}" data-tab="${t.id}">` +
        `<span class="settings-tab-icon">${t.icon}</span>` +
        `<span class="settings-tab-label">${t.label}</span>` +
      '</div>'
    ).join('');

  // Build the right-column pane wrapper (header + body + actions)
  const pane = document.createElement('div');
  pane.className = 'settings-pane';
  const header = document.createElement('div');
  header.className = 'settings-pane-header';
  header.innerHTML =
    '<div>' +
      '<div class="settings-pane-title" id="settingsPaneTitle">' + SETTINGS_TABS[0].label + '</div>' +
      '<div class="settings-pane-subtitle" id="settingsPaneSubtitle">' + SETTINGS_TABS[0].subtitle + '</div>' +
    '</div>';
  pane.appendChild(header);
  body.classList.add('settings-pane-body');
  pane.appendChild(body);
  if (actions) {
    actions.classList.add('settings-pane-actions-row');
    pane.appendChild(actions);
  }
  modal.appendChild(sidebar);
  modal.appendChild(pane);

  // Group existing config-section elements into tab containers
  const sections = Array.from(body.querySelectorAll('.config-section'));
  // Create container per tab
  const tabContainers = {};
  SETTINGS_TABS.forEach(t => {
    const c = document.createElement('div');
    c.className = 'settings-pane-section' + (t.id === 'general' ? ' active' : '');
    c.dataset.tabContainer = t.id;
    body.appendChild(c);
    tabContainers[t.id] = c;
  });
  sections.forEach(sec => {
    const tab = sec.dataset.settingsTab || 'general';
    if (tabContainers[tab]) tabContainers[tab].appendChild(sec);
  });

  // Tab switching
  sidebar.addEventListener('click', (e) => {
    const tab = e.target.closest('.settings-tab');
    if (!tab) return;
    const id = tab.dataset.tab;
    sidebar.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === tab));
    Object.keys(tabContainers).forEach(k => tabContainers[k].classList.toggle('active', k === id));
    const def = SETTINGS_TABS.find(t => t.id === id);
    if (def) {
      const t1 = overlay.querySelector('#settingsPaneTitle');
      const t2 = overlay.querySelector('#settingsPaneSubtitle');
      if (t1) t1.textContent = def.label;
      if (t2) t2.textContent = def.subtitle;
    }
  });
}

function openConfigModal() {
  const old = document.querySelector('.config-modal-overlay');
  if (old) old.remove();

  const cfg = userConfig;
  // Tutorial system is a localStorage flag (not in userConfig) so it stays
  // out of saved/exported configs and never leaks to production users.
  let tutorialDevEnabled = false;
  try { tutorialDevEnabled = localStorage.getItem('ch.tutorial.enabled') === '1'; } catch (_) {}
  const overlay = document.createElement('div');
  overlay.className = 'config-modal-overlay wm-modal-overlay';
  overlay.innerHTML = `
    <div class="config-modal wm-modal" style="width:520px; max-height:85vh; overflow-y:auto;">
      <div class="wm-modal-title">Settings</div>
      <div class="wm-modal-body" style="gap:16px;">

        <!-- Config Actions -->
        <div class="config-section" data-settings-tab="general">
          <div class="config-section-title">Configuration</div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-ghost btn-sm" id="cfgImport">Load / Import Config</button>
            <button class="btn btn-accent btn-sm" id="cfgExport">Export Config</button>
            <button class="btn btn-primary btn-sm" id="cfgSave">Save Config</button>
          </div>
        </div>

        <!-- Button Toggles -->
        <div class="config-section" data-settings-tab="general">
          <div class="config-section-title">Editor / Clipping Options</div>
          <p class="config-note">Toggle which buttons appear on pending clips. Download is always shown.</p>
          <label class="config-toggle"><input type="checkbox" id="cfgJumpIn" ${cfg.buttons.jumpToIn?'checked':''}> <span>Jump to IN</span> <span class="config-default">(on by default)</span></label>
          <label class="config-toggle"><input type="checkbox" id="cfgJumpEnd" ${cfg.buttons.jumpToEnd?'checked':''}> <span>Jump to OUT</span> <span class="config-default">(off by default)</span></label>
          <label class="config-toggle"><input type="checkbox" id="cfgWatermark" ${cfg.buttons.watermark?'checked':''}> <span>Watermark</span> <span class="config-default">(on by default)</span></label>
          <label class="config-toggle"><input type="checkbox" id="cfgOutro" ${cfg.buttons.appendOutro?'checked':''}> <span>Append Outro</span> <span class="config-default">(on by default)</span></label>
        </div>

        <!-- Universal Watermark Config -->
        <div class="config-section" data-settings-tab="assets">
          <div class="config-section-title">Universal Watermark</div>
          <p class="config-note">Set a default watermark applied to all clips unless overridden per-clip.</p>
          <label class="config-toggle"><input type="checkbox" id="cfgWmEnabled" ${universalWatermarkEnabled?'checked':''}> <span>Enable Universal Watermark</span></label>
          <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
            <button class="btn btn-accent btn-sm" id="cfgEditWatermark">${(universalWatermark || universalImageWatermark) ? 'Edit Watermark' : 'Configure Watermark'}</button>
            <span id="cfgWmValue" class="config-value" style="font-size:11px;color:var(--text-muted,#9aa3b2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;">${
              universalImageWatermark && universalImageWatermark.imagePath
                ? '"' + escH(pathForDisplay(universalImageWatermark.imagePath).split(/[/\\]/).pop()) + '"'
                : universalWatermark && universalWatermark.text
                  ? '"' + escH(universalWatermark.text) + '"'
                  : '<em>none configured</em>'
            }</span>
          </div>
        </div>

        <!-- Universal Outro Config -->
        <div class="config-section" data-settings-tab="assets">
          <div class="config-section-title">Universal Outro</div>
          <p class="config-note">Set a default outro video appended to all clips unless overridden per-clip.</p>
          <label class="config-toggle"><input type="checkbox" id="cfgOutroEnabled" ${universalOutro.enabled?'checked':''}> <span>Enable Universal Outro</span></label>
          <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
            <button class="btn btn-accent btn-sm" id="cfgOutroBrowse">${universalOutro.filePath ? 'Change Outro' : 'Choose Outro'}</button>
            <span id="cfgOutroValue" class="config-value" data-real-path="${escAttr(universalOutro.filePath||'')}" style="font-size:11px;color:var(--text-muted,#9aa3b2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;">${
              universalOutro.filePath
                ? '"' + escH(pathForDisplay(universalOutro.filePath)) + '"'
                : '<em>none configured</em>'
            }</span>
          </div>
        </div>

        <!-- Default Channel -->
        <div class="config-section" data-settings-tab="general">
          <div class="config-section-title">Default Channel</div>
          <p class="config-note">Set a default channel to navigate to on startup.</p>
          <label class="config-toggle"><input type="checkbox" id="cfgChannelEnabled" ${cfg.defaultChannel.enabled?'checked':''}> <span>Enable Default Channel</span></label>
          <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
            <input class="wm-input" id="cfgChannelId" type="text" value="${escAttr(cfg.defaultChannel.channel_id||'')}" placeholder="e.g. channelname" style="flex:1; font-size:11px;">
            <button class="btn btn-accent btn-sm" id="cfgChannelSave">Save</button>
            <button class="btn btn-ghost btn-sm" id="cfgChannelDelete">Delete</button>
          </div>
        </div>

        <!-- Keybinds — moved to dedicated Keyboard Shortcuts editor (Help > Keyboard Shortcuts) -->
        <div class="config-section" data-settings-tab="shortcuts">
          <div class="config-section-title">Keyboard Shortcuts</div>
          <p class="config-note">Every shortcut is now editable in the dedicated Keyboard Shortcuts editor.</p>
          <button class="btn btn-accent btn-sm" id="cfgOpenShortcuts">Open Keyboard Shortcuts Editor</button>
        </div>

        <!-- Catch-up Speed -->
        <div class="config-section" data-settings-tab="encoding">
          <div class="config-section-title">Catch-Up Mode</div>
          <p class="config-note">Press <kbd>C</kbd> during playback to toggle catch-up speed after clipping a live moment.</p>
          <label class="wm-label">Speed <span class="wm-val" id="cfgCatchUpVal">${cfg.catchUpSpeed}x</span>
            <input class="wm-range" id="cfgCatchUpSpeed" type="range" min="1.1" max="2.5" step="0.1" value="${cfg.catchUpSpeed}">
          </label>
        </div>

        <!-- FFmpeg Settings -->
        <div class="config-section" data-settings-tab="encoding">
          <div class="config-section-title">FFmpeg / Encoding Settings</div>
          <p class="config-note">Advanced settings for how clips are encoded. Leave defaults unless you know what you're doing.</p>
          <div class="config-grid">
            <label class="config-kb"><span>Video Codec</span>
              <select class="wm-select" id="cfgVideoCodec">
                <option value="libx264" data-platforms="win32,darwin,linux"${cfg.ffmpeg.videoCodec==='libx264'?' selected':''}>libx264 (CPU — all platforms)</option>
                <option value="libx265" data-platforms="win32,darwin,linux"${cfg.ffmpeg.videoCodec==='libx265'?' selected':''}>libx265 (CPU — all platforms)</option>
                <option value="h264_nvenc" data-platforms="win32,linux"${cfg.ffmpeg.videoCodec==='h264_nvenc'?' selected':''}>h264_nvenc (NVIDIA GPU — Windows/Linux)</option>
                <option value="hevc_nvenc" data-platforms="win32,linux"${cfg.ffmpeg.videoCodec==='hevc_nvenc'?' selected':''}>hevc_nvenc (NVIDIA GPU — Windows/Linux)</option>
                <option value="h264_videotoolbox" data-platforms="darwin"${cfg.ffmpeg.videoCodec==='h264_videotoolbox'?' selected':''}>h264_videotoolbox (Apple Silicon / macOS)</option>
                <option value="hevc_videotoolbox" data-platforms="darwin"${cfg.ffmpeg.videoCodec==='hevc_videotoolbox'?' selected':''}>hevc_videotoolbox (Apple Silicon / macOS)</option>
                <option value="h264_vaapi" data-platforms="linux"${cfg.ffmpeg.videoCodec==='h264_vaapi'?' selected':''}>h264_vaapi (Linux — Intel/AMD)</option>
                <option value="hevc_vaapi" data-platforms="linux"${cfg.ffmpeg.videoCodec==='hevc_vaapi'?' selected':''}>hevc_vaapi (Linux — Intel/AMD)</option>
                <option value="h264_qsv" data-platforms="win32,linux"${cfg.ffmpeg.videoCodec==='h264_qsv'?' selected':''}>h264_qsv (Intel Quick Sync — Windows/Linux)</option>
                <option value="hevc_qsv" data-platforms="win32,linux"${cfg.ffmpeg.videoCodec==='hevc_qsv'?' selected':''}>hevc_qsv (Intel Quick Sync — Windows/Linux)</option>
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
        <div class="config-section" data-settings-tab="performance">
          <div class="config-section-title">GPU Acceleration</div>
          <p class="config-note">Enable hardware-accelerated decoding. Requires compatible GPU and drivers.</p>
          <div class="config-grid">
            <label class="config-kb"><span>HW Accel</span>
              <select class="wm-select" id="cfgHwaccel">
                <option value="" data-platforms="win32,darwin,linux"${!cfg.ffmpeg.hwaccel?' selected':''}>None (CPU only)</option>
                <option value="cuda" data-platforms="win32,linux"${cfg.ffmpeg.hwaccel==='cuda'?' selected':''}>CUDA (NVIDIA — Windows/Linux)</option>
                <option value="videotoolbox" data-platforms="darwin"${cfg.ffmpeg.hwaccel==='videotoolbox'?' selected':''}>VideoToolbox (macOS)</option>
                <option value="vaapi" data-platforms="linux"${cfg.ffmpeg.hwaccel==='vaapi'?' selected':''}>VAAPI (Linux — Intel/AMD)</option>
                <option value="d3d11va" data-platforms="win32"${cfg.ffmpeg.hwaccel==='d3d11va'?' selected':''}>D3D11VA (Windows)</option>
                <option value="dxva2" data-platforms="win32"${cfg.ffmpeg.hwaccel==='dxva2'?' selected':''}>DXVA2 (Windows)</option>
                <option value="qsv" data-platforms="win32,linux"${cfg.ffmpeg.hwaccel==='qsv'?' selected':''}>QSV (Intel — Windows/Linux)</option>
              </select>
            </label>
            <label class="config-kb"><span>Output Format</span>
              <select class="wm-select" id="cfgHwaccelFormat">
                <option value="" data-platforms="win32,darwin,linux"${!cfg.ffmpeg.hwaccelOutputFormat?' selected':''}>Default</option>
                <option value="cuda" data-platforms="win32,linux"${cfg.ffmpeg.hwaccelOutputFormat==='cuda'?' selected':''}>cuda (NVIDIA)</option>
                <option value="d3d11" data-platforms="win32"${cfg.ffmpeg.hwaccelOutputFormat==='d3d11'?' selected':''}>d3d11 (Windows)</option>
                <option value="videotoolbox_vld" data-platforms="darwin"${cfg.ffmpeg.hwaccelOutputFormat==='videotoolbox_vld'?' selected':''}>videotoolbox_vld (macOS)</option>
                <option value="vaapi" data-platforms="linux"${cfg.ffmpeg.hwaccelOutputFormat==='vaapi'?' selected':''}>vaapi (Linux)</option>
                <option value="qsv" data-platforms="win32,linux"${cfg.ffmpeg.hwaccelOutputFormat==='qsv'?' selected':''}>qsv (Intel)</option>
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
        <div class="config-section" data-settings-tab="developer" style="border:1px dashed #ef4444; border-radius:6px; padding:10px; margin-top:8px;">
          <div class="config-section-title" style="color:#ef4444;">Developer Features <span style="font-weight:400;color:#71717a;">(FOR DEVELOPMENT PURPOSES)</span></div>
          <p class="config-note">When enabled, press <kbd>B</kbd> to toggle batch mode. Creates N identical clips from a single IN/OUT for encoding comparison. Each batch outputs to a subfolder named after the ffmpeg config, with a manifest .txt documenting all commands.</p>
          <label class="config-toggle"><input type="checkbox" id="cfgBatchEnabled" ${batchModeEnabled?'checked':''}> <span>Enable Batch Testing Mode</span></label>
          <label class="config-toggle" style="margin-top:6px;"><input type="checkbox" id="cfgFfmpegLogs" ${cfg.devFeatures?.ffmpegLogs?'checked':''}> <span>Show "View FFMPEG Log" on completed clips</span></label>
          <label class="config-toggle" style="margin-top:6px;"><input type="checkbox" id="cfgKeepTempFiles" ${cfg.devFeatures?.keepTempFiles?'checked':''}> <span>Keep temp files after clip download</span></label>
          <label class="config-toggle" style="margin-top:6px;"><input type="checkbox" id="cfgLogFfmpegCommands" ${cfg.devFeatures?.logFfmpegCommands?'checked':''}> <span>Output all FFmpeg commands to debug log</span></label>
          <label class="config-toggle" style="margin-top:6px;"><input type="checkbox" id="cfgAdvancedPanels" ${cfg.devFeatures?.advancedPanelSystem?'checked':''}> <span>Enable advanced panel system</span> <span class="config-default">(drag, split, dock, undock, custom layouts &mdash; off for a simpler experience)</span></label>
          <label class="config-toggle" style="margin-top:6px;"><input type="checkbox" id="cfgFrameAccurateClipping" ${cfg.devFeatures?.frameAccurateClipping?'checked':''}> <span>Frame-accurate clipping</span> <span class="config-default">(experimental &mdash; off keeps the main pipeline untouched; tests live in tests/unit/frame-accurate-clip.test.js)</span></label>
          <label class="config-toggle" style="margin-top:6px;"><input type="checkbox" id="cfgTutorialDev" ${tutorialDevEnabled?'checked':''}> <span>Tutorial system</span> <span class="config-default">(in-development guided walkthrough &mdash; reloads the app when toggled; not saved to user config)</span></label>
          <label class="config-toggle" style="margin-top:6px;"><input type="checkbox" id="cfgShazamScan" ${cfg.devFeatures?.shazamScan?'checked':''}> <span>Shazam button on pending clips</span> <span class="config-default">(experimental &mdash; adds a "Shazam" button that scans the clip's IN&rarr;OUT range for music and appends recognized tracks to a .txt; requires music/.venv with shazamio installed)</span></label>
          <div style="display:flex;align-items:center;gap:8px;margin:8px 0 0 22px;">
            <span style="color:#a1a1aa;font-size:12px;">Shazam output file:</span>
            <span id="cfgShazamOutputPath" style="flex:1;color:#71717a;font-size:12px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(cfg.musicOutputPath || '')}">${cfg.musicOutputPath ? escH(cfg.musicOutputPath) : '<em>not set</em>'}</span>
            <button type="button" class="btn btn-ghost btn-xs" id="cfgShazamPick">Choose...</button>
          </div>
        </div>

      </div>
      <div class="wm-modal-actions">
        <button class="btn btn-ghost btn-sm" id="cfgClose">Close</button>
        <button class="btn btn-primary btn-sm" id="cfgApply">Apply & Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Decorate the modal with sidebar tabs (enterprise-style layout)
  decorateSettingsAsTabs(overlay);

  // Wire the "Open Keyboard Shortcuts Editor" button to the dedicated modal
  const _openShortcutsBtn = overlay.querySelector('#cfgOpenShortcuts');
  if (_openShortcutsBtn) {
    _openShortcutsBtn.onclick = () => {
      overlay.remove();
      if (window.HeaderModals && window.HeaderModals.openShortcuts) window.HeaderModals.openShortcuts();
    };
  }

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
      window.userConfig = userConfig;
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

  // Outro path picker. The display element is a <span#cfgOutroValue> with
  // the ANON-sanitized path for screenshot safety; the real path lives on
  // dataset.realPath so the apply-handler can save it back unchanged.
  function setOutroPath(realPath) {
    const span = overlay.querySelector('#cfgOutroValue');
    const btn = overlay.querySelector('#cfgOutroBrowse');
    if (span) {
      span.dataset.realPath = realPath || '';
      span.innerHTML = realPath
        ? '"' + escH(pathForDisplay(realPath)) + '"'
        : '<em>none configured</em>';
    }
    if (btn) btn.textContent = realPath ? 'Change Outro' : 'Choose Outro';
  }
  overlay.querySelector('#cfgOutroBrowse').onclick = async () => {
    const result = await window.clipper.chooseOutroFile();
    if (result.success) setOutroPath(result.filePath);
  };

  // Shazam output picker — seed dataset.path with the persisted value so the
  // "no change" case still saves the existing path correctly.
  {
    const pathSpan = overlay.querySelector('#cfgShazamOutputPath');
    if (pathSpan) pathSpan.dataset.path = userConfig.musicOutputPath || '';
    const pickBtn = overlay.querySelector('#cfgShazamPick');
    if (pickBtn) {
      pickBtn.onclick = async () => {
        dbg('ACTION', 'Shazam output picker opened', {});
        const result = await window.clipper.chooseShazamOutput();
        if (result && result.success) {
          dbg('ACTION', 'Shazam output picker chose path', { filePath: result.filePath });
          if (pathSpan) {
            pathSpan.dataset.path = result.filePath;
            pathSpan.textContent = result.filePath;
            pathSpan.title = result.filePath;
          }
        } else {
          dbg('ACTION', 'Shazam output picker cancelled', {});
        }
      };
    }
  }

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

    // Universal watermark — only the enabled flag is editable from this
    // panel; the configured text/image lives in the watermark editor modal.
    universalWatermarkEnabled = overlay.querySelector('#cfgWmEnabled').checked;

    // Universal outro — read the real path from the span's dataset, not
    // the ANON-sanitized text shown to the user.
    universalOutro.enabled = overlay.querySelector('#cfgOutroEnabled').checked;
    {
      const span = overlay.querySelector('#cfgOutroValue');
      const real = (span && span.dataset && span.dataset.realPath) || '';
      universalOutro.filePath = real.trim();
    }

    // Dev features
    batchModeEnabled = overlay.querySelector('#cfgBatchEnabled').checked;
    if (!batchModeEnabled) { batchModeActive = false; $('batchPanel').style.display = 'none'; }
    if (!userConfig.devFeatures) userConfig.devFeatures = {};
    userConfig.devFeatures.ffmpegLogs = overlay.querySelector('#cfgFfmpegLogs').checked;
    userConfig.devFeatures.keepTempFiles = overlay.querySelector('#cfgKeepTempFiles').checked;
    userConfig.devFeatures.logFfmpegCommands = overlay.querySelector('#cfgLogFfmpegCommands').checked;
    userConfig.devFeatures.advancedPanelSystem = overlay.querySelector('#cfgAdvancedPanels').checked;
    userConfig.devFeatures.frameAccurateClipping = overlay.querySelector('#cfgFrameAccurateClipping').checked;
    userConfig.devFeatures.shazamScan = overlay.querySelector('#cfgShazamScan').checked;
    // musicOutputPath is mutated directly by the picker handler below — just
    // re-read here so the displayed value is what we persist.
    {
      const pathSpan = overlay.querySelector('#cfgShazamOutputPath');
      const picked = pathSpan?.dataset?.path;
      if (picked != null) userConfig.musicOutputPath = picked;
    }

    // Tutorial flag: localStorage, not userConfig. tutorial-boot.js reads
    // this once at page load, so a real toggle requires a reload to take
    // effect. We capture the change here and let the Save handler trigger
    // reload only when the value actually flipped.
    const newTutorialDev = overlay.querySelector('#cfgTutorialDev').checked;
    let tutorialFlagChanged = false;
    try {
      const prev = localStorage.getItem('ch.tutorial.enabled') === '1';
      if (prev !== newTutorialDev) {
        if (newTutorialDev) localStorage.setItem('ch.tutorial.enabled', '1');
        else localStorage.removeItem('ch.tutorial.enabled');
        tutorialFlagChanged = true;
      }
    } catch (_) {}

    dbg('ACTION', 'Settings saved', { videoCodec: userConfig.ffmpeg.videoCodec, hwaccel: userConfig.ffmpeg.hwaccel || 'none', catchUpSpeed: userConfig.catchUpSpeed, batchEnabled: batchModeEnabled, ffmpegLogs: userConfig.devFeatures.ffmpegLogs, keepTempFiles: userConfig.devFeatures.keepTempFiles, logFfmpegCommands: userConfig.devFeatures.logFfmpegCommands });
    await saveConfig();
    await saveUniversalConfigs();
    applyConfig();
    renderPendingClips();
    renderCompletedClips();
    return { tutorialFlagChanged };
  }

  // Save buttons
  overlay.querySelector('#cfgSave').onclick = overlay.querySelector('#cfgApply').onclick = async () => {
    const result = await collectAndSaveConfig();
    overlay.remove();
    if (result && result.tutorialFlagChanged) {
      // Reload so tutorial-boot.js re-evaluates the flag at startup.
      setTimeout(() => location.reload(), 50);
    }
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
$('outputPath').onclick = async () => {
  dbg('ACTION', 'Choose clips directory');
  const d = await window.clipper.chooseClipsDir();
  if (d) { dbg('ACTION', 'Clips directory changed', { path: d }); $('outputPath').textContent = d; }
};
{
  const _completedFolderBtn = $('openCompletedFolder');
  if (_completedFolderBtn) {
    _completedFolderBtn.onclick = () => { dbg('ACTION', 'Open clips folder'); window.clipper.openClipsFolder(); };
  }
}

/* ─── Header dropdown wiring (File / Edit / Help / Clips / Debug) ─ */

// Helper: wire a click on either the action button or the entire row
// (.dd-row-with-action) so the whole row is a target.
function _wireDdRow(buttonId, handler) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  const row = btn.closest('.dd-row-with-action') || btn;
  row.style.cursor = 'pointer';
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    handler(e);
  });
}

// File > Rumble Browser — switches the main window back to the embedded
// channel browser (Rumble homepage), same as the old back-arrow button.
_wireDdRow('ddRumbleBtn', () => {
  dbg('ACTION', 'File > Rumble Browser (back to embedded browser)');
  closeAllMenus();
  if (typeof showBrowserView === 'function') showBrowserView();
  else if (window.showBrowserView) window.showBrowserView();
});

// File > Settings (label half of the split row)
const _ddSettings = $('ddSettings');
if (_ddSettings) {
  _ddSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    dbg('ACTION', 'File > Settings');
    openConfigModal();
    closeAllMenus();
  });
}

// File > Exit
const _ddExit = $('ddExit');
if (_ddExit) {
  _ddExit.addEventListener('click', () => {
    dbg('ACTION', 'File > Exit');
    if (window.clipper && window.clipper.quitApp) window.clipper.quitApp();
    else window.close();
  });
}

// Keep menu open when interacting with the Edit > Stream Settings URL pane
const _editStreamPane = document.querySelector('.edit-stream-pane');
if (_editStreamPane) {
  _editStreamPane.addEventListener('click', (e) => e.stopPropagation());
}

// Edit > View M3U8 URL — copy current stream URL to clipboard
const _ddViewM3u8 = $('ddViewM3u8');
if (_ddViewM3u8) {
  _ddViewM3u8.addEventListener('click', () => {
    dbg('ACTION', 'Edit > View M3U8 URL');
    const url = (window.Player && window.Player.stream && window.Player.stream.PS && window.Player.stream.PS.currentM3U8) || '';
    if (!url) {
      if (window.toast) window.toast('No stream loaded');
    } else {
      navigator.clipboard.writeText(url).then(
        () => window.toast && window.toast('M3U8 URL copied to clipboard'),
        () => window.toast && window.toast('M3U8: ' + url)
      );
    }
    closeAllMenus();
  });
}

// Edit > Reload Stream
const _ddReloadStream = $('ddReloadStream');
if (_ddReloadStream) {
  _ddReloadStream.addEventListener('click', () => {
    dbg('ACTION', 'Edit > Reload Stream');
    const url = (window.Player && window.Player.stream && window.Player.stream.PS && window.Player.stream.PS.currentM3U8) || '';
    if (!url) {
      if (window.toast) window.toast('No stream to reload');
    } else {
      window.Player.stream.handleURL(url);
    }
    closeAllMenus();
  });
}

// Edit > Config > Import
_wireDdRow('ddImportConfig', () => {
  dbg('ACTION', 'Edit > Config > Import');
  if (window.HeaderModals && window.HeaderModals.importAppConfig) window.HeaderModals.importAppConfig();
  closeAllMenus();
});

// Edit > Config > Export
_wireDdRow('ddExportConfig', () => {
  dbg('ACTION', 'Edit > Config > Export');
  if (window.HeaderModals && window.HeaderModals.exportAppConfig) window.HeaderModals.exportAppConfig();
  closeAllMenus();
});

// Help > Check for update — banner provides all visual feedback (checking → result)
const _ddCheckUpdate = $('ddCheckUpdate');
if (_ddCheckUpdate) {
  _ddCheckUpdate.addEventListener('click', () => {
    dbg('ACTION', 'Help > Check for update');
    closeAllMenus();
    if (window.clipper && window.clipper.checkForUpdate) {
      window.clipper.checkForUpdate().catch(() => {});
    }
  });
}

// Help > Debugger
const _ddOpenDebugger = $('ddOpenDebugger');
if (_ddOpenDebugger) {
  _ddOpenDebugger.addEventListener('click', () => {
    dbg('ACTION', 'Help > Debugger');
    closeAllMenus();
    if (window.clipper && window.clipper.openDebugWindow) window.clipper.openDebugWindow();
  });
}

// Help > Keyboard Shortcuts
const _ddShortcuts = $('ddShortcuts');
if (_ddShortcuts) {
  _ddShortcuts.addEventListener('click', () => {
    dbg('ACTION', 'Help > Keyboard Shortcuts');
    closeAllMenus();
    if (window.HeaderModals && window.HeaderModals.openShortcuts) window.HeaderModals.openShortcuts();
  });
}

// Help > About
const _ddAbout = $('ddAbout');
if (_ddAbout) {
  _ddAbout.addEventListener('click', () => {
    dbg('ACTION', 'Help > About');
    closeAllMenus();
    if (window.HeaderModals && window.HeaderModals.openAbout) window.HeaderModals.openAbout();
  });
}

// Modal close buttons
const _aboutClose = $('aboutClose');
if (_aboutClose) _aboutClose.addEventListener('click', () => window.HeaderModals && window.HeaderModals.closeModal('aboutModal'));
const _shortcutsClose = $('shortcutsClose');
if (_shortcutsClose) _shortcutsClose.addEventListener('click', () => window.HeaderModals && window.HeaderModals.closeModal('shortcutsModal'));

/* ─── In-player keyboard shortcuts cheat-sheet ─────────────────
   Quick reference overlay rendered inside .player-wrap. Reads live
   from KeybindRegistry + userConfig so it always shows current binds. */
const CHEATSHEET_GROUPS = [
  { name: 'Playback', ids: ['playPause', 'mute', 'volumeUp', 'volumeDown', 'cycleSpeed', 'playbackSpeedDown', 'playbackSpeedUp', 'frameStepBack', 'frameStepForward', 'fullscreen'] },
  { name: 'Seeking',  ids: ['seekBackSmall', 'seekForwardSmall', 'seekBackMedium', 'seekForwardMedium', 'seekBackLarge', 'seekForwardLarge'] },
  { name: 'Clipping', ids: ['markIn', 'markOut', 'editIn', 'editOut'] },
  { name: 'Help',     ids: ['toggleShortcutsOverlay'] },
];

function renderCheatsheetBody() {
  const body = document.getElementById('cheatsheetBody');
  const Reg = window.KeybindRegistry;
  if (!body || !Reg) return;
  const live = (window.userConfig && window.userConfig.keybinds) || {};
  const lookup = {};
  Reg.REGISTRY.forEach(d => { lookup[d.id] = d; });

  let html = '';
  CHEATSHEET_GROUPS.forEach(group => {
    const rows = group.ids
      .map(id => {
        const def = lookup[id];
        if (!def) return null;
        const bind = (live[id] != null) ? live[id] : def.default;
        return { label: def.label, key: Reg.formatBinding(bind) };
      })
      .filter(Boolean);
    if (!rows.length) return;
    html += `<div class="cheatsheet-subhead">${group.name}</div>`;
    rows.forEach(r => {
      html += `<div class="cheatsheet-row"><span class="cs-label">${r.label}</span><kbd>${r.key}</kbd></div>`;
    });
  });
  body.innerHTML = html;
}

function toggleShortcutsCheatsheet(forceState) {
  const el = document.getElementById('shortcutsCheatsheet');
  const btn = document.getElementById('shortcutsToggleBtn');
  if (!el) return;
  const willOpen = (forceState !== undefined) ? !!forceState : el.hidden;
  if (willOpen) {
    renderCheatsheetBody();
    el.hidden = false;
    el.classList.add('open');
    if (btn) btn.classList.add('active');
  } else {
    el.classList.remove('open');
    el.hidden = true;
    if (btn) btn.classList.remove('active');
  }
}

const _shortcutsToggleBtn = $('shortcutsToggleBtn');
if (_shortcutsToggleBtn) {
  _shortcutsToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleShortcutsCheatsheet();
  });
}
const _cheatsheetClose = $('cheatsheetClose');
if (_cheatsheetClose) {
  _cheatsheetClose.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleShortcutsCheatsheet(false);
  });
}
// Click anywhere on the player area outside the panel closes it
if (playerWrapEl) {
  playerWrapEl.addEventListener('click', (e) => {
    const cs = document.getElementById('shortcutsCheatsheet');
    if (!cs || cs.hidden) return;
    if (cs.contains(e.target)) return;
    if (e.target.closest && e.target.closest('#shortcutsToggleBtn')) return;
    toggleShortcutsCheatsheet(false);
  });
}

// Top-right Clips button (replaces old caption editor icon button)
const _clipsBtn = $('clipsBtn');
if (_clipsBtn) {
  _clipsBtn.addEventListener('click', () => {
    dbg('ACTION', 'Header > Clips');
    if (typeof openPostCaptionWindow === 'function') {
      openPostCaptionWindow(undefined, { tab: 'clips', source: 'header-button' });
    }
  });
}

// Top-right Debug button
const _debugBtn = $('debugBtn');
if (_debugBtn) {
  _debugBtn.addEventListener('click', () => {
    dbg('ACTION', 'Header > Debug');
    if (window.clipper && window.clipper.openDebugWindow) window.clipper.openDebugWindow();
  });
}

/* ─── Initial renders ───────────────────────────────────────── */
renderPendingClips();
renderDownloadingClips();
renderCompletedClips();


})();


