(function () {
'use strict';

/* ─── Utilities ─────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDur(s) {
  if (!s || isNaN(s) || s < 0) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}
function fmtHMS(s) {
  s = Math.floor(Math.max(0, s));
  return `${pad2(Math.floor(s/3600))}:${pad2(Math.floor((s%3600)/60))}:${pad2(s%60)}`;
}
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function escAttr(s) { return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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
let hls = null;
let isLive = false;
let currentM3U8 = null;
let proxyPort = null;
let markingIn = false;
let pendingInTime = null;
let pendingClips = [];
let downloadingClips = [];
let completedClips = [];

// Live DVR state
let liveStartWall = null;
let liveDvrWindow = 0;
let atLiveEdge = true;
let userSeekedAway = false;
let liveStallInterval = null;
let _extractionId = 0;
let thumbVid = null;

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
    markIn: 'i',
    markOut: 'o',
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
  devFeatures: {
    ffmpegLogs: false,
    keepTempFiles: false,
    logFfmpegCommands: false,
  },
};

// Universal watermark config (cached separately)
let universalWatermark = null;
// Universal outro config
let universalOutro = { enabled: false, filePath: '' };

/* ─── Browse / Player mode ──────────────────────────────────── */
let inBrowseMode = true;
let videoLoaded = false;
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
  $('playerWrap').style.display = '';
  $('markerState').style.display = '';
  backBtn.classList.add('on');
}

function showBrowserView() {
  if (videoLoaded) {
    if (!confirm('Are you sure you want to go back? The current video will be unloaded.')) return;
  }
  inBrowseMode = true;
  videoLoaded = false;
  browserWrap.style.display = '';
  $('playerWrap').style.display = 'none';
  $('markerState').style.display = 'none';
  backBtn.classList.remove('on');

  if (hls) { hls.destroy(); hls = null; }
  const v = $('vid');
  v.pause(); v.removeAttribute('src'); v.load();
  $('playerPlaceholder').style.display = 'flex';
  v.style.display = 'none';
  currentM3U8 = null;
  pendingInTime = null;
  markingIn = false;

  $('liveBadge').classList.remove('on');
  $('liveSyncBtn').classList.remove('on', 'at-edge');
  $('extractBar').classList.remove('on');
  setStatus('', 'Browse the channel and click a video to load it');
  $('urlIn').value = '';
}

backBtn.onclick = () => { dbg('ACTION', 'Back to channel browser clicked'); showBrowserView(); };

/* ─── Init ──────────────────────────────────────────────────── */
(async () => {
  proxyPort = await window.clipper.getProxyPort();
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
    universalOutro = savedWm.outro || { enabled: false, filePath: '' };
  }

  applyConfig();

  window.clipper.onClipProgress(({ clipName, progress }) => {
    const dl = downloadingClips.find(d => d.name === clipName);
    if (dl) { dl.progress = progress; renderDownloadingClips(); }
  });

  window.clipper.onStreamFound(({ m3u8, isLive: live }) => {
    dbg('STREAM', 'Stream found via navigator', { m3u8: m3u8?.slice(0, 120), isLive: live });
    showPlayerView();
    urlIn.value = m3u8;
    setStatus('ok', 'Stream grabbed from navigator!');
    currentM3U8 = m3u8;
    loadStream(m3u8, live);
    videoLoaded = true;
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

  setStatus('', 'Browse the channel and click a video to load it');

  channelBrowser.addEventListener('will-navigate', (e) => {
    if (inBrowseMode && isRumbleVideo(e.url)) {
      setTimeout(() => channelBrowser.stop(), 50);
      urlIn.value = e.url;
      handleURL(e.url);
    }
  });

  channelBrowser.addEventListener('new-window', (e) => {
    e.preventDefault();
    if (isRumbleVideo(e.url)) {
      urlIn.value = e.url;
      handleURL(e.url);
    } else if (/rumble\.com/i.test(e.url)) {
      channelBrowser.loadURL(e.url);
    }
  });

  channelBrowser.addEventListener('did-start-navigation', (e) => {
    if (inBrowseMode && e.isMainFrame && isRumbleVideo(e.url)) {
      channelBrowser.stop();
      urlIn.value = e.url;
      handleURL(e.url);
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
    outro: universalOutro,
  });
}

/* ─── Stream loading ────────────────────────────────────────── */
const urlIn      = $('urlIn');
const loadBtn    = $('loadBtn');
const navBtn     = $('navBtn');
const importBtn  = $('importBtn');
const vid        = $('vid');
const playerWrap = $('playerWrap');
const placeholder = $('playerPlaceholder');
const spinner    = $('loadingSpinner');
const bufBadge   = $('bufferBadge');
const statusDot  = $('statusDot');
const statusText = $('statusText');
const liveBadge  = $('liveBadge');
const streamInfo = $('streamInfo');
const extractBar = $('extractBar');
const extractStep = $('extractStep');

const isM3U8 = u => /\.m3u8(\?|$)/i.test(u);
const isRumble = u => /rumble\.com/i.test(u);

function setStatus(type, text) {
  statusDot.className = 'status-dot' + (type ? ` ${type}` : '');
  statusText.textContent = text;
}

loadBtn.onclick = () => { dbg('ACTION', 'Load Stream clicked', { url: urlIn.value.trim().slice(0, 120) }); handleURL(urlIn.value.trim()); };
urlIn.onkeydown = e => { if (e.key === 'Enter') { dbg('ACTION', 'URL submitted via Enter', { url: urlIn.value.trim().slice(0, 120) }); handleURL(urlIn.value.trim()); } };

if (navBtn) navBtn.onclick = () => {
  const url = urlIn.value.trim();
  dbg('ACTION', 'Browse Rumble clicked', { url: url || '(none)' });
  window.clipper.openNavigator({ url: isRumble(url) ? url : undefined });
  setStatus('', 'Rumble navigator open — play any video to grab the stream');
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
      handleURL(f.path || f.name);
    } else {
      currentM3U8 = null;
      const objectUrl = URL.createObjectURL(f);
      loadLocalFile(objectUrl, f.name);
    }
  };
  input.click();
});

async function handleURL(raw) {
  if (!raw) return;
  showPlayerView();

  if (hls) { hls.destroy(); hls = null; }
  vid.pause(); vid.removeAttribute('src'); vid.load();

  currentM3U8 = null;
  liveBadge.classList.remove('on');
  $('liveSyncBtn').classList.remove('on', 'at-edge');
  extractBar.classList.remove('on');
  loadBtn.disabled = true;
  setStatus('', 'Loading...');

  if (isM3U8(raw)) {
    currentM3U8 = raw;
    loadStream(raw, false);
    loadBtn.disabled = false;
    return;
  }

  if (isRumble(raw)) {
    const myId = ++_extractionId;
    extractBar.classList.add('on');
    extractStep.textContent = 'Opening Rumble in background browser...';
    try {
      const result = await window.clipper.extractM3U8({ pageUrl: raw });
      if (myId !== _extractionId) return;
      extractBar.classList.remove('on');
      currentM3U8 = result.m3u8;
      urlIn.value = result.m3u8;
      loadStream(result.m3u8, result.isLive);
    } catch (err) {
      if (myId !== _extractionId) return;
      extractBar.classList.remove('on');
      loadBtn.disabled = false;
      setStatus('err', 'Could not extract stream');
      const useNav = confirm(
        'Auto-extraction failed:\n' + err.message +
        '\n\nOpen the Rumble browser navigator to grab it manually?'
      );
      if (useNav) window.clipper.openNavigator({ url: raw });
    }
    return;
  }

  currentM3U8 = raw;
  dbg('STREAM', 'Loading stream URL', { url: raw.slice(0, 120) });
  loadStream(raw, false);
  loadBtn.disabled = false;
}

function loadStream(url, liveHint) {
  loadBtn.disabled = false;
  isLive = !!liveHint;
  liveStartWall = null;
  liveDvrWindow = 0;
  atLiveEdge = true;
  userSeekedAway = false;
  if (liveStallInterval) { clearInterval(liveStallInterval); liveStallInterval = null; }

  if (hls) { hls.destroy(); hls = null; }
  vid.pause(); vid.removeAttribute('src'); vid.load();
  if (typeof thumbVid !== 'undefined' && thumbVid) { thumbVid.removeAttribute('src'); thumbVid.load(); thumbVid = null; }

  placeholder.style.display = 'none';
  vid.style.display = 'block';
  spinner.classList.add('on');
  liveBadge.classList.remove('on');
  $('liveSyncBtn').classList.remove('on', 'at-edge');
  streamInfo.textContent = '';
  setStatus('', 'Connecting...');

  if (!Hls.isSupported()) {
    spinner.classList.remove('on');
    setStatus('err', 'HLS not supported in this browser');
    return;
  }

  const proxied = `http://localhost:${proxyPort}/proxy?url=${encodeURIComponent(url)}`;

  hls = new Hls({
    enableWorker: true,
    backBufferLength: liveHint ? 300 : 120,
    maxBufferLength: liveHint ? 60 : 30,
    maxMaxBufferLength: liveHint ? 120 : 60,
    maxBufferSize: 60 * 1000 * 1000,
    maxBufferHole: 0.5,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 8,
    liveDurationInfinity: true,
    liveBackBufferLength: 300,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1000,
    manifestLoadingMaxRetry: 4,
    levelLoadingMaxRetry: 4,
    abrEwmaDefaultEstimate: 5000000,
    startLevel: -1,
    lowLatencyMode: false,
  });

  hls.loadSource(proxied);
  hls.attachMedia(vid);

  hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => {
    spinner.classList.remove('on');
    videoLoaded = true;
    dbg('HLS', 'Manifest parsed', { levels: d.levels?.length, live: d.live, duration: vid.duration });

    setTimeout(() => {
      const seekable = vid.seekable;
      isLive = d.live || !isFinite(vid.duration) || (seekable.length > 0 && !isFinite(seekable.end(seekable.length - 1)));
      if (!isLive && vid.duration > 0) isLive = false;

      if (isLive) {
        liveStartWall = Date.now();
        liveBadge.classList.add('on');
        $('liveSyncBtn').classList.add('on', 'at-edge');
        setStatus('live', 'Live stream');
        dbg('HLS', 'Stream type: LIVE', { seekableStart: seekable.length > 0 ? seekable.start(0) : null, seekableEnd: seekable.length > 0 ? seekable.end(seekable.length-1) : null });
      } else {
        liveBadge.classList.remove('on');
        $('liveSyncBtn').classList.remove('on');
        setStatus('ok', `VOD — ${fmtDur(vid.duration)}`);
        dbg('HLS', 'Stream type: VOD', { duration: vid.duration });
      }
    }, 800);

    const qSel = $('qualitySelect');
    qSel.innerHTML = '<option value="-1">Auto</option>';
    if (d.levels && d.levels.length > 1) {
      const sorted = d.levels.map((lv, i) => ({ lv, i })).sort((a, b) => (b.lv.height || 0) - (a.lv.height || 0));
      sorted.forEach(({ lv, i }) => {
        const o = document.createElement('option');
        o.value = i;
        const label = lv.height ? `${lv.height}p` : `Level ${i+1}`;
        const kbps = lv.bitrate ? ` (${(lv.bitrate/1000).toFixed(0)}k)` : '';
        o.textContent = label + kbps;
        qSel.appendChild(o);
      });
      qSel.style.display = 'block';
      qSel.onchange = () => { const lvl = parseInt(qSel.value); dbg('ACTION', 'Quality changed', { level: lvl, label: qSel.options[qSel.selectedIndex]?.text }); hls.currentLevel = lvl; };
    } else {
      qSel.style.display = 'none';
    }

    vid.play().catch(() => {});
  });

  hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => {
    const lv = hls.levels[d.level];
    if (lv) {
      const parts = [];
      if (lv.height) parts.push(`${lv.width}x${lv.height}`);
      if (lv.bitrate) parts.push(`${(lv.bitrate/1000).toFixed(0)} kbps`);
      streamInfo.textContent = parts.join(' · ');
    }
  });

  hls.on(Hls.Events.ERROR, (_, d) => {
    dbg('HLS', `Error: ${d.details}`, { type: d.type, fatal: d.fatal, reason: d.reason || '' });
    console.warn('HLS error:', d.type, d.details, d.fatal, d);
    if (!d.fatal) {
      if (d.details === 'bufferStalledError' && isLive && !userSeekedAway) {
        const seekable = vid.seekable;
        if (seekable.length > 0) {
          const edge = seekable.end(seekable.length - 1);
          if (edge - vid.currentTime > 15) {
            vid.currentTime = edge - 3;
          }
        }
      }
      return;
    }
    spinner.classList.remove('on');
    if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
      setStatus('err', 'Network error — retrying...');
      setTimeout(() => hls && hls.startLoad(), 1500);
    } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
      setStatus('err', 'Media error — recovering...');
      hls.recoverMediaError();
    } else {
      setStatus('err', 'Stream error: ' + (d.details || 'unknown'));
      console.error('HLS fatal error:', d);
    }
  });

  if (liveHint) {
    liveStallInterval = setInterval(() => {
      if (!hls || !isLive) { clearInterval(liveStallInterval); liveStallInterval = null; return; }
      if (userSeekedAway) return;
      const seekable = vid.seekable;
      if (seekable.length === 0) return;
      const edge = seekable.end(seekable.length - 1);
      if (vid.paused && atLiveEdge && !userSeekedAway) {
        vid.currentTime = edge - 2;
        vid.play().catch(() => {});
      }
    }, 5000);
  }
}

function loadLocalFile(objectUrl, name) {
  if (hls) { hls.destroy(); hls = null; }
  placeholder.style.display = 'none';
  vid.style.display = 'block';
  vid.src = objectUrl;
  vid.load();
  vid.play().catch(() => {});
  isLive = false;
  setStatus('ok', 'Local: ' + name);
}

/* ─── Player controls ───────────────────────────────────────── */
const ppBtn      = $('playPauseBtn');
const iconPlay   = ppBtn.querySelector('.icon-play');
const iconPause  = ppBtn.querySelector('.icon-pause');
const progTrack  = $('progressTrack');
const progFill   = $('progressFill');
const timeDisp   = $('timeDisplay');
const muteBtn    = $('muteBtn');
const volSlider  = $('volumeSlider');
const speedBtn   = $('speedBtn');
const fsBtn      = $('fullscreenBtn');

const speeds = [0.25, 0.5, 0.75, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0, 2.5];
let speedIdx = 3;

function togglePlay() { dbg('ACTION', vid.paused ? 'Play' : 'Pause'); vid.paused ? vid.play() : vid.pause(); }
ppBtn.onclick = togglePlay;
vid.onclick   = togglePlay;

vid.onplay  = () => { iconPlay.style.display='none'; iconPause.style.display='block'; playerWrap.classList.remove('paused'); bufBadge.classList.remove('on'); };
vid.onpause = () => { iconPlay.style.display='block'; iconPause.style.display='none'; playerWrap.classList.add('paused'); };
vid.onwaiting = () => bufBadge.classList.add('on');
vid.oncanplay = () => bufBadge.classList.remove('on');

const liveSyncBtn  = $('liveSyncBtn');
const hoverPreview = $('hoverPreview');
const hoverCanvas  = $('hoverCanvas');
const hoverTime    = $('hoverTime');
const progBuffer   = $('progressBuffer');

let thumbDebounce = null;

vid.ontimeupdate = () => {
  if (isLive) {
    const seekable = vid.seekable;
    if (seekable.length > 0) {
      const start = seekable.start(0);
      const end = seekable.end(seekable.length - 1);
      liveDvrWindow = end - start;
      const pos = vid.currentTime - start;
      const pct = liveDvrWindow > 0 ? (pos / liveDvrWindow * 100) : 0;
      progFill.style.width = Math.min(100, pct) + '%';

      const behind = end - vid.currentTime;
      atLiveEdge = behind < 5;
      liveSyncBtn.classList.toggle('at-edge', atLiveEdge);

      if (atLiveEdge) {
        timeDisp.textContent = fmtDur(vid.currentTime);
      } else {
        timeDisp.textContent = `-${fmtDur(behind)} / ${fmtDur(vid.currentTime)}`;
      }
    } else {
      progFill.style.width = '0%';
      timeDisp.textContent = fmtDur(vid.currentTime);
    }
  } else if (isFinite(vid.duration)) {
    progFill.style.width = (vid.currentTime / vid.duration * 100) + '%';
    timeDisp.textContent = fmtDur(vid.currentTime) + ' / ' + fmtDur(vid.duration);
  } else {
    progFill.style.width = '0%';
    timeDisp.textContent = '0:00';
  }
  updateBufferBar();
  renderProgressMarkers();
};

function updateBufferBar() {
  if (!vid.buffered || vid.buffered.length === 0) {
    progBuffer.style.width = '0%';
    return;
  }
  if (isLive) {
    const seekable = vid.seekable;
    if (seekable.length > 0) {
      const start = seekable.start(0);
      const range = seekable.end(seekable.length - 1) - start;
      const bufEnd = vid.buffered.end(vid.buffered.length - 1) - start;
      progBuffer.style.width = range > 0 ? Math.min(100, bufEnd / range * 100) + '%' : '0%';
    }
  } else if (isFinite(vid.duration) && vid.duration > 0) {
    const bufEnd = vid.buffered.end(vid.buffered.length - 1);
    progBuffer.style.width = (bufEnd / vid.duration * 100) + '%';
  }
}

liveSyncBtn.onclick = () => {
  if (!hls || !isLive) return;
  dbg('ACTION', 'Jump to LIVE edge clicked');
  const seekable = vid.seekable;
  if (seekable.length > 0) {
    vid.currentTime = seekable.end(seekable.length - 1) - 1;
    if (vid.paused) vid.play().catch(() => {});
  }
  userSeekedAway = false;
  enableHlsLiveSync();
  hls.startLoad();
};

let dragging = false;
progTrack.onmousedown = e => { dragging = true; dbg('ACTION', 'Progress bar seek started'); doSeek(e); };
document.onmousemove  = e => {
  if (dragging) doSeek(e);
  if (e.target === progTrack || progTrack.contains(e.target)) showHoverPreview(e);
};
document.onmouseup = () => { dragging = false; };

function doSeek(e) {
  const r = progTrack.getBoundingClientRect();
  const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  if (isLive) {
    const seekable = vid.seekable;
    if (seekable.length > 0) {
      const start = seekable.start(0);
      const end = seekable.end(seekable.length - 1);
      const target = Math.max(start, Math.min(end - 0.5, start + p * (end - start)));
      vid.currentTime = target;
      if ((end - target) > 5) {
        userSeekedAway = true;
        disableHlsLiveSync();
      } else {
        userSeekedAway = false;
        enableHlsLiveSync();
      }
    }
  } else if (isFinite(vid.duration)) {
    vid.currentTime = p * vid.duration;
  }
}

progTrack.addEventListener('mouseenter', () => { hoverPreview.classList.add('on'); });
progTrack.addEventListener('mouseleave', () => {
  hoverPreview.classList.remove('on');
  if (thumbDebounce) { clearTimeout(thumbDebounce); thumbDebounce = null; }
});

function showHoverPreview(e) {
  const r = progTrack.getBoundingClientRect();
  const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  let hoverSec;

  if (isLive) {
    const seekable = vid.seekable;
    if (seekable.length > 0) {
      const start = seekable.start(0);
      const end = seekable.end(seekable.length - 1);
      hoverSec = start + p * (end - start);
      const behind = end - hoverSec;
      hoverTime.textContent = behind < 2 ? 'LIVE' : `-${fmtDur(behind)}`;
    } else return;
  } else if (isFinite(vid.duration)) {
    hoverSec = p * vid.duration;
    hoverTime.textContent = fmtDur(hoverSec);
  } else return;

  const px = e.clientX - r.left;
  const clamp = Math.max(85, Math.min(r.width - 85, px));
  hoverPreview.style.left = clamp + 'px';

  if (!isLive && isFinite(vid.duration)) {
    if (thumbDebounce) clearTimeout(thumbDebounce);
    thumbDebounce = setTimeout(() => generateThumb(hoverSec), 80);
  } else {
    hoverCanvas.style.display = 'none';
  }
}

function generateThumb(sec) {
  hoverCanvas.style.display = 'block';
  if (!thumbVid) {
    thumbVid = document.createElement('video');
    thumbVid.muted = true;
    thumbVid.preload = 'auto';
    thumbVid.style.display = 'none';
    document.body.appendChild(thumbVid);
    if (hls && vid.src) {
      thumbVid.src = vid.src;
    } else if (vid.src) {
      thumbVid.src = vid.src;
    }
  }

  thumbVid.currentTime = sec;
  thumbVid.onseeked = () => {
    try {
      const ctx = hoverCanvas.getContext('2d');
      ctx.drawImage(thumbVid, 0, 0, 160, 90);
    } catch { /* CORS or decode failure */ }
    thumbVid.onseeked = null;
  };
}

volSlider.oninput = () => { vid.volume = +volSlider.value; vid.muted = vid.volume === 0; syncVol(); dbg('ACTION', 'Volume changed', { volume: vid.volume }); };
muteBtn.onclick = () => { vid.muted = !vid.muted; syncVol(); dbg('ACTION', vid.muted ? 'Muted' : 'Unmuted'); };
function syncVol() {
  const m = vid.muted || vid.volume === 0;
  muteBtn.querySelector('.icon-vol').style.display  = m ? 'none' : 'block';
  muteBtn.querySelector('.icon-mute').style.display = m ? 'block' : 'none';
}

speedBtn.onclick = () => {
  speedIdx = (speedIdx + 1) % speeds.length;
  vid.playbackRate = speeds[speedIdx];
  speedBtn.textContent = speeds[speedIdx] + 'x';
  dbg('ACTION', 'Speed changed', { speed: speeds[speedIdx] });
};

function clampLive(t) {
  const s = vid.seekable;
  if (!isLive || s.length === 0) return t;
  const start = s.start(0);
  const end = s.end(s.length - 1);
  return Math.max(start, Math.min(end - 0.5, t));
}

function disableHlsLiveSync() {
  if (!hls) return;
  hls.config.liveSyncDurationCount = Infinity;
  hls.config.liveMaxLatencyDurationCount = Infinity;
}
function enableHlsLiveSync() {
  if (!hls) return;
  hls.config.liveSyncDurationCount = 3;
  hls.config.liveMaxLatencyDurationCount = 8;
}

$('skipBack').onclick = () => {
  dbg('ACTION', 'Skip back 10s', { from: vid.currentTime });
  const t = vid.currentTime - 10;
  vid.currentTime = isLive ? clampLive(t) : Math.max(0, t);
  if (isLive) { userSeekedAway = true; disableHlsLiveSync(); }
};
$('skipForward').onclick = () => {
  dbg('ACTION', 'Skip forward 10s', { from: vid.currentTime });
  const t = vid.currentTime + 10;
  vid.currentTime = isLive ? clampLive(t) : Math.min(vid.duration || Infinity, t);
  if (isLive && vid.seekable.length > 0) {
    const edge = vid.seekable.end(vid.seekable.length - 1);
    if (edge - vid.currentTime < 5) { userSeekedAway = false; enableHlsLiveSync(); }
  }
};

$('pipBtn').onclick = async () => {
  dbg('ACTION', document.pictureInPictureElement ? 'Exit PiP' : 'Enter PiP');
  if (document.pictureInPictureElement) await document.exitPictureInPicture();
  else if (vid.requestPictureInPicture) try { await vid.requestPictureInPicture(); } catch {}
};

fsBtn.onclick = () => {
  dbg('ACTION', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
  if (!document.fullscreenElement) playerWrap.requestFullscreen?.();
  else document.exitFullscreen?.();
};
document.addEventListener('fullscreenchange', () => {
  const fs = !!document.fullscreenElement;
  fsBtn.querySelector('.icon-fs').style.display     = fs ? 'none' : 'block';
  fsBtn.querySelector('.icon-fs-exit').style.display = fs ? 'block' : 'none';
});

let hideTimer = null;
playerWrap.addEventListener('mousemove', () => {
  $('controlsOverlay').style.cssText = 'opacity:1;pointer-events:all';
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!vid.paused) $('controlsOverlay').style.cssText = '';
  }, 2500);
});

/* ─── Customizable Keybinds ─────────────────────────────────── */
function matchKeybind(e, bind) {
  if (!bind) return false;
  const parts = bind.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const needCtrl = parts.includes('ctrl');
  const needShift = parts.includes('shift');
  const needAlt = parts.includes('alt');

  if (needCtrl !== e.ctrlKey) return false;
  if (needShift !== e.shiftKey) return false;
  if (needAlt !== e.altKey) return false;

  return e.key.toLowerCase() === key.toLowerCase() || e.key === key;
}

document.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  const kb = userConfig.keybinds;

  // Play/Pause
  if (matchKeybind(e, kb.playPause) || e.key === 'k') {
    e.preventDefault(); togglePlay(); return;
  }

  // Mark IN/OUT
  if (matchKeybind(e, kb.markIn)) { e.preventDefault(); handleMarkIn(); return; }
  if (matchKeybind(e, kb.markOut)) { e.preventDefault(); handleMarkOut(); return; }

  // Seek — large (Ctrl+Arrow)
  if (matchKeybind(e, kb.seekBackLarge)) {
    e.preventDefault();
    const t = vid.currentTime - (kb.jumpSizeLarge || 60);
    vid.currentTime = isLive ? clampLive(t) : Math.max(0, t);
    if (isLive) { userSeekedAway = true; disableHlsLiveSync(); }
    return;
  }
  if (matchKeybind(e, kb.seekForwardLarge)) {
    e.preventDefault();
    const t = vid.currentTime + (kb.jumpSizeLarge || 60);
    vid.currentTime = isLive ? clampLive(t) : Math.min(vid.duration||Infinity, t);
    if (isLive && vid.seekable.length > 0) {
      const edge = vid.seekable.end(vid.seekable.length - 1);
      if (edge - vid.currentTime < 5) { userSeekedAway = false; enableHlsLiveSync(); }
    }
    return;
  }

  // Seek — medium (Shift+Arrow)
  if (matchKeybind(e, kb.seekBackMedium)) {
    e.preventDefault();
    const t = vid.currentTime - (kb.jumpSizeMedium || 30);
    vid.currentTime = isLive ? clampLive(t) : Math.max(0, t);
    if (isLive) { userSeekedAway = true; disableHlsLiveSync(); }
    return;
  }
  if (matchKeybind(e, kb.seekForwardMedium)) {
    e.preventDefault();
    const t = vid.currentTime + (kb.jumpSizeMedium || 30);
    vid.currentTime = isLive ? clampLive(t) : Math.min(vid.duration||Infinity, t);
    if (isLive && vid.seekable.length > 0) {
      const edge = vid.seekable.end(vid.seekable.length - 1);
      if (edge - vid.currentTime < 5) { userSeekedAway = false; enableHlsLiveSync(); }
    }
    return;
  }

  // Seek — small (plain Arrow)
  if (matchKeybind(e, kb.seekBackSmall)) {
    e.preventDefault();
    const t = vid.currentTime - (kb.jumpSizeSmall || 5);
    vid.currentTime = isLive ? clampLive(t) : Math.max(0, t);
    if (isLive) { userSeekedAway = true; disableHlsLiveSync(); }
    return;
  }
  if (matchKeybind(e, kb.seekForwardSmall)) {
    e.preventDefault();
    const t = vid.currentTime + (kb.jumpSizeSmall || 5);
    vid.currentTime = isLive ? clampLive(t) : Math.min(vid.duration||Infinity, t);
    if (isLive && vid.seekable.length > 0) {
      const edge = vid.seekable.end(vid.seekable.length - 1);
      if (edge - vid.currentTime < 5) { userSeekedAway = false; enableHlsLiveSync(); }
    }
    return;
  }

  // Volume
  if (e.key === 'ArrowUp') { e.preventDefault(); vid.volume = Math.min(1, vid.volume+0.1); volSlider.value=vid.volume; syncVol(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); vid.volume = Math.max(0, vid.volume-0.1); volSlider.value=vid.volume; syncVol(); return; }

  // Other shortcuts
  if (e.key === 'm' || e.key === 'M') { vid.muted = !vid.muted; syncVol(); return; }
  if (e.key === 'f' || e.key === 'F') { fsBtn.click(); return; }
  if (e.key === 's' || e.key === 'S') { speedBtn.click(); return; }

  // Batch mode toggle: press B (only when enabled in settings)
  if ((e.key === 'b' || e.key === 'B') && batchModeEnabled) {
    e.preventDefault();
    batchModeActive = !batchModeActive;
    $('batchPanel').style.display = batchModeActive ? '' : 'none';
    dbg('ACTION', 'Batch mode ' + (batchModeActive ? 'ON' : 'OFF'));
    return;
  }

  // Catch-up mode: press C to toggle catch-up speed
  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    if (vid.playbackRate === 1.0) {
      vid.playbackRate = userConfig.catchUpSpeed || 1.5;
      speedBtn.textContent = vid.playbackRate + 'x';
      speedBtn.classList.add('catch-up-active');
      dbg('ACTION', 'Catch-up mode ON', { speed: vid.playbackRate });
    } else {
      vid.playbackRate = 1.0;
      speedBtn.textContent = '1.0x';
      speedBtn.classList.remove('catch-up-active');
      speedIdx = 3;
      dbg('ACTION', 'Catch-up mode OFF');
    }
    return;
  }
});

/* ─── IN / OUT markers (CLIPPER'S EXACT LOGIC) ──────────────── */
const markInBtn   = $('markInBtn');
const markOutBtn  = $('markOutBtn');
const markerState = $('markerState');

markInBtn.onclick  = handleMarkIn;
markOutBtn.onclick = handleMarkOut;

function handleMarkIn() {
  if (vid.style.display === 'none') return;
  if (markingIn) { dbg('ACTION', 'Mark IN cancelled (toggled off)'); cancelMarking(); return; }

  pendingInTime = vid.currentTime;
  dbg('ACTION', 'Mark IN pressed', { currentTime: pendingInTime });
  markingIn = true;
  markInBtn.classList.add('active');
  markOutBtn.disabled = false;
  markerState.classList.add('marking');
  markerState.querySelector('.marker-state-label').textContent = 'IN set at ' + fmtHMS(pendingInTime);
  markerState.querySelector('.marker-state-hint').innerHTML = 'Press <kbd>O</kbd> to set OUT, or <kbd>I</kbd> to cancel';

  const seekable = vid.seekable;
  markerState._seekableStart = seekable.length > 0 ? seekable.start(0) : 0;
  dbg('MARK', 'IN set', { inTime: pendingInTime, seekableStart: markerState._seekableStart, seekableEnd: seekable.length > 0 ? seekable.end(seekable.length-1) : null, isLive, currentTime: vid.currentTime });
}

function handleMarkOut() {
  if (!markingIn || pendingInTime === null) return;
  const outTime = vid.currentTime;
  dbg('ACTION', 'Mark OUT pressed', { currentTime: outTime, inTime: pendingInTime });
  if (outTime <= pendingInTime) { dbg('ACTION', 'Mark OUT rejected — before IN'); alert('OUT must be after IN.'); return; }

  const clipObj = {
    id: uid(),
    name: 'Clip ' + (pendingClips.length + completedClips.length + 1),
    caption: '',
    inTime: pendingInTime,
    outTime,
    m3u8Url: currentM3U8,
    isLive,
    seekableStart: markerState._seekableStart || 0,
  };
  dbg('MARK', 'OUT set — clip created', { name: clipObj.name, inTime: clipObj.inTime, outTime: clipObj.outTime, duration: outTime - pendingInTime, seekableStart: clipObj.seekableStart, isLive, m3u8: currentM3U8?.slice(0, 80) });

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

  cancelMarking();
}

function cancelMarking() {
  markingIn = false; pendingInTime = null;
  markInBtn.classList.remove('active');
  markOutBtn.disabled = true;
  markerState.classList.remove('marking');
  markerState.querySelector('.marker-state-label').textContent = 'Ready to mark';
  markerState.querySelector('.marker-state-hint').innerHTML = 'Press <kbd>I</kbd> to set IN point during playback';
  markerState._seekableStart = null;
}

/* ─── Progress bar markers ──────────────────────────────────── */
function renderProgressMarkers() {
  progTrack.querySelectorAll('.progress-marker, .progress-marker-range').forEach(el => el.remove());

  let rangeStart = 0, rangeLen = 0;
  if (isLive && vid.seekable.length > 0) {
    rangeStart = vid.seekable.start(0);
    rangeLen = vid.seekable.end(vid.seekable.length - 1) - rangeStart;
  } else if (isFinite(vid.duration) && vid.duration > 0) {
    rangeLen = vid.duration;
  }
  if (rangeLen <= 0) return;

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
        <span><span class="label">IN</span> <span class="in-val">${fmtHMS(clip.inTime)}</span></span>
        <span><span class="label">OUT</span> <span class="out-val">${fmtHMS(clip.outTime)}</span></span>
        <span><span class="label">DUR</span> <span class="dur-val">${fmtDur(clip.outTime - clip.inTime)}</span></span>
      </div>
      <textarea class="clip-card-caption" data-idx="${idx}" placeholder="Caption / summary idea..." rows="1">${escH(clip.caption)}</textarea>
      <div class="clip-card-actions">
        <button class="btn btn-success btn-xs" data-action="download" data-idx="${idx}">&#11015; Download</button>
        ${btns.jumpToIn ? `<button class="btn btn-ghost btn-xs" data-action="jumpin" data-idx="${idx}">Jump to IN</button>` : ''}
        ${btns.jumpToEnd ? `<button class="btn btn-ghost btn-xs" data-action="jumpout" data-idx="${idx}">Jump to OUT</button>` : ''}
        ${btns.watermark ? `<button class="btn btn-accent btn-xs wm-btn-icon" data-action="watermark" data-idx="${idx}" title="Watermark${clip.watermark ? ' (configured)' : ''}">
          <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          ${clip.watermark ? '<span class="wm-dot"></span>' : ''}
        </button>` : ''}
        ${btns.appendOutro ? `<button class="btn btn-ghost btn-xs" data-action="outro" data-idx="${idx}" title="Add Outro${clip.outro ? ' (set)' : ''}">Add Outro${clip.outro ? ' *' : ''}</button>` : ''}
      </div>
    </div>
  `).join('');

  list.onclick = e => {
    const btn = e.target.closest('[data-action], .clip-card-remove');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    if (btn.classList.contains('clip-card-remove')) { dbg('ACTION', 'Remove clip', { idx, name: pendingClips[idx]?.name }); pendingClips.splice(idx, 1); renderPendingClips(); return; }
    if (btn.dataset.action === 'download') { dbg('ACTION', 'Download clip clicked', { idx, name: pendingClips[idx]?.name }); downloadClip(idx); }
    if (btn.dataset.action === 'jumpin') { dbg('ACTION', 'Jump to IN', { idx, time: pendingClips[idx]?.inTime }); vid.currentTime = pendingClips[idx].inTime; }
    if (btn.dataset.action === 'jumpout') { dbg('ACTION', 'Jump to OUT', { idx, time: pendingClips[idx]?.outTime }); vid.currentTime = pendingClips[idx].outTime; }
    if (btn.dataset.action === 'watermark') { dbg('ACTION', 'Open watermark modal', { idx }); openWatermarkModal(idx); }
    if (btn.dataset.action === 'outro') { dbg('ACTION', 'Open outro modal', { idx }); openOutroModal(idx); }
  };
  list.oninput = e => {
    const idx = parseInt(e.target.dataset.idx);
    if (isNaN(idx)) return;
    if (e.target.classList.contains('clip-card-name'))    pendingClips[idx].name    = e.target.value;
    if (e.target.classList.contains('clip-card-caption')) pendingClips[idx].caption = e.target.value;
  };

  updateClipCount();
}

/* ═══════════════════════════════════════════════════════════════
   ── Watermark Modal (from ClipperWATERMARKTESTING) ──────────
   ═══════════════════════════════════════════════════════════════ */
function openWatermarkModal(idx) {
  const clip = pendingClips[idx];
  if (!clip) return;

  const old = document.querySelector('.wm-modal-overlay');
  if (old) old.remove();

  // Start with clip-specific watermark, fall back to universal, fall back to defaults
  const wm = clip.watermark || universalWatermark || {
    text: '', fontFamily: 'Arial', fontSize: 48, opacity: 0.7,
    color: '#ffffff', position: 'bottom-right'
  };

  const overlay = document.createElement('div');
  overlay.className = 'wm-modal-overlay';
  overlay.innerHTML = `
    <div class="wm-modal">
      <div class="wm-modal-title">Watermark Settings</div>
      <div class="wm-modal-body">
        <label class="wm-label">Text
          <input class="wm-input" id="wmText" type="text" value="${escAttr(wm.text)}" placeholder="Your watermark text..." autofocus>
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
          <label class="wm-label wm-half">Opacity <span class="wm-val" id="wmOpacityVal">${Math.round(wm.opacity*100)}%</span>
            <input class="wm-range" id="wmOpacity" type="range" min="10" max="100" value="${Math.round(wm.opacity*100)}">
          </label>
        </div>
        <label class="wm-label">Position</label>
        <div class="wm-position-grid" id="wmPosGrid">
          ${['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right'].map(pos =>
            `<button class="wm-pos${wm.position===pos?' active':''}" data-pos="${pos}">${
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
            <span class="wm-preview-text" id="wmPreviewText">${escH(wm.text || 'Preview')}</span>
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

  const txtIn = overlay.querySelector('#wmText');
  const fontSel = overlay.querySelector('#wmFont');
  const colorIn = overlay.querySelector('#wmColor');
  const sizeIn = overlay.querySelector('#wmSize');
  const opacIn = overlay.querySelector('#wmOpacity');
  const prevText = overlay.querySelector('#wmPreviewText');
  const posGrid = overlay.querySelector('#wmPosGrid');

  let selectedPos = wm.position;

  function updatePreview() {
    const txt = txtIn.value || 'Preview';
    prevText.textContent = txt;
    prevText.style.fontFamily = fontSel.value;
    prevText.style.fontSize = sizeIn.value / 2 + 'px';
    prevText.style.color = colorIn.value;
    prevText.style.opacity = opacIn.value / 100;
    overlay.querySelector('#wmSizeVal').textContent = sizeIn.value + 'px';
    overlay.querySelector('#wmOpacityVal').textContent = opacIn.value + '%';

    prevText.style.position = 'absolute';
    const [vy, vx] = selectedPos.includes('-') ? selectedPos.split('-') : ['center', selectedPos === 'center' ? 'center' : selectedPos];
    prevText.style.top = vy === 'top' ? '8px' : vy === 'bottom' ? '' : '50%';
    prevText.style.bottom = vy === 'bottom' ? '8px' : '';
    prevText.style.left = vx === 'left' ? '8px' : vx === 'center' ? '50%' : '';
    prevText.style.right = vx === 'right' ? '8px' : '';
    prevText.style.transform = (vy === 'center' && vx === 'center') ? 'translate(-50%,-50%)'
      : vy === 'center' ? 'translateY(-50%)' : vx === 'center' ? 'translateX(-50%)' : 'none';
  }

  txtIn.oninput = updatePreview;
  fontSel.onchange = updatePreview;
  colorIn.oninput = updatePreview;
  sizeIn.oninput = updatePreview;
  opacIn.oninput = updatePreview;

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
    overlay.remove();
    renderPendingClips();
  };

  overlay.querySelector('#wmApply').onclick = () => {
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
    overlay.remove();
    renderPendingClips();
  };
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

/* ─── Downloading (CLIPPER'S EXACT LOGIC + watermark/outro) ── */
async function downloadClip(idx) {
  const clip = pendingClips.splice(idx, 1)[0];
  if (!clip) return;

  renderPendingClips();

  if (!clip.m3u8Url) { alert('No stream URL for this clip.'); return; }

  let startSec = clip.inTime - (clip.seekableStart || 0);
  dbg('CLIP', 'Download initiated', { name: clip.name, inTime: clip.inTime, outTime: clip.outTime, seekableStart: clip.seekableStart, computedStartSec: startSec, isLive: clip.isLive });
  if (startSec < 0) {
    const ok = confirm(
      'Segments for the IN point may have expired from the live buffer.\n' +
      'The clip may start later than expected.\n\nTry anyway?'
    );
    if (!ok) {
      pendingClips.push(clip);
      renderPendingClips();
      return;
    }
    startSec = 0;
  }
  const durationSec = clip.outTime - clip.inTime;

  const dl = { id: clip.id, name: clip.name, progress: 0 };
  downloadingClips.push(dl);
  renderDownloadingClips();

  // Determine watermark: clip-specific > universal
  const watermark = clip.watermark || universalWatermark || null;

  // Determine outro: clip-specific > universal (if enabled)
  const outro = clip.outro || (universalOutro.enabled && universalOutro.filePath ? universalOutro : null);

  // FFmpeg options from config
  const ffmpegOptions = { ...userConfig.ffmpeg };

  try {
    const dlParams = {
      m3u8Url: clip.m3u8Url,
      startSec,
      durationSec,
      clipName: clip.name,
      watermark,
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
        batchId: clip._batchId,
        batchIndex: clip._batchIndex,
        batchTotal: clip._batchTotal,
        ffmpegConfig: { ...cfg },
        hasWatermark: !!watermark,
        hasOutro: !!outro,
      };
    }

    dbg('CLIP', 'Sending to main process', { startSec: dlParams.startSec, durationSec: dlParams.durationSec, hasWatermark: !!watermark, hasOutro: !!outro, batch: !!clip._batchMode });
    const result = await window.clipper.downloadClip(dlParams);

    downloadingClips = downloadingClips.filter(d => d.id !== clip.id);
    renderDownloadingClips();

    if (result && result.success) {
      dbg('CLIP', 'Download succeeded', { name: clip.name, filePath: result.filePath, fileSize: result.fileSize });
      completedClips.unshift({ id: clip.id, name: clip.name, caption: clip.caption,
        filePath: result.filePath, fileName: result.fileName, fileSize: result.fileSize });
      renderCompletedClips();
    } else {
      dbg('ERROR', 'Download failed', { name: clip.name, error: result?.error });
      alert('Download failed: ' + (result?.error || 'Unknown error'));
    }
  } catch (err) {
    dbg('ERROR', 'Download exception', { name: clip.name, error: err.message });
    downloadingClips = downloadingClips.filter(d => d.id !== clip.id);
    renderDownloadingClips();
    alert('Download error: ' + err.message);
  }
}

function renderDownloadingClips() {
  const list = $('downloadingClipList');
  list.innerHTML = downloadingClips.length === 0
    ? '<div class="empty-state"><small>Clips being processed will appear here</small></div>'
    : downloadingClips.map(dl => `
        <div class="download-card">
          <div class="download-card-name">${escH(dl.name)}</div>
          <div class="download-progress"><div class="download-progress-fill" style="width:${dl.progress}%"></div></div>
          <div class="download-progress-text">${dl.progress}% — processing with ffmpeg...</div>
        </div>`).join('');
  updateClipCount();
}

/* ─── Completed ─────────────────────────────────────────────── */
function renderCompletedClips() {
  const list = $('completedClipList');
  if (completedClips.length === 0) {
    list.innerHTML = '<div class="empty-state"><small>Downloaded clips appear here — drag to post!</small></div>';
    updateClipCount(); return;
  }

  const showFfmpegLog = userConfig.devFeatures?.ffmpegLogs;

  list.innerHTML = completedClips.map((clip, idx) => `
    <div class="completed-card" draggable="true" data-path="${escAttr(clip.filePath)}">
      <span class="completed-card-icon">&#127916;</span>
      <div class="completed-card-info">
        <div class="completed-card-name">${escH(clip.name)}</div>
        <div class="completed-card-meta">${escH(clip.fileName)} · ${fmtSize(clip.fileSize)}</div>
      </div>
      <div class="completed-card-actions">
        ${showFfmpegLog ? `<button class="btn btn-ghost btn-xs ffmpeg-log-btn" data-action="ffmpeglog" data-idx="${idx}" title="View FFMPEG Log">&#128220;</button>` : ''}
        <button class="btn btn-ghost btn-xs" data-action="show" data-idx="${idx}">&#128193;</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.completed-card').forEach((card, idx) => {
    card.addEventListener('dragstart', e => { e.preventDefault(); window.clipper.startDrag(completedClips[idx].filePath); });
  });
  list.onclick = e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const ci = parseInt(btn.dataset.idx);
    if (btn.dataset.action === 'show') { dbg('ACTION', 'Show in folder', { name: completedClips[ci]?.name }); window.clipper.showInFolder(completedClips[ci].filePath); }
    if (btn.dataset.action === 'ffmpeglog') { dbg('ACTION', 'View FFMPEG log', { name: completedClips[ci]?.name }); window.clipper.openClipFfmpegLog(completedClips[ci].name); }
  };

  updateClipCount();
}

function updateClipCount() {
  const n = pendingClips.length + downloadingClips.length + completedClips.length;
  $('clipCount').textContent = n + (n === 1 ? ' clip' : ' clips');
}

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
          <button class="btn btn-accent btn-sm" id="cfgEditWatermark">${universalWatermark ? 'Edit Universal Watermark' : 'Configure Universal Watermark'}</button>
          ${universalWatermark ? `<span style="color:var(--green);font-size:10px;margin-left:8px;">Active: "${escH(universalWatermark.text)}"</span>` : ''}
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
          <p class="config-note">Set a default Rumble channel to navigate to on startup.</p>
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

  overlay.querySelector('#cfgEditWatermark').onclick = () => {
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

  overlay.querySelector('#cfgClose').onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  // Save all
  overlay.querySelector('#cfgSave').onclick = overlay.querySelector('#cfgApply').onclick = async () => {
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
    overlay.remove();
  };
}

/* ─── Universal Watermark Modal ─────────────────────────────── */
function openUniversalWatermarkModal() {
  const old = document.querySelector('.wm-modal-overlay');
  if (old) old.remove();

  const wm = universalWatermark || {
    text: '', fontFamily: 'Arial', fontSize: 48, opacity: 0.7,
    color: '#ffffff', position: 'bottom-right'
  };

  // Reuse the same watermark modal structure
  const overlay = document.createElement('div');
  overlay.className = 'wm-modal-overlay';
  overlay.innerHTML = `
    <div class="wm-modal">
      <div class="wm-modal-title">Universal Watermark</div>
      <div class="wm-modal-body">
        <p style="color: var(--text-secondary); font-size: 11px; margin-bottom: 8px;">This watermark will be applied to all clips unless overridden per-clip.</p>
        <label class="wm-label">Text
          <input class="wm-input" id="wmText" type="text" value="${escAttr(wm.text)}" placeholder="Your watermark text..." autofocus>
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
          <label class="wm-label wm-half">Opacity <span class="wm-val" id="wmOpacityVal">${Math.round(wm.opacity*100)}%</span>
            <input class="wm-range" id="wmOpacity" type="range" min="10" max="100" value="${Math.round(wm.opacity*100)}">
          </label>
        </div>
        <label class="wm-label">Position</label>
        <div class="wm-position-grid" id="wmPosGrid">
          ${['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right'].map(pos =>
            `<button class="wm-pos${wm.position===pos?' active':''}" data-pos="${pos}">${
              {'top-left':'&#8598;','top-center':'&#8593;','top-right':'&#8599;','center-left':'&#8592;','center':'&#9679;','center-right':'&#8594;','bottom-left':'&#8601;','bottom-center':'&#8595;','bottom-right':'&#8600;'}[pos]
            }</button>`
          ).join('')}
        </div>
        <div class="wm-preview-wrap">
          <div class="wm-preview" id="wmPreview">
            <span class="wm-preview-text" id="wmPreviewText">${escH(wm.text || 'Preview')}</span>
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

  const txtIn = overlay.querySelector('#wmText');
  const fontSel = overlay.querySelector('#wmFont');
  const colorIn = overlay.querySelector('#wmColor');
  const sizeIn = overlay.querySelector('#wmSize');
  const opacIn = overlay.querySelector('#wmOpacity');
  const prevText = overlay.querySelector('#wmPreviewText');
  const posGrid = overlay.querySelector('#wmPosGrid');
  let selectedPos = wm.position;

  function updatePreview() {
    const txt = txtIn.value || 'Preview';
    prevText.textContent = txt;
    prevText.style.fontFamily = fontSel.value;
    prevText.style.fontSize = sizeIn.value / 2 + 'px';
    prevText.style.color = colorIn.value;
    prevText.style.opacity = opacIn.value / 100;
    overlay.querySelector('#wmSizeVal').textContent = sizeIn.value + 'px';
    overlay.querySelector('#wmOpacityVal').textContent = opacIn.value + '%';
    prevText.style.position = 'absolute';
    const [vy, vx] = selectedPos.includes('-') ? selectedPos.split('-') : ['center', selectedPos === 'center' ? 'center' : selectedPos];
    prevText.style.top = vy === 'top' ? '8px' : vy === 'bottom' ? '' : '50%';
    prevText.style.bottom = vy === 'bottom' ? '8px' : '';
    prevText.style.left = vx === 'left' ? '8px' : vx === 'center' ? '50%' : '';
    prevText.style.right = vx === 'right' ? '8px' : '';
    prevText.style.transform = (vy === 'center' && vx === 'center') ? 'translate(-50%,-50%)'
      : vy === 'center' ? 'translateY(-50%)' : vx === 'center' ? 'translateX(-50%)' : 'none';
  }

  txtIn.oninput = updatePreview;
  fontSel.onchange = updatePreview;
  colorIn.oninput = updatePreview;
  sizeIn.oninput = updatePreview;
  opacIn.oninput = updatePreview;
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
    await saveUniversalConfigs();
    overlay.remove();
    openConfigModal();
  };

  overlay.querySelector('#wmApply').onclick = async () => {
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

})();
