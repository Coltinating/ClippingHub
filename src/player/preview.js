/**
 * Player Preview — hover preview tooltip and thumbnail generation.
 */
(function () {
  'use strict';

  var P = window.Player;
  var log = function (msg, data) { P.log('PLAYER:PREVIEW', msg, data); };

  function showHoverPreview(e) {
    var els = P.els;
    var vid = els.vid;
    var S = P.state;
    var fmtDur = P.utils.fmtDur;

    var r = els.progTrack.getBoundingClientRect();
    var p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    var hoverSec;

    if (S.isLive) {
      var seekable = vid.seekable;
      if (seekable.length > 0) {
        var start = seekable.start(0);
        var end = seekable.end(seekable.length - 1);
        hoverSec = start + p * (end - start);
        var behind = end - hoverSec;
        els.hoverTime.textContent = behind < 2 ? 'LIVE' : '-' + fmtDur(behind);
      } else return;
    } else if (isFinite(vid.duration)) {
      hoverSec = p * vid.duration;
      els.hoverTime.textContent = fmtDur(hoverSec);
    } else return;

    var px = e.clientX - r.left;
    var clamp = Math.max(85, Math.min(r.width - 85, px));
    els.hoverPreview.style.left = clamp + 'px';

    if (!S.isLive && isFinite(vid.duration)) {
      if (S.thumbDebounce) clearTimeout(S.thumbDebounce);
      S.thumbDebounce = setTimeout(function () { generateThumb(hoverSec); }, 80);
    } else {
      els.hoverCanvas.style.display = 'none';
    }
  }

  function generateThumb(sec) {
    var S = P.state;
    var els = P.els;
    var vid = els.vid;

    els.hoverCanvas.style.display = 'block';
    if (!S.thumbVid) {
      log('generateThumb — creating hidden thumbnail video element');
      S.thumbVid = document.createElement('video');
      S.thumbVid.muted = true;
      S.thumbVid.preload = 'auto';
      S.thumbVid.style.display = 'none';
      document.body.appendChild(S.thumbVid);
      if (S.hls && vid.src) {
        S.thumbVid.src = vid.src;
      } else if (vid.src) {
        S.thumbVid.src = vid.src;
      }
    }

    S.thumbVid.currentTime = sec;
    S.thumbVid.onseeked = function () {
      try {
        var ctx = els.hoverCanvas.getContext('2d');
        ctx.drawImage(S.thumbVid, 0, 0, 160, 90);
      } catch (e) {
        log('generateThumb — canvas draw failed (CORS/decode)', { sec: sec });
      }
      S.thumbVid.onseeked = null;
    };
  }

  P.preview = {
    showHoverPreview: showHoverPreview,
    generateThumb: generateThumb,
  };
})();
