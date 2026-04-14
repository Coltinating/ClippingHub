(function () {
'use strict';

var instances = {};

function getProxyPort() {
  var state = window.Player && window.Player.state;
  return state && state.proxyPort ? state.proxyPort : null;
}

function proxyUrl(url) {
  var port = getProxyPort();
  if (!port || !url) return '';
  return 'http://localhost:' + port + '/proxy?url=' + encodeURIComponent(url);
}

function formatTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = Math.floor(sec % 60);
  if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function create(instanceKey) {
  var el = document.createElement('div');
  el.className = 'panel viewer-panel viewer-player';
  el.dataset.viewerKey = instanceKey;

  // Video viewport
  var viewport = document.createElement('div');
  viewport.className = 'viewer-viewport';
  var video = document.createElement('video');
  video.className = 'viewer-vid';
  video.playsInline = true;
  video.muted = true;
  viewport.appendChild(video);

  var statusOverlay = document.createElement('div');
  statusOverlay.className = 'viewer-status-overlay';
  statusOverlay.textContent = 'Waiting for Clipper stream...';
  viewport.appendChild(statusOverlay);

  // Controls bar
  var controls = document.createElement('div');
  controls.className = 'viewer-controls-bar';

  // Seekbar
  var seekWrap = document.createElement('div');
  seekWrap.className = 'viewer-seek-wrap';
  var seekbar = document.createElement('input');
  seekbar.type = 'range';
  seekbar.className = 'viewer-seekbar';
  seekbar.min = '0';
  seekbar.max = '1000';
  seekbar.value = '0';
  seekWrap.appendChild(seekbar);

  // Time display
  var timeDisplay = document.createElement('div');
  timeDisplay.className = 'viewer-time';
  timeDisplay.textContent = '0:00 / 0:00';

  // Button row
  var btnRow = document.createElement('div');
  btnRow.className = 'viewer-btn-row';

  var playBtn = document.createElement('button');
  playBtn.className = 'viewer-btn viewer-play';
  playBtn.innerHTML = '&#9654;';
  playBtn.title = 'Play/Pause';

  var speedBtn = document.createElement('button');
  speedBtn.className = 'viewer-btn viewer-speed';
  speedBtn.textContent = '1x';
  speedBtn.title = 'Playback speed';

  var volBtn = document.createElement('button');
  volBtn.className = 'viewer-btn viewer-vol';
  volBtn.innerHTML = '&#128263;';
  volBtn.title = 'Unmute';

  var spacer = document.createElement('div');
  spacer.style.flex = '1';

  var setPbBtn = document.createElement('button');
  setPbBtn.className = 'viewer-btn viewer-set-playback';
  setPbBtn.textContent = 'Set Playback \u25B6';
  setPbBtn.title = 'Set Clipper playback to this position';

  btnRow.appendChild(playBtn);
  btnRow.appendChild(speedBtn);
  btnRow.appendChild(volBtn);
  btnRow.appendChild(spacer);
  btnRow.appendChild(setPbBtn);

  controls.appendChild(seekWrap);
  controls.appendChild(timeDisplay);
  controls.appendChild(btnRow);

  el.appendChild(viewport);
  el.appendChild(controls);

  // Instance state
  var inst = {
    key: instanceKey,
    el: el,
    video: video,
    statusOverlay: statusOverlay,
    seekbar: seekbar,
    timeDisplay: timeDisplay,
    playBtn: playBtn,
    speedBtn: speedBtn,
    volBtn: volBtn,
    setPbBtn: setPbBtn,
    hls: null,
    currentUrl: '',
    speedIdx: 2,
    speeds: [0.5, 0.75, 1.0, 1.25, 1.5, 2.0],
    draggingSeek: false
  };

  // ── Event wiring ──────────────────────────────────────────
  playBtn.addEventListener('click', function () {
    if (video.paused) video.play(); else video.pause();
  });

  video.addEventListener('play', function () { playBtn.innerHTML = '&#9646;&#9646;'; });
  video.addEventListener('pause', function () { playBtn.innerHTML = '&#9654;'; });

  speedBtn.addEventListener('click', function () {
    inst.speedIdx = (inst.speedIdx + 1) % inst.speeds.length;
    video.playbackRate = inst.speeds[inst.speedIdx];
    speedBtn.textContent = inst.speeds[inst.speedIdx] + 'x';
  });

  volBtn.addEventListener('click', function () {
    video.muted = !video.muted;
    volBtn.innerHTML = video.muted ? '&#128263;' : '&#128266;';
  });

  seekbar.addEventListener('mousedown', function () { inst.draggingSeek = true; });
  seekbar.addEventListener('input', function () {
    if (video.duration && isFinite(video.duration)) {
      video.currentTime = (seekbar.value / 1000) * video.duration;
    }
  });
  seekbar.addEventListener('mouseup', function () { inst.draggingSeek = false; });
  seekbar.addEventListener('change', function () { inst.draggingSeek = false; });

  video.addEventListener('timeupdate', function () {
    if (!inst.draggingSeek && video.duration && isFinite(video.duration)) {
      seekbar.value = Math.round((video.currentTime / video.duration) * 1000);
    }
    timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
  });

  setPbBtn.addEventListener('click', function () {
    if (!window.Player || !window.Player.els || !window.Player.els.vid) return;
    var clipperVid = window.Player.els.vid;
    if (video.currentTime && isFinite(video.currentTime)) {
      clipperVid.currentTime = video.currentTime;
      if (window._panels) window._panels.toast('Clipper set to ' + formatTime(video.currentTime));
    }
  });

  instances[instanceKey] = inst;
  return inst;
}

function loadStream(inst, url) {
  if (!url) return;
  var port = getProxyPort();
  if (!port) {
    inst.statusOverlay.textContent = 'Load a stream in Clipper first';
    inst.statusOverlay.style.display = '';
    return;
  }

  if (inst.hls) { inst.hls.destroy(); inst.hls = null; }
  inst.currentUrl = url;

  var proxied = proxyUrl(url);
  var PS = window.Player && window.Player.state;
  var isLive = PS && PS.isLive;

  var hls = new Hls({
    enableWorker: true,
    backBufferLength: isLive ? 300 : 120,
    maxBufferLength: isLive ? 60 : 30,
    maxMaxBufferLength: isLive ? 120 : 60,
    maxBufferSize: 60 * 1000 * 1000,
    maxBufferHole: 0.5,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 8,
    liveDurationInfinity: !!isLive,
    liveBackBufferLength: isLive ? 300 : 0,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1000,
    manifestLoadingMaxRetry: 4,
    levelLoadingMaxRetry: 4,
    startLevel: -1,
    lowLatencyMode: false
  });

  inst.hls = hls;
  hls.loadSource(proxied);
  hls.attachMedia(inst.video);

  hls.on(Hls.Events.MANIFEST_PARSED, function () {
    inst.statusOverlay.style.display = 'none';
    inst.video.play().catch(function () {});
  });

  hls.on(Hls.Events.ERROR, function (_, data) {
    if (data.fatal) {
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        inst.statusOverlay.textContent = 'Playback error';
        inst.statusOverlay.style.display = '';
      }
    }
  });
}

function autoFollow(inst) {
  var PS = window.Player && window.Player.state;
  if (!PS || !PS.currentM3U8) {
    inst.statusOverlay.textContent = 'Waiting for Clipper stream...';
    inst.statusOverlay.style.display = '';
    return;
  }
  if (inst.currentUrl === PS.currentM3U8) return;
  loadStream(inst, PS.currentM3U8);
}

function destroy(instanceKey) {
  var inst = instances[instanceKey];
  if (!inst) return;
  if (inst.hls) { inst.hls.destroy(); inst.hls = null; }
  if (inst.video) {
    inst.video.pause();
    inst.video.removeAttribute('src');
    inst.video.load();
  }
  delete instances[instanceKey];
}

function get(instanceKey) {
  return instances[instanceKey] || null;
}

// Auto-follow: when Clipper loads a new stream, update all viewer instances
if (window._panelBus) {
  window._panelBus.on('player:statechange', function (state) {
    if (!state || !state.url) return;
    var keys = Object.keys(instances);
    for (var i = 0; i < keys.length; i++) {
      autoFollow(instances[keys[i]]);
    }
  });
}

var api = {
  create: create,
  loadStream: loadStream,
  autoFollow: autoFollow,
  destroy: destroy,
  get: get,
  instances: instances
};

if (typeof window !== 'undefined') window._viewerPlayer = api;

})();
