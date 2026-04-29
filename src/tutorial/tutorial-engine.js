(function () {
  'use strict';
  var FLAG_KEY = 'ch.tutorial.seen.v1';

  function root() { return (typeof window !== 'undefined') ? window : globalThis; }

  function isFirstRun() {
    try { return root().localStorage.getItem(FLAG_KEY) !== '1'; }
    catch (e) { return false; }
  }

  function markSeen() {
    try { root().localStorage.setItem(FLAG_KEY, '1'); } catch (e) {}
  }

  function clearSeen() {
    try { root().localStorage.removeItem(FLAG_KEY); } catch (e) {}
  }

  var api = { isFirstRun: isFirstRun, markSeen: markSeen, clearSeen: clearSeen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window._tutorialEngine = api;
})();
