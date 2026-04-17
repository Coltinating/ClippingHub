import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const p = require('../../src/lib/profile.js');

describe('sanitizeXHandle', () => {
  it('strips leading @', () => {
    expect(p.sanitizeXHandle('@socks')).toBe('socks');
  });
  it('trims and lowercases nothing (case-preserving, but strips spaces)', () => {
    expect(p.sanitizeXHandle('  Sox_42  ')).toBe('Sox_42');
  });
  it('rejects disallowed chars', () => {
    expect(p.sanitizeXHandle('bad!name')).toBe('');
  });
  it('clamps to 15 chars (X handle max)', () => {
    expect(p.sanitizeXHandle('abcdefghijklmnopqrstuv')).toBe('abcdefghijklmno');
  });
  it('returns empty for null/undefined', () => {
    expect(p.sanitizeXHandle(null)).toBe('');
    expect(p.sanitizeXHandle(undefined)).toBe('');
  });
});

describe('resolveUserColor', () => {
  it('uses profile.color when present and valid hex', () => {
    expect(p.resolveUserColor({ color: '#ff8800' }, '#000')).toBe('#ff8800');
  });
  it('falls back when color invalid', () => {
    expect(p.resolveUserColor({ color: 'red' }, '#abcdef')).toBe('#abcdef');
  });
  it('falls back when color missing', () => {
    expect(p.resolveUserColor({}, '#abcdef')).toBe('#abcdef');
  });
});

describe('validatePfpDataUrl', () => {
  it('accepts small image data URL', () => {
    const ok = 'data:image/png;base64,AAA';
    expect(p.validatePfpDataUrl(ok, 1024)).toBe(true);
  });
  it('rejects non-image data URL', () => {
    expect(p.validatePfpDataUrl('data:text/plain;base64,AAA', 1024)).toBe(false);
  });
  it('rejects oversized data URL', () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(10_000);
    expect(p.validatePfpDataUrl(big, 1024)).toBe(false);
  });
  it('rejects non-data URLs', () => {
    expect(p.validatePfpDataUrl('http://x/y.png', 1024)).toBe(false);
  });
});

describe('buildProfilePayload', () => {
  it('returns only profile-safe fields', () => {
    const payload = p.buildProfilePayload({
      id: 'u1', name: 'Socks', xHandle: '@socks',
      color: '#ff8800', pfpDataUrl: 'data:image/png;base64,AAA',
      secret: 'nope'
    });
    expect(payload).toEqual({
      id: 'u1', name: 'Socks', xHandle: 'socks',
      color: '#ff8800', pfpDataUrl: 'data:image/png;base64,AAA'
    });
    expect(payload.secret).toBeUndefined();
  });
});
