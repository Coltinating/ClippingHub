/**
 * Player — main entry point. Loaded last among the player scripts.
 * Calls init() to wire DOM elements and bind event listeners.
 *
 * Usage from renderer.js:
 *   window.Player.init(domIdHelper);
 *   window.Player.stream.handleURL(url);
 *   window.Player.on('timeupdate', () => renderProgressMarkers());
 */
(function () {
  'use strict';

  var P = window.Player;

  /* ── Shared utility functions (used by multiple modules) ── */
  function pad2(n) { return String(n).padStart(2, '0'); }

  P.utils = {
    fmtDur: function (s) {
      if (!s || isNaN(s) || s < 0) return '0:00';
      s = Math.floor(s);
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      return h > 0 ? h + ':' + pad2(m) + ':' + pad2(sec) : m + ':' + pad2(sec);
    },
    fmtHMS: function (s) {
      s = Math.floor(Math.max(0, s));
      return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
    },
  };

  /**
   * Initialise the player. Must be called once after the DOM is ready.
   *
   * @param {Function} $ - DOM helper (id => document.getElementById(id))
   */
  P.init = function ($) {
    P.log('PLAYER:INIT', 'Player.init() — resolving DOM elements');

    P.els = {
      vid:             $('vid'),
      playerWrap:      $('playerWrap'),
      placeholder:     $('playerPlaceholder'),
      spinner:         $('loadingSpinner'),
      bufBadge:        $('bufferBadge'),
      statusDot:       $('statusDot'),
      statusText:      $('statusText'),
      liveBadge:       $('liveBadge'),
      streamInfo:      $('streamInfo'),
      extractBar:      $('extractBar'),
      extractStep:     $('extractStep'),
      urlIn:           $('urlIn'),
      loadBtn:         $('loadBtn'),
      qualitySelect:   $('qualitySelect'),

      // Controls
      ppBtn:           $('playPauseBtn'),
      iconPlay:        $('playPauseBtn').querySelector('.icon-play'),
      iconPause:       $('playPauseBtn').querySelector('.icon-pause'),
      muteBtn:         $('muteBtn'),
      volSlider:       $('volumeSlider'),
      speedBtn:        $('speedBtn'),
      fsBtn:           $('fullscreenBtn'),
      pipBtn:          $('pipBtn'),
      skipBack:        $('skipBack'),
      skipForward:     $('skipForward'),
      controlsOverlay: $('controlsOverlay'),
      liveSyncBtn:     $('liveSyncBtn'),

      // Timeline
      progTrack:       $('progressTrack'),
      progFill:        $('progressFill'),
      progBuffer:      $('progressBuffer'),
      timeDisp:        $('timeDisplay'),

      // Preview
      hoverPreview:    $('hoverPreview'),
      hoverCanvas:     $('hoverCanvas'),
      hoverTime:       $('hoverTime'),
    };

    // Verify all elements resolved
    var missing = [];
    for (var key in P.els) {
      if (!P.els[key]) missing.push(key);
    }
    if (missing.length > 0) {
      P.log('PLAYER:ERROR', 'Player.init() — missing DOM elements', { missing: missing });
    }

    // Log video element capabilities
    var vid = P.els.vid;
    P.log('PLAYER:INIT', 'Video element info', {
      canPlayHLS: vid.canPlayType('application/vnd.apple.mpegurl') || 'no (will use HLS.js)',
      canPlayMP4: vid.canPlayType('video/mp4'),
      canPlayWebM: vid.canPlayType('video/webm'),
    });

    // Bind all sub-module listeners
    P.controls.bindControls();
    P.timeline.bindTimeline();
    P.transcription.bindTranscription();

    // Log on window unload for session tracking
    window.addEventListener('beforeunload', function () {
      P.log('PLAYER:INIT', 'Player shutting down (beforeunload)', {
        totalLogEntries: P.getLogCount(),
        videoLoaded: P.state.videoLoaded,
        isLive: P.state.isLive,
      });
    });

    P.log('PLAYER:INIT', 'Player.init() — complete', {
      modules: ['state', 'live', 'stream', 'controls', 'timeline', 'preview', 'keybinds', 'transcription'],
    });
  };
})();
