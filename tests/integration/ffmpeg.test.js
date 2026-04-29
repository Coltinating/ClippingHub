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

let ffprobeAvailable = false;
try {
  execSync('ffprobe -version', { stdio: 'pipe' });
  ffprobeAvailable = true;
} catch { /* ffprobe not installed */ }

const ffToolsAvailable = ffmpegAvailable && ffprobeAvailable;

describe.skipIf(!ffToolsAvailable)('concat + trim pipeline', () => {
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

    const { segments: segs } = parseSegments(playlist);
    expect(segs).toHaveLength(3);

    const covering = findCoveringSegments(segs, 3, 9);
    expect(covering).toHaveLength(3);

    const narrow = findCoveringSegments(segs, 6, 3);
    expect(narrow).toHaveLength(1);
    expect(narrow[0].url).toBe('seg_0002.ts');
  });
});

// ─── Timestamp normalization ───
describe.skipIf(!ffToolsAvailable)('timestamp normalization', () => {
  const HLS_DIR = path.join(FIXTURES_DIR, 'hls_nonzero_pts');
  const hlsSeg1 = path.join(HLS_DIR, 'seg_hls_0001.ts');
  const hlsSeg2 = path.join(HLS_DIR, 'seg_hls_0002.ts');
  const hlsSeg3 = path.join(HLS_DIR, 'seg_hls_0003.ts');
  const hlsListFile = path.join(HLS_DIR, 'files.txt');
  const hlsConcatFile = path.join(HLS_DIR, 'concat.ts');
  const hlsOutFile = path.join(HLS_DIR, 'trimmed.mp4');
  const hlsFrameFile = path.join(HLS_DIR, 'frame0.bmp');

  beforeAll(() => {
    fs.mkdirSync(HLS_DIR, { recursive: true });

    // Generate 3 test .ts segments with NON-ZERO PTS (simulating live HLS)
    // offset 3600 = 1 hour wall-clock PTS, like real live HLS streams
    const segments = [
      [hlsSeg1, 3600, 440],
      [hlsSeg2, 3605, 550],
      [hlsSeg3, 3610, 660],
    ];
    for (const [file, offset, freq] of segments) {
      execSync([
        'ffmpeg', '-y',
        '-f', 'lavfi', '-i', `testsrc=duration=5:size=320x240:rate=30`,
        '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=5`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60',
        '-c:a', 'aac',
        '-output_ts_offset', String(offset),
        '-f', 'mpegts', `"${file}"`,
      ].join(' '), { stdio: 'pipe', timeout: 15000 });
    }

    // Write concat list
    fs.writeFileSync(hlsListFile,
      [hlsSeg1, hlsSeg2, hlsSeg3].map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n')
    );

    // Concat segments
    const { buildConcatArgs } = require('../../src/lib/ffmpeg-args.js');
    const concatArgs = buildConcatArgs(hlsListFile, hlsConcatFile);
    execSync(['ffmpeg', ...concatArgs].join(' '), { stdio: 'pipe', timeout: 15000 });

    // Trim to final clip
    const { buildTrimArgs } = require('../../src/lib/ffmpeg-args.js');
    const trimArgs = buildTrimArgs(hlsConcatFile, hlsOutFile, 2, 7);
    execSync(['ffmpeg', ...trimArgs].join(' '), { stdio: 'pipe', timeout: 15000 });
  }, 30000);

  afterAll(() => {
    for (const f of [hlsSeg1, hlsSeg2, hlsSeg3, hlsListFile, hlsConcatFile, hlsOutFile, hlsFrameFile]) {
      try { fs.unlinkSync(f); } catch {}
    }
    try { fs.rmdirSync(HLS_DIR); } catch {}
  });

  it('concat.ts from non-zero-PTS segments has start_time normalized (not at original offset)', () => {
    // The concat demuxer + avoid_negative_ts normalizes PTS from ~3600 to near zero.
    // MPEGTS container has an inherent ~1.4s start_time artifact (PAT/PMT overhead),
    // so we check < 2.0 instead of < 1.0. The trimmed MP4 output will be exactly 0.
    const probe = execSync(
      `ffprobe -v error -show_entries format=start_time -of default=noprint_wrappers=1:nokey=1 "${hlsConcatFile}"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    const startTime = parseFloat(probe);
    expect(startTime).toBeLessThan(2.0);
  }, 30000);

  it('trimmed MP4 first keyframe is at PTS near zero', () => {
    // Get first keyframe PTS from the trimmed output
    const probe = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,flags -of csv "${hlsOutFile}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const keyframes = probe.split('\n')
      .filter(line => line.includes(',K'))
      .map(line => {
        const parts = line.split(',');
        return parseFloat(parts[1]);
      })
      .filter(v => !isNaN(v));

    expect(keyframes.length).toBeGreaterThan(0);
    // First keyframe should be near PTS 0, not offset by GOP alignment
    expect(keyframes[0]).toBeLessThan(0.5);
  }, 30000);

  it('trimmed MP4 first frame can be extracted (not corrupt)', () => {
    // Extract first frame as BMP — should succeed if video is seekable
    const result = execSync(
      `ffmpeg -y -i "${hlsOutFile}" -frames:v 1 -f image2 "${hlsFrameFile}"`,
      { stdio: 'pipe', timeout: 10000 }
    );
    expect(fs.existsSync(hlsFrameFile)).toBe(true);
    const stat = fs.statSync(hlsFrameFile);
    // A valid BMP frame should be > 1000 bytes (not empty/tiny)
    expect(stat.size).toBeGreaterThan(1000);
  }, 30000);

  it('output duration matches requested duration (regression guard)', () => {
    const probe = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${hlsOutFile}"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    const duration = parseFloat(probe);
    // Requested 7s, allow ±0.5s tolerance
    expect(duration).toBeGreaterThanOrEqual(6.5);
    expect(duration).toBeLessThanOrEqual(7.5);
  }, 30000);
});
