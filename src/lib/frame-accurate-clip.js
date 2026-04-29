// ─────────────────────────────────────────────────────────────
// Frame-accurate clipping (EXPERIMENTAL — gated by
// userConfig.devFeatures.frameAccurateClipping).
//
// The default trim path (`buildTrimArgs` in ffmpeg-args.js) uses
// output-seek + re-encode, which is already frame-accurate to the
// requested time *if* the encoder is well-behaved. This module
// explores stricter alternatives that:
//
//   1. Combine fast input-seek (to nearest preceding keyframe) with
//      a small output-seek delta — same accuracy, much less decoded
//      pre-roll on long files.
//   2. Force CFR output (`-fps_mode cfr`) so concatenated clips don't
//      drift on assembly.
//   3. Optionally emit an all-I-frame intermediate (`opts.allIntra`)
//      so any downstream cut is precise even with stream copy.
//
// These args are NOT used by the production pipeline. The dev flag
// exists so future code can opt-in conditionally; until that wiring
// happens, this module is exercised only by its unit tests.
// ─────────────────────────────────────────────────────────────

/**
 * Pick a fast-seek anchor that is at most `keyframeIntervalSec` before
 * the requested ssOffset, leaving a small (sub-keyframe) delta for the
 * accurate output-seek. Clamps to 0.
 *
 * @param {number} ssOffset            requested clip start (seconds)
 * @param {number} keyframeIntervalSec assumed GOP length (default 2s)
 * @returns {{ fastSeek: number, delta: number }}
 */
function splitSeek(ssOffset, keyframeIntervalSec) {
  const gop = (keyframeIntervalSec > 0) ? keyframeIntervalSec : 2;
  const fastSeek = Math.max(0, Math.floor(ssOffset / gop) * gop);
  const delta = Math.max(0, ssOffset - fastSeek);
  return { fastSeek, delta };
}

/**
 * Build frame-accurate trim args using combined seek (fast + slow).
 * Mirrors the default trim's encoder choices but:
 *   - inserts a fast input-seek before -i to skip ahead to the
 *     nearest preceding keyframe before decoding,
 *   - uses -fps_mode cfr to enforce constant frame-rate output,
 *   - sets -avoid_negative_ts make_zero on the output side so
 *     downstream concat does not see negative timestamps.
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} ssOffset
 * @param {number} duration
 * @param {Object} [opts]
 * @param {number} [opts.keyframeIntervalSec=2]  Assumed GOP length for the fast-seek anchor.
 * @param {boolean} [opts.allIntra=false]        Emit all-I-frame output (-g 1) — bigger files, but any later cut is exact.
 * @param {string}  [opts.videoCodec='libx264']
 * @param {string}  [opts.preset='fast']
 * @param {string|number} [opts.crf=18]
 * @param {string}  [opts.audioCodec='aac']
 * @param {string}  [opts.audioBitrate='192k']
 * @returns {string[]}
 */
function buildFrameAccurateTrimArgs(inputPath, outputPath, ssOffset, duration, opts) {
  const o = opts || {};
  const { fastSeek, delta } = splitSeek(ssOffset, o.keyframeIntervalSec);
  const videoCodec = o.videoCodec || 'libx264';
  const preset     = o.preset     || 'fast';
  const crf        = (o.crf != null ? o.crf : 18);
  const audioCodec = o.audioCodec || 'aac';
  const audioBitrate = o.audioBitrate || '192k';

  const args = ['-y'];

  // Fast input-seek (pre-input -ss): jumps to nearest preceding keyframe
  // without decoding everything before it. Skipped at offset 0.
  if (fastSeek > 0) args.push('-ss', String(fastSeek));

  args.push('-i', inputPath);

  // Slow output-seek for sub-keyframe accuracy. Always present (even if 0)
  // so the arg shape is uniform and easy to assert in tests.
  args.push('-ss', String(delta));

  args.push(
    '-t', String(duration),
    '-vf', 'setpts=PTS-STARTPTS',
    '-af', 'asetpts=PTS-STARTPTS',
    '-fps_mode', 'cfr',
    '-avoid_negative_ts', 'make_zero',
    '-c:v', videoCodec, '-preset', preset, '-crf', String(crf), '-bf', '0'
  );

  // All-I-frame intermediate: every output frame is a keyframe. Future
  // cuts on the result can use stream copy and still land on a frame.
  if (o.allIntra) {
    args.push('-g', '1', '-keyint_min', '1');
  }

  args.push(
    '-c:a', audioCodec, '-b:a', audioBitrate,
    '-movflags', '+faststart', '-use_editlist', '0',
    outputPath
  );

  return args;
}

/**
 * Decide whether a given userConfig opts the user into the experimental
 * pipeline. Production code MUST funnel through this so the default
 * (flag absent or false) keeps the standard trim path.
 *
 * @param {object} userConfig
 * @returns {boolean}
 */
function isFrameAccurateEnabled(userConfig) {
  return !!(userConfig && userConfig.devFeatures && userConfig.devFeatures.frameAccurateClipping);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    splitSeek,
    buildFrameAccurateTrimArgs,
    isFrameAccurateEnabled,
  };
}
