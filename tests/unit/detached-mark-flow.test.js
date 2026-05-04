import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildMarkPayload, validateIncomingMark } = require('../../src/lib/detached-mark.js');

describe('buildMarkPayload', () => {
  it('produces a clip object suitable for pendingClips.push()', () => {
    const out = buildMarkPayload({ inTime: 10, outTime: 22, m3u8Url: 'https://x/s.m3u8', isLive: false });
    expect(out.id).toBeTruthy();
    expect(out.inTime).toBe(10);
    expect(out.outTime).toBe(22);
    expect(out.source).toBe('detached');
    expect(out.m3u8Url).toBe('https://x/s.m3u8');
  });

  it('rejects bad input by returning null', () => {
    expect(buildMarkPayload({ inTime: null, outTime: 10, m3u8Url: 'x' })).toBe(null);
    expect(buildMarkPayload({ inTime: 10, outTime: 10, m3u8Url: 'x' })).toBe(null);
    expect(buildMarkPayload({ inTime: 10, outTime: 5,  m3u8Url: 'x' })).toBe(null);
  });
});

describe('validateIncomingMark', () => {
  it('accepts a well-formed payload', () => {
    expect(validateIncomingMark({ id: 'a', inTime: 1, outTime: 2, source: 'detached' })).toBe(true);
  });
  it('rejects missing fields', () => {
    expect(validateIncomingMark({ inTime: 1, outTime: 2 })).toBe(false);
    expect(validateIncomingMark({ id: 'a', outTime: 2 })).toBe(false);
  });
});
