/**
 * Integration tests: verify all ffmpeg codec/config combinations
 * produce output with start_time=0.000000 on both streams.
 *
 * Uses the real concat.ts from _tmp_1775081178625 (the clip that
 * originally had start_time=0.066016).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Source file (the problematic concat.ts) ──
// Override via START_TIME_FIXTURE env var; otherwise default to a checked-in
// fixture under tests/fixtures/. Test suite is skipped when fixture absent.
const CONCAT_TS = process.env.START_TIME_FIXTURE
  || path.join(__dirname, '..', 'fixtures', 'start-time', 'concat.ts');
const OUT_DIR = path.join(__dirname, '..', 'fixtures', 'start-time-outputs');
const SS_OFFSET = '1.979';
const DURATION = '10.61';

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

const fixtureAvailable = fs.existsSync(CONCAT_TS);
const canRun = ffmpegAvailable && ffprobeAvailable && fixtureAvailable;

function ffmpeg(args) {
  return execSync(`ffmpeg ${args}`, {
    encoding: 'utf-8',
    timeout: 60000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function getStartTimes(filePath) {
  const raw = execSync(
    `ffprobe -v error -show_entries stream=codec_type,start_time,start_pts -of json "${filePath}"`,
    { encoding: 'utf-8', timeout: 10000 }
  );
  const data = JSON.parse(raw);
  const result = {};
  for (const s of data.streams) {
    result[s.codec_type] = {
      start_time: parseFloat(s.start_time),
      start_pts: parseInt(s.start_pts, 10),
    };
  }
  return result;
}

function assertZeroStart(filePath, label) {
  const times = getStartTimes(filePath);
  expect(times.video.start_time, `${label}: video start_time`).toBeLessThan(0.001);
  expect(times.audio.start_time, `${label}: audio start_time`).toBeLessThan(0.001);
}

// Common args shared across all tests
const COMMON_FILTERS = '-vf setpts=PTS-STARTPTS -af asetpts=PTS-STARTPTS';
const COMMON_AUDIO = '-c:a aac -b:a 192k';
const COMMON_MUXER = '-movflags +faststart -use_editlist 0';

describe.skipIf(!canRun)('start_time=0 across all codec configs', () => {
  beforeAll(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  });

  // ── CPU codecs ──

  it('libx264 -preset fast -crf 18 -bf 0', () => {
    const out = path.join(OUT_DIR, 'libx264_fast.mp4');
    ffmpeg(`-y -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v libx264 -preset fast -crf 18 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'libx264/fast');
  }, 30000);

  it('libx264 -preset ultrafast -crf 23 -bf 0', () => {
    const out = path.join(OUT_DIR, 'libx264_ultrafast.mp4');
    ffmpeg(`-y -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v libx264 -preset ultrafast -crf 23 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'libx264/ultrafast');
  }, 30000);

  it('libx264 -preset medium -crf 18 -bf 0', () => {
    const out = path.join(OUT_DIR, 'libx264_medium.mp4');
    ffmpeg(`-y -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v libx264 -preset medium -crf 18 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'libx264/medium');
  }, 30000);

  it('libx264 -preset veryslow -crf 18 -bf 0', () => {
    const out = path.join(OUT_DIR, 'libx264_veryslow.mp4');
    ffmpeg(`-y -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v libx264 -preset veryslow -crf 18 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'libx264/veryslow');
  }, 120000);

  it('libx265 -preset fast -crf 23 -bf 0', () => {
    const out = path.join(OUT_DIR, 'libx265_fast.mp4');
    ffmpeg(`-y -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v libx265 -preset fast -crf 23 -bf 0 -tag:v hvc1 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'libx265/fast');
  }, 60000);

  it('libx265 -preset medium -crf 28 -bf 0', () => {
    const out = path.join(OUT_DIR, 'libx265_medium.mp4');
    ffmpeg(`-y -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v libx265 -preset medium -crf 28 -bf 0 -tag:v hvc1 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'libx265/medium');
  }, 60000);

  // ── NVIDIA GPU codecs ──

  it('h264_nvenc -preset p4 -cq 23 -bf 0', () => {
    const out = path.join(OUT_DIR, 'h264_nvenc_p4.mp4');
    ffmpeg(`-y -hwaccel cuda -hwaccel_device 0 -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v h264_nvenc -preset p4 -cq 23 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'h264_nvenc/p4');
  }, 30000);

  it('h264_nvenc -preset p1 -cq 18 -bf 0', () => {
    const out = path.join(OUT_DIR, 'h264_nvenc_p1.mp4');
    ffmpeg(`-y -hwaccel cuda -hwaccel_device 0 -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v h264_nvenc -preset p1 -cq 18 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'h264_nvenc/p1');
  }, 30000);

  it('h264_nvenc -preset p7 -cq 18 -bf 0', () => {
    const out = path.join(OUT_DIR, 'h264_nvenc_p7.mp4');
    ffmpeg(`-y -hwaccel cuda -hwaccel_device 0 -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v h264_nvenc -preset p7 -cq 18 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'h264_nvenc/p7');
  }, 30000);

  it('hevc_nvenc -preset p4 -cq 23 -bf 0', () => {
    const out = path.join(OUT_DIR, 'hevc_nvenc_p4.mp4');
    ffmpeg(`-y -hwaccel cuda -hwaccel_device 0 -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v hevc_nvenc -preset p4 -cq 23 -bf 0 -tag:v hvc1 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'hevc_nvenc/p4');
  }, 30000);

  it('hevc_nvenc -preset p7 -cq 18 -bf 0', () => {
    const out = path.join(OUT_DIR, 'hevc_nvenc_p7.mp4');
    ffmpeg(`-y -hwaccel cuda -hwaccel_device 0 -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v hevc_nvenc -preset p7 -cq 18 -bf 0 -tag:v hvc1 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'hevc_nvenc/p7');
  }, 30000);

  // ── Audio codec variations ──

  it('h264_nvenc + libopus audio', () => {
    const out = path.join(OUT_DIR, 'nvenc_opus.mp4');
    ffmpeg(`-y -hwaccel cuda -hwaccel_device 0 -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v h264_nvenc -preset p4 -cq 23 -bf 0 -c:a libopus -b:a 192k ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'nvenc/opus');
  }, 30000);

  it('libx264 + audio copy', () => {
    const out = path.join(OUT_DIR, 'x264_audiocopy.mp4');
    ffmpeg(`-y -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} -vf setpts=PTS-STARTPTS -c:v libx264 -preset fast -crf 18 -bf 0 -c:a copy ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'x264/audiocopy');
  }, 30000);

  // ── HW accel decode variations (same NVENC encode) ──

  it('d3d11va decode + h264_nvenc encode', () => {
    const out = path.join(OUT_DIR, 'nvenc_d3d11va.mp4');
    ffmpeg(`-y -hwaccel d3d11va -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v h264_nvenc -preset p4 -cq 23 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'nvenc/d3d11va');
  }, 30000);

  it('no hwaccel + h264_nvenc encode', () => {
    const out = path.join(OUT_DIR, 'nvenc_nohwaccel.mp4');
    ffmpeg(`-y -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v h264_nvenc -preset p4 -cq 23 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'nvenc/no-hwaccel');
  }, 30000);

  // ── Different CRF/CQ values ──

  it('h264_nvenc -cq 51 (lowest quality)', () => {
    const out = path.join(OUT_DIR, 'nvenc_cq51.mp4');
    ffmpeg(`-y -hwaccel cuda -hwaccel_device 0 -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v h264_nvenc -preset p4 -cq 51 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'nvenc/cq51');
  }, 30000);

  it('libx264 -crf 51 (lowest quality)', () => {
    const out = path.join(OUT_DIR, 'x264_crf51.mp4');
    ffmpeg(`-y -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v libx264 -preset fast -crf 51 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'x264/crf51');
  }, 30000);

  // ── Different ss offsets (the root cause was offset-dependent) ──

  it('h264_nvenc with ssOffset=0.891 (the offset that worked before)', () => {
    const out = path.join(OUT_DIR, 'nvenc_ss0891.mp4');
    ffmpeg(`-y -hwaccel cuda -hwaccel_device 0 -i "${CONCAT_TS}" -ss 0.891 -t 5 ${COMMON_FILTERS} -c:v h264_nvenc -preset p4 -cq 23 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'nvenc/ss0.891');
  }, 30000);

  it('h264_nvenc with ssOffset=0.5', () => {
    const out = path.join(OUT_DIR, 'nvenc_ss05.mp4');
    ffmpeg(`-y -hwaccel cuda -hwaccel_device 0 -i "${CONCAT_TS}" -ss 0.5 -t 5 ${COMMON_FILTERS} -c:v h264_nvenc -preset p4 -cq 23 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'nvenc/ss0.5');
  }, 30000);

  it('h264_nvenc with ssOffset=3.333', () => {
    const out = path.join(OUT_DIR, 'nvenc_ss3333.mp4');
    ffmpeg(`-y -hwaccel cuda -hwaccel_device 0 -i "${CONCAT_TS}" -ss 3.333 -t 5 ${COMMON_FILTERS} -c:v h264_nvenc -preset p4 -cq 23 -bf 0 ${COMMON_AUDIO} ${COMMON_MUXER} "${out}"`);
    assertZeroStart(out, 'nvenc/ss3.333');
  }, 30000);

  // ── WITHOUT the fix (control group — should fail) ──

  it('CONTROL: h264_nvenc WITHOUT -bf 0 / -use_editlist 0 should have non-zero start', () => {
    const out = path.join(OUT_DIR, 'control_no_fix.mp4');
    ffmpeg(`-y -hwaccel cuda -hwaccel_device 0 -i "${CONCAT_TS}" -ss ${SS_OFFSET} -t ${DURATION} ${COMMON_FILTERS} -c:v h264_nvenc -preset p4 -cq 23 ${COMMON_AUDIO} -movflags +faststart "${out}"`);
    const times = getStartTimes(out);
    // This SHOULD have non-zero start_time — proving the fix is necessary
    expect(times.video.start_time, 'control: video should be non-zero without fix').toBeGreaterThan(0.01);
  }, 30000);
});
