import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildTrimArgs, parseSegments, findCoveringSegments } = require('../../src/lib/ffmpeg-args.js');

describe('buildTrimArgs', () => {
  it('builds correct ffmpeg trim arguments', () => {
    const args = buildTrimArgs('/tmp/concat.ts', '/tmp/out.mp4', 5.5, 30);
    expect(args).toContain('-ss');
    expect(args).toContain('5.5');
    expect(args).toContain('-t');
    expect(args).toContain('30');
    expect(args).toContain('-c:v');
    expect(args).toContain('libx264');
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });
});

describe('parseSegments', () => {
  it('parses a simple HLS playlist', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:5.005,',
      'seg001.ts',
      '#EXTINF:5.005,',
      'seg002.ts',
      '#EXTINF:4.004,',
      'seg003.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const segs = parseSegments(playlist);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ url: 'seg001.ts', duration: 5.005, startTime: 0 });
    expect(segs[1].startTime).toBeCloseTo(5.005);
    expect(segs[2].startTime).toBeCloseTo(10.01);
  });

  it('returns empty for master playlist', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000',
      'variant.m3u8',
    ].join('\n');
    expect(parseSegments(master)).toHaveLength(0);
  });

  it('handles live playlist without ENDLIST', () => {
    const live = [
      '#EXTM3U',
      '#EXT-X-MEDIA-SEQUENCE:100',
      '#EXTINF:6.006,',
      'seg100.ts',
      '#EXTINF:6.006,',
      'seg101.ts',
    ].join('\n');

    const segs = parseSegments(live);
    expect(segs).toHaveLength(2);
    expect(segs[0].url).toBe('seg100.ts');
  });
});

describe('findCoveringSegments', () => {
  it('finds segments overlapping a time range', () => {
    const segments = [
      { url: 's0.ts', duration: 5, startTime: 0 },
      { url: 's1.ts', duration: 5, startTime: 5 },
      { url: 's2.ts', duration: 5, startTime: 10 },
      { url: 's3.ts', duration: 5, startTime: 15 },
      { url: 's4.ts', duration: 5, startTime: 20 },
    ];

    const result = findCoveringSegments(segments, 7, 10);
    expect(result).toHaveLength(3);
    expect(result.map(s => s.url)).toEqual(['s1.ts', 's2.ts', 's3.ts']);
  });

  it('returns empty when no segments in range', () => {
    const segments = [
      { url: 's0.ts', duration: 5, startTime: 0 },
      { url: 's1.ts', duration: 5, startTime: 5 },
    ];
    const result = findCoveringSegments(segments, 100, 10);
    expect(result).toHaveLength(0);
  });
});
