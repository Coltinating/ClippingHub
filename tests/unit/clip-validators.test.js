import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  validateClipShape,
  computeRequestedDuration,
  computeCoveredDuration,
  wouldDisplayMismatchExport,
  isClipExpired,
} = require('../../src/lib/clip-validators.js');

// ─── Helpers to build realistic m3u8 snapshots for tests ──────────────
function buildPlaylist({ seq = 0, segDurations }) {
  const lines = ['#EXTM3U', `#EXT-X-MEDIA-SEQUENCE:${seq}`];
  for (let i = 0; i < segDurations.length; i++) {
    lines.push(`#EXTINF:${segDurations[i]},`);
    lines.push(`seg${String(seq + i).padStart(5, '0')}.ts`);
  }
  return lines.join('\n');
}

const sixSec = (n) => Array(n).fill(6.006);

// ─── Shape validation ─────────────────────────────────────────────────
describe('validateClipShape', () => {
  it('accepts a well-formed live clip', () => {
    const clip = { inTime: 4500, outTime: 4530, seekableStart: 4400 };
    expect(validateClipShape(clip)).toEqual({ ok: true, errors: [] });
  });

  it('rejects null / non-object', () => {
    expect(validateClipShape(null).ok).toBe(false);
    expect(validateClipShape(42).ok).toBe(false);
  });

  it('rejects NaN inTime — caught regression where vid.currentTime returned NaN', () => {
    const r = validateClipShape({ inTime: NaN, outTime: 30 });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('inTime is not a finite number');
  });

  it('rejects outTime <= inTime (would have produced negative-duration export)', () => {
    const r = validateClipShape({ inTime: 100, outTime: 100 });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('outTime <= inTime');
  });

  it('rejects seekableStart > inTime — implies snapshot will start at offset 0 with wrong content', () => {
    const r = validateClipShape({ inTime: 100, outTime: 130, seekableStart: 200 });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('seekableStart > inTime');
  });

  it('tolerates float drift on seekableStart', () => {
    // seekableStart 0.05s past inTime is float jitter, not a bug
    const r = validateClipShape({ inTime: 100, outTime: 130, seekableStart: 100.05 });
    expect(r.ok).toBe(true);
  });
});

// ─── Requested duration ───────────────────────────────────────────────
describe('computeRequestedDuration', () => {
  it('matches what the pending-clip card displays', () => {
    expect(computeRequestedDuration({ inTime: 100, outTime: 130 })).toBe(30);
  });

  it('returns 0 for malformed clips instead of NaN', () => {
    expect(computeRequestedDuration({ inTime: NaN, outTime: 30 })).toBe(0);
    expect(computeRequestedDuration(null)).toBe(0);
    expect(computeRequestedDuration(undefined)).toBe(0);
  });

  it('clamps negative durations to 0', () => {
    expect(computeRequestedDuration({ inTime: 100, outTime: 90 })).toBe(0);
  });
});

// ─── Coverage: VOD case ───────────────────────────────────────────────
describe('computeCoveredDuration — VOD (no m3u8Text)', () => {
  it('reports full coverage for VOD clips', () => {
    const r = computeCoveredDuration({ inTime: 60, outTime: 90 });
    expect(r).toEqual({ requested: 30, covered: 30, truncatedSec: 0, reason: 'vod' });
  });
});

// ─── Coverage: live with full snapshot ────────────────────────────────
describe('computeCoveredDuration — live with adequate snapshot', () => {
  it('reports full coverage when snapshot covers [in,out]', () => {
    // 10 segments × 6.006s ≈ 60s of playlist, starting at seekableStart 4400
    const m3u8 = buildPlaylist({ seq: 100, segDurations: sixSec(10) });
    const clip = { inTime: 4410, outTime: 4440, seekableStart: 4400, m3u8Text: m3u8 };
    const r = computeCoveredDuration(clip);
    expect(r.requested).toBe(30);
    expect(r.covered).toBeCloseTo(30, 1);
    expect(r.truncatedSec).toBeLessThan(0.1);
    expect(r.reason).toBe('ok');
  });
});

// ─── Coverage: the bug the user reported ──────────────────────────────
// "said it was 4:30, was really around 2 minutes"
//   → requested duration 270s, but m3u8 snapshot only covered ~120s of it.
describe('computeCoveredDuration — the displayed-vs-exported bug', () => {
  it('detects a snapshot that ends before the OUT mark (live edge cut short)', () => {
    // User marks IN at 4500, OUT at 4770 (270s requested = 4:30).
    // But the snapshot taken at OUT-mark time only contained 20 segments
    // covering 120s starting at seekableStart 4500.
    const m3u8 = buildPlaylist({ seq: 0, segDurations: sixSec(20) }); // ≈120s
    const clip = {
      inTime: 4500,
      outTime: 4770,
      seekableStart: 4500,
      m3u8Text: m3u8,
    };
    const r = computeCoveredDuration(clip);
    expect(r.requested).toBeCloseTo(270, 1);
    expect(r.covered).toBeCloseTo(120.12, 0); // 20 × 6.006
    expect(r.truncatedSec).toBeGreaterThan(140);
    expect(r.reason).toBe('snapshot-misses-end');
    expect(wouldDisplayMismatchExport(clip)).toBe(true);
  });

  it('detects a snapshot whose first segment is AFTER the IN mark (window slid)', () => {
    // IN at 100s, OUT at 130s. Snapshot starts at 110s relative to seekable.
    const m3u8 = buildPlaylist({ seq: 0, segDurations: sixSec(10) });
    const clip = {
      inTime: 100,
      outTime: 130,
      seekableStart: -10, // forces playlist's segment[0].startTime = 0 → relative 10s
      m3u8Text: m3u8,
    };
    // startSec (relative to snapshot) = 100 - (-10) = 110
    // endSec = 130 - (-10) = 140
    // playlist covers 0..60s of relative time → entirely BEFORE [110,140]
    const r = computeCoveredDuration(clip);
    expect(r.covered).toBe(0);
    expect(r.reason).toBe('snapshot-before-range');
    expect(wouldDisplayMismatchExport(clip)).toBe(true);
  });

  it('detects an empty playlist snapshot', () => {
    const clip = { inTime: 0, outTime: 30, m3u8Text: '#EXTM3U\n#EXT-X-ENDLIST' };
    const r = computeCoveredDuration(clip);
    expect(r.covered).toBe(0);
    expect(r.reason).toBe('empty-playlist');
  });

  it('reports partial coverage when snapshot starts mid-clip', () => {
    // 30s requested, but playlist only covers from t=10s onward (20s usable).
    // We model "snapshot starts mid-clip" by setting seekableStart so the
    // playlist's t=0 maps to absolute time 110, while clip.inTime is 100.
    const m3u8 = buildPlaylist({ seq: 0, segDurations: [10, 10, 10] }); // 0..30s
    const clip = { inTime: 100, outTime: 130, seekableStart: 110, m3u8Text: m3u8 };
    // startSec = -10, endSec = 20
    // covered intersection with [0, 30] = [0, 20] = 20s
    const r = computeCoveredDuration(clip);
    expect(r.requested).toBe(30);
    expect(r.covered).toBe(20);
    expect(r.truncatedSec).toBe(10);
    expect(r.reason).toBe('snapshot-misses-start');
    expect(wouldDisplayMismatchExport(clip)).toBe(true);
  });
});

// ─── Tolerance handling ───────────────────────────────────────────────
describe('wouldDisplayMismatchExport — tolerance', () => {
  it('does not flag sub-100ms float drift as a mismatch', () => {
    // 5 segs × 6.006s = 30.03s — clip requests 30s
    const m3u8 = buildPlaylist({ seq: 0, segDurations: sixSec(5) });
    const clip = { inTime: 0, outTime: 30, seekableStart: 0, m3u8Text: m3u8 };
    expect(wouldDisplayMismatchExport(clip)).toBe(false);
  });

  it('respects a custom tolerance', () => {
    const m3u8 = buildPlaylist({ seq: 0, segDurations: sixSec(5) }); // 30.03s
    const clip = { inTime: 0, outTime: 30.05, seekableStart: 0, m3u8Text: m3u8 };
    // truncatedSec ≈ 0.02 → not flagged with default tolerance
    expect(wouldDisplayMismatchExport(clip)).toBe(false);
    // Forced strict tolerance flags it
    expect(wouldDisplayMismatchExport(clip, 0.001)).toBe(true);
  });
});

// ─── isClipExpired ────────────────────────────────────────────────────
describe('isClipExpired', () => {
  it('detects an IN that fell out of the live window', () => {
    expect(isClipExpired({ inTime: 100 }, 200)).toBe(true);
  });
  it('returns false when IN is at or past the seekable start', () => {
    expect(isClipExpired({ inTime: 200 }, 200)).toBe(false);
    expect(isClipExpired({ inTime: 250 }, 200)).toBe(false);
  });
  it('tolerates float drift', () => {
    expect(isClipExpired({ inTime: 199.95 }, 200)).toBe(false);
  });
  it('returns false on missing data instead of throwing', () => {
    expect(isClipExpired(null, 200)).toBe(false);
    expect(isClipExpired({ inTime: 100 }, NaN)).toBe(false);
  });
});
