// Detached player controller — runs inside the detached BrowserWindow.
// Loads a stream URL via HLS, exposes basic playback + IN/OUT mark buttons,
// and ships completed marks back to the main renderer over IPC.
(function () {
  'use strict';

  const vid          = document.getElementById('det-vid');
  const playPauseBtn = document.getElementById('det-playPause');
  const progress     = document.getElementById('det-progress');
  const progressFill = document.getElementById('det-progressFill');
  const timeLbl      = document.getElementById('det-time');
  const inBtn        = document.getElementById('det-markIn');
  const outBtn       = document.getElementById('det-markOut');

  const state = { hls: null, m3u8Url: '', isLive: false, pendingIn: null };

  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtDur(s) {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(sec) : m + ':' + pad2(sec);
  }

  function loadStream(url, isLive) {
    state.m3u8Url = url;
    state.isLive  = !!isLive;
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    if (window.Hls && window.Hls.isSupported()) {
      state.hls = new window.Hls();
      state.hls.loadSource(url);
      state.hls.attachMedia(vid);
    } else {
      vid.src = url;
    }
  }

  function tick() {
    if (!Number.isFinite(vid.duration) || vid.duration <= 0) {
      progressFill.style.width = '0%';
      timeLbl.textContent = '0:00';
      return;
    }
    progressFill.style.width = ((vid.currentTime / vid.duration) * 100) + '%';
    timeLbl.textContent = fmtDur(vid.currentTime) + ' / ' + fmtDur(vid.duration);
  }

  vid.addEventListener('timeupdate', tick);
  vid.addEventListener('play',  () => { playPauseBtn.textContent = '⏸'; });
  vid.addEventListener('pause', () => { playPauseBtn.textContent = '▶'; });

  playPauseBtn.addEventListener('click', () => {
    if (vid.paused) vid.play(); else vid.pause();
  });
  progress.addEventListener('click', (e) => {
    const r = progress.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    if (Number.isFinite(vid.duration)) vid.currentTime = f * vid.duration;
  });

  inBtn.addEventListener('click', () => {
    state.pendingIn = vid.currentTime;
    inBtn.classList.add('active');
    inBtn.textContent = 'IN ' + fmtDur(state.pendingIn);
  });
  outBtn.addEventListener('click', () => {
    if (state.pendingIn == null) return;
    const out = vid.currentTime;
    const payload = window.DetachedMark.buildMarkPayload({
      inTime: state.pendingIn,
      outTime: out,
      m3u8Url: state.m3u8Url,
      isLive: state.isLive,
    });
    if (!payload) { alert('OUT must be after IN'); return; }
    if (window.detachedAPI && window.detachedAPI.postMark) {
      window.detachedAPI.postMark(payload);
    }
    state.pendingIn = null;
    inBtn.classList.remove('active');
    inBtn.textContent = 'IN';
  });

  if (window.detachedAPI && window.detachedAPI.onStreamUrl) {
    window.detachedAPI.onStreamUrl((data) => loadStream(data.url, data.isLive));
  }
})();
