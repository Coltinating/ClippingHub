import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'pipe' });
  ffmpegAvailable = true;
} catch { /* ffmpeg not installed */ }

describe.skipIf(!ffmpegAvailable)('concat + trim pipeline', () => {
  const seg1Path = path.join(FIXTURES_DIR, 'seg_0001.ts');
  const seg2Path = path.join(FIXTURES_DIR, 'seg_0002.ts');
  const seg3Path = path.join(FIXTURES_DIR, 'seg_0003.ts');

  beforeAll(() => {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });

    for (const [file, freq] of [[seg1Path, 440], [seg2Path, 550], [seg3Path, 660]]) {
      execSync([
        'ffmpeg', '-y',
        '-f', 'lavfi', '-i', `testsrc=duration=5:size=320x240:rate=30`,
        '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=5`,
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-f', 'mpegts', `"${file}"`,
      ].join(' '), { stdio: 'pipe', timeout: 15000 });
    }
  }, 30000);

  afterAll(() => {
    for (const f of [seg1Path, seg2Path, seg3Path]) {
      try { fs.unlinkSync(f); } catch {}
    }
    try { fs.rmdirSync(FIXTURES_DIR); } catch {}
  });

  it('concat 3 segments + trim to 7s produces correct output', async () => {
    const listFile = path.join(FIXTURES_DIR, 'files.txt');
    const concatFile = path.join(FIXTURES_DIR, 'concat.ts');
    const outFile = path.join(FIXTURES_DIR, 'trimmed.mp4');

    fs.writeFileSync(listFile,
      [seg1Path, seg2Path, seg3Path].map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n')
    );

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c', 'copy', concatFile,
      ], { stdio: 'pipe' });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`concat exit ${code}`)));
      proc.on('error', reject);
    });

    const { buildTrimArgs } = require('../../src/lib/ffmpeg-args.js'); // eslint-disable-line
    const trimArgs = buildTrimArgs(concatFile, outFile, 4, 7);

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', trimArgs, { stdio: 'pipe' });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`trim exit ${code}`)));
      proc.on('error', reject);
    });

    expect(fs.existsSync(outFile)).toBe(true);

    const probeOut = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outFile}"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    const outputDuration = parseFloat(probeOut);

    expect(outputDuration).toBeGreaterThanOrEqual(6.5);
    expect(outputDuration).toBeLessThanOrEqual(7.5);

    for (const f of [listFile, concatFile, outFile]) {
      try { fs.unlinkSync(f); } catch {}
    }
  }, 30000);

  it('findCoveringSegments picks correct segments', async () => {
    const { parseSegments, findCoveringSegments } = require('../../src/lib/ffmpeg-args.js'); // eslint-disable-line

    const playlist = [
      '#EXTM3U',
      '#EXT-X-MEDIA-SEQUENCE:50',
      '#EXTINF:5.0,',
      'seg_0001.ts',
      '#EXTINF:5.0,',
      'seg_0002.ts',
      '#EXTINF:5.0,',
      'seg_0003.ts',
    ].join('\n');

    const segs = parseSegments(playlist);
    expect(segs).toHaveLength(3);

    const covering = findCoveringSegments(segs, 3, 9);
    expect(covering).toHaveLength(3);

    const narrow = findCoveringSegments(segs, 6, 3);
    expect(narrow).toHaveLength(1);
    expect(narrow[0].url).toBe('seg_0002.ts');
  });
});
