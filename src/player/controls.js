/**
 * Player Controls — play/pause, volume, speed, PiP, fullscreen, auto-hide.
 */
(function () {
  'use strict';

  var P = window.Player;
  var log = function (msg, data) { P.log('PLAYER:CONTROLS', msg, data); };

  function togglePlay() {
    var vid = P.els.vid;
    var action = vid.paused ? 'play' : 'pause';
    log('togglePlay', { action: action, currentTime: vid.currentTime });
    vid.paused ? vid.play() : vid.pause();
  }

  function syncVol() {
    var vid = P.els.vid;
    var muteBtn = P.els.muteBtn;
    var m = vid.muted || vid.volume === 0;
    muteBtn.querySelector('.icon-vol').style.display  = m ? 'none' : 'block';
    muteBtn.querySelector('.icon-mute').style.display = m ? 'block' : 'none';
  }

  function setVolume(val) {
    var vid = P.els.vid;
    vid.volume = val;
    vid.muted = vid.volume === 0;
    syncVol();
    log('setVolume', { volume: val, muted: vid.muted });
  }

  function toggleMute() {
    var vid = P.els.vid;
    vid.muted = !vid.muted;
    syncVol();
    log('toggleMute', { muted: vid.muted, volume: vid.volume });
  }

  function setSpeedIdx(idx) {
    var S = P.state;
    var vid = P.els.vid;
    S.speedIdx = Math.max(0, Math.min(S.speeds.length - 1, idx));
    vid.playbackRate = S.speeds[S.speedIdx];
    P.els.speedBtn.textContent = S.speeds[S.speedIdx] + 'x';
    log('setSpeedIdx', { speed: S.speeds[S.speedIdx], index: S.speedIdx });
  }

  function cycleSpeed() {
    var S = P.state;
    setSpeedIdx((S.speedIdx + 1) % S.speeds.length);
  }

  function stepSpeed(dir) {
    setSpeedIdx(P.state.speedIdx + (dir > 0 ? 1 : -1));
  }

  function frameStep(dir) {
    var vid = P.els.vid;
    if (!vid.paused) vid.pause();
    var step = (dir > 0 ? 1 : -1) / 30;
    vid.currentTime = Math.max(0, Math.min(vid.duration || Infinity, vid.currentTime + step));
    log('frameStep', { dir: dir, currentTime: vid.currentTime });
  }

  function toggleCatchUp(catchUpSpeed) {
    var vid = P.els.vid;
    var S = P.state;
    if (vid.playbackRate === 1.0) {
      vid.playbackRate = catchUpSpeed || 1.5;
      P.els.speedBtn.textContent = vid.playbackRate + 'x';
      P.els.speedBtn.classList.add('catch-up-active');
      log('toggleCatchUp ON', { speed: vid.playbackRate });
    } else {
      vid.playbackRate = 1.0;
      P.els.speedBtn.textContent = '1.0x';
      P.els.speedBtn.classList.remove('catch-up-active');
      S.speedIdx = 3;
      log('toggleCatchUp OFF');
    }
  }

  function togglePiP() {
    var vid = P.els.vid;
    var entering = !document.pictureInPictureElement;
    log('togglePiP', { entering: entering });
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
    } else if (vid.requestPictureInPicture) {
      vid.requestPictureInPicture().catch(function () {});
    }
  }

  function toggleFullscreen() {
    var playerWrap = P.els.playerWrap;
    var entering = !document.fullscreenElement;
    log('toggleFullscreen', { entering: entering });
    if (!document.fullscreenElement) {
      if (playerWrap.requestFullscreen) playerWrap.requestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }

  function bindControls() {
    var els = P.els;
    var vid = els.vid;

    log('bindControls — wiring DOM event listeners');

    els.ppBtn.onclick = togglePlay;
    vid.onclick = togglePlay;

    vid.onplay = function () {
      els.iconPlay.style.display = 'none';
      els.iconPause.style.display = 'block';
      els.playerWrap.classList.remove('paused');
      els.bufBadge.classList.remove('on');
      log('vid.onplay — playback started', { currentTime: vid.currentTime });
    };
    vid.onpause = function () {
      els.iconPlay.style.display = 'block';
      els.iconPause.style.display = 'none';
      els.playerWrap.classList.add('paused');
      log('vid.onpause — playback paused', { currentTime: vid.currentTime });
    };
    vid.onwaiting = function () {
      els.bufBadge.classList.add('on');
      log('vid.onwaiting — buffering', { currentTime: vid.currentTime });
    };
    vid.oncanplay = function () {
      els.bufBadge.classList.remove('on');
      log('vid.oncanplay — ready to play', { currentTime: vid.currentTime, readyState: vid.readyState });
    };
    vid.onerror = function () {
      var err = vid.error;
      P.log('PLAYER:ERROR', 'vid.onerror', { code: err && err.code, message: err && err.message });
    };
    vid.onstalled = function () {
      log('vid.onstalled — download stalled', { currentTime: vid.currentTime });
    };
    vid.onseeking = function () {
      log('vid.onseeking', { currentTime: vid.currentTime });
    };
    vid.onseeked = function () {
      log('vid.onseeked', { currentTime: vid.currentTime });
    };
    vid.onended = function () {
      log('vid.onended — playback ended', { duration: vid.duration });
    };
    vid.onratechange = function () {
      log('vid.onratechange', { playbackRate: vid.playbackRate });
    };

    // Volume
    els.volSlider.oninput = function () {
      setVolume(+els.volSlider.value);
    };
    els.muteBtn.onclick = toggleMute;

    // Speed
    els.speedBtn.onclick = cycleSpeed;

    // Live sync
    els.liveSyncBtn.onclick = P.live.jumpToLiveEdge;

    // PiP
    els.pipBtn.onclick = togglePiP;

    // Fullscreen
    els.fsBtn.onclick = toggleFullscreen;
    document.addEventListener('fullscreenchange', function () {
      var fs = !!document.fullscreenElement;
      els.fsBtn.querySelector('.icon-fs').style.display     = fs ? 'none' : 'block';
      els.fsBtn.querySelector('.icon-fs-exit').style.display = fs ? 'block' : 'none';
      log('fullscreenchange', { fullscreen: fs });
    });

    // Skip buttons
    els.skipBack.onclick = function () {
      var t = vid.currentTime - 10;
      vid.currentTime = P.state.isLive ? P.live.clampLive(t) : Math.max(0, t);
      if (P.state.isLive) { P.state.userSeekedAway = true; P.live.disableHlsLiveSync(); }
      log('skipBack 10s', { from: vid.currentTime + 10, to: vid.currentTime });
    };
    els.skipForward.onclick = function () {
      var t = vid.currentTime + 10;
      vid.currentTime = P.state.isLive ? P.live.clampLive(t) : Math.min(vid.duration || Infinity, t);
      if (P.state.isLive && vid.seekable.length > 0) {
        var edge = vid.seekable.end(vid.seekable.length - 1);
        if (edge - vid.currentTime < 5) { P.state.userSeekedAway = false; P.live.enableHlsLiveSync(); }
      }
      log('skipForward 10s', { from: vid.currentTime - 10, to: vid.currentTime });
    };

    // Auto-hide controls overlay
    els.playerWrap.addEventListener('mousemove', function () {
      els.controlsOverlay.style.cssText = 'opacity:1;pointer-events:all';
      clearTimeout(P.state.hideTimer);
      P.state.hideTimer = setTimeout(function () {
        if (!vid.paused) els.controlsOverlay.style.cssText = '';
      }, 2500);
    });

    log('bindControls — complete');
  }

  function seekBy(delta) {
    var vid = P.els.vid;
    var S = P.state;
    var from = vid.currentTime;
    var t = vid.currentTime + delta;
    if (S.isLive) {
      vid.currentTime = P.live.clampLive(t);
      if (delta < 0) {
        S.userSeekedAway = true;
        P.live.disableHlsLiveSync();
      } else if (vid.seekable.length > 0) {
        var edge = vid.seekable.end(vid.seekable.length - 1);
        if (edge - vid.currentTime < 5) { S.userSeekedAway = false; P.live.enableHlsLiveSync(); }
        else { S.userSeekedAway = true; P.live.disableHlsLiveSync(); }
      }
    } else {
      vid.currentTime = Math.max(0, Math.min(vid.duration || Infinity, t));
    }
    log('seekBy', { delta: delta, from: from, to: vid.currentTime, isLive: S.isLive });
  }

  P.controls = {
    togglePlay: togglePlay,
    syncVol: syncVol,
    setVolume: setVolume,
    toggleMute: toggleMute,
    cycleSpeed: cycleSpeed,
    setSpeedIdx: setSpeedIdx,
    stepSpeed: stepSpeed,
    frameStep: frameStep,
    toggleCatchUp: toggleCatchUp,
    togglePiP: togglePiP,
    toggleFullscreen: toggleFullscreen,
    seekBy: seekBy,
    bindControls: bindControls,
  };
})();
