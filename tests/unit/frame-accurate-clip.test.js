import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fac = require('../../src/lib/frame-accurate-clip.js');
const { splitSeek, buildFrameAccurateTrimArgs, isFrameAccurateEnabled } = fac;

// Helper: pull the value that follows a flag (e.g. argAfter(args, '-ss')).
function argAfter(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}
function indicesOf(args, flag) {
  const out = [];
  args.forEach((v, i) => { if (v === flag) out.push(i); });
  return out;
}

describe('splitSeek', () => {
  it('returns 0/0 at the origin', () => {
    expect(splitSeek(0, 2)).toEqual({ fastSeek: 0, delta: 0 });
  });

  it('snaps fast-seek to the previous keyframe boundary', () => {
    // 17.5s with 2s GOP → fast-seek 16, delta 1.5
    expect(splitSeek(17.5, 2)).toEqual({ fastSeek: 16, delta: 1.5 });
  });

  it('handles exact keyframe boundaries (no leftover delta)', () => {
    expect(splitSeek(8, 2)).toEqual({ fastSeek: 8, delta: 0 });
    expect(splitSeek(12, 4)).toEqual({ fastSeek: 12, delta: 0 });
  });

  it('falls back to a 2s GOP when interval is invalid', () => {
    expect(splitSeek(5, 0)).toEqual({ fastSeek: 4, delta: 1 });
    expect(splitSeek(5)).toEqual({ fastSeek: 4, delta: 1 });
  });

  it('clamps negatives to zero', () => {
    expect(splitSeek(-3, 2)).toEqual({ fastSeek: 0, delta: 0 });
  });
});

describe('buildFrameAccurateTrimArgs', () => {
  it('emits the requested input/output paths in the right slots', () => {
    const args = buildFrameAccurateTrimArgs('/in.mp4', '/out.mp4', 17.5, 30);
    expect(argAfter(args, '-i')).toBe('/in.mp4');
    expect(args[args.length - 1]).toBe('/out.mp4');
    expect(args[0]).toBe('-y');
  });

  it('uses combined seek: pre-input fast -ss + post-input fine -ss', () => {
    const args = buildFrameAccurateTrimArgs('/in.mp4', '/out.mp4', 17.5, 30, { keyframeIntervalSec: 2 });
    const inputIdx = args.indexOf('-i');
    const ssIndices = indicesOf(args, '-ss');
    expect(ssIndices.length).toBe(2);
    // First -ss is BEFORE -i (input-seek), second is AFTER -i (output-seek).
    expect(ssIndices[0]).toBeLessThan(inputIdx);
    expect(ssIndices[1]).toBeGreaterThan(inputIdx);
    expect(args[ssIndices[0] + 1]).toBe('16');
    expect(args[ssIndices[1] + 1]).toBe('1.5');
  });

  it('omits the pre-input -ss when ssOffset is 0', () => {
    const args = buildFrameAccurateTrimArgs('/in.mp4', '/out.mp4', 0, 10);
    const inputIdx = args.indexOf('-i');
    const preInputSlice = args.slice(0, inputIdx);
    expect(preInputSlice).not.toContain('-ss');
    // Output-side -ss is still present (delta = 0) so callers can rely on uniform shape.
    expect(indicesOf(args, '-ss')).toHaveLength(1);
    expect(argAfter(args, '-ss')).toBe('0');
  });

  it('forces CFR via -fps_mode cfr', () => {
    const args = buildFrameAccurateTrimArgs('/in.mp4', '/out.mp4', 5, 10);
    expect(argAfter(args, '-fps_mode')).toBe('cfr');
  });

  it('sets -avoid_negative_ts make_zero', () => {
    const args = buildFrameAccurateTrimArgs('/in.mp4', '/out.mp4', 5, 10);
    expect(argAfter(args, '-avoid_negative_ts')).toBe('make_zero');
  });

  it('includes timestamp-reset filters for video and audio', () => {
    const args = buildFrameAccurateTrimArgs('/in.mp4', '/out.mp4', 5, 10);
    expect(argAfter(args, '-vf')).toBe('setpts=PTS-STARTPTS');
    expect(argAfter(args, '-af')).toBe('asetpts=PTS-STARTPTS');
  });

  it('uses libx264 fast preset CRF 18 by default', () => {
    const args = buildFrameAccurateTrimArgs('/in.mp4', '/out.mp4', 5, 10);
    expect(argAfter(args, '-c:v')).toBe('libx264');
    expect(argAfter(args, '-preset')).toBe('fast');
    expect(argAfter(args, '-crf')).toBe('18');
    expect(argAfter(args, '-c:a')).toBe('aac');
    expect(argAfter(args, '-b:a')).toBe('192k');
  });

  it('respects encoder overrides', () => {
    const args = buildFrameAccurateTrimArgs('/in.mp4', '/out.mp4', 5, 10, {
      videoCodec: 'h264_nvenc',
      preset: 'p5',
      crf: 21,
      audioCodec: 'libopus',
      audioBitrate: '128k',
    });
    expect(argAfter(args, '-c:v')).toBe('h264_nvenc');
    expect(argAfter(args, '-preset')).toBe('p5');
    expect(argAfter(args, '-crf')).toBe('21');
    expect(argAfter(args, '-c:a')).toBe('libopus');
    expect(argAfter(args, '-b:a')).toBe('128k');
  });

  it('emits -g 1 -keyint_min 1 only when allIntra is set', () => {
    const def = buildFrameAccurateTrimArgs('/in.mp4', '/out.mp4', 5, 10);
    expect(def).not.toContain('-keyint_min');
    // (-g may be absent OR equal to a different value — either way, in default
    //  mode there should be no '-keyint_min' override.)

    const allI = buildFrameAccurateTrimArgs('/in.mp4', '/out.mp4', 5, 10, { allIntra: true });
    expect(argAfter(allI, '-g')).toBe('1');
    expect(argAfter(allI, '-keyint_min')).toBe('1');
  });

  it('produces args distinct from the default trim path', () => {
    // Sanity: this experimental builder must not accidentally regress to
    // the same output as the default `buildTrimArgs`. If it does, the
    // dev-flag gate is meaningless.
    const { buildTrimArgs } = require('../../src/lib/ffmpeg-args.js');
    const baseline = buildTrimArgs('/in.mp4', '/out.mp4', 17.5, 30);
    const accurate = buildFrameAccurateTrimArgs('/in.mp4', '/out.mp4', 17.5, 30);
    expect(accurate).not.toEqual(baseline);
    // And specifically: the accurate path should include -fps_mode, baseline shouldn't.
    expect(accurate).toContain('-fps_mode');
    expect(baseline).not.toContain('-fps_mode');
  });
});

describe('isFrameAccurateEnabled', () => {
  it('returns false when the flag is absent', () => {
    expect(isFrameAccurateEnabled(null)).toBe(false);
    expect(isFrameAccurateEnabled(undefined)).toBe(false);
    expect(isFrameAccurateEnabled({})).toBe(false);
    expect(isFrameAccurateEnabled({ devFeatures: {} })).toBe(false);
  });

  it('returns false when the flag is explicitly false', () => {
    expect(isFrameAccurateEnabled({ devFeatures: { frameAccurateClipping: false } })).toBe(false);
  });

  it('returns true only when the flag is truthy', () => {
    expect(isFrameAccurateEnabled({ devFeatures: { frameAccurateClipping: true } })).toBe(true);
  });

  it('does not leak into adjacent dev flags', () => {
    // The other dev flags must NOT enable this experimental path on their own.
    const cfg = { devFeatures: { ffmpegLogs: true, keepTempFiles: true, advancedPanelSystem: true } };
    expect(isFrameAccurateEnabled(cfg)).toBe(false);
  });
});
