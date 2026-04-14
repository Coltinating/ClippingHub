(function () {
  'use strict';

  var params = window.floatBridge.getParams();
  var floatId = params.floatId;
  var panelType = params.panelType;
  var body = document.getElementById('floatBody');

  document.getElementById('floatTitle').textContent = params.title || panelType;

  document.getElementById('floatCloseBtn').addEventListener('click', function () {
    window.floatBridge.requestClose(floatId);
  });

  // ── Grip drag-to-dock ────────────────────────────────────────────
  // Mousedown on grip → hides this float window via IPC, main window
  // takes over with a drag ghost and drop previews.
  var grip = document.getElementById('floatGrip');
  grip.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    // Send screen-coords so the main window can position the ghost
    window.floatBridge.sendMessage(floatId, 'dock-drag-request', {
      panelType: panelType,
      screenX: window.screenX + e.clientX,
      screenY: window.screenY + e.clientY
    });
  });

  // ── Viewer panel: full HLS player ────────────────────────────────
  var viewerState = null;

  function buildViewerPlayer() {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;';

    var viewport = document.createElement('div');
    viewport.style.cssText = 'flex:1;position:relative;min-height:0;background:#000;';
    var video = document.createElement('video');
    video.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    video.playsInline = true;
    video.muted = true;
    viewport.appendChild(video);

    var status = document.createElement('div');
    status.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);color:#888;font-size:12px;z-index:1;';
    status.textContent = 'Waiting for stream...';
    viewport.appendChild(status);

    var controls = document.createElement('div');
    controls.style.cssText = 'padding:6px 10px 8px;background:var(--bg-panel,#131316);';

    var seekbar = document.createElement('input');
    seekbar.type = 'range';
    seekbar.min = '0'; seekbar.max = '1000'; seekbar.value = '0';
    seekbar.style.cssText = 'width:100%;height:4px;cursor:pointer;accent-color:#6366f1;';
    controls.appendChild(seekbar);

    var timeRow = document.createElement('div');
    timeRow.style.cssText = 'font-size:10px;color:#888;text-align:center;margin:3px 0;';
    timeRow.textContent = '0:00 / 0:00';
    controls.appendChild(timeRow);

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;align-items:center;gap:6px;';

    var playBtn = document.createElement('button');
    playBtn.innerHTML = '&#9654;';
    playBtn.style.cssText = 'background:none;border:1px solid #444;color:#ccc;padding:3px 10px;border-radius:3px;font-size:12px;cursor:pointer;';

    var volBtn = document.createElement('button');
    volBtn.innerHTML = '&#128263;';
    volBtn.style.cssText = playBtn.style.cssText;

    var speedBtn = document.createElement('button');
    speedBtn.textContent = '1x';
    speedBtn.style.cssText = playBtn.style.cssText;

    var spacer = document.createElement('div');
    spacer.style.flex = '1';

    var setPbBtn = document.createElement('button');
    setPbBtn.textContent = 'Set Playback \u25B6';
    setPbBtn.style.cssText = 'background:rgba(99,102,241,0.15);border:1px solid #6366f1;color:#6366f1;padding:3px 10px;border-radius:3px;font-size:11px;cursor:pointer;font-weight:600;';

    btnRow.appendChild(playBtn);
    btnRow.appendChild(speedBtn);
    btnRow.appendChild(volBtn);
    btnRow.appendChild(spacer);
    btnRow.appendChild(setPbBtn);
    controls.appendChild(btnRow);

    wrap.appendChild(viewport);
    wrap.appendChild(controls);
    body.appendChild(wrap);

    var hls = null;
    var dragging = false;
    var speedIdx = 2;
    var speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

    function formatTime(sec) {
      if (!sec || !isFinite(sec)) return '0:00';
      var m = Math.floor(sec / 60);
      var s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    playBtn.addEventListener('click', function () {
      if (video.paused) video.play(); else video.pause();
    });
    video.addEventListener('play', function () { playBtn.innerHTML = '&#9646;&#9646;'; });
    video.addEventListener('pause', function () { playBtn.innerHTML = '&#9654;'; });

    speedBtn.addEventListener('click', function () {
      speedIdx = (speedIdx + 1) % speeds.length;
      video.playbackRate = speeds[speedIdx];
      speedBtn.textContent = speeds[speedIdx] + 'x';
    });

    volBtn.addEventListener('click', function () {
      video.muted = !video.muted;
      volBtn.innerHTML = video.muted ? '&#128263;' : '&#128266;';
    });

    seekbar.addEventListener('mousedown', function () { dragging = true; });
    seekbar.addEventListener('input', function () {
      if (video.duration && isFinite(video.duration)) {
        video.currentTime = (seekbar.value / 1000) * video.duration;
      }
    });
    seekbar.addEventListener('mouseup', function () { dragging = false; });
    seekbar.addEventListener('change', function () { dragging = false; });

    video.addEventListener('timeupdate', function () {
      if (!dragging && video.duration && isFinite(video.duration)) {
        seekbar.value = Math.round((video.currentTime / video.duration) * 1000);
      }
      timeRow.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
    });

    setPbBtn.addEventListener('click', function () {
      if (video.currentTime && isFinite(video.currentTime)) {
        window.floatBridge.sendMessage(floatId, 'set-playback', { time: video.currentTime });
      }
    });

    viewerState = {
      video: video,
      status: status,
      load: function (proxyPort, streamUrl, isLive) {
        if (!proxyPort || !streamUrl) {
          status.textContent = 'No stream available';
          return;
        }
        if (hls) { hls.destroy(); hls = null; }

        var proxied = 'http://localhost:' + proxyPort + '/proxy?url=' + encodeURIComponent(streamUrl);
        status.textContent = 'Loading...';

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          hls = new Hls({
            enableWorker: true,
            backBufferLength: isLive ? 300 : 120,
            maxBufferLength: isLive ? 60 : 30,
            maxMaxBufferLength: isLive ? 120 : 60,
            maxBufferSize: 60 * 1000 * 1000,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 8,
            liveDurationInfinity: !!isLive,
            fragLoadingMaxRetry: 6,
            startLevel: -1
          });
          hls.loadSource(proxied);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, function () {
            status.style.display = 'none';
            video.play().catch(function () {});
          });
          hls.on(Hls.Events.ERROR, function (_, data) {
            if (data.fatal) {
              if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
              else { status.textContent = 'Playback error'; status.style.display = ''; }
            }
          });
        } else {
          video.src = proxied;
          video.play().then(function () { status.style.display = 'none'; }).catch(function () {});
        }
      }
    };
  }

  // ── Generic panel placeholder ────────────────────────────────────
  function buildPlaceholder() {
    var msg = document.createElement('div');
    msg.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted,#888);font-size:13px;text-align:center;padding:20px;';
    msg.innerHTML = '<div><p style="margin:0 0 8px;font-size:16px;opacity:0.5;">' + (params.title || panelType) + '</p><p style="margin:0;">Drag the grip to dock this panel back.</p></div>';
    body.appendChild(msg);
  }

  // ── Build panel based on type ────────────────────────────────────
  if (panelType === 'viewer') {
    buildViewerPlayer();
  } else {
    buildPlaceholder();
  }

  // ── Receive state from main window ───────────────────────────────
  window.floatBridge.onStateUpdate(function (state) {
    if (!state) return;
    if (viewerState && state.proxyPort && state.streamUrl) {
      viewerState.load(state.proxyPort, state.streamUrl, state.isLive);
    }
  });

  window._floatPanel = { params: params };
})();
