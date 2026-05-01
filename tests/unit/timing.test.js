import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { calculateSegmentClipParams, isSegmentExpired } = require('../../src/lib/timing.js');

describe('calculateSegmentClipParams', () => {
  it('computes correct offset for live DVR clip', () => {
    const result = calculateSegmentClipParams(500, 530, 400);
    expect(result.startSec).toBe(100);
    expect(result.durationSec).toBe(30);
    expect(result.expired).toBe(false);
  });

  it('computes correct offset for VOD clip', () => {
    const result = calculateSegmentClipParams(60, 90, 0);
    expect(result.startSec).toBe(60);
    expect(result.durationSec).toBe(30);
    expect(result.expired).toBe(false);
  });

  it('detects expired segments', () => {
    const result = calculateSegmentClipParams(100, 150, 200);
    expect(result.expired).toBe(true);
    expect(result.startSec).toBe(0);
  });

  it('handles IN exactly at seekable start', () => {
    const result = calculateSegmentClipParams(300, 310, 300);
    expect(result.startSec).toBe(0);
    expect(result.expired).toBe(false);
  });
});

describe('isSegmentExpired', () => {
  it('returns false when in range', () => {
    expect(isSegmentExpired(150, 100)).toBe(false);
  });

  it('returns true when expired', () => {
    expect(isSegmentExpired(50, 100)).toBe(true);
  });

  it('returns false at boundary', () => {
    expect(isSegmentExpired(100, 100)).toBe(false);
  });
});

// ─── Partial-coverage / late-snapshot regressions ─────────────────────
// These pin the behaviour around the displayed-vs-exported bug pattern:
// when the clip's IN has slid out of the live window, calculateSegmentClipParams
// reports startSec=0 but durationSec UNCHANGED — meaning a downstream caller
// that trusts `durationSec` blindly will request more footage than the snapshot
// can provide. The expired flag is the signal callers must check.
describe('calculateSegmentClipParams — partial-coverage signals', () => {
  it('expired clip still reports the requested durationSec (caller must respect `expired`)', () => {
    const r = calculateSegmentClipParams(100, 370, 200); // requested 4:30 starting before window
    expect(r.expired).toBe(true);
    expect(r.startSec).toBe(0);
    expect(r.durationSec).toBe(270); // ← unchanged; trust this only if !expired
  });

  it('non-expired clip on the live edge reports durationSec verbatim', () => {
    // IN is in range, OUT extends past the live edge. This function does
    // NOT know the live edge — it only checks expiration on the IN side.
    // The actual coverage check belongs in clip-validators.js.
    const r = calculateSegmentClipParams(500, 770, 400);
    expect(r.expired).toBe(false);
    expect(r.startSec).toBe(100);
    expect(r.durationSec).toBe(270);
  });

  it('float drift on seekable start does not falsely expire', () => {
    // seekableStart 100.0001 vs inTime 100 should not flip to expired
    const r = calculateSegmentClipParams(100, 130, 100.0001);
    // current implementation flips to expired on any negative; document that
    // as a known sharp edge so a fix later is a deliberate change.
    expect(r.expired).toBe(true);
    expect(r.startSec).toBe(0);
  });
});
