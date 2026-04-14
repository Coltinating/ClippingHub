(function () {
'use strict';

// ── Event Bus ───────────────────────────────────────────────────────

var _handlers = {};

function on(event, handler) {
  if (!_handlers[event]) _handlers[event] = [];
  _handlers[event].push(handler);
  return function unsubscribe() { off(event, handler); };
}

function off(event, handler) {
  var list = _handlers[event];
  if (!list) return;
  for (var i = list.length - 1; i >= 0; i--) {
    if (list[i] === handler) list.splice(i, 1);
  }
}

function once(event, handler) {
  var unsub = on(event, function wrapper(data) {
    unsub();
    handler(data);
  });
  return unsub;
}

function emit(event, data) {
  var list = _handlers[event];
  if (!list) return;
  for (var i = 0; i < list.length; i++) {
    try { list[i](data); } catch (e) { console.error('[panelBus]', event, e); }
  }
}

// ── Player Bridge ───────────────────────────────────────────────────
// Re-emit Player events onto the bus so panels decouple from Player directly.

function _bridgePlayerEvents() {
  var P = window.Player;
  if (!P || !P.on) return;

  P.on('timeupdate', function (time, duration) {
    emit('player:timeupdate', { currentTime: time, duration: duration });
  });

  P.on('statechange', function (state) {
    emit('player:statechange', state);
  });

  P.on('showplayer', function () {
    emit('player:showplayer', {});
  });
}

// Bridge once Player is available (it loads before us in script order)
if (typeof window !== 'undefined') {
  if (window.Player && window.Player.on) {
    _bridgePlayerEvents();
  } else {
    // Fallback: try bridging after DOM is ready
    document.addEventListener('DOMContentLoaded', _bridgePlayerEvents);
  }
}

// ── Public API ──────────────────────────────────────────────────────

var api = {
  on: on,
  off: off,
  once: once,
  emit: emit
};

if (typeof window !== 'undefined') window._panelBus = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();
