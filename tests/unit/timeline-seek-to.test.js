import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { computeSeekTarget } = require('../../src/player/timeline-seek-helpers.js');

describe('computeSeekTarget', () => {
  it('clamps VOD seek to [0, duration]', () => {
    expect(computeSeekTarget({ isLive: false, duration: 100, seekableStart: 0, seekableEnd: 0 }, -50)).toBe(0);
    expect(computeSeekTarget({ isLive: false, duration: 100, seekableStart: 0, seekableEnd: 0 }, 50)).toBe(50);
    expect(computeSeekTarget({ isLive: false, duration: 100, seekableStart: 0, seekableEnd: 0 }, 200)).toBe(100);
  });

  it('clamps live seek to [seekableStart, seekableEnd - 0.5]', () => {
    const ctx = { isLive: true, duration: Infinity, seekableStart: 1000, seekableEnd: 2000 };
    expect(computeSeekTarget(ctx, 500)).toBe(1000);
    expect(computeSeekTarget(ctx, 1500)).toBe(1500);
    expect(computeSeekTarget(ctx, 2500)).toBe(1999.5);
  });

  it('returns NaN for live with no seekable range (caller should noop)', () => {
    const ctx = { isLive: true, duration: Infinity, seekableStart: 0, seekableEnd: 0 };
    expect(Number.isNaN(computeSeekTarget(ctx, 100))).toBe(true);
  });

  it('returns NaN for VOD with no duration', () => {
    expect(Number.isNaN(computeSeekTarget({ isLive: false, duration: NaN, seekableStart: 0, seekableEnd: 0 }, 50))).toBe(true);
    expect(Number.isNaN(computeSeekTarget({ isLive: false, duration: 0, seekableStart: 0, seekableEnd: 0 }, 50))).toBe(true);
  });
});
