// Resolves ffmpeg/ffprobe paths:
//   - Packaged app: uses bundled binaries from resources/ffmpeg/
//   - Dev mode: prefers build/ffmpeg/<platform>/ then build/ffmpeg/ flat layout
//   - Otherwise falls back to system PATH
//
// Cross-platform:
//   - Windows: ffmpeg.exe / ffprobe.exe
//   - macOS / Linux: ffmpeg / ffprobe (no extension)

const path = require('path');
const fs = require('fs');
const { BIN_EXT, platformDir } = require('./platform');

const FFMPEG_BIN  = 'ffmpeg'  + BIN_EXT;
const FFPROBE_BIN = 'ffprobe' + BIN_EXT;

function getFfmpegDir() {
  // Packaged Electron app
  try {
    const { app } = require('electron');
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'ffmpeg');
    }
  } catch (_) {
    // Not in Electron context (e.g. unit tests) — fall through
  }

  // Dev mode: prefer per-platform subdir, fall back to flat layout
  const projectRoot = path.join(__dirname, '..', '..');
  const platSpecific = path.join(projectRoot, 'build', 'ffmpeg', platformDir());
  if (fs.existsSync(path.join(platSpecific, FFMPEG_BIN))) return platSpecific;

  const flat = path.join(projectRoot, 'build', 'ffmpeg');
  if (fs.existsSync(path.join(flat, FFMPEG_BIN))) return flat;

  return null;
}

function getFfmpegPath() {
  const dir = getFfmpegDir();
  return dir ? path.join(dir, FFMPEG_BIN) : 'ffmpeg';
}

function getFfprobePath() {
  const dir = getFfmpegDir();
  return dir ? path.join(dir, FFPROBE_BIN) : 'ffprobe';
}

module.exports = { getFfmpegPath, getFfprobePath };
