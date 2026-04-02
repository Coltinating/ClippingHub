/**
 * Player Stream — HLS stream loading, local file loading, URL handling.
 */
(function () {
  'use strict';

  var P = window.Player;
  var log = function (msg, data) { P.log('PLAYER:STREAM', msg, data); };

  var isM3U8 = function (u) { return /\.m3u8(\?|$)/i.test(u); };
  var isRumble = function (u) { return /rumble\.com/i.test(u); };

  function setStatus(type, text) {
    P.els.statusDot.className = 'status-dot' + (type ? ' ' + type : '');
    P.els.statusText.textContent = text;
    log('setStatus', { type: type || 'default', text: text });
  }

  function loadStream(url, liveHint) {
    var S = P.state;
    var els = P.els;
    var vid = els.vid;

    log('loadStream — start', { url: url ? url.slice(0, 120) : null, liveHint: liveHint });

    els.loadBtn.disabled = false;
    S.isLive = !!liveHint;
    S.liveStartWall = null;
    S.liveDvrWindow = 0;
    S.atLiveEdge = true;
    S.userSeekedAway = false;
    if (S.liveStallInterval) { clearInterval(S.liveStallInterval); S.liveStallInterval = null; }

    if (S.hls) { log('loadStream — destroying previous HLS instance'); S.hls.destroy(); S.hls = null; }
    if (window.LocalPlaylist) window.LocalPlaylist.stop();
    vid.pause(); vid.removeAttribute('src'); vid.load();
    if (S.thumbVid) { S.thumbVid.removeAttribute('src'); S.thumbVid.load(); S.thumbVid = null; }

    els.placeholder.style.display = 'none';
    vid.style.display = 'block';
    els.spinner.classList.add('on');
    els.liveBadge.classList.remove('on');
    els.liveSyncBtn.classList.remove('on', 'at-edge');
    els.streamInfo.textContent = '';
    setStatus('', 'Connecting...');

    if (!Hls.isSupported()) {
      log('loadStream — HLS not supported');
      els.spinner.classList.remove('on');
      setStatus('err', 'HLS not supported in this browser');
      return;
    }

    var proxied = 'http://localhost:' + S.proxyPort + '/proxy?url=' + encodeURIComponent(url);
    log('loadStream — creating HLS instance', { proxiedUrl: proxied.slice(0, 120), backBufferLength: liveHint ? 300 : 120 });

    var hls = new Hls({
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

    S.hls = hls;
    hls.loadSource(proxied);
    hls.attachMedia(vid);
    log('loadStream — HLS attached to video element');

    hls.on(Hls.Events.MANIFEST_PARSED, function (_, d) {
      els.spinner.classList.remove('on');
      S.videoLoaded = true;
      log('HLS MANIFEST_PARSED', { levels: d.levels && d.levels.length, live: d.live, duration: vid.duration });

      // Start LocalPlaylist immediately so no FRAG_LOADED events are missed.
      // _mediaTimeOffset is set automatically from the first fragment's frag.start.
      // If the stream turns out to be VOD, we stop it in the setTimeout below.
      if (window.LocalPlaylist) window.LocalPlaylist.start();

      setTimeout(function () {
        var seekable = vid.seekable;
        S.isLive = d.live || !isFinite(vid.duration) || (seekable.length > 0 && !isFinite(seekable.end(seekable.length - 1)));
        if (!S.isLive && vid.duration > 0) S.isLive = false;

        if (S.isLive) {
          S.liveStartWall = Date.now();
          els.liveBadge.classList.add('on');
          els.liveSyncBtn.classList.add('on', 'at-edge');
          setStatus('live', 'Live stream');
          log('Stream type determined: LIVE', { seekableStart: seekable.length > 0 ? seekable.start(0) : null, seekableEnd: seekable.length > 0 ? seekable.end(seekable.length - 1) : null });
        } else {
          els.liveBadge.classList.remove('on');
          els.liveSyncBtn.classList.remove('on');
          setStatus('ok', 'VOD \u2014 ' + P.utils.fmtDur(vid.duration));
          log('Stream type determined: VOD', { duration: vid.duration });
          // Not live — stop LocalPlaylist (started optimistically in MANIFEST_PARSED)
          if (window.LocalPlaylist) window.LocalPlaylist.stop();
        }
      }, 800);

      var qSel = els.qualitySelect;
      qSel.innerHTML = '<option value="-1">Auto</option>';
      if (d.levels && d.levels.length > 1) {
        log('Quality levels available', { count: d.levels.length });
        var sorted = d.levels.map(function (lv, i) { return { lv: lv, i: i }; }).sort(function (a, b) { return (b.lv.height || 0) - (a.lv.height || 0); });
        sorted.forEach(function (item) {
          var o = document.createElement('option');
          o.value = item.i;
          var label = item.lv.height ? item.lv.height + 'p' : 'Level ' + (item.i + 1);
          var kbps = item.lv.bitrate ? ' (' + (item.lv.bitrate / 1000).toFixed(0) + 'k)' : '';
          o.textContent = label + kbps;
          qSel.appendChild(o);
        });
        qSel.style.display = 'block';
        qSel.onchange = function () {
          var lvl = parseInt(qSel.value);
          log('Quality changed', { level: lvl, label: qSel.options[qSel.selectedIndex] && qSel.options[qSel.selectedIndex].text });
          hls.currentLevel = lvl;
        };
      } else {
        qSel.style.display = 'none';
      }

      // Select cache level (highest ≤ 1080p) for independent LocalPlaylist fetching
      if (window.LocalPlaylist && d.levels && d.levels.length > 0) {
        var cacheIdx = window.LocalPlaylist.pickCacheLevel(d.levels);
        S.cacheLevelIdx = cacheIdx;
        var cacheLvl = hls.levels[cacheIdx];
        var cacheLevelUrl = cacheLvl.url[0];
        window.LocalPlaylist.startCacheFetcher(cacheLevelUrl, S.proxyPort);
        log('Cache level selected', { index: cacheIdx, height: cacheLvl.height, bitrate: cacheLvl.bitrate });
      }

      vid.play().catch(function () {});
      log('loadStream — playback started');
      P._emit('streamready', { isLive: S.isLive });
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, function (_, d) {
      var lv = hls.levels[d.level];
      if (lv) {
        var parts = [];
        if (lv.height) parts.push(lv.width + 'x' + lv.height);
        if (lv.bitrate) parts.push((lv.bitrate / 1000).toFixed(0) + ' kbps');
        els.streamInfo.textContent = parts.join(' \u00B7 ');
        log('HLS LEVEL_SWITCHED', { level: d.level, resolution: lv.height ? lv.width + 'x' + lv.height : null, bitrate: lv.bitrate });
      }
    });

    hls.on(Hls.Events.ERROR, function (_, d) {
      P.log('PLAYER:HLS', 'HLS Error: ' + d.details, { type: d.type, fatal: d.fatal, reason: d.reason || '' });
      console.warn('HLS error:', d.type, d.details, d.fatal, d);
      if (!d.fatal) {
        if (d.details === 'bufferStalledError' && S.isLive && !S.userSeekedAway) {
          var seekable = vid.seekable;
          if (seekable.length > 0) {
            var edge = seekable.end(seekable.length - 1);
            if (edge - vid.currentTime > 15) {
              log('HLS bufferStalledError — jumping to edge', { edge: edge, currentTime: vid.currentTime });
              vid.currentTime = edge - 3;
            }
          }
        }
        return;
      }
      els.spinner.classList.remove('on');
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
        P.log('PLAYER:ERROR', 'HLS fatal network error — retrying in 1.5s', { details: d.details });
        setStatus('err', 'Network error \u2014 retrying...');
        setTimeout(function () { if (hls) hls.startLoad(); }, 1500);
      } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
        P.log('PLAYER:ERROR', 'HLS fatal media error — recovering', { details: d.details });
        setStatus('err', 'Media error \u2014 recovering...');
        hls.recoverMediaError();
      } else {
        P.log('PLAYER:ERROR', 'HLS fatal error — unrecoverable', { details: d.details, type: d.type });
        setStatus('err', 'Stream error: ' + (d.details || 'unknown'));
        console.error('HLS fatal error:', d);
      }
    });

    hls.on(Hls.Events.LEVEL_LOADED, function (_, d) {
      // Seed LocalPlaylist with ALL fragments from the level playlist (full DVR window).
      // On first load this gives us the entire DVR window immediately — so even if the
      // user just rejoined, they can clip from any point the server still has.
      // On subsequent refreshes, only new segments are added (deduped by sn).
      try { if (window.LocalPlaylist && d.level === S.cacheLevelIdx) window.LocalPlaylist.seedFromLevel(d.details); } catch (e) { /* never block hls.js */ }
    });

    hls.on(Hls.Events.FRAG_LOADED, function (_, d) {
      P.log('PLAYER:HLS', 'Fragment loaded', { sn: d.frag.sn, duration: d.frag.duration, level: d.frag.level });
      try { if (window.LocalPlaylist && d.frag.level === S.cacheLevelIdx) window.LocalPlaylist.addFragment(d.frag); } catch (e) { /* never block hls.js */ }
    });

    hls.on(Hls.Events.BUFFER_APPENDED, function () {
      var buffered = vid.buffered;
      if (buffered.length > 0) {
        var bufEnd = buffered.end(buffered.length - 1);
        var ahead = bufEnd - vid.currentTime;
        // Only log occasionally to avoid spam (every ~5s of buffer change)
        if (!P.state._lastBufferLog || (Date.now() - P.state._lastBufferLog > 5000)) {
          P.log('PLAYER:HLS', 'Buffer updated', { bufferedEnd: bufEnd.toFixed(1), aheadSec: ahead.toFixed(1), currentTime: vid.currentTime.toFixed(1) });
          P.state._lastBufferLog = Date.now();
        }
      }
    });

    if (liveHint) {
      P.live.startStallRecovery();
    }
  }

  function loadLocalFile(objectUrl, name) {
    var S = P.state;
    var els = P.els;
    log('loadLocalFile', { name: name });
    if (S.hls) { log('loadLocalFile — destroying HLS instance'); S.hls.destroy(); S.hls = null; }
    els.placeholder.style.display = 'none';
    els.vid.style.display = 'block';
    els.vid.src = objectUrl;
    els.vid.load();
    els.vid.play().catch(function () {});
    S.isLive = false;
    setStatus('ok', 'Local: ' + name);
  }

  async function handleURL(raw) {
    if (!raw) return;
    var S = P.state;
    var els = P.els;
    var vid = els.vid;

    log('handleURL — start', { url: raw ? raw.slice(0, 120) : null, isM3U8: isM3U8(raw), isRumble: isRumble(raw) });
    P._emit('showplayer');

    if (S.hls) { S.hls.destroy(); S.hls = null; }
    vid.pause(); vid.removeAttribute('src'); vid.load();

    S.currentM3U8 = null;
    els.liveBadge.classList.remove('on');
    els.liveSyncBtn.classList.remove('on', 'at-edge');
    els.extractBar.classList.remove('on');
    els.loadBtn.disabled = true;
    setStatus('', 'Loading...');

    if (isM3U8(raw)) {
      log('handleURL — direct m3u8');
      S.currentM3U8 = raw;
      loadStream(raw, false);
      els.loadBtn.disabled = false;
      return;
    }

    if (isRumble(raw)) {
      var myId = ++S._extractionId;
      log('handleURL — Rumble URL, extracting m3u8', { extractionId: myId });
      els.extractBar.classList.add('on');
      els.extractStep.textContent = 'Opening stream in background browser...';
      try {
        var result = await window.clipper.extractM3U8({ pageUrl: raw });
        if (myId !== S._extractionId) { log('handleURL — stale extraction, ignoring', { myId: myId, current: S._extractionId }); return; }
        els.extractBar.classList.remove('on');
        S.currentM3U8 = result.m3u8;
        els.urlIn.value = result.m3u8;
        log('handleURL — extraction succeeded', { m3u8: result.m3u8 ? result.m3u8.slice(0, 120) : null, isLive: result.isLive });
        loadStream(result.m3u8, result.isLive);
      } catch (err) {
        if (myId !== S._extractionId) return;
        els.extractBar.classList.remove('on');
        els.loadBtn.disabled = false;
        P.log('PLAYER:ERROR', 'handleURL — extraction failed', { error: err.message });
        setStatus('err', 'Could not extract stream');
        var useNav = confirm(
          'Auto-extraction failed:\n' + err.message +
          '\n\nOpen the stream browser navigator to grab it manually?'
        );
        if (useNav) window.clipper.openNavigator({ url: raw });
      }
      return;
    }

    log('handleURL — raw URL, treating as stream');
    S.currentM3U8 = raw;
    loadStream(raw, false);
    els.loadBtn.disabled = false;
  }

  function resetPlayer() {
    var S = P.state;
    var els = P.els;
    log('resetPlayer — destroying player state');
    if (S.hls) { S.hls.destroy(); S.hls = null; }
    var v = els.vid;
    v.pause(); v.removeAttribute('src'); v.load();
    els.placeholder.style.display = 'flex';
    v.style.display = 'none';
    if (window.LocalPlaylist) window.LocalPlaylist.stop();
    S.currentM3U8 = null;
    S.videoLoaded = false;

    els.liveBadge.classList.remove('on');
    els.liveSyncBtn.classList.remove('on', 'at-edge');
    els.extractBar.classList.remove('on');
    if (P.transcription && P.transcription.reset) P.transcription.reset();
    setStatus('', 'Browse the channel and click a video to load it');
    log('resetPlayer — complete');
  }

  P.stream = {
    loadStream: loadStream,
    loadLocalFile: loadLocalFile,
    handleURL: handleURL,
    resetPlayer: resetPlayer,
    setStatus: setStatus,
    isM3U8: isM3U8,
    isRumble: isRumble,
  };
})();
