// Resolves whisper binary and model paths:
//   - Packaged app: uses bundled binaries from resources/whisper/
//   - Dev mode: falls back to local resources/whisper/ or system PATH
//
// Directory layout:
//   resources/whisper/
//     cpp/              — whisper.cpp CUDA build + tiny model
//       whisper-cli.exe
//       ggml-tiny.en.bin
//       *.dll
//     faster/           — faster-whisper Python backend + medium model
//       transcribe.py
//       model.bin

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function getWhisperDir() {
  try {
    const { app } = require('electron');
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'whisper');
    }
  } catch (_) {
    // Not in Electron context
  }
  // Dev: check for a local resources/whisper folder relative to project root
  const devDir = path.join(__dirname, '..', '..', 'resources', 'whisper');
  if (fs.existsSync(devDir)) return devDir;
  return null;
}

/* ── whisper.cpp (GPU) ─────────────────────────────────────────── */

function getWhisperPath() {
  const dir = getWhisperDir();
  if (dir) {
    const cli = path.join(dir, 'cpp', 'whisper-cli.exe');
    if (fs.existsSync(cli)) return cli;
    // Legacy fallback (flat layout)
    const legacy = path.join(dir, 'whisper-cli.exe');
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
  // Prefer py launcher which can target specific versions
  try {
    execFileSync('py', ['-3.10', '--version'], { stdio: 'pipe', timeout: 5000 });
    return { cmd: 'py', args: ['-3.10'] };
  } catch (_) {}
  // Fall back to plain python
  try {
    execFileSync('python', ['--version'], { stdio: 'pipe', timeout: 5000 });
    return { cmd: 'python', args: [] };
  } catch (_) {}
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
