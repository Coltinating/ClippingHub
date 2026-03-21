import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildImageWatermarkArgs } = require('../../src/lib/ffmpeg-args.js');

describe('buildImageWatermarkArgs', () => {
  // ── Null / invalid input ──

  it('returns null when no config provided', () => {
    expect(buildImageWatermarkArgs(null)).toBe(null);
    expect(buildImageWatermarkArgs(undefined)).toBe(null);
    expect(buildImageWatermarkArgs({})).toBe(null);
  });

  it('returns null when imagePath is empty string', () => {
    expect(buildImageWatermarkArgs({ imagePath: '' })).toBe(null);
  });

  it('returns null when imagePath is missing but position is set', () => {
    expect(buildImageWatermarkArgs({ position: 'center' })).toBe(null);
  });

  // ── Position: 4 corners ──

  it('builds top-left overlay with correct position', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'top-left',
      opacity: 1,
    });
    expect(result).not.toBe(null);
    expect(result.filterComplex).toContain('overlay=x=0:y=0');
  });

  it('builds top-right overlay with correct position', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'top-right',
      opacity: 1,
    });
    expect(result.filterComplex).toContain('overlay=x=W-w:y=0');
  });

  it('builds bottom-left overlay with correct position', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'bottom-left',
      opacity: 1,
    });
    expect(result.filterComplex).toContain('overlay=x=0:y=H-h');
  });

  it('builds bottom-right overlay with correct position', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'bottom-right',
      opacity: 1,
    });
    expect(result.filterComplex).toContain('overlay=x=W-w:y=H-h');
  });

  // ── Position: center ──

  it('builds center overlay with correct position', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
      opacity: 1,
    });
    expect(result.filterComplex).toContain('overlay=x=(W-w)/2:y=(H-h)/2');
  });

  it('defaults to center when position not specified', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      opacity: 1,
    });
    expect(result.filterComplex).toContain('overlay=x=(W-w)/2:y=(H-h)/2');
  });

  // ── Opacity ──

  it('applies opacity via colorchannelmixer when < 1', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
      opacity: 0.5,
    });
    expect(result.filterComplex).toContain('colorchannelmixer=aa=0.5');
  });

  it('skips colorchannelmixer when opacity is 1', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
      opacity: 1,
    });
    expect(result.filterComplex).not.toContain('colorchannelmixer');
  });

  it('defaults opacity to 1 when not specified', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
    });
    expect(result.filterComplex).not.toContain('colorchannelmixer');
  });

  // ── Scaling ──

  it('applies scale multiplier when scale specified', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
      scale: 0.5,
    });
    expect(result.filterComplex).toContain('scale=iw*0.5:ih*0.5');
  });

  it('skips scale multiplier when scale is 1', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
      scale: 1,
    });
    expect(result.filterComplex).not.toContain('scale=');
  });

  it('applies scale when width specified', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
      width: 200,
    });
    expect(result.filterComplex).toContain('scale=200:-1');
  });

  it('applies scale when height specified', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
      height: 100,
    });
    expect(result.filterComplex).toContain('scale=-1:100');
  });

  it('applies scale when both width and height specified', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
      width: 200,
      height: 100,
    });
    expect(result.filterComplex).toContain('scale=200:100');
  });

  // ── Return structure ──

  it('returns inputs array with -i flag and image path', () => {
    const result = buildImageWatermarkArgs({
      imagePath: 'C:\\Users\\test\\logo.png',
      position: 'center',
    });
    expect(result.inputs).toEqual(['-i', 'C:\\Users\\test\\logo.png']);
  });

  it('includes setpts=PTS-STARTPTS in filter chain', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
    });
    expect(result.filterComplex).toContain('setpts=PTS-STARTPTS');
  });

  it('includes format=rgba for transparency support', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
    });
    expect(result.filterComplex).toContain('format=rgba');
  });

  it('labels overlay input as [wm] and video as [base]', () => {
    const result = buildImageWatermarkArgs({
      imagePath: '/tmp/logo.png',
      position: 'center',
    });
    expect(result.filterComplex).toContain('[wm]');
    expect(result.filterComplex).toContain('[base]');
  });
});
