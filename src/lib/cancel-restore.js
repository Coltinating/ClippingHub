// Pure helper: strips download-only fields and returns a clip that's ready to
// be re-inserted into pendingClips[].
(function () {
  'use strict';

  function restoreCancelledClip(clip) {
    const out = Object.assign({}, clip);
    delete out._state;
    delete out._progress;
    delete out._downloadId;
    delete out.filePath;
    delete out.fileName;
    return out;
  }

  const exportsObj = { restoreCancelledClip };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
  if (typeof window !== 'undefined') window.CancelRestore = exportsObj;
})();
