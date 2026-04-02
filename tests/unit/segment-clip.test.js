import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { calculateSegmentClipParams, isSegmentExpired } = require('../../src/lib/timing.js');

describe('calculateSegmentClipParams', () => {
  it('computes startSec relative to seekable start', () => {
    const result = calculateSegmentClipParams(120, 150, 100);
    expect(result.startSec).toBe(20);
    expect(result.durationSec).toBe(30);
    expect(result.expired).toBe(false);
  });

  it('detects expired segments when seekable moved past IN', () => {
    const result = calculateSegmentClipParams(120, 150, 200);
    expect(result.expired).toBe(true);
    expect(result.startSec).toBe(0);
  });

  it('handles IN at the very start of seekable range', () => {
    const result = calculateSegmentClipParams(100, 110, 100);
    expect(result.startSec).toBe(0);
    expect(result.durationSec).toBe(10);
    expect(result.expired).toBe(false);
  });

  it('handles VOD where seekableStart is 0', () => {
    const result = calculateSegmentClipParams(60, 90, 0);
    expect(result.startSec).toBe(60);
    expect(result.durationSec).toBe(30);
    expect(result.expired).toBe(false);
  });

  it('partially expired: OUT in range but IN is not', () => {
    const result = calculateSegmentClipParams(100, 150, 120);
    expect(result.expired).toBe(true);
  });
});

describe('isSegmentExpired', () => {
  it('returns false when IN is within seekable range', () => {
    expect(isSegmentExpired(150, 100)).toBe(false);
  });

  it('returns true when IN is before seekable start', () => {
    expect(isSegmentExpired(50, 100)).toBe(true);
  });

  it('returns false when IN equals seekable start', () => {
    expect(isSegmentExpired(100, 100)).toBe(false);
  });
});
