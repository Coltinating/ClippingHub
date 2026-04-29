'use strict';

/* ─────────────────────────────────────────────────────────────
   Central keybind registry.

   Single source of truth for every user-facing keyboard shortcut.
   The Keyboard Shortcuts editor (Help > Keyboard Shortcuts) builds
   its UI from this list. Defaults here MUST mirror the defaults in
   renderer.js DEFAULT_USER_CONFIG.keybinds so a fresh install / reset
   produces a consistent state.
   ───────────────────────────────────────────────────────────── */
(function () {
  /** @typedef {{
   *   id: string,            // userConfig.keybinds[id]
   *   label: string,         // human-readable in editor
   *   category: string,      // grouping in editor
   *   default: string,       // default key combo
   *   description?: string,  // optional hint shown under label
   *   system?: boolean,      // true = display-only, not rebindable
   * }} KeybindDef */

  /** @type {KeybindDef[]} */
  var REGISTRY = [
    // ─── Seeking (most-used, on top) ─────────────────────
    { id: 'seekBackSmall',     label: 'Seek Back (Small)',     category: 'Seeking', default: 'ArrowLeft',        description: 'Jump backward by Small interval' },
    { id: 'seekForwardSmall',  label: 'Seek Forward (Small)',  category: 'Seeking', default: 'ArrowRight',       description: 'Jump forward by Small interval' },
    { id: 'seekBackMedium',    label: 'Seek Back (Medium)',    category: 'Seeking', default: 'shift+ArrowLeft',  description: 'Jump backward by Medium interval' },
    { id: 'seekForwardMedium', label: 'Seek Forward (Medium)', category: 'Seeking', default: 'shift+ArrowRight', description: 'Jump forward by Medium interval' },
    { id: 'seekBackLarge',     label: 'Seek Back (Large)',     category: 'Seeking', default: 'ctrl+ArrowLeft',   description: 'Jump backward by Large interval' },
    { id: 'seekForwardLarge',  label: 'Seek Forward (Large)',  category: 'Seeking', default: 'ctrl+ArrowRight',  description: 'Jump forward by Large interval' },

    // ─── Clipping ────────────────────────────────────────
    { id: 'markIn',  label: 'Mark IN',  category: 'Clipping', default: 'g', description: 'Set the in-point for a new clip' },
    { id: 'markOut', label: 'Mark OUT', category: 'Clipping', default: 'k', description: 'Set the out-point and queue the clip' },
    { id: 'editIn',  label: 'Edit IN',  category: 'Clipping', default: 'h', description: 'Re-pick the last in-point' },
    { id: 'editOut', label: 'Edit OUT', category: 'Clipping', default: 'j', description: 'Re-pick the last out-point' },

    // ─── Playback ────────────────────────────────────────
    { id: 'playPause',        label: 'Play / Pause',       category: 'Playback', default: ' ' },
    { id: 'volumeUp',         label: 'Volume Up',          category: 'Playback', default: 'ArrowUp' },
    { id: 'volumeDown',       label: 'Volume Down',        category: 'Playback', default: 'ArrowDown' },
    { id: 'mute',             label: 'Mute / Unmute',      category: 'Playback', default: 'm' },
    { id: 'fullscreen',       label: 'Toggle Fullscreen',  category: 'Playback', default: 'f' },
    { id: 'cycleSpeed',       label: 'Cycle Playback Speed', category: 'Playback', default: 's' },
    { id: 'playbackSpeedDown',label: 'Decrease Playback Speed', category: 'Playback', default: 'shift+,', description: 'Step down through the speed list' },
    { id: 'playbackSpeedUp',  label: 'Increase Playback Speed', category: 'Playback', default: 'shift+.', description: 'Step up through the speed list' },
    { id: 'frameStepBack',    label: 'Frame Step Back',         category: 'Playback', default: ',',       description: 'Nudge one frame backward (paused only)' },
    { id: 'frameStepForward', label: 'Frame Step Forward',      category: 'Playback', default: '.',       description: 'Nudge one frame forward (paused only)' },
    { id: 'toggleShortcutsOverlay', label: 'Toggle Shortcuts Overlay', category: 'Playback', default: '?', description: 'Show/hide the in-player cheat sheet' },
    { id: 'toggleCatchUp',    label: 'Toggle Catch-Up Mode', category: 'Playback', default: 'c', description: 'Speed override (configurable in Settings)' },
    { id: 'toggleTranscript', label: 'Toggle Live Transcript', category: 'Playback', default: 't' },

    // ─── Layout (Advanced panel system) ─────────────────
    { id: 'resetLayout', label: 'Reset Layout',  category: 'Layout', default: 'ctrl+shift+r' },
    { id: 'saveLayout',  label: 'Save Layout…',  category: 'Layout', default: 'ctrl+shift+l' },

    // ─── Header (off by default; user can assign) ──────
    { id: 'openClips', label: 'Open Clips Panel', category: 'Header', default: '', description: 'Opens the caption editor on the Clips tab' },
    { id: 'openDebug', label: 'Open Debug Log',   category: 'Header', default: '', description: 'Opens the debug window' },
  ];

  /** Numeric jump-size fields shown alongside seeking shortcuts. */
  var JUMP_SIZES = [
    { id: 'jumpSizeSmall',  label: 'Small (seconds)',  default: 5,  min: 1, max: 300 },
    { id: 'jumpSizeMedium', label: 'Medium (seconds)', default: 30, min: 1, max: 300 },
    { id: 'jumpSizeLarge',  label: 'Large (seconds)',  default: 60, min: 1, max: 300 },
  ];

  /** Format a binding for display (e.g. "ctrl+shift+r" → "Ctrl + Shift + R"). */
  function formatBinding(bind) {
    if (!bind) return '— unbound —';
    if (bind === ' ') return 'Space';
    var parts = String(bind).split('+');
    return parts.map(function (p) {
      var lower = p.toLowerCase();
      if (lower === 'ctrl') return 'Ctrl';
      if (lower === 'shift') return 'Shift';
      if (lower === 'alt') return 'Alt';
      if (lower === 'meta' || lower === 'cmd') return 'Cmd';
      if (lower === 'arrowup') return '↑';
      if (lower === 'arrowdown') return '↓';
      if (lower === 'arrowleft') return '←';
      if (lower === 'arrowright') return '→';
      if (lower === ' ' || lower === 'space') return 'Space';
      if (lower === 'escape') return 'Esc';
      if (lower === 'enter') return 'Enter';
      if (p.length === 1) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join(' + ');
  }

  /** Convert a KeyboardEvent to a normalized binding string ("ctrl+shift+r"). */
  function eventToBinding(e) {
    var parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    if (e.metaKey) parts.push('meta');
    var key = e.key;
    if (!key) return null;
    if (key === ' ' || key === 'Spacebar') {
      parts.push(' ');
    } else if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
      // Modifier-only press is not a valid binding
      return null;
    } else {
      parts.push(key);
    }
    return parts.join('+').toLowerCase();
  }

  /** Group registry entries by category, preserving order. */
  function groupedRegistry() {
    var groups = [];
    var byKey = {};
    REGISTRY.forEach(function (def) {
      if (!byKey[def.category]) {
        byKey[def.category] = { name: def.category, items: [] };
        groups.push(byKey[def.category]);
      }
      byKey[def.category].items.push(def);
    });
    return groups;
  }

  /** Find conflicts: returns array of { binding, ids[] } where ids share a binding. */
  function findConflicts(keybinds) {
    var byBind = {};
    REGISTRY.forEach(function (def) {
      var v = (keybinds && keybinds[def.id]) || '';
      if (!v) return;
      var k = String(v).toLowerCase();
      (byBind[k] = byBind[k] || []).push(def.id);
    });
    var out = [];
    Object.keys(byBind).forEach(function (k) {
      if (byBind[k].length > 1) out.push({ binding: k, ids: byBind[k] });
    });
    return out;
  }

  window.KeybindRegistry = {
    REGISTRY: REGISTRY,
    JUMP_SIZES: JUMP_SIZES,
    formatBinding: formatBinding,
    eventToBinding: eventToBinding,
    groupedRegistry: groupedRegistry,
    findConflicts: findConflicts,
  };
})();
