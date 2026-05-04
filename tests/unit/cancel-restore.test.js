import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { restoreCancelledClip } = require('../../src/lib/cancel-restore.js');

describe('restoreCancelledClip', () => {
  it('returns the clip with status reset to pending', () => {
    const clip = { id: 'c1', inTime: 1, outTime: 2, _state: 'downloading', _progress: 42 };
    const restored = restoreCancelledClip(clip);
    expect(restored.id).toBe('c1');
    expect(restored.inTime).toBe(1);
    expect(restored.outTime).toBe(2);
    expect(restored._state).toBeUndefined();
    expect(restored._progress).toBeUndefined();
  });

  it('does not mutate the input', () => {
    const clip = { id: 'c1', _state: 'downloading' };
    restoreCancelledClip(clip);
    expect(clip._state).toBe('downloading');
  });

  it('preserves user-edit fields like name and caption', () => {
    const clip = { id: 'c1', name: 'My Clip', caption: 'Big play', inTime: 1, outTime: 2 };
    const out = restoreCancelledClip(clip);
    expect(out.name).toBe('My Clip');
    expect(out.caption).toBe('Big play');
  });
});
