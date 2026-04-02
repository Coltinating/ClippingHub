/**
 * Player Keybinds — keyboard shortcut matching and player-related key handlers.
 */
(function () {
  'use strict';

  var P = window.Player;
  var log = function (msg, data) { P.log('PLAYER:KEYBIND', msg, data); };

  function matchKeybind(e, bind) {
    if (!bind) return false;
    var parts = bind.toLowerCase().split('+');
    var key = parts[parts.length - 1];
    var needCtrl = parts.indexOf('ctrl') !== -1;
    var needShift = parts.indexOf('shift') !== -1;
    var needAlt = parts.indexOf('alt') !== -1;

    if (needCtrl !== e.ctrlKey) return false;
    if (needShift !== e.shiftKey) return false;
    if (needAlt !== e.altKey) return false;

    return e.key.toLowerCase() === key.toLowerCase() || e.key === key;
  }

  function handlePlayerKeybind(e, kb, catchUpSpeed) {
    // Play/Pause
    if (matchKeybind(e, kb.playPause)) {
      e.preventDefault(); log('keybind: playPause'); P.controls.togglePlay(); return true;
    }

    // Seek — large (Ctrl+Arrow)
    if (matchKeybind(e, kb.seekBackLarge)) {
      e.preventDefault(); log('keybind: seekBackLarge', { jump: kb.jumpSizeLarge || 60 }); P.controls.seekBy(-(kb.jumpSizeLarge || 60)); return true;
    }
    if (matchKeybind(e, kb.seekForwardLarge)) {
      e.preventDefault(); log('keybind: seekForwardLarge', { jump: kb.jumpSizeLarge || 60 }); P.controls.seekBy(kb.jumpSizeLarge || 60); return true;
    }

    // Seek — medium (Shift+Arrow)
    if (matchKeybind(e, kb.seekBackMedium)) {
      e.preventDefault(); log('keybind: seekBackMedium', { jump: kb.jumpSizeMedium || 30 }); P.controls.seekBy(-(kb.jumpSizeMedium || 30)); return true;
    }
    if (matchKeybind(e, kb.seekForwardMedium)) {
      e.preventDefault(); log('keybind: seekForwardMedium', { jump: kb.jumpSizeMedium || 30 }); P.controls.seekBy(kb.jumpSizeMedium || 30); return true;
    }

    // Seek — small (plain Arrow)
    if (matchKeybind(e, kb.seekBackSmall)) {
      e.preventDefault(); log('keybind: seekBackSmall', { jump: kb.jumpSizeSmall || 5 }); P.controls.seekBy(-(kb.jumpSizeSmall || 5)); return true;
    }
    if (matchKeybind(e, kb.seekForwardSmall)) {
      e.preventDefault(); log('keybind: seekForwardSmall', { jump: kb.jumpSizeSmall || 5 }); P.controls.seekBy(kb.jumpSizeSmall || 5); return true;
    }

    // Volume up/down
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      var vid = P.els.vid;
      vid.volume = Math.min(1, vid.volume + 0.1);
      P.els.volSlider.value = vid.volume;
      P.controls.syncVol();
      log('keybind: volumeUp', { volume: vid.volume });
      return true;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      var vid2 = P.els.vid;
      vid2.volume = Math.max(0, vid2.volume - 0.1);
      P.els.volSlider.value = vid2.volume;
      P.controls.syncVol();
      log('keybind: volumeDown', { volume: vid2.volume });
      return true;
    }

    // Mute
    if (e.key === 'm' || e.key === 'M') {
      P.els.vid.muted = !P.els.vid.muted;
      P.controls.syncVol();
      log('keybind: toggleMute', { muted: P.els.vid.muted });
      return true;
    }

    // Fullscreen
    if (e.key === 'f' || e.key === 'F') {
      log('keybind: fullscreen');
      P.els.fsBtn.click();
      return true;
    }

    // Speed cycle
    if (e.key === 's' || e.key === 'S') {
      log('keybind: cycleSpeed');
      P.els.speedBtn.click();
      return true;
    }

    // Catch-up mode
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      log('keybind: toggleCatchUp');
      P.controls.toggleCatchUp(catchUpSpeed);
      return true;
    }

    // Live transcript toggle
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      log('keybind: toggleTranscript');
      P.transcription.toggle();
      return true;
    }

    return false;
  }

  P.keybinds = {
    matchKeybind: matchKeybind,
    handlePlayerKeybind: handlePlayerKeybind,
  };
})();
