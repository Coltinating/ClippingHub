// Pure helper for computing seek targets. Extracted from src/player/timeline.js
// so it can be unit-tested without a real HTMLVideoElement.
(function () {
'use strict';

function computeSeekTarget(ctx, target) {
  if (ctx.isLive) {
    if (ctx.seekableEnd <= ctx.seekableStart) return NaN;
    return Math.max(ctx.seekableStart, Math.min(ctx.seekableEnd - 0.5, target));
  }
  if (!Number.isFinite(ctx.duration) || ctx.duration <= 0) return NaN;
  return Math.max(0, Math.min(ctx.duration, target));
}

const exportsObj = { computeSeekTarget };
if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
if (typeof window !== 'undefined') window.TimelineSeekHelpers = exportsObj;
})();
