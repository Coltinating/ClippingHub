import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { resolveCaption } = require('../../src/lib/caption-sync.js');

describe('resolveCaption', () => {
  it('keeps local when local is newer', () => {
    expect(resolveCaption({
      local: { value: 'L', updatedAt: 200 },
      remote: { value: 'R', updatedAt: 100 }
    })).toEqual({ value: 'L', updatedAt: 200, source: 'local' });
  });

  it('adopts remote when remote is newer', () => {
    expect(resolveCaption({
      local: { value: 'L', updatedAt: 100 },
      remote: { value: 'R', updatedAt: 200 }
    })).toEqual({ value: 'R', updatedAt: 200, source: 'remote' });
  });

  it('prefers non-empty when timestamps tie', () => {
    expect(resolveCaption({
      local: { value: '', updatedAt: 100 },
      remote: { value: 'R', updatedAt: 100 }
    }).value).toBe('R');
  });

  it('treats missing remote as no-op', () => {
    expect(resolveCaption({
      local: { value: 'L', updatedAt: 100 },
      remote: null
    })).toEqual({ value: 'L', updatedAt: 100, source: 'local' });
  });
});
