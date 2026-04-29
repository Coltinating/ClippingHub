// Resolves whisper binary and model paths:
//   - Packaged app: uses bundled binaries from resources/whisper/
//   - Dev mode: prefers resources/whisper/, then build/whisper/<platform>/
//
// Directory layout:
//   resources/whisper/
//     cpp/              — whisper.cpp build (CUDA on Windows, Metal on macOS, CPU/Vulkan on Linux)
//       whisper-cli[.exe]
//       ggml-tiny.en.bin
//       *.dll / *.dylib / *.so
//     faster/           — faster-whisper Python backend + medium model
//       transcribe.py
//       model.bin
//
// Cross-platform: binary is `whisper-cli.exe` on Windows, `whisper-cli` elsewhere.

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { BIN_EXT, IS_WIN, platformDir } = require('./platform');

const WHISPER_BIN = 'whisper-cli' + BIN_EXT;

function getWhisperDir() {
  try {
    const { app } = require('electron');
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'whisper');
    }
  } catch (_) {
    // Not in Electron context
  }
  // Dev: prefer resources/whisper folder relative to project root
  const projectRoot = path.join(__dirname, '..', '..');
  const devResources = path.join(projectRoot, 'resources', 'whisper');
  if (fs.existsSync(devResources)) return devResources;

  // Fall back to per-platform build directory
  const platDir = path.join(projectRoot, 'build', 'whisper', platformDir());
  if (fs.existsSync(platDir)) return platDir;

  return null;
}

/* ── whisper.cpp (GPU) ─────────────────────────────────────────── */

function getWhisperPath() {
  const dir = getWhisperDir();
  if (dir) {
    const cli = path.join(dir, 'cpp', WHISPER_BIN);
    if (fs.existsSync(cli)) return cli;
    // Legacy fallback (flat layout)
    const legacy = path.join(dir, WHISPER_BIN);
    if (fs.existsSync(legacy)) return legacy;
  }
  return 'whisper-cli'; // fall back to system PATH
}

function getWhisperModelPath() {
  const dir = getWhisperDir();
  if (dir) {
    const p = path.join(dir, 'cpp', 'ggml-tiny.en.bin');
    if (fs.existsSync(p)) return p;
    // Legacy fallback
    const flat = path.join(dir, 'ggml-tiny.en.bin');
    if (fs.existsSync(flat)) return flat;
  }
  return null;
}

function isWhisperAvailable() {
  const bin = getWhisperPath();
  const model = getWhisperModelPath();
  if (bin === 'whisper-cli') return false; // no bundled binary
  return !!model;
}

/* ── faster-whisper (Python) ───────────────────────────────────── */

let _fasterWhisperAvail = null; // cached result

function getTranscribeScript() {
  const dir = getWhisperDir();
  if (!dir) return null;
  const p = path.join(dir, 'faster', 'transcribe.py');
  if (fs.existsSync(p)) return p;
  // Legacy fallback
  const flat = path.join(dir, 'transcribe.py');
  return fs.existsSync(flat) ? flat : null;
}

function getFasterModelPath() {
  const dir = getWhisperDir();
  if (!dir) return null;
  const p = path.join(dir, 'faster', 'model.bin');
  return fs.existsSync(p) ? p : null;
}

function getPythonPath() {
  // Windows: prefer the `py` launcher, which can target specific versions.
  if (IS_WIN) {
    try {
      execFileSync('py', ['-3.10', '--version'], { stdio: 'pipe', timeout: 5000 });
      return { cmd: 'py', args: ['-3.10'] };
    } catch (_) {}
  }
  // macOS/Linux (and Windows fallback): try python3 first, then python.
  for (const cmd of ['python3', 'python']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'pipe', timeout: 5000 });
      return { cmd, args: [] };
    } catch (_) {}
  }
  return null;
}

function isFasterWhisperAvailable() {
  if (_fasterWhisperAvail !== null) return _fasterWhisperAvail;
  const script = getTranscribeScript();
  if (!script) { _fasterWhisperAvail = false; return false; }
  const py = getPythonPath();
  if (!py) { _fasterWhisperAvail = false; return false; }
  try {
    execFileSync(py.cmd, [...py.args, '-c', 'import faster_whisper'], { stdio: 'pipe', timeout: 10000 });
    _fasterWhisperAvail = true;
  } catch (_) {
    _fasterWhisperAvail = false;
  }
  return _fasterWhisperAvail;
}

module.exports = {
  getWhisperPath, getWhisperModelPath, getWhisperDir, isWhisperAvailable,
  getTranscribeScript, getFasterModelPath, getPythonPath, isFasterWhisperAvailable,
};
