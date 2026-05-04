// Helpers for tagging clip arrays with their lifecycle state and merging
// pending/downloading/completed into a single ordered list for the
// advanced timeline. Pure: never mutates inputs.
(function () {
  'use strict';

  function tagClipsWithState(clips, state) {
    return (clips || []).map(c => Object.assign({}, c, { _state: state }));
  }

  function mergeClipsForTimeline(pending, downloading, completed) {
    return [
      ...tagClipsWithState(pending, 'pending'),
      ...tagClipsWithState(downloading, 'downloading'),
      ...tagClipsWithState(completed, 'done'),
    ];
  }

  const exportsObj = { tagClipsWithState, mergeClipsForTimeline };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
  if (typeof window !== 'undefined') window.ClipStateHelpers = exportsObj;
})();
