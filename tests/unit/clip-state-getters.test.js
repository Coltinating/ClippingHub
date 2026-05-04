import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { tagClipsWithState, mergeClipsForTimeline } = require('../../src/lib/clip-state-helpers.js');

describe('tagClipsWithState', () => {
  it('tags every clip with the given state', () => {
    const clips = [{ id: 'a', inTime: 1, outTime: 2 }, { id: 'b', inTime: 3, outTime: 4 }];
    const out = tagClipsWithState(clips, 'pending');
    expect(out[0]._state).toBe('pending');
    expect(out[1]._state).toBe('pending');
  });

  it('does not mutate the input', () => {
    const clips = [{ id: 'a', inTime: 1, outTime: 2 }];
    tagClipsWithState(clips, 'done');
    expect(clips[0]._state).toBeUndefined();
  });
});

describe('mergeClipsForTimeline', () => {
  it('returns pending + downloading + completed in that order, each tagged', () => {
    const merged = mergeClipsForTimeline(
      [{ id: 'p1' }],
      [{ id: 'd1' }],
      [{ id: 'c1' }, { id: 'c2' }]
    );
    expect(merged.map(c => c.id)).toEqual(['p1', 'd1', 'c1', 'c2']);
    expect(merged.map(c => c._state)).toEqual(['pending', 'downloading', 'done', 'done']);
    expect(merged[2]._state).toBe('done');
  });

  it('handles empty arrays', () => {
    expect(mergeClipsForTimeline([], [], [])).toEqual([]);
  });
});
