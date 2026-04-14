/* ═══════════════════════════════════════════════════════════════
   CLIPPING HUB — Player B (Secondary Independent Player)
   Self-contained HLS.js player with own video element, controls,
   volume, seek, and URL input. Does NOT modify window.Player.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

var Player2 = {
  hls: null,
  active: false,
  els: {}
};

function $(id) { return document.getElementById(id); }

// ─── INITIALIZATION ──────────────────────────────────────
function init() {
  Player2.els = {
    vid:        $('b-vid'),
    wrap:       $('player2Wrap'),
    overlay:    $('player2Overlay'),
    ppBtn:      $('b-playPauseBtn'),
    muteBtn:    $('b-muteBtn'),
    volSlider:  $('b-volumeSlider'),
    progTrack:  $('b-progressTrack'),
    progFill:   $('b-progressFill'),
    timeDisp:   $('b-timeDisplay'),
    urlIn:      $('b-urlIn'),
    loadBtn:    $('b-loadBtn'),
    closeBtn:   $('b-closeBtn'),
    splitBtn:   $('splitPreviewBtn'),
    splitter:   $('splitSplitter'),
    playerWrap: $('playerWrap')
  };

  if (!Player2.els.vid || !Player2.els.splitBtn) return;

  bindControls();
  bindSplitButton();
  bindSplitSplitter();
}

// ─── SPLIT TOGGLE ────────────────────────────────────────
function bindSplitButton() {
  Player2.els.splitBtn.addEventListener('click', function () {
    if (Player2.active) {
      unsplit();
    } else {
      split();
    }
  });
}

function split() {
  Player2.active = true;
  var previewArea = document.querySelector('.preview-area');
  if (previewArea) previewArea.classList.add('split');
  Player2.els.wrap.style.display = '';
  if (Player2.els.splitter) Player2.els.splitter.style.display = '';
  Player2.els.splitBtn.classList.add('active');

  // Reset both players to 50/50
  if (Player2.els.playerWrap) {
    Player2.els.playerWrap.style.flex = '1 1 50%';
  }
  Player2.els.wrap.style.flex = '1 1 50%';

  // Clone current stream if primary has one loaded
  var PS = window.Player && window.Player.state;
  if (PS && PS.currentM3U8 && PS.proxyPort) {
    loadStream(PS.currentM3U8, PS.proxyPort, PS.isLive);
  }
}

function unsplit() {
  Player2.active = false;
  var previewArea = document.querySelector('.preview-area');
  if (previewArea) previewArea.classList.remove('split');
  Player2.els.wrap.style.display = 'none';
  if (Player2.els.splitter) Player2.els.splitter.style.display = 'none';
  Player2.els.splitBtn.classList.remove('active');

  // Restore primary player sizing
  if (Player2.els.playerWrap) {
    Player2.els.playerWrap.style.flex = '';
  }

  destroyHls();
}

// ─── HLS STREAM LOADING ─────────────────────────────────
function loadStream(url, proxyPort, isLive) {
  destroyHls();

  if (typeof Hls === 'undefined' || !Hls.isSupported()) return;

  var vid = Player2.els.vid;
  var proxied = 'http://localhost:' + proxyPort + '/proxy?url=' + encodeURIComponent(url);

  var hls = new Hls({
    enableWorker: true,
    backBufferLength: isLive ? 300 : 120,
    maxBufferLength: isLive ? 60 : 30,
    maxMaxBufferLength: isLive ? 120 : 60,
    maxBufferSize: 60 * 1000 * 1000,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 8,
    liveDurationInfinity: true,
    liveBackBufferLength: 300,
    startLevel: -1,
    lowLatencyMode: false
  });

  Player2.hls = hls;
  hls.loadSource(proxied);
  hls.attachMedia(vid);

  hls.on(Hls.Events.MANIFEST_PARSED, function () {
    vid.volume = parseFloat(Player2.els.volSlider.value) || 0.5;
    vid.play().catch(function () {});
  });

  hls.on(Hls.Events.ERROR, function (_, data) {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      setTimeout(function () { if (Player2.hls === hls) hls.startLoad(); }, 1500);
    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
    }
  });
}

function destroyHls() {
  if (Player2.hls) {
    Player2.hls.destroy();
    Player2.hls = null;
  }
  var vid = Player2.els.vid;
  if (vid) {
    vid.pause();
    vid.removeAttribute('src');
    vid.load();
  }
}

// ─── CONTROLS ────────────────────────────────────────────
function bindControls() {
  var els = Player2.els;
  var vid = els.vid;

  // Play/Pause
  els.ppBtn.addEventListener('click', function () {
    vid.paused ? vid.play() : vid.pause();
  });
  vid.addEventListener('click', function () {
    vid.paused ? vid.play() : vid.pause();
  });
  vid.addEventListener('play', function () {
    setPlayIcon(false);
  });
  vid.addEventListener('pause', function () {
    setPlayIcon(true);
  });

  // Volume
  els.volSlider.addEventListener('input', function () {
    vid.volume = parseFloat(els.volSlider.value);
    vid.muted = vid.volume === 0;
    syncMuteIcon();
  });
  els.muteBtn.addEventListener('click', function () {
    vid.muted = !vid.muted;
    syncMuteIcon();
  });

  // Time update → progress + display
  vid.addEventListener('timeupdate', function () {
    updateProgress();
  });

  // Seek on progress bar
  els.progTrack.addEventListener('mousedown', function (e) {
    doSeek(e);
    var onMove = function (ev) { doSeek(ev); };
    var onUp = function () {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // URL load
  els.loadBtn.addEventListener('click', function () {
    var url = els.urlIn.value.trim();
    if (!url) return;
    var PS = window.Player && window.Player.state;
    var port = PS ? PS.proxyPort : null;
    if (!port) return;
    loadStream(url, port, false);
  });
  els.urlIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') els.loadBtn.click();
  });

  // Close
  els.closeBtn.addEventListener('click', function () {
    unsplit();
  });
}

function setPlayIcon(showPlay) {
  var pp = Player2.els.ppBtn;
  var play = pp.querySelector('.icon-play');
  var pause = pp.querySelector('.icon-pause');
  if (play) play.style.display = showPlay ? '' : 'none';
  if (pause) pause.style.display = showPlay ? 'none' : '';
}

function syncMuteIcon() {
  var vid = Player2.els.vid;
  var muted = vid.muted || vid.volume === 0;
  var volIcon = Player2.els.muteBtn.querySelector('.icon-vol');
  var muteIcon = Player2.els.muteBtn.querySelector('.icon-mute');
  if (volIcon) volIcon.style.display = muted ? 'none' : '';
  if (muteIcon) muteIcon.style.display = muted ? '' : 'none';
}

function updateProgress() {
  var vid = Player2.els.vid;
  var els = Player2.els;

  if (isFinite(vid.duration) && vid.duration > 0) {
    els.progFill.style.width = (vid.currentTime / vid.duration * 100) + '%';
    els.timeDisp.textContent = fmtDur(vid.currentTime) + ' / ' + fmtDur(vid.duration);
  } else {
    els.timeDisp.textContent = fmtDur(vid.currentTime);
    var seekable = vid.seekable;
    if (seekable.length > 0) {
      var start = seekable.start(0);
      var range = seekable.end(seekable.length - 1) - start;
      var pos = vid.currentTime - start;
      els.progFill.style.width = range > 0 ? Math.min(100, pos / range * 100) + '%' : '0%';
    }
  }
}

function doSeek(e) {
  var vid = Player2.els.vid;
  var track = Player2.els.progTrack;
  var r = track.getBoundingClientRect();
  var p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));

  if (isFinite(vid.duration) && vid.duration > 0) {
    vid.currentTime = p * vid.duration;
  } else {
    var seekable = vid.seekable;
    if (seekable.length > 0) {
      var start = seekable.start(0);
      var end = seekable.end(seekable.length - 1);
      vid.currentTime = start + p * (end - start);
    }
  }
}

function fmtDur(s) {
  if (!s || isNaN(s) || s < 0) return '0:00';
  s = Math.floor(s);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  return m + ':' + String(sec).padStart(2, '0');
}

// ─── SPLIT SPLITTER DRAG ─────────────────────────────────
function bindSplitSplitter() {
  var splitter = Player2.els.splitter;
  if (!splitter) return;

  var SNAP_POINTS = [0.25, 0.333, 0.5, 0.667, 0.75];
  var SNAP_THRESHOLD = 0.02;
  var MIN_RATIO = 0.15;

  splitter.addEventListener('mousedown', function (e) {
    if (!Player2.active) return;
    e.preventDefault();
    splitter.classList.add('dragging');

    var previewArea = document.querySelector('.preview-area');
    if (!previewArea) return;

    var pA = Player2.els.playerWrap;
    var pB = Player2.els.wrap;
    if (!pA || !pB) return;

    var onMove = function (ev) {
      var rect = previewArea.getBoundingClientRect();
      var splitterW = splitter.getBoundingClientRect().width;
      var available = rect.width - splitterW;
      if (available < 100) return;

      var rawRatio = (ev.clientX - rect.left) / rect.width;
      var ratio = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, rawRatio));

      // Snap to common ratios
      for (var i = 0; i < SNAP_POINTS.length; i++) {
        if (Math.abs(ratio - SNAP_POINTS[i]) < SNAP_THRESHOLD) {
          ratio = SNAP_POINTS[i];
          break;
        }
      }

      var wA = ratio * available;
      var wB = (1 - ratio) * available;

      pA.style.flex = '0 0 ' + wA + 'px';
      pB.style.flex = '0 0 ' + wB + 'px';
    };

    var onUp = function () {
      splitter.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Double-click to reset to 50/50
  splitter.addEventListener('dblclick', function () {
    if (!Player2.active) return;
    var pA = Player2.els.playerWrap;
    var pB = Player2.els.wrap;
    if (pA) pA.style.flex = '1 1 50%';
    if (pB) pB.style.flex = '1 1 50%';
  });
}

// ─── INIT ────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.Player2 = Player2;

})();
