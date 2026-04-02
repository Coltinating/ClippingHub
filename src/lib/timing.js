// Segment-based timing for clip boundaries

function calculateSegmentClipParams(inTime, outTime, currentSeekableStart) {
  const durationSec = outTime - inTime;
  const startSec = inTime - currentSeekableStart;

  if (startSec < 0) {
    return { startSec: 0, durationSec, expired: true };
  }

  return { startSec, durationSec, expired: false };
}

function isSegmentExpired(inTime, currentSeekableStart) {
  return inTime < currentSeekableStart;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calculateSegmentClipParams, isSegmentExpired };
}
