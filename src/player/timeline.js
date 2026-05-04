/**
 * Player Timeline — progress bar, seeking, time display, buffer bar.
 */
(function () {
  'use strict';

  var P = window.Player;
  var log = function (msg, data) { P.log('PLAYER:TIMELINE', msg, data); };

  // Throttle timeupdate logging to avoid flooding (log every ~2s)
  var _lastTimeLog = 0;

  function updateBufferBar() {
    var vid = P.els.vid;
    var progBuffer = P.els.progBuffer;
    if (!vid.buffered || vid.buffered.length === 0) {
      progBuffer.style.width = '0%';
      return;
    }
    if (P.state.isLive) {
      var seekable = vid.seekable;
      if (seekable.length > 0) {
        var start = seekable.start(0);
        var range = seekable.end(seekable.length - 1) - start;
        var bufEnd = vid.buffered.end(vid.buffered.length - 1) - start;
        progBuffer.style.width = range > 0 ? Math.min(100, bufEnd / range * 100) + '%' : '0%';
      }
    } else if (isFinite(vid.duration) && vid.duration > 0) {
      var bufEnd2 = vid.buffered.end(vid.buffered.length - 1);
      progBuffer.style.width = (bufEnd2 / vid.duration * 100) + '%';
    }
  }

  function onTimeUpdate() {
    var vid = P.els.vid;
    var S = P.state;
    var fmtDur = P.utils.fmtDur;

    if (S.isLive) {
      var seekable = vid.seekable;
      if (seekable.length > 0) {
        var start = seekable.start(0);
        var end = seekable.end(seekable.length - 1);
        S.liveDvrWindow = end - start;
        var pos = vid.currentTime - start;
        var pct = S.liveDvrWindow > 0 ? (pos / S.liveDvrWindow * 100) : 0;
        P.els.progFill.style.width = Math.min(100, pct) + '%';

        var behind = end - vid.currentTime;
        S.atLiveEdge = behind < 5;
        P.els.liveSyncBtn.classList.toggle('at-edge', S.atLiveEdge);

        if (S.atLiveEdge) {
          P.els.timeDisp.textContent = fmtDur(vid.currentTime);
        } else {
          P.els.timeDisp.textContent = '-' + fmtDur(behind) + ' / ' + fmtDur(vid.currentTime);
        }
      } else {
        P.els.progFill.style.width = '0%';
        P.els.timeDisp.textContent = fmtDur(vid.currentTime);
      }
    } else if (isFinite(vid.duration)) {
      P.els.progFill.style.width = (vid.currentTime / vid.duration * 100) + '%';
      P.els.timeDisp.textContent = fmtDur(vid.currentTime) + ' / ' + fmtDur(vid.duration);
    } else {
      P.els.progFill.style.width = '0%';
      P.els.timeDisp.textContent = '0:00';
    }

    updateBufferBar();

    // Throttled timeupdate log
    var now = Date.now();
    if (now - _lastTimeLog > 2000) {
      _lastTimeLog = now;
      log('timeupdate', {
        currentTime: vid.currentTime.toFixed(1),
        duration: isFinite(vid.duration) ? vid.duration.toFixed(1) : 'Infinity',
        isLive: S.isLive,
        atLiveEdge: S.atLiveEdge,
        playbackRate: vid.playbackRate,
        paused: vid.paused,
      });
    }

    P._emit('timeupdate');
  }

  function doSeek(e) {
    var vid = P.els.vid;
    var progTrack = P.els.progTrack;
    var r = progTrack.getBoundingClientRect();
    var p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    if (P.state.isLive) {
      var seekable = vid.seekable;
      if (seekable.length > 0) {
        var start = seekable.start(0);
        var end = seekable.end(seekable.length - 1);
        var target = Math.max(start, Math.min(end - 0.5, start + p * (end - start)));
        vid.currentTime = target;
        log('doSeek (live)', { pct: (p * 100).toFixed(1), target: target, edge: end });
        P.live.handleLiveSeekState(target);
      }
    } else if (isFinite(vid.duration)) {
      vid.currentTime = p * vid.duration;
      log('doSeek (vod)', { pct: (p * 100).toFixed(1), target: vid.currentTime, duration: vid.duration });
    }
  }

  function seekTo(target) {
    var vid = P.els.vid;
    var helpers = window.TimelineSeekHelpers;
    if (!helpers) { log('seekTo — helpers missing, noop'); return; }
    var ctx = {
      isLive: P.state.isLive,
      duration: vid.duration,
      seekableStart: (vid.seekable && vid.seekable.length > 0) ? vid.seekable.start(0) : 0,
      seekableEnd: (vid.seekable && vid.seekable.length > 0) ? vid.seekable.end(vid.seekable.length - 1) : 0,
    };
    var clamped = helpers.computeSeekTarget(ctx, target);
    if (Number.isNaN(clamped)) return;
    vid.currentTime = clamped;
    if (P.state.isLive && P.live && typeof P.live.handleLiveSeekState === 'function') {
      P.live.handleLiveSeekState(clamped);
    }
    log('seekTo', { target: target, clamped: clamped, isLive: P.state.isLive });
  }

  function bindTimeline() {
    var els = P.els;
    var vid = els.vid;

    log('bindTimeline — wiring DOM event listeners');

    vid.ontimeupdate = onTimeUpdate;

    els.progTrack.onmousedown = function (e) {
      P.state.dragging = true;
      log('progTrack.onmousedown — seek drag started');
      doSeek(e);
    };

    document.addEventListener('mousemove', function (e) {
      if (P.state.dragging) doSeek(e);
      if (e.target === els.progTrack || els.progTrack.contains(e.target)) {
        P.preview.showHoverPreview(e);
      }
    });

    document.addEventListener('mouseup', function () {
      if (P.state.dragging) {
        log('progTrack — seek drag ended');
        P.state.dragging = false;
      }
    });

    els.progTrack.addEventListener('mouseenter', function () {
      els.hoverPreview.classList.add('on');
    });
    els.progTrack.addEventListener('mouseleave', function () {
      els.hoverPreview.classList.remove('on');
      if (P.state.thumbDebounce) { clearTimeout(P.state.thumbDebounce); P.state.thumbDebounce = null; }
    });

    log('bindTimeline — complete');
  }

  P.timeline = {
    updateBufferBar: updateBufferBar,
    onTimeUpdate: onTimeUpdate,
    doSeek: doSeek,
    seekTo: seekTo,
    bindTimeline: bindTimeline,
  };
})();
