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
