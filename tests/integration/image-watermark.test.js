import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildImageWatermarkArgs } = require('../../src/lib/ffmpeg-args.js');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const LOGO_DIR = path.join(__dirname, '..', '..', 'misc', 'rumblelogo');
const SNAP_IMG = path.join(LOGO_DIR, 'snaptocorners.jpg');
const CENTER_IMG = path.join(LOGO_DIR, 'center.jpg');

let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'pipe' });
  ffmpegAvailable = true;
} catch { /* ffmpeg not installed */ }

// Helper: run FFmpeg with image watermark overlay on a source video
function applyImageWatermark(inputVideo, outputPath, watermarkConfig) {
  return new Promise((resolve, reject) => {
    const wmArgs = buildImageWatermarkArgs(watermarkConfig);
    if (!wmArgs) return reject(new Error('buildImageWatermarkArgs returned null'));

    const args = [
      '-y',
      '-i', inputVideo,
      ...wmArgs.inputs,
      '-filter_complex', wmArgs.filterComplex,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: 'pipe' });
    let stderr = '';
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

describe.skipIf(!ffmpegAvailable)('image watermark overlay', () => {
  const testVideo = path.join(FIXTURES_DIR, 'wm_test_source.mp4');
  const outputs = [];

  beforeAll(() => {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });

    // Verify test images exist
    if (!fs.existsSync(SNAP_IMG)) throw new Error(`Missing test image: ${SNAP_IMG}`);
    if (!fs.existsSync(CENTER_IMG)) throw new Error(`Missing test image: ${CENTER_IMG}`);

    // Generate a 3-second 640x360 test video with audio
    execSync([
      'ffmpeg', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=3:size=640x360:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast',
      '-c:a', 'aac',
      `"${testVideo}"`,
    ].join(' '), { stdio: 'pipe', timeout: 15000 });
  }, 30000);

  afterAll(() => {
    for (const f of [testVideo, ...outputs]) {
      try { fs.unlinkSync(f); } catch {}
    }
  });

  // ── snaptocorners.jpg on all 4 corners ──

  it('overlays snaptocorners.jpg at top-left', async () => {
    const out = path.join(FIXTURES_DIR, 'wm_topleft.mp4');
    outputs.push(out);
    await applyImageWatermark(testVideo, out, {
      imagePath: SNAP_IMG,
      position: 'top-left',
      opacity: 0.8,
    });
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBeGreaterThan(1000);

    // Verify output resolution matches source
    const probe = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${out}"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    const [w, h] = probe.split(',').map(Number);
    expect(w).toBe(640);
    expect(h).toBe(360);
  }, 30000);

  it('overlays snaptocorners.jpg at top-right', async () => {
    const out = path.join(FIXTURES_DIR, 'wm_topright.mp4');
    outputs.push(out);
    await applyImageWatermark(testVideo, out, {
      imagePath: SNAP_IMG,
      position: 'top-right',
      opacity: 0.8,
    });
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBeGreaterThan(1000);
  }, 30000);

  it('overlays snaptocorners.jpg at bottom-left', async () => {
    const out = path.join(FIXTURES_DIR, 'wm_bottomleft.mp4');
    outputs.push(out);
    await applyImageWatermark(testVideo, out, {
      imagePath: SNAP_IMG,
      position: 'bottom-left',
      opacity: 0.8,
    });
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBeGreaterThan(1000);
  }, 30000);

  it('overlays snaptocorners.jpg at bottom-right', async () => {
    const out = path.join(FIXTURES_DIR, 'wm_bottomright.mp4');
    outputs.push(out);
    await applyImageWatermark(testVideo, out, {
      imagePath: SNAP_IMG,
      position: 'bottom-right',
      opacity: 0.8,
    });
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBeGreaterThan(1000);
  }, 30000);

  // ── center.jpg in center ──

  it('overlays center.jpg at center', async () => {
    const out = path.join(FIXTURES_DIR, 'wm_center.mp4');
    outputs.push(out);
    await applyImageWatermark(testVideo, out, {
      imagePath: CENTER_IMG,
      position: 'center',
      opacity: 0.8,
    });
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBeGreaterThan(1000);

    // Verify duration is preserved
    const probe = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${out}"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    const duration = parseFloat(probe);
    expect(duration).toBeGreaterThanOrEqual(2.5);
    expect(duration).toBeLessThanOrEqual(3.5);
  }, 30000);

  // ── Resize test (same aspect ratio, different resolution) ──

  it('overlays with explicit size (resize for resolution mismatch)', async () => {
    const out = path.join(FIXTURES_DIR, 'wm_resized.mp4');
    outputs.push(out);
    await applyImageWatermark(testVideo, out, {
      imagePath: CENTER_IMG,
      position: 'center',
      opacity: 0.7,
      width: 120,
      height: 120,
    });
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.statSync(out).size).toBeGreaterThan(1000);
  }, 30000);
});
