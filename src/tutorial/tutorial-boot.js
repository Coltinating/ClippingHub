(function () {
  'use strict';

  // Dev-only feature flag. The tutorial system is shipped behind
  // localStorage so production users never see it until the UX is
  // polished. Enable from the app's DevTools console:
  //
  //   localStorage.setItem('ch.tutorial.enabled', '1'); location.reload();
  //
  // Disable:  localStorage.removeItem('ch.tutorial.enabled');
  var FLAG_KEY = 'ch.tutorial.enabled';

  function isEnabled() {
    try { return localStorage.getItem(FLAG_KEY) === '1'; }
    catch (_) { return false; }
  }

  function showMenuItem() {
    var ddTutorial = document.getElementById('ddTutorial');
    if (ddTutorial) ddTutorial.hidden = false;
  }

  function boot() {
    if (!isEnabled()) return;
    if (!window._tutorialEngine || !window._tutorialContent || !window._tutorialOverlay) return;
    window._tutorialEngine.init(window._tutorialContent);
    window._tutorialOverlay.init(window._tutorialEngine, window._tutorialContent);

    showMenuItem();

    var ddTutorial = document.getElementById('ddTutorial');
    if (ddTutorial) {
      ddTutorial.addEventListener('click', function () {
        if (window.closeAllMenus) try { window.closeAllMenus(); } catch (_) {}
        window._tutorialEngine.openTOC();
      });
    }

    if (window._tutorialEngine.isFirstRun()) {
      // Defer slightly so app paint settles
      setTimeout(function () {
        window._tutorialEngine.openTOC();
        window._tutorialEngine.startSection('getting-started');
      }, 600);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
