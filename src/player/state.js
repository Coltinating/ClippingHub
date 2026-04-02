/**
 * Player State — shared mutable state for all player modules.
 * Loaded first; other player modules read/write via window.Player.state.
 */
(function () {
  'use strict';

  var _logCount = 0;

  var Player = {
    /* ── Mutable state ─────────────────────────────────────── */
    state: {
      hls: null,
      isLive: false,
      currentM3U8: null,
      proxyPort: null,
      videoLoaded: false,

      // Live DVR
      liveStartWall: null,
      liveDvrWindow: 0,
      atLiveEdge: true,
      userSeekedAway: false,
      liveStallInterval: null,

      // Stream extraction
      _extractionId: 0,

      // Cache level (highest ≤ 1080p) for LocalPlaylist independent fetching
      cacheLevelIdx: -1,

      // Speed
      speeds: [0.25, 0.5, 0.75, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0, 2.5],
      speedIdx: 3,

      // Timeline drag
      dragging: false,

      // Thumbnail
      thumbVid: null,
      thumbDebounce: null,

      // Controls auto-hide
      hideTimer: null,
    },

    /* ── DOM element references (set during init) ──────────── */
    els: {},

    /* ── Simple event system ───────────────────────────────── */
    _cbs: {},
    on: function (event, fn) {
      (this._cbs[event] = this._cbs[event] || []).push(fn);
    },
    off: function (event, fn) {
      if (!this._cbs[event]) return;
      this._cbs[event] = this._cbs[event].filter(function (f) { return f !== fn; });
    },
    _emit: function (event, data) {
      Player.log('PLAYER:EVENT', 'emit: ' + event, data);
      (this._cbs[event] || []).forEach(function (fn) { fn(data); });
    },

    /**
     * Unified player logger — routes to dbg() with PLAYER:* categories.
     * Every player module function should call this.
     * Entries go to both the main session log AND the dedicated VideoPlayerLogs.
     *
     * @param {string} category  e.g. 'PLAYER:STREAM', 'PLAYER:CONTROLS'
     * @param {string} message
     * @param {object} [data]
     */
    log: function (category, message, data) {
      _logCount++;
      if (window.dbg) {
        window.dbg(category, message, data);
      }
    },

    /** Return how many player log entries have been emitted this session. */
    getLogCount: function () { return _logCount; },
  };

  window.Player = Player;
})();
