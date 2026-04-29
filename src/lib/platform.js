// Cross-platform helpers — single source of truth for OS detection.
// Use these instead of inlining `process.platform === 'win32'` / `.exe`
// suffixes / Windows-specific env vars elsewhere in the codebase.

'use strict';

const path = require('path');
const os = require('os');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

const BIN_EXT = IS_WIN ? '.exe' : '';

// Returns the OS-specific config root used outside the Electron main process.
// Inside main.js prefer `app.getPath('userData')` directly — it already does
// the right thing per OS and namespaces by appId.
function userConfigRoot() {
  if (IS_WIN)  return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (IS_MAC)  return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

// Default system fonts directory, used by the watermark drawtext filter.
function fontsDir() {
  if (IS_WIN)  return path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'Fonts');
  if (IS_MAC)  return '/Library/Fonts';
  return '/usr/share/fonts';
}

// Short string used to namespace per-platform bundled binaries (build/<platformDir>/...)
function platformDir() {
  if (IS_WIN)  return 'win32';
  if (IS_MAC)  return 'darwin';
  return 'linux';
}

module.exports = {
  IS_WIN, IS_MAC, IS_LINUX,
  BIN_EXT,
  userConfigRoot,
  fontsDir,
  platformDir,
};
