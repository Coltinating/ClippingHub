// Clip-validation helpers.
//
// Why this file exists:
//   The pending-clip card displays `fmtDur(clip.outTime - clip.inTime)`
//   (the *requested* duration), but the actual exported file's duration is
//   bounded by the m3u8 snapshot stored on the clip at OUT-mark time. When
//   the snapshot doesn't cover the full [inTime, outTime] range — e.g. live
//   window slid before snapshot, OUT was past the live edge, or a stale
//   seekableStart was captured — ffmpeg silently trims and the user sees
//   a clip much shorter than the displayed DUR.
//
//   These helpers expose that mismatch as plain data so it can be:
//     - asserted against in unit tests (this is how the bug is reproduced
//       and regressions are caught), and
//     - optionally called from renderer.js as a pre-download sanity check
//       to warn the user before they download a clip that will be truncated.
//
//   The file deliberately has no dependencies on Electron, DOM, or window
//   globals — only ffmpeg-args.js for parseSegments.

const { parseSegments } = require('./ffmpeg-args.js');

const FLOAT_TOLERANCE_SEC = 0.1;

function validateClipShape(clip) {
  const errors = [];
  if (clip == null || typeof clip !== 'object') {
    return { ok: false, errors: ['clip is not an object'] };
  }
  if (typeof clip.inTime !== 'number' || !Number.isFinite(clip.inTime)) {
    errors.push('inTime is not a finite number');
  }
  if (typeof clip.outTime !== 'number' || !Number.isFinite(clip.outTime)) {
    errors.push('outTime is not a finite number');
  }
  if (Number.isFinite(clip.inTime) && Number.isFinite(clip.outTime)) {
    if (clip.outTime <= clip.inTime) errors.push('outTime <= inTime');
  }
  if (clip.seekableStart != null) {
    if (!Number.isFinite(clip.seekableStart)) {
      errors.push('seekableStart is not finite');
    } else if (Number.isFinite(clip.inTime) && clip.seekableStart > clip.inTime + FLOAT_TOLERANCE_SEC) {
      // seekableStart should be the floor of the seekable window at IN time.
      // If it's past inTime, the snapshot couldn't have covered the clip and
      // export will start at offset 0 (wrong content).
      errors.push('seekableStart > inTime');
    }
  }
  return { ok: errors.length === 0, errors };
}

function computeRequestedDuration(clip) {
  if (!clip || !Number.isFinite(clip.inTime) || !Number.isFinite(clip.outTime)) return 0;
  return Math.max(0, clip.outTime - clip.inTime);
}

// Compute how much of [inTime, outTime] is actually present in the m3u8
// snapshot stored on the clip. Returns the requested duration unchanged
// for VOD clips (no snapshot).
//
// Returns:
//   {
//     requested:    number — what the pending card shows,
//     covered:      number — what ffmpeg can actually trim out,
//     truncatedSec: number — requested - covered, never negative,
//     reason:       string — why coverage is short (or 'ok' / 'vod')
//   }
function computeCoveredDuration(clip) {
  const requested = computeRequestedDuration(clip);

  if (!clip || !clip.m3u8Text) {
    return { requested, covered: requested, truncatedSec: 0, reason: 'vod' };
  }

  const seekableStart = clip.seekableStart || 0;
  const startSec = clip.inTime - seekableStart;
  const endSec   = clip.outTime - seekableStart;

  const parsed = parseSegments(clip.m3u8Text);
  const segs = parsed && parsed.segments ? parsed.segments : [];

  if (segs.length === 0) {
    return { requested, covered: 0, truncatedSec: requested, reason: 'empty-playlist' };
  }

  const firstStart = segs[0].startTime;
  const lastEnd    = segs[segs.length - 1].startTime + segs[segs.length - 1].duration;

  // Snapshot is entirely past the requested range — IN was after the
  // playlist's coverage. (Should not happen with correct seekableStart.)
  if (firstStart >= endSec) {
    return { requested, covered: 0, truncatedSec: requested, reason: 'snapshot-after-range' };
  }
  // Snapshot is entirely before the requested range — IN expired out of DVR.
  if (lastEnd <= startSec) {
    return { requested, covered: 0, truncatedSec: requested, reason: 'snapshot-before-range' };
  }

  const coveredStart = Math.max(startSec, firstStart);
  const coveredEnd   = Math.min(endSec, lastEnd);
  const covered = Math.max(0, coveredEnd - coveredStart);
  const truncatedSec = Math.max(0, requested - covered);

  let reason = 'ok';
  if (truncatedSec > FLOAT_TOLERANCE_SEC) {
    if (firstStart > startSec + FLOAT_TOLERANCE_SEC && lastEnd < endSec - FLOAT_TOLERANCE_SEC) {
      reason = 'snapshot-narrower-both-sides';
    } else if (firstStart > startSec + FLOAT_TOLERANCE_SEC) {
      reason = 'snapshot-misses-start';
    } else if (lastEnd < endSec - FLOAT_TOLERANCE_SEC) {
      reason = 'snapshot-misses-end';
    } else {
      reason = 'short-snapshot';
    }
  }

  return { requested, covered, truncatedSec, reason };
}

// True iff the displayed DUR on the pending card would mislead the user —
// the actual export will be materially shorter than what's shown.
function wouldDisplayMismatchExport(clip, toleranceSec) {
  const tol = (typeof toleranceSec === 'number') ? toleranceSec : FLOAT_TOLERANCE_SEC;
  const c = computeCoveredDuration(clip);
  return (c.requested - c.covered) > tol;
}

// Mirror of timing.js's expired check, but tolerant of float drift.
function isClipExpired(clip, currentSeekableStart) {
  if (!clip || !Number.isFinite(clip.inTime)) return false;
  if (!Number.isFinite(currentSeekableStart)) return false;
  return clip.inTime < currentSeekableStart - FLOAT_TOLERANCE_SEC;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FLOAT_TOLERANCE_SEC,
    validateClipShape,
    computeRequestedDuration,
    computeCoveredDuration,
    wouldDisplayMismatchExport,
    isClipExpired,
  };
}
