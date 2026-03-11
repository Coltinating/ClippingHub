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

/* ─── State ─────────────────────────────────────────────────── */
let hls = null;
let isLive = false;
let currentM3U8 = null;   // raw m3u8 URL (for ffmpeg clipping)
let proxyPort = null;      // set during init
let markingIn = false;
let pendingInTime = null;
let pendingClips = [];
let downloadingClips = [];
let completedClips = [];

// Live DVR state
let liveStartWall = null;   // Date.now() when live stream first loaded
let liveDvrWindow = 0;      // seekable range in seconds
let atLiveEdge = true;      // whether user is near the live edge
let userSeekedAway = false; // true when user intentionally seeks behind live
let liveStallInterval = null; // stall watchdog interval ID
let _extractionId = 0;        // guard against stale extraction results
let thumbVid = null;           // hidden video element for timeline preview thumbnails

/* ─── Init ──────────────────────────────────────────────────── */
(async () => {
  proxyPort = await window.clipper.getProxyPort();
  const dir = await window.clipper.getClipsDir();
  $('outputPath').textContent = dir;

  window.clipper.onClipProgress(({ clipName, progress }) => {
    const dl = downloadingClips.find(d => d.name === clipName);
    if (dl) { dl.progress = progress; renderDownloadingClips(); }
  });

  // Stream auto-found by the Rumble navigator window
  window.clipper.onStreamFound(({ m3u8, isLive: live }) => {
    urlIn.value = m3u8;
    setStatus('ok', 'Stream grabbed from navigator!');
    currentM3U8 = m3u8;
    loadStream(m3u8, live);
  });
})();

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

loadBtn.onclick = () => handleURL(urlIn.value.trim());
urlIn.onkeydown = e => { if (e.key === 'Enter') handleURL(urlIn.value.trim()); };

// Browse Rumble button — opens the built-in navigator window
if (navBtn) navBtn.onclick = () => {
  const url = urlIn.value.trim();
  window.clipper.openNavigator({ url: isRumble(url) ? url : undefined });
  setStatus('', 'Rumble navigator open — play any video to grab the stream');
};

// Import a local .mp4 / .mkv / .webm / .m3u8 file
importBtn && (importBtn.onclick = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*,.m3u8,.m3u';
  input.onchange = () => {
    const f = input.files[0];
    if (!f) return;
    if (f.name.endsWith('.m3u8') || f.name.endsWith('.m3u')) {
      handleURL(f.path || f.name);
    } else {
      // Local video file — play directly
      currentM3U8 = null;
      const objectUrl = URL.createObjectURL(f);
      loadLocalFile(objectUrl, f.name);
    }
  };
  input.click();
});

async function handleURL(raw) {
  if (!raw) return;

  // Tear down any existing stream immediately
  if (hls) { hls.destroy(); hls = null; }
  vid.pause(); vid.removeAttribute('src'); vid.load();

  currentM3U8 = null;
  liveBadge.classList.remove('on');
  $('liveSyncBtn').classList.remove('on', 'at-edge');
  extractBar.classList.remove('on');
  loadBtn.disabled = true;
  setStatus('', 'Loading...');

  // Direct .m3u8 link — feed straight to player
  if (isM3U8(raw)) {
    currentM3U8 = raw;
    loadStream(raw, false);
    loadBtn.disabled = false;
    return;
  }

  // Rumble page URL — use Electron-native hidden window extraction
  if (isRumble(raw)) {
    const myId = ++_extractionId;
    extractBar.classList.add('on');
    extractStep.textContent = 'Opening Rumble in background browser...';
    try {
      const result = await window.clipper.extractM3U8({ pageUrl: raw });
      // If user loaded something else while we were extracting, discard
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

  // Unknown URL — try as direct stream anyway
  currentM3U8 = raw;
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
  // Reset thumbnail video for hover previews
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

  // Tuned HLS config — aggressive for live stability, generous for VOD
  hls = new Hls({
    enableWorker: true,
    // Buffer control
    backBufferLength: liveHint ? 300 : 120,
    maxBufferLength: liveHint ? 60 : 30,
    maxMaxBufferLength: liveHint ? 120 : 60,
    maxBufferSize: 60 * 1000 * 1000,        // 60 MB
    maxBufferHole: 0.5,
    // Live tuning — stay close to edge but with enough buffer to avoid stalls
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 8,
    liveDurationInfinity: true,              // expose full DVR window
    liveBackBufferLength: 300,               // keep 5 min behind for seeking
    // Recovery
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1000,
    manifestLoadingMaxRetry: 4,
    levelLoadingMaxRetry: 4,
    // ABR — allow fast quality ramp-up
    abrEwmaDefaultEstimate: 5000000,         // 5 Mbps initial guess
    startLevel: -1,                          // auto
    // Low-latency (Rumble may not support, but helps if it does)
    lowLatencyMode: false,
  });

  hls.loadSource(proxied);
  hls.attachMedia(vid);

  hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => {
    spinner.classList.remove('on');

    // Detect live vs VOD (slight delay to let duration settle)
    setTimeout(() => {
      const seekable = vid.seekable;
      isLive = d.live || !isFinite(vid.duration) || (seekable.length > 0 && !isFinite(seekable.end(seekable.length - 1)));
      if (!isLive && vid.duration > 0) isLive = false; // trust finite duration

      if (isLive) {
        liveStartWall = Date.now();
        liveBadge.classList.add('on');
        $('liveSyncBtn').classList.add('on', 'at-edge');
        setStatus('live', 'Live stream');
      } else {
        liveBadge.classList.remove('on');
        $('liveSyncBtn').classList.remove('on');
        setStatus('ok', `VOD — ${fmtDur(vid.duration)}`);
      }
    }, 800);

    // Populate quality selector
    const qSel = $('qualitySelect');
    qSel.innerHTML = '<option value="-1">Auto</option>';
    if (d.levels && d.levels.length > 1) {
      // Sort by height descending for display
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
      qSel.onchange = () => { hls.currentLevel = parseInt(qSel.value); };
    } else {
      qSel.style.display = 'none';
    }

    vid.play().catch(() => {});
  });

  hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => {
    const lv = hls.levels[d.level];
    if (lv) {
      const parts = [];
      if (lv.height) parts.push(`${lv.width}×${lv.height}`);
      if (lv.bitrate) parts.push(`${(lv.bitrate/1000).toFixed(0)} kbps`);
      streamInfo.textContent = parts.join(' · ');
      // Update quality dropdown to reflect ABR switch
      const qSel = $('qualitySelect');
      if (qSel && qSel.value === '-1') {
        // Don't change the select value, but we could show current level
      }
    }
  });

  hls.on(Hls.Events.ERROR, (_, d) => {
    console.warn('HLS error:', d.type, d.details, d.fatal, d);
    if (!d.fatal) {
      // Non-fatal buffer stalls — only auto-jump if user hasn't deliberately seeked away
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

  // Periodically re-sync ONLY if the user hasn't deliberately seeked away
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

const speeds = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
let speedIdx = 3;

function togglePlay() { vid.paused ? vid.play() : vid.pause(); }
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
    // Live DVR mode — use seekable range
    const seekable = vid.seekable;
    if (seekable.length > 0) {
      const start = seekable.start(0);
      const end = seekable.end(seekable.length - 1);
      liveDvrWindow = end - start;
      const pos = vid.currentTime - start;
      const pct = liveDvrWindow > 0 ? (pos / liveDvrWindow * 100) : 0;
      progFill.style.width = Math.min(100, pct) + '%';

      // How far behind live edge
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

// Jump to live edge
liveSyncBtn.onclick = () => {
  if (!hls || !isLive) return;
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
progTrack.onmousedown = e => { dragging = true; doSeek(e); };
document.onmousemove  = e => {
  if (dragging) doSeek(e);
  // Hover preview on progress track
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

// ── Hover preview on timeline ────────────────────────────────
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

  // Position the preview
  const px = e.clientX - r.left;
  const clamp = Math.max(85, Math.min(r.width - 85, px));
  hoverPreview.style.left = clamp + 'px';

  // Generate thumbnail for VOD (not live — too expensive)
  if (!isLive && isFinite(vid.duration)) {
    if (thumbDebounce) clearTimeout(thumbDebounce);
    thumbDebounce = setTimeout(() => generateThumb(hoverSec), 80);
  } else {
    // For live, just show the timestamp without a thumbnail
    hoverCanvas.style.display = 'none';
  }
}

function generateThumb(sec) {
  hoverCanvas.style.display = 'block';
  // Use a hidden video element to seek and capture frame
  if (!thumbVid) {
    thumbVid = document.createElement('video');
    thumbVid.muted = true;
    thumbVid.preload = 'auto';
    thumbVid.style.display = 'none';
    document.body.appendChild(thumbVid);
    // Attach to the same HLS source if available
    if (hls && vid.src) {
      thumbVid.src = vid.src; // uses the blob URL from HLS
    } else if (vid.src) {
      thumbVid.src = vid.src;
    }
  }

  thumbVid.currentTime = sec;
  thumbVid.onseeked = () => {
    try {
      const ctx = hoverCanvas.getContext('2d');
      ctx.drawImage(thumbVid, 0, 0, 160, 90);
    } catch { /* CORS or decode failure — just show timestamp */ }
    thumbVid.onseeked = null;
  };
}

volSlider.oninput = () => { vid.volume = +volSlider.value; vid.muted = vid.volume === 0; syncVol(); };
muteBtn.onclick = () => { vid.muted = !vid.muted; syncVol(); };
function syncVol() {
  const m = vid.muted || vid.volume === 0;
  muteBtn.querySelector('.icon-vol').style.display  = m ? 'none' : 'block';
  muteBtn.querySelector('.icon-mute').style.display = m ? 'block' : 'none';
}

speedBtn.onclick = () => {
  speedIdx = (speedIdx + 1) % speeds.length;
  vid.playbackRate = speeds[speedIdx];
  speedBtn.textContent = speeds[speedIdx] + '×';
};

// Clamp a time value to the live seekable range
function clampLive(t) {
  const s = vid.seekable;
  if (!isLive || s.length === 0) return t;
  const start = s.start(0);
  const end = s.end(s.length - 1);
  return Math.max(start, Math.min(end - 0.5, t));
}

// Disable/enable HLS.js internal live sync so it doesn't fight the user
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
  const t = vid.currentTime - 10;
  vid.currentTime = isLive ? clampLive(t) : Math.max(0, t);
  if (isLive) { userSeekedAway = true; disableHlsLiveSync(); }
};
$('skipForward').onclick = () => {
  const t = vid.currentTime + 10;
  vid.currentTime = isLive ? clampLive(t) : Math.min(vid.duration || Infinity, t);
  if (isLive && vid.seekable.length > 0) {
    const edge = vid.seekable.end(vid.seekable.length - 1);
    if (edge - vid.currentTime < 5) { userSeekedAway = false; enableHlsLiveSync(); }
  }
};

$('pipBtn').onclick = async () => {
  if (document.pictureInPictureElement) await document.exitPictureInPicture();
  else if (vid.requestPictureInPicture) try { await vid.requestPictureInPicture(); } catch {}
};

fsBtn.onclick = () => {
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

document.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  switch (e.key) {
    case ' ': case 'k': e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft':  e.preventDefault(); vid.currentTime = isLive ? clampLive(vid.currentTime - 10) : Math.max(0, vid.currentTime - 10); if (isLive) { userSeekedAway = true; disableHlsLiveSync(); } break;
    case 'ArrowRight': e.preventDefault(); vid.currentTime = isLive ? clampLive(vid.currentTime + 10) : Math.min(vid.duration||Infinity, vid.currentTime+10); break;
    case 'ArrowUp':    e.preventDefault(); vid.volume = Math.min(1, vid.volume+0.1); volSlider.value=vid.volume; syncVol(); break;
    case 'ArrowDown':  e.preventDefault(); vid.volume = Math.max(0, vid.volume-0.1); volSlider.value=vid.volume; syncVol(); break;
    case 'm': case 'M': vid.muted = !vid.muted; syncVol(); break;
    case 'f': case 'F': fsBtn.click(); break;
    case 's': case 'S': speedBtn.click(); break;
    case 'i': case 'I': handleMarkIn(); break;
    case 'o': case 'O': handleMarkOut(); break;
  }
});

/* ─── IN / OUT markers ──────────────────────────────────────── */
const markInBtn   = $('markInBtn');
const markOutBtn  = $('markOutBtn');
const markerState = $('markerState');

markInBtn.onclick  = handleMarkIn;
markOutBtn.onclick = handleMarkOut;

function handleMarkIn() {
  if (vid.style.display === 'none') return;
  if (markingIn) { cancelMarking(); return; }

  pendingInTime = vid.currentTime;
  markingIn = true;
  markInBtn.classList.add('active');
  markOutBtn.disabled = false;
  markerState.classList.add('marking');
  markerState.querySelector('.marker-state-label').textContent = 'IN set at ' + fmtHMS(pendingInTime);
  markerState.querySelector('.marker-state-hint').innerHTML = 'Press <kbd>O</kbd> to set OUT, or <kbd>I</kbd> to cancel';

  // For live streams, record the seekable range start so we can compute
  // playlist-relative offsets later when downloading
  if (isLive) {
    const seekable = vid.seekable;
    markerState._seekableStart = seekable.length > 0 ? seekable.start(0) : 0;
  }
}

function handleMarkOut() {
  if (!markingIn || pendingInTime === null) return;
  const outTime = vid.currentTime;
  if (outTime <= pendingInTime) { alert('OUT must be after IN.'); return; }

  pendingClips.push({
    id: uid(),
    name: 'Clip ' + (pendingClips.length + completedClips.length + 1),
    caption: '',
    inTime: pendingInTime,
    outTime,
    m3u8Url: currentM3U8,
    isLive,
    seekableStart: markerState._seekableStart || 0,
  });
  renderPendingClips();
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

  // Determine the time range the progress bar represents
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

/* ─── Clip Hub — Pending ────────────────────────────────────── */
function renderPendingClips() {
  const list = $('pendingClipList');
  if (pendingClips.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No clips yet</p><small>Mark IN/OUT points while watching to create clips</small></div>';
    updateClipCount(); return;
  }

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
        <button class="btn btn-success btn-xs" data-action="download" data-idx="${idx}">⬇ Download</button>
        <button class="btn btn-ghost btn-xs" data-action="jumpin" data-idx="${idx}">Jump to IN</button>
      </div>
    </div>
  `).join('');

  list.onclick = e => {
    const btn = e.target.closest('[data-action], .clip-card-remove');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    if (btn.classList.contains('clip-card-remove')) { pendingClips.splice(idx, 1); renderPendingClips(); return; }
    if (btn.dataset.action === 'download') downloadClip(idx);
    if (btn.dataset.action === 'jumpin') vid.currentTime = pendingClips[idx].inTime;
  };
  list.oninput = e => {
    const idx = parseInt(e.target.dataset.idx);
    if (isNaN(idx)) return;
    if (e.target.classList.contains('clip-card-name'))    pendingClips[idx].name    = e.target.value;
    if (e.target.classList.contains('clip-card-caption')) pendingClips[idx].caption = e.target.value;
  };

  updateClipCount();
}

/* ─── Downloading ───────────────────────────────────────────── */
async function downloadClip(idx) {
  const clip = pendingClips.splice(idx, 1)[0];
  if (!clip) return;
  if (!clip.m3u8Url) { alert('No stream URL for this clip.'); return; }

  renderPendingClips();

  const dl = { id: clip.id, name: clip.name, progress: 0 };
  downloadingClips.push(dl);
  renderDownloadingClips();

  try {
    // For live streams, IN/OUT are in HLS PTS time (e.g. 86400s into stream).
    // The download handler's parser starts at t=0 for the first segment in the
    // current playlist window.  Convert to playlist-relative offsets.
    const startSec = clip.isLive
      ? clip.inTime - (clip.seekableStart || 0)
      : clip.inTime;
    const durationSec = clip.outTime - clip.inTime;

    let result;
    result = await window.clipper.downloadClip({
      m3u8Url: clip.m3u8Url,
      startSec,
      durationSec,
      clipName: clip.name
    });

    downloadingClips = downloadingClips.filter(d => d.id !== clip.id);
    renderDownloadingClips();

    if (result && result.success) {
      completedClips.push({ id: clip.id, name: clip.name, caption: clip.caption,
        filePath: result.filePath, fileName: result.fileName, fileSize: result.fileSize });
      renderCompletedClips();
    } else {
      alert('Download failed: ' + (result?.error || 'Unknown error'));
    }
  } catch (err) {
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

  list.innerHTML = completedClips.map((clip, idx) => `
    <div class="completed-card" draggable="true" data-path="${escAttr(clip.filePath)}">
      <span class="completed-card-icon">🎬</span>
      <div class="completed-card-info">
        <div class="completed-card-name">${escH(clip.name)}</div>
        <div class="completed-card-meta">${escH(clip.fileName)} · ${fmtSize(clip.fileSize)}</div>
      </div>
      <div class="completed-card-actions">
        <button class="btn btn-ghost btn-xs" data-action="show" data-idx="${idx}">📁</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.completed-card').forEach((card, idx) => {
    card.addEventListener('dragstart', e => { e.preventDefault(); window.clipper.startDrag(completedClips[idx].filePath); });
  });
  list.onclick = e => {
    const btn = e.target.closest('[data-action]');
    if (btn && btn.dataset.action === 'show') window.clipper.showInFolder(completedClips[parseInt(btn.dataset.idx)].filePath);
  };

  updateClipCount();
}

function updateClipCount() {
  const n = pendingClips.length + downloadingClips.length + completedClips.length;
  $('clipCount').textContent = n + (n === 1 ? ' clip' : ' clips');
}

/* ─── Settings ──────────────────────────────────────────────── */
$('settingsBtn').onclick = $('outputPath').onclick = async () => {
  const d = await window.clipper.chooseClipsDir();
  if (d) $('outputPath').textContent = d;
};
$('openFolderBtn').onclick = $('openCompletedFolder').onclick = () => window.clipper.openClipsFolder();

/* ─── Initial renders ───────────────────────────────────────── */
renderPendingClips();
renderDownloadingClips();
renderCompletedClips();

})();
