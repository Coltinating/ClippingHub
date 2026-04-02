import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ffmpegArgs = require('../../src/lib/ffmpeg-args.js');
const { buildTrimArgs, parseSegments, findCoveringSegments } = ffmpegArgs;

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

  it('includes audio timestamp reset filter (asetpts)', () => {
    const args = buildTrimArgs('/tmp/concat.ts', '/tmp/out.mp4', 5.5, 30);
    const afIndex = args.indexOf('-af');
    expect(afIndex).toBeGreaterThan(-1);
    expect(args[afIndex + 1]).toBe('asetpts=PTS-STARTPTS');
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

    const { segments: segs } = parseSegments(playlist);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ url: 'seg001.ts', duration: 5.005, startTime: 0, seq: 0 });
    expect(segs[1].startTime).toBeCloseTo(5.005);
    expect(segs[2].startTime).toBeCloseTo(10.01);
  });

  it('returns empty for master playlist', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000',
      'variant.m3u8',
    ].join('\n');
    expect(parseSegments(master).segments).toHaveLength(0);
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

    const { segments: segs } = parseSegments(live);
    expect(segs).toHaveLength(2);
    expect(segs[0].url).toBe('seg100.ts');
  });
});

// ─── Output-side seeking ───
describe('buildTrimArgs — input-side seeking', () => {
  it('places -ss before -i to avoid MP4 edit list dwell bug', () => {
    const args = buildTrimArgs('/tmp/concat.ts', '/tmp/out.mp4', 5.5, 30);
    const ssIndex = args.indexOf('-ss');
    const iIndex = args.indexOf('-i');
    expect(ssIndex).toBeGreaterThan(-1);
    expect(iIndex).toBeGreaterThan(-1);
    expect(ssIndex).toBeLessThan(iIndex);
  });
});

// ─── Timing drift ───
describe('parseSegments — timing drift', () => {
  it('does not accumulate float drift with varying durations over 2000 segments', () => {
    // Build a playlist with 2000 segments of varying durations
    // that have exact integer-millisecond values (no inherent float imprecision)
    const lines = ['#EXTM3U', '#EXT-X-TARGETDURATION:7'];
    const durations = [5.005, 6.006, 4.004, 5.005, 6.006]; // cycle through these
    let expectedMs = 0;
    for (let i = 0; i < 2000; i++) {
      const dur = durations[i % durations.length];
      lines.push(`#EXTINF:${dur},`);
      lines.push(`seg${String(i).padStart(5, '0')}.ts`);
      expectedMs += Math.round(dur * 1000);
    }

    const result = parseSegments(lines.join('\n'));
    // parseSegments should return { segments, ... } not a plain array
    const segs = Array.isArray(result) ? result : result.segments;
    const lastSeg = segs[segs.length - 1];

    // The expected startTime of the last segment is the sum of the first 1999
    // durations (not all 2000 — the last segment's own duration isn't included)
    const lastDur = durations[(2000 - 1) % durations.length];
    const expectedStartSec = (expectedMs - Math.round(lastDur * 1000)) / 1000;
    const actualStartSec = lastSeg.startTime;
    const driftMs = Math.abs(actualStartSec - expectedStartSec) * 1000;

    // After 2000 segments, float accumulation of t += dur will drift >1ms
    // A correct implementation uses integer-ms math and should have 0 drift
    expect(driftMs).toBeLessThan(1);
  });

  it('returns mediaSequence from playlist', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-MEDIA-SEQUENCE:500',
      '#EXTINF:6.006,',
      'seg500.ts',
      '#EXTINF:6.006,',
      'seg501.ts',
    ].join('\n');

    const result = parseSegments(playlist);
    // parseSegments must return an object with mediaSequence, not a plain array
    expect(result).not.toBeInstanceOf(Array);
    expect(result).toHaveProperty('mediaSequence', 500);
    expect(result).toHaveProperty('segments');
    expect(result.segments).toHaveLength(2);
  });

  it('assigns consistent seq numbers across playlist refreshes', () => {
    // First fetch: server reports MEDIA-SEQUENCE 100, 3 segments
    const playlist1 = [
      '#EXTM3U',
      '#EXT-X-MEDIA-SEQUENCE:100',
      '#EXTINF:6.006,',
      'seg100.ts',
      '#EXTINF:6.006,',
      'seg101.ts',
      '#EXTINF:6.006,',
      'seg102.ts',
    ].join('\n');

    // Second fetch: window slides, MEDIA-SEQUENCE is now 102
    const playlist2 = [
      '#EXTM3U',
      '#EXT-X-MEDIA-SEQUENCE:102',
      '#EXTINF:6.006,',
      'seg102.ts',
      '#EXTINF:6.006,',
      'seg103.ts',
      '#EXTINF:6.006,',
      'seg104.ts',
    ].join('\n');

    const result1 = parseSegments(playlist1);
    const result2 = parseSegments(playlist2);
    const segs1 = Array.isArray(result1) ? result1 : result1.segments;
    const segs2 = Array.isArray(result2) ? result2 : result2.segments;

    // Each segment should carry its sequence number
    // so seg102.ts has the same seq in both fetches
    expect(segs1[2]).toHaveProperty('seq', 102);
    expect(segs2[0]).toHaveProperty('seq', 102);
    expect(segs1[2].seq).toBe(segs2[0].seq);
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

// ─── Timestamp normalization ───
describe('buildConcatArgs — timestamp normalization', () => {
  it('buildConcatArgs exists and includes -output_ts_offset 0', () => {
    expect(ffmpegArgs.buildConcatArgs).toBeTypeOf('function');
    const args = ffmpegArgs.buildConcatArgs('files.txt', 'concat.ts');
    const idx = args.indexOf('-output_ts_offset');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('0');
  });

  it('buildConcatArgs includes -avoid_negative_ts make_zero', () => {
    const args = ffmpegArgs.buildConcatArgs('files.txt', 'concat.ts');
    const idx = args.indexOf('-avoid_negative_ts');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('make_zero');
  });

  it('buildConcatArgs uses -c copy (no re-encode during concat)', () => {
    const args = ffmpegArgs.buildConcatArgs('files.txt', 'concat.ts');
    expect(args).toContain('-c');
    expect(args).toContain('copy');
  });
});

describe('buildTrimArgs — no unnecessary input flags', () => {
  it('does not include -fflags +genpts', () => {
    const args = buildTrimArgs('/tmp/concat.ts', '/tmp/out.mp4', 5.5, 30);
    expect(args.indexOf('-fflags')).toBe(-1);
  });
});
