/**
 * Player Live DVR — helpers for live stream sync, edge detection, stall recovery.
 */
(function () {
  'use strict';

  var P = window.Player;
  var log = function (msg, data) { P.log('PLAYER:LIVE', msg, data); };

  function disableHlsLiveSync() {
    var hls = P.state.hls;
    if (!hls) return;
    log('disableHlsLiveSync — setting liveSyncDurationCount=Infinity');
    hls.config.liveSyncDurationCount = Infinity;
    hls.config.liveMaxLatencyDurationCount = Infinity;
  }

  function enableHlsLiveSync() {
    var hls = P.state.hls;
    if (!hls) return;
    log('enableHlsLiveSync — restoring liveSyncDurationCount=3, liveMaxLatencyDurationCount=8');
    hls.config.liveSyncDurationCount = 3;
    hls.config.liveMaxLatencyDurationCount = 8;
  }

  function clampLive(t) {
    var vid = P.els.vid;
    var s = vid.seekable;
    if (!P.state.isLive || s.length === 0) return t;
    var start = s.start(0);
    var end = s.end(s.length - 1);
    var clamped = Math.max(start, Math.min(end - 0.5, t));
    if (clamped !== t) {
      log('clampLive', { requested: t, clamped: clamped, seekableStart: start, seekableEnd: end });
    }
    return clamped;
  }

  function jumpToLiveEdge() {
    var hls = P.state.hls;
    var vid = P.els.vid;
    if (!hls || !P.state.isLive) return;
    var seekable = vid.seekable;
    var edge = seekable.length > 0 ? seekable.end(seekable.length - 1) : null;
    log('jumpToLiveEdge', { edge: edge, currentTime: vid.currentTime });
    if (seekable.length > 0) {
      vid.currentTime = edge - 1;
      if (vid.paused) vid.play().catch(function () {});
    }
    P.state.userSeekedAway = false;
    enableHlsLiveSync();
    hls.startLoad();
  }

  function startStallRecovery() {
    log('startStallRecovery — interval started (5000ms)');
    P.state.liveStallInterval = setInterval(function () {
      if (!P.state.hls || !P.state.isLive) {
        log('startStallRecovery — cleared (no hls or not live)');
        clearInterval(P.state.liveStallInterval);
        P.state.liveStallInterval = null;
        return;
      }
      if (P.state.userSeekedAway) return;
      var vid = P.els.vid;
      var seekable = vid.seekable;
      if (seekable.length === 0) return;
      var edge = seekable.end(seekable.length - 1);
      if (vid.paused && P.state.atLiveEdge && !P.state.userSeekedAway) {
        log('startStallRecovery — auto-catch-up', { edge: edge, currentTime: vid.currentTime });
        vid.currentTime = edge - 2;
        vid.play().catch(function () {});
      }
    }, 5000);
  }

  function handleLiveSeekState(targetTime) {
    var vid = P.els.vid;
    if (!P.state.isLive) return;
    var seekable = vid.seekable;
    if (seekable.length === 0) return;
    var edge = seekable.end(seekable.length - 1);
    var behind = edge - targetTime;
    if (behind > 5) {
      log('handleLiveSeekState — seeked away from edge', { targetTime: targetTime, edge: edge, behind: behind });
      P.state.userSeekedAway = true;
      disableHlsLiveSync();
    } else {
      log('handleLiveSeekState — near edge, re-enabling sync', { targetTime: targetTime, edge: edge, behind: behind });
      P.state.userSeekedAway = false;
      enableHlsLiveSync();
    }
  }

  P.live = {
    disableHlsLiveSync: disableHlsLiveSync,
    enableHlsLiveSync: enableHlsLiveSync,
    clampLive: clampLive,
    jumpToLiveEdge: jumpToLiveEdge,
    startStallRecovery: startStallRecovery,
    handleLiveSeekState: handleLiveSeekState,
  };
})();
