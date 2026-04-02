// Resolves ffmpeg/ffprobe paths:
//   - Packaged app: uses bundled binaries from resources/ffmpeg/
//   - Dev mode / tests: falls back to system PATH

const path = require('path');

function getFfmpegDir() {
  try {
    const { app } = require('electron');
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'ffmpeg');
    }
  } catch (_) {
    // Not in Electron context (e.g. unit tests) — fall through to PATH
  }
  return null;
}

function getFfmpegPath() {
  const dir = getFfmpegDir();
  return dir ? path.join(dir, 'ffmpeg.exe') : 'ffmpeg';
}

function getFfprobePath() {
  const dir = getFfmpegDir();
  return dir ? path.join(dir, 'ffprobe.exe') : 'ffprobe';
}

module.exports = { getFfmpegPath, getFfprobePath };
