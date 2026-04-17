import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const sf = require('../../src/lib/send-flow.js');

describe('buildLockedClipName', () => {
  it('prepends helper name + dash', () => {
    expect(sf.buildLockedClipName('Owl', 'Epic moment')).toBe('Owl - Epic moment');
  });
  it('returns rawName when helperName empty', () => {
    expect(sf.buildLockedClipName('', 'Clip A')).toBe('Clip A');
  });
  it('collapses double prefix if rawName already starts with it', () => {
    expect(sf.buildLockedClipName('Owl', 'Owl - Something')).toBe('Owl - Something');
  });
  it('trims whitespace', () => {
    expect(sf.buildLockedClipName('  Owl  ', '  Moment  ')).toBe('Owl - Moment');
  });
});

describe('stripLockedPrefix', () => {
  it('removes the helper prefix if present', () => {
    expect(sf.stripLockedPrefix('Owl - Something', 'Owl')).toBe('Something');
  });
  it('leaves name unchanged if prefix missing', () => {
    expect(sf.stripLockedPrefix('Something', 'Owl')).toBe('Something');
  });
  it('handles empty helperName', () => {
    expect(sf.stripLockedPrefix('Thing', '')).toBe('Thing');
  });
});

describe('shouldResend', () => {
  it('returns true when range is sent and patch touches tracked fields', () => {
    expect(sf.shouldResend({ sentBy: 'h1' }, { inTime: 5 })).toBe(true);
    expect(sf.shouldResend({ sentBy: 'h1' }, { outTime: 10 })).toBe(true);
    expect(sf.shouldResend({ sentBy: 'h1' }, { postCaption: 'x' })).toBe(true);
    expect(sf.shouldResend({ sentBy: 'h1' }, { name: 'new' })).toBe(true);
  });
  it('returns false when range is not sent', () => {
    expect(sf.shouldResend({ sentBy: '' }, { inTime: 5 })).toBe(false);
  });
  it('returns false when patch does not touch tracked fields', () => {
    expect(sf.shouldResend({ sentBy: 'h1' }, { foo: 'bar' })).toBe(false);
  });
});
