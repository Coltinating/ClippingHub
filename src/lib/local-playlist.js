/**
 * LocalPlaylist — renderer-side m3u8 accumulator for live streams.
 *
 * Listens to hls.js FRAG_LOADED events (via addFragment) to accumulate
 * every segment ever loaded.  Generates stable m3u8 text for the clipping
 * backend — the local playlist only grows, never drops old segments,
 * so live playlist rotation never affects clip timing.
 *
 * Usage:
 *   LocalPlaylist.start()
 *   LocalPlaylist.seedFromLevel(levelDetails)  // seed full DVR window from hls.js
 *   LocalPlaylist.addFragment(frag)             // called from stream.js FRAG_LOADED
 *   LocalPlaylist.stop()
 *   LocalPlaylist.getPlaylistText()             // m3u8 string for clipping backend
 *   LocalPlaylist.getMediaTimeOffset()          // frag.start of first captured fragment
 */
(function () {
  'use strict';

  var _segments = new Map();        // seq (number) → { url, duration, seq }
  var _active = false;
  var _mediaTimeOffset = 0;         // frag.start of first captured fragment

  // Independent cache fetcher state
  var _fetchInterval = null;
  var _cacheLevelUrl = null;
  var _proxyPort = null;

  function log(msg, data) {
    if (window.Player && window.Player.log) {
      window.Player.log('PLAYLIST:LOCAL', msg, data);
    }
  }

  /**
   * Strip the CORS proxy prefix from a URL to recover the original.
   * Input:  "/proxy?url=https%3A%2F%2Fcdn.example.com%2Fseg.ts"
   * Output: "https://cdn.example.com/seg.ts"
   * If no prefix found, returns the url as-is.
   */
  function stripProxyPrefix(url) {
    if (!url) return url;
    var prefix = '/proxy?url=';
    var idx = url.indexOf(prefix);
    if (idx !== -1) {
      return decodeURIComponent(url.substring(idx + prefix.length));
    }
    // Full URL form: http://localhost:PORT/proxy?url=...
    var match = url.match(/https?:\/\/[^/]+\/proxy\?url=(.+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    return url;
  }

  /**
   * Seed from hls.js level details — pre-populates the segment map with
   * ALL fragments in the current playlist (the full DVR window).
   *
   * Called on LEVEL_LOADED, which fires every time hls.js refreshes the
   * live playlist. On first load this seeds the entire DVR window so
   * the user can clip from any point the server still has — even if
   * they just rejoined.
   *
   * @param {object} details — hls.js LevelDetails (has .fragments array)
   */
  function seedFromLevel(details) {
    if (!_active || !details || !details.fragments) return;
    var frags = details.fragments;
    var added = 0;
    for (var i = 0; i < frags.length; i++) {
      var f = frags[i];
      if (typeof f.sn !== 'number' || _segments.has(f.sn)) continue;

      // Set _mediaTimeOffset from the earliest fragment we see
      if (_segments.size === 0 && typeof f.start === 'number') {
        _mediaTimeOffset = f.start;
        log('Media time offset set from level seed', { start: f.start, sn: f.sn });
      }

      var url = stripProxyPrefix(f.relurl || f.url);
      _segments.set(f.sn, { url: url, duration: f.duration, seq: f.sn });
      added++;
    }
    if (added > 0) {
      log('Seeded from level', { added: added, total: _segments.size });
    }
  }

  /**
   * Seed from raw m3u8 media playlist text (used by the independent cache fetcher).
   * Parses #EXTINF + URL pairs and feeds them into _segments.
   *
   * @param {string} text — raw m3u8 media playlist text
   * @param {string} baseUrl — base URL for resolving relative segment URLs
   */
  function seedFromM3U8Text(text, baseUrl) {
    if (!_active || !text) return;

    // Extract media sequence
    var seqMatch = text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    var mediaSeq = seqMatch ? parseInt(seqMatch[1], 10) : 0;

    // Parse EXTINF + URL pairs
    var lines = text.split('\n');
    var sn = mediaSeq;
    var added = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var infMatch = line.match(/^#EXTINF:([\d.]+)/);
      if (infMatch) {
        var duration = parseFloat(infMatch[1]);
        // Next non-empty, non-comment line is the URL
        var urlLine = '';
        for (var j = i + 1; j < lines.length; j++) {
          var candidate = lines[j].trim();
          if (candidate && candidate.charAt(0) !== '#') {
            urlLine = candidate;
            i = j; // advance outer loop past this URL line
            break;
          }
        }
        if (!urlLine) { sn++; continue; }

        if (_segments.has(sn)) { sn++; continue; }

        // Resolve relative URLs against baseUrl
        var url = urlLine;
        if (url.indexOf('http') !== 0 && url.indexOf('//') !== 0) {
          var base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
          url = base + url;
        }
        url = stripProxyPrefix(url);

        // Only set _mediaTimeOffset if not yet set (hls.js FRAG_LOADED provides more accurate values)
        if (_segments.size === 0 && _mediaTimeOffset === 0) {
          log('Media time offset not yet set — will be set by hls.js FRAG_LOADED');
        }

        _segments.set(sn, { url: url, duration: duration, seq: sn });
        added++;
        sn++;
      }
    }

    if (added > 0) {
      log('Seeded from m3u8 text', { added: added, total: _segments.size, mediaSeq: mediaSeq });
    }
  }

  /**
   * Add a fragment from hls.js FRAG_LOADED event.
   * Stores the original (non-proxy) URL, duration, and sequence number.
   */
  function addFragment(frag) {
    if (!_active) return;
    var sn = frag.sn;
    if (typeof sn !== 'number' || _segments.has(sn)) return;

    // Set _mediaTimeOffset from the first fragment's presentation time.
    // This ensures the local playlist timeline aligns with vid.currentTime.
    if (_segments.size === 0 && typeof frag.start === 'number') {
      _mediaTimeOffset = frag.start;
      log('Media time offset set from first fragment', { start: frag.start, sn: sn });
    }

    var url = stripProxyPrefix(frag.relurl || frag.url);

    _segments.set(sn, { url: url, duration: frag.duration, seq: sn });
    log('Fragment added', { sn: sn, duration: frag.duration, total: _segments.size });
  }

  /**
   * Generate valid m3u8 text from all accumulated segments.
   * Segment URLs are original absolute URLs — main.js's toProxyUrl()
   * wraps them correctly for download via the CORS proxy.
   */
  function getPlaylistText() {
    if (_segments.size === 0) return null;

    var sorted = Array.from(_segments.values()).sort(function (a, b) { return a.seq - b.seq; });
    var maxDur = 0;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i].duration > maxDur) maxDur = sorted[i].duration;
    }

    var lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-MEDIA-SEQUENCE:' + sorted[0].seq,
      '#EXT-X-TARGETDURATION:' + Math.ceil(maxDur),
    ];

    for (var j = 0; j < sorted.length; j++) {
      lines.push('#EXTINF:' + sorted[j].duration.toFixed(3) + ',');
      lines.push(sorted[j].url);
    }

    return lines.join('\n');
  }

  /** Return all segments with cumulative startTime (seconds). */
  function getSegments() {
    if (_segments.size === 0) return [];
    var sorted = Array.from(_segments.values()).sort(function (a, b) { return a.seq - b.seq; });
    var tMs = 0;
    return sorted.map(function (seg) {
      var s = { url: seg.url, duration: seg.duration, startTime: tMs / 1000, seq: seg.seq };
      tMs += Math.round(seg.duration * 1000);
      return s;
    });
  }

  /** Fetch the cache level's media playlist and seed segments from it. */
  function fetchCachePlaylist() {
    if (!_cacheLevelUrl || !_proxyPort) return;
    var proxied = 'http://localhost:' + _proxyPort + '/proxy?url=' + encodeURIComponent(_cacheLevelUrl);
    fetch(proxied)
      .then(function (res) { return res.text(); })
      .then(function (text) {
        seedFromM3U8Text(text, _cacheLevelUrl);
      })
      .catch(function (err) {
        log('Cache fetch error', { error: err.message || String(err) });
      });
  }

  /** Start periodic fetching of the cache level's media playlist. */
  function startCacheFetcher(cacheLevelUrl, proxyPort) {
    stopCacheFetcher();
    _cacheLevelUrl = cacheLevelUrl;
    _proxyPort = proxyPort;
    log('Cache fetcher started', { url: cacheLevelUrl });
    fetchCachePlaylist(); // fetch once immediately
    _fetchInterval = setInterval(fetchCachePlaylist, 6000);
  }

  /** Stop the periodic cache fetcher. */
  function stopCacheFetcher() {
    if (_fetchInterval) {
      clearInterval(_fetchInterval);
      _fetchInterval = null;
    }
    _cacheLevelUrl = null;
    _proxyPort = null;
  }

  /**
   * Pick the best cache level index (highest quality ≤ 1080p).
   * @param {Array} levels — hls.js levels array (each has .height, .bitrate)
   * @returns {number} level index
   */
  function pickCacheLevel(levels) {
    if (!levels || levels.length === 0) return 0;
    if (levels.length === 1) return 0;

    // Filter levels ≤ 1080p
    var candidates = [];
    for (var i = 0; i < levels.length; i++) {
      if (levels[i].height && levels[i].height <= 1080) {
        candidates.push({ idx: i, height: levels[i].height, bitrate: levels[i].bitrate || 0 });
      }
    }

    if (candidates.length > 0) {
      // Pick highest height, break ties by bitrate
      candidates.sort(function (a, b) {
        return b.height - a.height || b.bitrate - a.bitrate;
      });
      return candidates[0].idx;
    }

    // All levels > 1080p — pick smallest height (closest to 1080)
    var withHeight = [];
    for (var j = 0; j < levels.length; j++) {
      if (levels[j].height) {
        withHeight.push({ idx: j, height: levels[j].height, bitrate: levels[j].bitrate || 0 });
      }
    }
    if (withHeight.length > 0) {
      withHeight.sort(function (a, b) { return a.height - b.height; });
      return withHeight[0].idx;
    }

    // No height metadata — pick highest bitrate
    var best = 0;
    var bestBr = levels[0].bitrate || 0;
    for (var k = 1; k < levels.length; k++) {
      if ((levels[k].bitrate || 0) > bestBr) {
        bestBr = levels[k].bitrate || 0;
        best = k;
      }
    }
    return best;
  }

  window.LocalPlaylist = {
    /**
     * Start accumulating fragments for a live stream.
     * _mediaTimeOffset is set automatically from the first fragment's frag.start.
     */
    start: function () {
      this.stop();
      _segments.clear();
      _mediaTimeOffset = 0;
      _active = true;
      log('Started');
    },

    /** Stop and clear accumulated data. */
    stop: function () {
      stopCacheFetcher();
      _active = false;
      _segments.clear();
      log('Stopped');
    },

    pickCacheLevel: pickCacheLevel,
    startCacheFetcher: startCacheFetcher,
    stopCacheFetcher: stopCacheFetcher,
    seedFromLevel: seedFromLevel,
    seedFromM3U8Text: seedFromM3U8Text,
    addFragment: addFragment,
    getPlaylistText: getPlaylistText,
    getSegments: getSegments,

    /** The seekable.start(0) recorded when this playlist started. */
    getMediaTimeOffset: function () { return _mediaTimeOffset; },

    isActive: function () { return _active && _segments.size > 0; },
    getSegmentCount: function () { return _segments.size; },
  };
})();
