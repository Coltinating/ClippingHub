(function () {
  'use strict';

  function boot() {
    if (!window._tutorialEngine || !window._tutorialContent || !window._tutorialOverlay) return;
    window._tutorialEngine.init(window._tutorialContent);
    window._tutorialOverlay.init(window._tutorialEngine, window._tutorialContent);

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
