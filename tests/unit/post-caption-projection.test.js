import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { projectRangeToTimelineClip } = require('../../src/lib/caption-sync.js');

describe('projectRangeToTimelineClip', () => {
  it('maps range fields onto a timeline-clip shape', () => {
    const range = {
      id: 'r1',
      clipperId: 'u1', clipperName: 'Socks',
      helperId: 'u2', helperName: 'Owl',
      inTime: 10, outTime: 20,
      status: 'done',
      postCaption: 'hello',
      postCaptionUpdatedAt: 42,
      fileName: 'clip.mp4', filePath: '/x/clip.mp4',
      postThumbnailDataUrl: 'data:image/png;base64,AAA'
    };
    expect(projectRangeToTimelineClip(range)).toMatchObject({
      id: 'r1',
      name: expect.any(String),
      stage: 'downloaded',
      inTime: 10, outTime: 20,
      postCaption: 'hello',
      postCaptionUpdatedAt: 42,
      clipperId: 'u1', clipperName: 'Socks',
      helperId: 'u2', helperName: 'Owl',
      fileName: 'clip.mp4', filePath: '/x/clip.mp4',
      postThumbnailDataUrl: 'data:image/png;base64,AAA'
    });
  });

  it('maps status values to stage buckets', () => {
    expect(projectRangeToTimelineClip({ id: 'r', status: 'queued' }).stage).toBe('pending');
    expect(projectRangeToTimelineClip({ id: 'r', status: 'downloading' }).stage).toBe('downloading');
    expect(projectRangeToTimelineClip({ id: 'r', status: 'done' }).stage).toBe('downloaded');
    expect(projectRangeToTimelineClip({ id: 'r', status: 'marking' }).stage).toBe('pending');
  });

  it('skips ranges without an id', () => {
    expect(projectRangeToTimelineClip({ inTime: 1, outTime: 2 })).toBeNull();
  });
});
