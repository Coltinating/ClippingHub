const { app, BrowserWindow, ipcMain, nativeImage, shell, dialog, session, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { URL } = require('url');
const express = require('express');
const http = require('http');
const https = require('https');
const {
  sanitizeLayoutKey,
  ensureDefaultLayouts,
  saveLayoutFile,
  deleteLayoutFile,
  listLayoutFiles
} = require('./src/lib/layout-config');

// ── FFmpeg Path Resolver ────────────────────────────────────────
const { getFfmpegPath, getFfprobePath } = require('./src/lib/ffmpeg-path');

// ── Whisper Path Resolver ───────────────────────────────────────
const { getWhisperPath, getWhisperModelPath, isWhisperAvailable,
        getTranscribeScript, getPythonPath, isFasterWhisperAvailable } = require('./src/lib/whisper-path');

// ── Cross-Platform Helpers ──────────────────────────────────────
const platformHelpers = require('./src/lib/platform');

// ── Auto-Updater ────────────────────────────────────────────────
const { autoUpdater } = require('electron-updater');

// ── Batch Testing (dev) ─────────────────────────────────────────
const { registerBatchIPC } = require('./src/batch/batch-ipc');

// ── Debug Logger ─────────────────────────────────────────────────
const DEBUG_DIR = path.join(platformHelpers.userConfigRoot(), 'ClippingHub', 'logs');
let debugLogStream = null;
let debugSessionId = null;
let playerLogStream = null;

// Video Player dedicated log directory
const PLAYER_LOG_DIR = path.join(DEBUG_DIR, 'VideoPlayerLogs');

function initDebugLog() {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  fs.mkdirSync(PLAYER_LOG_DIR, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  debugSessionId = stamp;
  const logPath = path.join(DEBUG_DIR, `session_${stamp}.log`);
  debugLogStream = fs.createWriteStream(logPath, { flags: 'a' });
  const playerLogPath = path.join(PLAYER_LOG_DIR, `player_${stamp}.log`);
  playerLogStream = fs.createWriteStream(playerLogPath, { flags: 'a' });
  debugLog('SESSION', `Started — pid=${process.pid} electron=${process.versions.electron} node=${process.versions.node}`);
  debugLog('SESSION', `Log file: ${logPath}`);
  debugLog('SESSION', `Player log file: ${playerLogPath}`);
}

// Sanitize paths and identifiers from log output (cross-platform).
const _userDir = require('os').homedir();
const _userDirRegex = new RegExp(_userDir.replace(/[\\\/]/g, '[\\\\/\\\\\\\\]'), 'gi');
const _usernameRegex = new RegExp('(?<=[\\\\/\\\\\\\\])' + path.basename(_userDir) + '(?=[\\\\/\\\\\\\\])', 'gi');
// COMPUTERNAME is Windows-only; fall back to os.hostname() on macOS/Linux.
const _hostName = process.env.COMPUTERNAME || (() => { try { return require('os').hostname(); } catch (_) { return null; } })();
const _computerNameRegex = _hostName
  ? new RegExp(_hostName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  : null;
// Use a path placeholder that matches the current OS layout so the sanitized
// string still resembles a real path (helps when grep'ing logs).
const _anonUserPath = process.platform === 'win32'
  ? 'C:\\Users\\ANON'
  : (process.platform === 'darwin' ? '/Users/ANON' : '/home/ANON');

function sanitize(str) {
  if (typeof str !== 'string') return str;
  let s = str.replace(_userDirRegex, _anonUserPath);
  s = s.replace(_usernameRegex, 'ANON');
  if (_computerNameRegex) s = s.replace(_computerNameRegex, 'ANON-PC');
  return s;
}

function sanitizeData(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitize(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeData);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = sanitizeData(v);
    return out;
  }
  return obj;
}

// Categories that are routed to the VideoPlayerLogs dedicated log
const PLAYER_LOG_CATEGORIES = new Set([
  'PLAYER', 'PLAYER:INIT', 'PLAYER:STATE',
  'PLAYER:STREAM', 'PLAYER:LIVE', 'PLAYER:CONTROLS',
  'PLAYER:TIMELINE', 'PLAYER:PREVIEW', 'PLAYER:KEYBIND',
  'PLAYER:EVENT', 'PLAYER:HLS', 'PLAYER:ERROR',
]);

function isPlayerLog(category) {
  return PLAYER_LOG_CATEGORIES.has(category) || (typeof category === 'string' && category.startsWith('PLAYER'));
}

function debugLog(category, message, data) {
  const ts = new Date().toISOString();
  const safeMessage = sanitize(message);
  const safeData = sanitizeData(data);
  const entry = { ts, category, message: safeMessage, data: safeData };
  const line = safeData !== undefined
    ? `[${ts}] [${category}] ${safeMessage} ${JSON.stringify(safeData)}`
    : `[${ts}] [${category}] ${safeMessage}`;
  // Always write to main session log
  if (debugLogStream) debugLogStream.write(line + '\n');
  console.log(line);
  // Also write player-related entries to dedicated VideoPlayerLogs
  if (playerLogStream && isPlayerLog(category)) {
    playerLogStream.write(line + '\n');
  }
  // Buffer for debug window replay
  debugLogBuffer.push(entry);
  if (debugLogBuffer.length > DEBUG_BUFFER_MAX) debugLogBuffer.shift();
  // Forward to debug window if open
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.webContents.send('debug-log', entry);
  }
}

// ── State ───────────────────────────────────────────────────────
let mainWindow = null;
let navWindow = null;
let debugWindow = null;
let proxyPort = null;
let clipsDir = null;
let debugLogBuffer = [];  // Buffer logs before debug window opens
const DEBUG_BUFFER_MAX = 5000;

// Per-clip ffmpeg log storage (clipName → { commands, logs })
const clipFfmpegLogs = new Map();

// ── Proxy helpers (used by download-clip and preview-watermark) ──
function toProxyUrl(url) {
  const base = `http://127.0.0.1:${proxyPort}`;
  if (!url.startsWith('http')) return base + url;
  if (url.startsWith(base)) return url;
  return `${base}/proxy?url=${encodeURIComponent(url)}`;
}

function proxyFetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(toProxyUrl(url), res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function proxyFetchBuffer(url) {
  return new Promise((resolve, reject) => {
    http.get(toProxyUrl(url), res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function resolveMediaUrl(url, pickLowest = false) {
  const text = await proxyFetchText(url);
  if (!text.includes('#EXT-X-STREAM-INF')) return { url, text };
  const lines = text.split('\n');
  let bestBw = pickLowest ? Infinity : -1;
  let bestUrl = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
      const bw = parseInt(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || '0');
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith('#')) {
        if (pickLowest ? bw < bestBw : bw > bestBw) { bestBw = bw; bestUrl = next; }
      }
    }
  }
  if (!bestUrl) throw new Error('No variant stream found in master playlist');
  const base = `http://127.0.0.1:${proxyPort}`;
  const mediaUrl = bestUrl.startsWith('http') ? bestUrl : base + bestUrl;
  const mediaText = await proxyFetchText(mediaUrl);
  return { url: mediaUrl, text: mediaText };
}

// Active download process registry (clipName → { proc, phase, cancelled })
const activeDownloads = new Map();

// Detachable hub window
let hubWindow = null;
// Detached post caption window
let postCaptionWindow = null;
let lastPostCaptionOpenContext = null;

// Broadcast progress to main window + hub window
function broadcastProgress(clipName, progress) {
  const data = { clipName, progress };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('clip-progress', data);
  if (hubWindow && !hubWindow.isDestroyed()) hubWindow.webContents.send('clip-progress', data);
}

// ── Config paths (per-OS user config root) ──────────────────────
// Windows: %APPDATA%\ClippingHub
// macOS:   ~/Library/Application Support/ClippingHub
// Linux:   ~/.config/ClippingHub
const CONFIG_DIR = path.join(platformHelpers.userConfigRoot(), 'ClippingHub');
const USER_CONFIG_PATH = path.join(CONFIG_DIR, 'user_config.json');
const WATERMARK_CONFIG_PATH = path.join(CONFIG_DIR, 'watermark_config.json');
const CHANNEL_CONFIG_PATH = path.join(CONFIG_DIR, 'channel_config.json');
const SERVER_CONFIG_PATH = path.join(CONFIG_DIR, 'server_config.json');
const PANEL_LAYOUTS_DIR = path.join(CONFIG_DIR, 'panel_layouts');
const PANEL_LAYOUT_STATE_PATH = path.join(CONFIG_DIR, 'panel_layout_state.json');
const PANEL_CURRENT_LAYOUT_PATH = path.join(CONFIG_DIR, 'panel_current_layout.json');
const BUNDLED_LAYOUTS_DIR = path.join(__dirname, 'layouts');
const DEFAULT_WORKSPACE_KEYS = ['minimal', 'collaboration', 'watch'];
const DEFAULT_WORKSPACE_SET = new Set(DEFAULT_WORKSPACE_KEYS);
const DEFAULTS_VERSION = 2;
const RETIRED_DEFAULT_KEYS = ['default', 'editing'];

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function loadServerConfig() {
  try { return JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, 'utf-8')); }
  catch { return { url: 'ws://localhost:3535/ws', autoConnect: false }; }
}

function saveServerConfig(cfg) {
  ensureConfigDir();
  fs.writeFileSync(SERVER_CONFIG_PATH, JSON.stringify(cfg || {}, null, 2));
  return cfg;
}

function loadBundledDefaultLayouts() {
  const out = {};
  for (let i = 0; i < DEFAULT_WORKSPACE_KEYS.length; i++) {
    const key = DEFAULT_WORKSPACE_KEYS[i];
    const filePath = path.join(BUNDLED_LAYOUTS_DIR, `${key}.json`);
    try {
      if (!fs.existsSync(filePath)) continue;
      const layout = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (layout && layout.tree) out[key] = layout;
    } catch {}
  }
  return out;
}

function loadPanelLayoutState() {
  try {
    if (!fs.existsSync(PANEL_LAYOUT_STATE_PATH)) {
      return { version: 1, defaultsVersion: DEFAULTS_VERSION, activeWorkspace: 'minimal' };
    }
    const parsed = JSON.parse(fs.readFileSync(PANEL_LAYOUT_STATE_PATH, 'utf-8'));
    return {
      version: Number(parsed && parsed.version) || 1,
      defaultsVersion: Number(parsed && parsed.defaultsVersion) || 1,
      activeWorkspace: sanitizeLayoutKey(parsed && parsed.activeWorkspace ? parsed.activeWorkspace : 'minimal')
    };
  } catch {
    return { version: 1, defaultsVersion: DEFAULTS_VERSION, activeWorkspace: 'minimal' };
  }
}

function savePanelLayoutState(state) {
  ensureConfigDir();
  const next = {
    version: 1,
    defaultsVersion: Number(state && state.defaultsVersion) || DEFAULTS_VERSION,
    activeWorkspace: sanitizeLayoutKey(state && state.activeWorkspace ? state.activeWorkspace : 'minimal')
  };
  fs.writeFileSync(PANEL_LAYOUT_STATE_PATH, JSON.stringify(next, null, 2));
  return next;
}

function loadPanelCurrentLayout() {
  try {
    if (!fs.existsSync(PANEL_CURRENT_LAYOUT_PATH)) return null;
    return JSON.parse(fs.readFileSync(PANEL_CURRENT_LAYOUT_PATH, 'utf-8'));
  } catch { return null; }
}

function savePanelCurrentLayout(layout) {
  ensureConfigDir();
  fs.writeFileSync(PANEL_CURRENT_LAYOUT_PATH, JSON.stringify(layout || {}, null, 2));
  return true;
}

function clearPanelCurrentLayout() {
  try { if (fs.existsSync(PANEL_CURRENT_LAYOUT_PATH)) fs.unlinkSync(PANEL_CURRENT_LAYOUT_PATH); }
  catch {}
}

function migrateRetiredDefaults() {
  for (let i = 0; i < RETIRED_DEFAULT_KEYS.length; i++) {
    const stale = path.join(PANEL_LAYOUTS_DIR, `${RETIRED_DEFAULT_KEYS[i]}.json`);
    try { if (fs.existsSync(stale)) fs.unlinkSync(stale); } catch {}
  }
  for (let j = 0; j < DEFAULT_WORKSPACE_KEYS.length; j++) {
    const overwrite = path.join(PANEL_LAYOUTS_DIR, `${DEFAULT_WORKSPACE_KEYS[j]}.json`);
    try { if (fs.existsSync(overwrite)) fs.unlinkSync(overwrite); } catch {}
  }
}

function ensurePanelLayoutConfig() {
  ensureConfigDir();
  fs.mkdirSync(PANEL_LAYOUTS_DIR, { recursive: true });

  const state = loadPanelLayoutState();
  if (!state.defaultsVersion || state.defaultsVersion < DEFAULTS_VERSION) {
    migrateRetiredDefaults();
    clearPanelCurrentLayout();
    let nextActive = state.activeWorkspace;
    if (RETIRED_DEFAULT_KEYS.indexOf(nextActive) !== -1 || nextActive === 'default') {
      nextActive = 'minimal';
    }
    savePanelLayoutState({ activeWorkspace: nextActive, defaultsVersion: DEFAULTS_VERSION });
  }

  const defaults = loadBundledDefaultLayouts();
  ensureDefaultLayouts(PANEL_LAYOUTS_DIR, defaults);
  if (!fs.existsSync(PANEL_LAYOUT_STATE_PATH)) {
    savePanelLayoutState({ activeWorkspace: 'minimal', defaultsVersion: DEFAULTS_VERSION });
  }
}

// ── Session partition ────────────────────────────────────────────
const PARTITION = 'persist:rumble';

// ── Express app ──────────────────────────────────────────────────
const expressApp = express();
expressApp.use(express.json());

// ── CORS proxy ──────────────────────────────────────────────────
expressApp.get('/proxy', async (req, res) => {
  const target = req.query.url;
  debugLog('PROXY', 'Request', { url: target ? target.slice(0, 120) : '(no url)' });
  if (!target) return res.status(400).send('Missing url');

  let parsed;
  try { parsed = new URL(target); } catch { return res.status(400).send('Invalid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).send('Bad protocol');

  try {
    const ses = session.fromPartition(PARTITION);
    const response = await ses.fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://rumble.com/',
        'Origin': 'https://rumble.com',
      }
    });

    const ct = response.headers.get('content-type') || 'application/octet-stream';
    debugLog('PROXY', `Response status=${response.status} ct=${ct}`);
    res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(response.status);

    if (ct.includes('mpegurl') || target.includes('.m3u8')) {
      let body = await response.text();
      body = body.replace(/^(?!#)(.+)$/gm, (line) => {
        line = line.trim();
        if (!line || line.startsWith('#')) return line;
        const abs = line.startsWith('http') ? line : new URL(line, target).href;
        return '/proxy?url=' + encodeURIComponent(abs);
      });
      res.end(body);
    } else {
      const buf = await response.arrayBuffer();
      res.end(Buffer.from(buf));
    }
  } catch (err) {
    debugLog('PROXY', 'Error', { error: err.message });
    if (!res.headersSent) res.status(502).send('Proxy error: ' + err.message);
  }
});

// Serve renderer static files
expressApp.use(express.static(path.join(__dirname, 'src')));

// ── IPC: extract m3u8 ────────────────────────────────────────────
ipcMain.handle('extract-m3u8', (event, { pageUrl }) => {
  return new Promise((resolve, reject) => {
    const ses = session.fromPartition(PARTITION);

    const hidden = new BrowserWindow({
      width: 1280, height: 720,
      show: false,
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false }
    });

    let found = null;
    let timer = null;

    const filter = { urls: ['*://*/*.m3u8*'] };

    function onCompleted(details) {
      if (!found && details.statusCode >= 200 && details.statusCode < 400) {
        found = details.url;
        cleanup();
        resolve({ m3u8: found, isLive: !found.includes('hls-vod') });
      }
    }

    function cleanup() {
      clearTimeout(timer);
      ses.webRequest.onCompleted(filter, null);
      try { hidden.close(); } catch {}
    }

    ses.webRequest.onCompleted(filter, onCompleted);

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('No stream found in 25s. Try Browse Streams to navigate manually.'));
    }, 25000);

    hidden.webContents.on('did-fail-load', (ev, code, desc) => {
      if (!found) { cleanup(); reject(new Error('Page load failed: ' + desc)); }
    });

    hidden.webContents.on('did-finish-load', () => {
      if (found) return;
      setTimeout(() => {
        if (found || hidden.isDestroyed()) return;
        hidden.webContents.executeJavaScript(`
          var v = document.querySelector('video');
          if (v) { v.muted = true; v.play && v.play().catch(function(){}); }
          var btn = document.querySelector('[class*="play"], [class*="Play"], .big-play-button');
          if (btn) btn.click();
        `).catch(() => {});
      }, 2000);
    });

    hidden.loadURL(pageUrl, {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    });
  });
});

// ── IPC: Stream navigator ────────────────────────────────────────
ipcMain.handle('open-navigator', (event, { url } = {}) => {
  if (navWindow && !navWindow.isDestroyed()) {
    navWindow.focus();
    if (url) navWindow.loadURL(url);
    return { opened: true };
  }

  const ses = session.fromPartition(PARTITION);

  navWindow = new BrowserWindow({
    width: 1100, height: 760,
    title: 'Browse Streams — Clipper Hub',
    backgroundColor: '#0f0f10',
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  navWindow.setMenuBarVisibility(false);

  const filter = { urls: ['*://*/*.m3u8*'] };

  ses.webRequest.onCompleted(filter, (details) => {
    if (details.statusCode >= 200 && details.statusCode < 400) {
      const m3u8 = details.url;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stream-found', {
          m3u8,
          isLive: !m3u8.includes('hls-vod'),
          source: 'navigator'
        });
        mainWindow.focus();
      }
    }
  });

  navWindow.webContents.on('did-finish-load', () => {
    navWindow.webContents.insertCSS(`
      #ch-bar { position:fixed;top:0;left:0;right:0;z-index:2147483647;
        background:#18181c;border-bottom:2px solid #7b61ff;
        padding:7px 16px;display:flex;align-items:center;gap:10px;
        font-family:system-ui,sans-serif;font-size:12px;color:#d4cfc8; }
      #ch-bar b { color:#a78bfa; }
      body { margin-top:36px !important; }
    `).catch(() => {});
    navWindow.webContents.executeJavaScript(`
      if (!document.getElementById('ch-bar')) {
        var el = document.createElement('div');
        el.id = 'ch-bar';
        el.innerHTML = '<b>Clipper Hub</b> — Navigate to any video or live stream. It auto-loads when the video plays.';
        document.body.prepend(el);
      }
    `).catch(() => {});
  });

  navWindow.loadURL(url || 'https://rumble.com', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });

  navWindow.on('closed', () => {
    ses.webRequest.onCompleted(filter, null);
    navWindow = null;
  });

  return { opened: true };
});

ipcMain.handle('close-navigator', () => {
  if (navWindow && !navWindow.isDestroyed()) navWindow.close();
  navWindow = null;
});

// ── IPC: channel config ─────────────────────────────────────────
ipcMain.handle('get-channel-config', () => {
  try {
    if (fs.existsSync(CHANNEL_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CHANNEL_CONFIG_PATH, 'utf-8'));
    }
    const configPath = path.join(__dirname, 'channel.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return { channel_id: '' };
  }
});

// ── IPC: debug ──────────────────────────────────────────────────
ipcMain.handle('get-debug-log-path', () => DEBUG_DIR);
ipcMain.handle('open-debug-logs', () => {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  shell.openPath(DEBUG_DIR);
});
ipcMain.on('renderer-debug-log', (_, { category, message, data }) => {
  debugLog(category, message, data);
});

// Open / toggle debug window
ipcMain.handle('open-debug-window', () => {
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.focus();
    return { opened: true };
  }

  debugWindow = new BrowserWindow({
    width: 820, height: 520,
    minWidth: 520, minHeight: 300,
    backgroundColor: '#0a0a0a',
    title: 'Debug Log — Clipper Hub',
    webPreferences: {
      preload: path.join(__dirname, 'preload-debug.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  debugWindow.setMenuBarVisibility(false);
  debugWindow.loadFile(path.join(__dirname, 'src', 'debug.html'));

  // Replay buffered logs once the window is ready
  debugWindow.webContents.on('did-finish-load', () => {
    for (const entry of debugLogBuffer) {
      if (debugWindow && !debugWindow.isDestroyed()) {
        debugWindow.webContents.send('debug-log', entry);
      }
    }
  });

  debugWindow.on('closed', () => { debugWindow = null; });
  return { opened: true };
});

// Open debug window with clip-specific ffmpeg log view
ipcMain.handle('open-clip-ffmpeg-log', (_, clipName) => {
  const logData = clipFfmpegLogs.get(clipName) || null;
  debugLog('ACTION', 'Open clip ffmpeg log', { clipName, hasData: !!logData });

  // Ensure debug window is open
  if (!debugWindow || debugWindow.isDestroyed()) {
    debugWindow = new BrowserWindow({
      width: 820, height: 520,
      minWidth: 520, minHeight: 300,
      backgroundColor: '#0a0a0a',
      title: 'Debug Log — Clipper Hub',
      webPreferences: {
        preload: path.join(__dirname, 'preload-debug.js'),
        contextIsolation: true,
        nodeIntegration: false,
      }
    });
    debugWindow.setMenuBarVisibility(false);
    debugWindow.loadFile(path.join(__dirname, 'src', 'debug.html'));

    debugWindow.webContents.on('did-finish-load', () => {
      // Replay buffered logs
      for (const entry of debugLogBuffer) {
        if (debugWindow && !debugWindow.isDestroyed()) {
          debugWindow.webContents.send('debug-log', entry);
        }
      }
      // Then send clip log view
      if (debugWindow && !debugWindow.isDestroyed()) {
        debugWindow.webContents.send('show-clip-log', { clipName, logData });
      }
    });

    debugWindow.on('closed', () => { debugWindow = null; });
  } else {
    // Debug window already open — just send the clip log view
    debugWindow.webContents.send('show-clip-log', { clipName, logData });
    debugWindow.focus();
  }

  return { opened: true };
});

// ── IPC: cancel active download ──────────────────────────────────
ipcMain.handle('cancel-clip', (_, { clipName }) => {
  const entry = activeDownloads.get(clipName);
  if (entry) {
    debugLog('CLIP', 'Cancelling download', { clipName, phase: entry.phase, hasProc: !!entry.proc });
    entry.cancelled = true;
    if (entry.proc) entry.proc.kill('SIGTERM');
    return { success: true };
  }
  return { success: false };
});

// ── IPC: delete clip file (for Re-Stage) ─────────────────────────
ipcMain.handle('delete-clip-file', (_, { filePath }) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      debugLog('CLIP', 'Deleted clip file for re-stage', { filePath: sanitize(filePath) });
      return { success: true };
    }
    return { success: false, error: 'File not found' };
  } catch (err) {
    debugLog('ERROR', 'Failed to delete clip file', { error: err.message });
    return { success: false, error: err.message };
  }
});

// ── IPC: GPU transcription (whisper.cpp + CUDA) ─────────────────
ipcMain.handle('whisper-available', () => {
  return isWhisperAvailable();
});

ipcMain.handle('transcribe-gpu', async (event, { audioBuffer }) => {
  // audioBuffer is a Node Buffer containing raw 16-bit PCM @ 16 kHz mono
  const whisperBin = getWhisperPath();
  const modelPath = getWhisperModelPath();
  if (!modelPath) {
    return { error: 'Whisper model not found. Place ggml-tiny.en.bin in resources/whisper/cpp/' };
  }

  const os = require('os');
  const tmpWav = path.join(os.tmpdir(), `ch_whisper_${Date.now()}.wav`);

  try {
    // Write a minimal WAV header + PCM data
    const pcm = Buffer.from(audioBuffer);
    const wavHeader = Buffer.alloc(44);
    const dataSize = pcm.length;
    const fileSize = 36 + dataSize;
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(fileSize, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);      // fmt chunk size
    wavHeader.writeUInt16LE(1, 20);       // PCM format
    wavHeader.writeUInt16LE(1, 22);       // mono
    wavHeader.writeUInt32LE(16000, 24);   // sample rate
    wavHeader.writeUInt32LE(32000, 28);   // byte rate (16000 * 2)
    wavHeader.writeUInt16LE(2, 32);       // block align
    wavHeader.writeUInt16LE(16, 34);      // bits per sample
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(dataSize, 40);

    fs.writeFileSync(tmpWav, Buffer.concat([wavHeader, pcm]));

    // Run whisper.cpp
    const text = await new Promise((resolve, reject) => {
      const args = [
        '-m', modelPath,
        '-f', tmpWav,
        '-l', 'en',
        '-nt',               // no timestamps in output
        '-np',               // no prints (only results)
      ];
      debugLog('WHISPER', 'Running whisper.cpp', { bin: whisperBin, args: args.join(' ') });
      const proc = spawn(whisperBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          debugLog('WHISPER', 'whisper.cpp failed', { code, stderr: stderr.slice(0, 500) });
          reject(new Error('whisper.cpp exited with code ' + code));
        }
      });
      proc.on('error', err => {
        debugLog('WHISPER', 'whisper.cpp spawn error', { error: err.message });
        reject(err);
      });
    });

    return { text };
  } catch (err) {
    debugLog('WHISPER', 'GPU transcription failed', { error: err.message });
    return { error: err.message };
  } finally {
    try { fs.unlinkSync(tmpWav); } catch (_) {}
  }
});

// ── IPC: faster-whisper (Python + CTranslate2 CUDA) ──────────────

ipcMain.handle('faster-whisper-available', () => {
  return isFasterWhisperAvailable();
});

// Persistent faster-whisper server process (stays alive between chunks)
let fwProc = null;
let fwReady = false;
let fwQueue = [];   // pending { resolve, reject } callbacks

let fwProgressWindow = null;

function showFwProgressPopup(msg) {
  if (!fwProgressWindow || fwProgressWindow.isDestroyed()) {
    fwProgressWindow = new BrowserWindow({
      width: 420, height: 140,
      resizable: false,
      alwaysOnTop: true,
      frame: false,
      transparent: false,
      backgroundColor: '#0a0a0a',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    fwProgressWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
      <!DOCTYPE html><html><head><style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { background:#0a0a0a; color:#fafafa; font-family:'Inter','Segoe UI',sans-serif;
               display:flex; flex-direction:column; justify-content:center; align-items:center;
               height:100vh; padding:20px; -webkit-app-region:drag; user-select:none; }
        .title { font-size:13px; font-weight:600; margin-bottom:12px; color:#a78bfa; }
        #msg { font-size:12px; color:#a1a1aa; text-align:center; line-height:1.5; }
        .spinner { width:20px; height:20px; border:2px solid #272727; border-top-color:#7b61ff;
                   border-radius:50%; animation:spin 0.8s linear infinite; margin-bottom:12px; }
        @keyframes spin { to { transform:rotate(360deg); } }
      </style></head><body>
        <div class="spinner"></div>
        <div class="title">faster-whisper</div>
        <div id="msg">${msg || 'Starting...'}</div>
        <script>
          window.addEventListener('message', e => {
            if (e.data && e.data.msg) document.getElementById('msg').textContent = e.data.msg;
          });
        </script>
      </body></html>
    `));
  } else {
    fwProgressWindow.webContents.executeJavaScript(
      `document.getElementById('msg').textContent = ${JSON.stringify(msg)};`
    ).catch(() => {});
  }
}

function closeFwProgressPopup() {
  if (fwProgressWindow && !fwProgressWindow.isDestroyed()) {
    fwProgressWindow.close();
  }
  fwProgressWindow = null;
}

function ensureFasterWhisperServer() {
  if (fwProc && !fwProc.killed) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = getTranscribeScript();
    const py = getPythonPath();
    if (!script || !py) return reject(new Error('faster-whisper not available'));

    showFwProgressPopup('Starting faster-whisper server...');

    const args = [...py.args, script, '--server', '--model', 'medium', '--device', 'cuda'];
    debugLog('WHISPER', 'Starting faster-whisper server', { cmd: py.cmd, args: args.join(' ') });
    fwProc = spawn(py.cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    fwReady = false;

    let stderrBuf = '';
    fwProc.stderr.on('data', d => {
      stderrBuf += d.toString();
      debugLog('WHISPER:FW', d.toString().trim());
    });

    // Wait for the READY line, forwarding PROGRESS: lines to renderer + popup
    let stdoutBuf = '';
    const onFirstData = (d) => {
      stdoutBuf += d.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop(); // keep incomplete tail
      for (const line of lines) {
        if (line.startsWith('PROGRESS:')) {
          const parts = line.slice(9).split(':');
          const pct = parseInt(parts[0], 10);
          const msg = parts.slice(1).join(':');
          showFwProgressPopup(msg);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('fw-progress', { pct, msg });
          }
          debugLog('WHISPER:FW', `Progress: ${msg} (${pct}%)`);
        } else if (line.trim() === 'READY') {
          fwProc.stdout.removeListener('data', onFirstData);
          fwReady = true;
          fwProc.stdout.on('data', onFwData);
          closeFwProgressPopup();
          debugLog('WHISPER', 'faster-whisper server ready');
          resolve();
        }
      }
    };
    fwProc.stdout.on('data', onFirstData);

    fwProc.on('close', code => {
      debugLog('WHISPER', 'faster-whisper server exited', { code });
      closeFwProgressPopup();
      fwReady = false;
      fwProc = null;
      for (const cb of fwQueue) cb.reject(new Error('faster-whisper server exited'));
      fwQueue = [];
    });
    fwProc.on('error', err => {
      debugLog('WHISPER', 'faster-whisper spawn error', { error: err.message });
      closeFwProgressPopup();
      reject(err);
    });

    // Timeout after 10 min (first run downloads ~1.5GB model)
    setTimeout(() => {
      if (!fwReady) {
        closeFwProgressPopup();
        reject(new Error('faster-whisper server startup timed out'));
      }
    }, 600000);
  });
}

let fwLineBuf = '';
function onFwData(d) {
  fwLineBuf += d.toString();
  let lines = fwLineBuf.split('\n');
  fwLineBuf = lines.pop(); // keep incomplete tail
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const cb = fwQueue.shift();
    if (!cb) continue;
    if (trimmed.startsWith('ERROR:')) {
      cb.reject(new Error(trimmed.slice(6)));
    } else {
      cb.resolve(trimmed);
    }
  }
}

function writeWavFile(audioBuffer) {
  const os = require('os');
  const tmpWav = path.join(os.tmpdir(), `ch_fw_${Date.now()}.wav`);
  const pcm = Buffer.from(audioBuffer);
  const wavHeader = Buffer.alloc(44);
  const dataSize = pcm.length;
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + dataSize, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);       // PCM
  wavHeader.writeUInt16LE(1, 22);       // mono
  wavHeader.writeUInt32LE(16000, 24);   // 16kHz
  wavHeader.writeUInt32LE(32000, 28);   // byte rate
  wavHeader.writeUInt16LE(2, 32);       // block align
  wavHeader.writeUInt16LE(16, 34);      // 16-bit
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(tmpWav, Buffer.concat([wavHeader, pcm]));
  return tmpWav;
}

ipcMain.handle('transcribe-faster', async (event, { audioBuffer }) => {
  try {
    await ensureFasterWhisperServer();
    const tmpWav = writeWavFile(audioBuffer);
    const text = await new Promise((resolve, reject) => {
      fwQueue.push({ resolve, reject });
      fwProc.stdin.write(tmpWav + '\n');
      // Timeout per chunk
      setTimeout(() => reject(new Error('transcription timed out')), 15000);
    });
    try { fs.unlinkSync(tmpWav); } catch (_) {}
    return { text };
  } catch (err) {
    debugLog('WHISPER', 'faster-whisper transcription failed', { error: err.message });
    return { error: err.message };
  }
});

// Clean up server on app quit
app.on('before-quit', () => {
  if (fwProc && !fwProc.killed) {
    try { fwProc.stdin.write('EXIT\n'); } catch (_) {}
    fwProc.kill();
  }
});

// ── IPC: detachable hub window ───────────────────────────────────
ipcMain.handle('open-hub-window', () => {
  if (hubWindow && !hubWindow.isDestroyed()) {
    hubWindow.focus();
    return { opened: true };
  }
  hubWindow = new BrowserWindow({
    width: 420, height: 700,
    minWidth: 350, minHeight: 400,
    backgroundColor: '#0a0a0a',
    title: 'Clip Hub — Clipper Hub',
    webPreferences: {
      preload: path.join(__dirname, 'preload-hub.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  hubWindow.setMenuBarVisibility(false);
  hubWindow.loadFile(path.join(__dirname, 'src', 'hub.html'));
  hubWindow.webContents.on('did-finish-load', () => {
    if (lastHubState && hubWindow && !hubWindow.isDestroyed()) {
      hubWindow.webContents.send('hub-state-update', lastHubState);
    }
  });
  hubWindow.on('closed', () => {
    hubWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hub-reattached');
    }
  });
  return { opened: true };
});

ipcMain.handle('close-hub-window', () => {
  if (hubWindow && !hubWindow.isDestroyed()) hubWindow.close();
  hubWindow = null;
});

// Relay state from main renderer → hub window (cache for startup)
let lastHubState = null;
ipcMain.on('hub-state-update', (_, state) => {
  lastHubState = state;
  if (hubWindow && !hubWindow.isDestroyed()) {
    hubWindow.webContents.send('hub-state-update', state);
  }
});

// Relay actions from hub window → main renderer
ipcMain.on('hub-action', (_, action) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hub-action', action);
  }
});

// IPC: detached post caption window
ipcMain.handle('open-post-caption-window', (_, context = {}) => {
  const safeContext = {
    tab: context && context.tab === 'clips' ? 'clips' : 'caption',
    source: context && typeof context.source === 'string' ? context.source : 'unknown',
    requestId: Date.now()
  };
  lastPostCaptionOpenContext = safeContext;
  if (postCaptionWindow && !postCaptionWindow.isDestroyed()) {
    if (postCaptionWindow.isMinimized()) postCaptionWindow.restore();
    postCaptionWindow.webContents.send('post-caption-open-context', safeContext);
    postCaptionWindow.focus();
    return { opened: true };
  }
  postCaptionWindow = new BrowserWindow({
    width: 1220, height: 860,
    minWidth: 480, minHeight: 540,
    backgroundColor: '#0a0a0a',
    title: 'Post Captioning - Clipper Hub',
    webPreferences: {
      preload: path.join(__dirname, 'preload-postcaption.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  postCaptionWindow.setMenuBarVisibility(false);
  postCaptionWindow.loadFile(path.join(__dirname, 'src', 'post-caption.html'));
  postCaptionWindow.webContents.on('did-finish-load', () => {
    if (lastPostCaptionState && postCaptionWindow && !postCaptionWindow.isDestroyed()) {
      postCaptionWindow.webContents.send('post-caption-state-update', lastPostCaptionState);
    }
    if (lastPostCaptionOpenContext && postCaptionWindow && !postCaptionWindow.isDestroyed()) {
      postCaptionWindow.webContents.send('post-caption-open-context', lastPostCaptionOpenContext);
    }
  });
  postCaptionWindow.on('closed', () => { postCaptionWindow = null; });
  return { opened: true };
});

ipcMain.handle('close-post-caption-window', () => {
  if (postCaptionWindow && !postCaptionWindow.isDestroyed()) postCaptionWindow.close();
  postCaptionWindow = null;
});

let lastPostCaptionState = null;
ipcMain.on('post-caption-state-update', (_, state) => {
  lastPostCaptionState = state;
  if (postCaptionWindow && !postCaptionWindow.isDestroyed()) {
    postCaptionWindow.webContents.send('post-caption-state-update', state);
  }
});

ipcMain.on('post-caption-action', (_, action) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('post-caption-action', action);
  }
});

// Save filtered debug output to file and open in explorer
ipcMain.handle('save-debug-log', async (_, { text, filterName }) => {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeName = (filterName || 'all').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const filePath = path.join(DEBUG_DIR, `debug_${safeName}_${stamp}.log`);
  fs.writeFileSync(filePath, text, 'utf-8');
  shell.showItemInFolder(filePath);
  return { success: true, filePath };
});

// ── IPC: open external URL in default browser ────────────────────
ipcMain.handle('open-external-url', async (_, url) => {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { success: false, error: 'invalid-protocol' };
    await shell.openExternal(u.toString());
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err && err.message || err) };
  }
});

// ── IPC: proxy port ──────────────────────────────────────────────
ipcMain.handle('get-proxy-port', () => proxyPort);

// ── IPC: clips directory ─────────────────────────────────────────
ipcMain.handle('get-clips-dir', () => sanitize(clipsDir));

ipcMain.handle('choose-clips-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose Clips Output Folder'
  });
  if (!result.canceled && result.filePaths[0]) {
    clipsDir = result.filePaths[0];
    return clipsDir;
  }
  return null;
});

ipcMain.handle('open-clips-folder', () => {
  fs.mkdirSync(clipsDir, { recursive: true });
  shell.openPath(clipsDir);
});

ipcMain.handle('show-in-folder', (_, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle('copy-text', (_, text) => {
  clipboard.writeText(String(text || ''));
  return { success: true };
});

// ══════════════════════════════════════════════════════════════════
// ── Config IPC handlers ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

ipcMain.handle('load-user-config', () => {
  try {
    if (fs.existsSync(USER_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return null;
});

ipcMain.handle('save-user-config', (_, config) => {
  ensureConfigDir();
  fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(config, null, 2));
  return { success: true };
});

ipcMain.handle('export-user-config', async () => {
  try {
    if (!fs.existsSync(USER_CONFIG_PATH)) return { success: false, error: 'No config to export' };
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Configuration',
      defaultPath: 'clippinghub_config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!result.canceled && result.filePath) {
      fs.copyFileSync(USER_CONFIG_PATH, result.filePath);
      return { success: true, filePath: result.filePath };
    }
    return { success: false, error: 'Cancelled' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('import-user-config', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Configuration',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!result.canceled && result.filePaths[0]) {
      const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
      ensureConfigDir();
      fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(data, null, 2));
      return { success: true, config: data };
    }
    return { success: false, error: 'Cancelled' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-watermark-config', () => {
  try {
    if (fs.existsSync(WATERMARK_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(WATERMARK_CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return null;
});

ipcMain.handle('save-watermark-config', (_, config) => {
  ensureConfigDir();
  fs.writeFileSync(WATERMARK_CONFIG_PATH, JSON.stringify(config, null, 2));
  return { success: true };
});

ipcMain.handle('save-channel-config', (_, config) => {
  ensureConfigDir();
  fs.writeFileSync(CHANNEL_CONFIG_PATH, JSON.stringify(config, null, 2));
  try {
    fs.writeFileSync(path.join(__dirname, 'channel.json'), JSON.stringify(config, null, 2));
  } catch {}
  return { success: true };
});

ipcMain.handle('delete-channel-config', () => {
  try { fs.unlinkSync(CHANNEL_CONFIG_PATH); } catch {}
  try { fs.writeFileSync(path.join(__dirname, 'channel.json'), JSON.stringify({ channel_id: '' }, null, 2)); } catch {}
  return { success: true };
});

// IPC: server connection config (renderer holds the WS, just persists URL here)
ipcMain.handle('server-get-config', () => loadServerConfig());
ipcMain.handle('server-set-config', (_e, cfg) => { saveServerConfig(cfg); return { success: true }; });

// ── IPC: choose outro file ──────────────────────────────────────
ipcMain.handle('choose-outro-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Outro Video',
    filters: [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov'] }],
    properties: ['openFile'],
  });
  if (!result.canceled && result.filePaths[0]) {
    return { success: true, filePath: result.filePaths[0] };
  }
  return { success: false };
});

// ── IPC: choose watermark image ──────────────────────────────────
ipcMain.handle('choose-watermark-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Watermark Image',
    filters: [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }],
    properties: ['openFile'],
  });
  if (!result.canceled && result.filePaths[0]) {
    return { success: true, filePath: result.filePaths[0] };
  }
  return { success: false };
});

// ══════════════════════════════════════════════════════════════════
// ── Watermark: build ffmpeg drawtext filter ──────────────────────
// (Ported from ClipperWATERMARKTESTING)
// ══════════════════════════════════════════════════════════════════

// Per-platform font candidates. First file that actually exists wins.
// macOS keeps fonts under /System/Library/Fonts/Supplemental (Catalina+) or /Library/Fonts.
// Linux fonts come from packages (msttcorefonts, dejavu, liberation, noto) and can live
// in /usr/share/fonts/ subdirs — we probe multiple known locations.
const FONT_CANDIDATES = {
  win32: {
    'Arial':         ['arial.ttf'],
    'Impact':        ['impact.ttf'],
    'Georgia':       ['georgia.ttf'],
    'Courier New':   ['cour.ttf'],
    'Verdana':       ['verdana.ttf'],
    'Tahoma':        ['tahoma.ttf'],
    'Trebuchet MS':  ['trebuc.ttf'],
    'Comic Sans MS': ['comic.ttf'],
  },
  darwin: {
    'Arial':         ['Arial.ttf', 'Supplemental/Arial.ttf'],
    'Impact':        ['Impact.ttf', 'Supplemental/Impact.ttf'],
    'Georgia':       ['Georgia.ttf', 'Supplemental/Georgia.ttf'],
    'Courier New':   ['Courier New.ttf', 'Supplemental/Courier New.ttf'],
    'Verdana':       ['Verdana.ttf', 'Supplemental/Verdana.ttf'],
    'Tahoma':        ['Tahoma.ttf', 'Supplemental/Tahoma.ttf'],
    'Trebuchet MS':  ['Trebuchet MS.ttf', 'Supplemental/Trebuchet MS.ttf'],
    'Comic Sans MS': ['Comic Sans MS.ttf', 'Supplemental/Comic Sans MS.ttf'],
  },
  linux: {
    // msttcorefonts lookalikes (Liberation/DejaVu) commonly available on Ubuntu/Fedora.
    'Arial':         ['truetype/liberation/LiberationSans-Regular.ttf', 'truetype/dejavu/DejaVuSans.ttf'],
    'Impact':        ['truetype/liberation/LiberationSans-Bold.ttf', 'truetype/dejavu/DejaVuSans-Bold.ttf'],
    'Georgia':       ['truetype/liberation/LiberationSerif-Regular.ttf', 'truetype/dejavu/DejaVuSerif.ttf'],
    'Courier New':   ['truetype/liberation/LiberationMono-Regular.ttf', 'truetype/dejavu/DejaVuSansMono.ttf'],
    'Verdana':       ['truetype/dejavu/DejaVuSans.ttf', 'truetype/liberation/LiberationSans-Regular.ttf'],
    'Tahoma':        ['truetype/dejavu/DejaVuSans.ttf', 'truetype/liberation/LiberationSans-Regular.ttf'],
    'Trebuchet MS':  ['truetype/dejavu/DejaVuSans.ttf', 'truetype/liberation/LiberationSans-Regular.ttf'],
    'Comic Sans MS': ['truetype/dejavu/DejaVuSans.ttf', 'truetype/liberation/LiberationSans-Regular.ttf'],
  },
};

// macOS searches both /Library/Fonts and the system supplemental dir.
// Linux searches a few common roots in addition to /usr/share/fonts.
const FONT_SEARCH_ROOTS = {
  win32:  [() => platformHelpers.fontsDir()],
  darwin: [
    () => '/System/Library/Fonts',
    () => '/Library/Fonts',
    () => path.join(require('os').homedir(), 'Library', 'Fonts'),
  ],
  linux:  [
    () => '/usr/share/fonts',
    () => '/usr/local/share/fonts',
    () => path.join(require('os').homedir(), '.fonts'),
    () => path.join(require('os').homedir(), '.local', 'share', 'fonts'),
  ],
};

function resolveFontFile(fontFamily) {
  const plat = process.platform;
  const candidates = (FONT_CANDIDATES[plat] || FONT_CANDIDATES.linux)[fontFamily]
                   || (FONT_CANDIDATES[plat] || FONT_CANDIDATES.linux)['Arial'];
  const roots = (FONT_SEARCH_ROOTS[plat] || FONT_SEARCH_ROOTS.linux).map(fn => fn());

  for (const root of roots) {
    for (const rel of candidates) {
      const candidate = path.join(root, rel);
      try { if (fs.existsSync(candidate)) return candidate; } catch (_) {}
    }
  }
  // Last-ditch fallback: just pick *something* that ffmpeg can open.
  for (const root of roots) {
    try {
      const stack = [root];
      while (stack.length) {
        const dir = stack.shift();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) { stack.push(full); continue; }
          if (/\.(ttf|otf)$/i.test(ent.name)) return full;
        }
      }
    } catch (_) {}
  }
  return null;
}

// Escape a path for use inside an ffmpeg drawtext filter expression.
// On every platform: backslashes → forward slashes, ':' → '\:'.
// On Windows specifically the resulting path looks like `C\:/Windows/Fonts/arial.ttf`.
function escapeFontPathForFilter(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function buildWatermarkFilter(wm) {
  if (!wm || !wm.text) return null;

  const escapedText = wm.text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%');

  const hex = (wm.color || '#ffffff').replace('#', '');
  const alpha = Math.round((wm.opacity || 0.7) * 255).toString(16).padStart(2, '0');
  const ffColor = `0x${hex}${alpha}`;

  const pos = wm.position || 'bottom-right';
  const pad = 20;
  let x, y;
  if (pos.includes('left'))        x = String(pad);
  else if (pos.includes('right'))  x = `w-tw-${pad}`;
  else                             x = '(w-tw)/2';

  if (pos.includes('top'))         y = String(pad);
  else if (pos.includes('bottom')) y = `h-th-${pad}`;
  else                             y = '(h-th)/2';

  const fontSize = wm.fontSize || 48;
  const fontFamily = (wm.fontFamily || 'Arial');

  const resolved = resolveFontFile(fontFamily);
  if (!resolved) {
    // No font found — fall back to drawtext without an explicit font; ffmpeg
    // will use its compiled-in default (libfontconfig/Arial) which is better
    // than crashing the encode.
    return `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${ffColor}:x=${x}:y=${y}`;
  }
  const fontPath = escapeFontPathForFilter(resolved);

  return `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${ffColor}:x=${x}:y=${y}:fontfile='${fontPath}'`;
}

// ══════════════════════════════════════════════════════════════════
// ── IPC: preview watermark (quick frame grab + overlay) ──────────
// ══════════════════════════════════════════════════════════════════

ipcMain.handle('preview-watermark', async (event, { m3u8Url, m3u8Text, startSec, watermark, imageWatermark }) => {
  debugLog('PREVIEW', 'Preview requested', { startSec, hasWatermark: !!watermark, hasImageWatermark: !!imageWatermark, fromCache: !!m3u8Text });

  const { parseSegments, findCoveringSegments, buildImageWatermarkArgs } = require('./src/lib/ffmpeg-args.js');
  const tempDir = path.join(clipsDir, `_preview_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // 1. Resolve m3u8 — use cached local playlist if available
    let mediaText;
    if (m3u8Text) {
      mediaText = m3u8Text;
    } else {
      ({ text: mediaText } = await resolveMediaUrl(m3u8Url));
    }
    const { segments } = parseSegments(mediaText);
    if (!segments.length) throw new Error('No segments in playlist');

    // 2. Find one segment overlapping startSec
    const covering = findCoveringSegments(segments, startSec, 1);
    const seg = covering.length ? covering[0] : segments[Math.floor(segments.length / 2)];
    debugLog('PREVIEW', 'Using segment', { url: seg.url?.slice(0, 80), startTime: seg.startTime });

    // 3. Download single segment
    const segBuf = await proxyFetchBuffer(seg.url);
    const segPath = path.join(tempDir, 'seg.ts');
    fs.writeFileSync(segPath, segBuf);

    // 4. Extract one frame
    const framePath = path.join(tempDir, 'frame.png');
    await new Promise((resolve, reject) => {
      const proc = spawn(getFfmpegPath(), ['-y', '-i', segPath, '-frames:v', '1', framePath], { stdio: 'pipe' });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Frame extract failed (${code})`)));
      proc.on('error', reject);
    });

    // 5. Apply watermark(s)
    const wmFilter = buildWatermarkFilter(watermark);
    const imgWmArgs = buildImageWatermarkArgs(imageWatermark);
    let previewPath = framePath;

    if (wmFilter || imgWmArgs) {
      previewPath = path.join(tempDir, 'preview.png');
      const ffArgs = ['-y', '-i', framePath];

      if (imgWmArgs) {
        ffArgs.push(...imgWmArgs.inputs);
        if (wmFilter) {
          const fc = imgWmArgs.filterComplex.replace(
            '[0:v][wm]overlay',
            `[0:v]${wmFilter}[txt];[txt][wm]overlay`
          );
          ffArgs.push('-filter_complex', fc);
        } else {
          ffArgs.push('-filter_complex', imgWmArgs.filterComplex);
        }
      } else {
        // Text-only watermark
        ffArgs.push('-vf', wmFilter);
      }

      ffArgs.push('-frames:v', '1', previewPath);

      await new Promise((resolve, reject) => {
        const proc = spawn(getFfmpegPath(), ffArgs, { stdio: 'pipe' });
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Overlay failed (${code}): ${stderr.slice(-300)}`)));
        proc.on('error', reject);
      });
    }

    debugLog('PREVIEW', 'Preview ready', { previewPath });
    return { success: true, previewPath };

  } catch (err) {
    debugLog('ERROR', 'Preview failed', { error: err.message });
    return { success: false, error: err.message };
  } finally {
    // Clean up segment file (keep preview for display)
    try { fs.unlinkSync(path.join(tempDir, 'seg.ts')); } catch {}
    try { fs.unlinkSync(path.join(tempDir, 'frame.png')); } catch {}
  }
});

// ── IPC: show preview image ──────────────────────────────────────
ipcMain.handle('show-preview', async (_, { filePath }) => {
  const { shell } = require('electron');
  await shell.openPath(filePath);
  return { success: true };
});

// ══════════════════════════════════════════════════════════════════
// ── IPC: download clip via ffmpeg ────────────────────────────────
// Clipper's segment-based download pipeline — PRESERVED FROM CLIPPER
// Added: watermark filter, outro concatenation, GPU accel options
// ══════════════════════════════════════════════════════════════════

ipcMain.handle('extract-clip-first-frame', async (_, { filePath }) => {
  if (!filePath) return { success: false, error: 'Missing filePath' };
  if (!fs.existsSync(filePath)) return { success: false, error: 'Clip file not found' };

  const tempDir = path.join(app.getPath('temp'), 'ClippingHubThumbs');
  fs.mkdirSync(tempDir, { recursive: true });
  const outPath = path.join(
    tempDir,
    `thumb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
  );

  try {
    await new Promise((resolve, reject) => {
      const ffArgs = ['-y', '-ss', '0', '-i', filePath, '-frames:v', '1', '-q:v', '2', outPath];
      const proc = spawn(getFfmpegPath(), ffArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', code => {
        if (code === 0 && fs.existsSync(outPath)) resolve();
        else reject(new Error(`First-frame extract failed (${code}): ${stderr.slice(-400)}`));
      });
    });

    const b64 = fs.readFileSync(outPath).toString('base64');
    return { success: true, dataUrl: `data:image/jpeg;base64,${b64}` };
  } catch (err) {
    debugLog('ERROR', 'First-frame thumbnail extraction failed', {
      error: err.message,
      filePath: sanitize(filePath)
    });
    return { success: false, error: err.message };
  } finally {
    try { fs.unlinkSync(outPath); } catch {}
  }
});

ipcMain.handle('download-clip', async (event, { m3u8Url, m3u8Text, startSec, durationSec, clipName, watermark, imageWatermark, outro, ffmpegOptions, batchOutputDir, batchManifest, keepTempFiles, logFfmpegCommands }) => {
  const { parseSegments, findCoveringSegments, buildConcatArgs, buildImageWatermarkArgs } = require('./src/lib/ffmpeg-args.js');
  debugLog('CLIP', 'Download requested', { clipName, startSec, durationSec, m3u8Url: m3u8Url?.slice(0, 120), hasWatermark: !!watermark, hasImageWatermark: !!imageWatermark, hasOutro: !!outro, ffmpegOptions, batch: !!batchOutputDir });

  // Determine output directory (batch mode overrides)
  let outputDir = clipsDir;
  if (batchOutputDir) {
    outputDir = path.join(clipsDir, '_batch', batchOutputDir);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const safeName = (clipName || 'clip')
    .replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-').toLowerCase().slice(0, 80);

  let out = path.join(outputDir, `${safeName}.mp4`);
  for (let i = 1; fs.existsSync(out); i++) out = path.join(outputDir, `${safeName}-${i}.mp4`);

  // Track ffmpeg commands for batch manifest + clip log viewer
  const ffmpegCommands = [];
  const ffmpegStepLogs = [];  // { step, stderr } per ffmpeg invocation

  // Proxy helpers are now at module scope: toProxyUrl, proxyFetchText, proxyFetchBuffer, resolveMediaUrl

  const tempDir = path.join(clipsDir, `_tmp_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Register early so cancelClip() can set the cancelled flag during segment download
    activeDownloads.set(clipName, { proc: null, phase: 'segments', cancelled: false });

    // 1. Resolve to a media playlist and parse segments
    //    If m3u8Text is provided (from LocalPlaylist cache), use it directly
    //    instead of fetching the live playlist — prevents live rotation issues
    let mediaText;
    if (m3u8Text) {
      debugLog('CLIP', 'Using cached local playlist text', { length: m3u8Text.length });
      mediaText = m3u8Text;
    } else {
      debugLog('CLIP', 'Resolving media playlist from URL...');
      ({ text: mediaText } = await resolveMediaUrl(m3u8Url));
    }
    const { segments, mediaSequence, totalDuration } = parseSegments(mediaText);
    debugLog('CLIP', 'Playlist parsed', { segmentCount: segments.length, mediaSequence, totalDuration, firstSeg: segments[0]?.startTime, lastSeg: segments[segments.length-1]?.startTime, fromCache: !!m3u8Text });
    if (!segments.length) throw new Error('No segments found in playlist');

    // 2. Find segments that overlap [startSec, startSec+durationSec)
    const endSec = startSec + durationSec;
    const relevant = segments.filter(s => s.startTime + s.duration > startSec && s.startTime < endSec);
    debugLog('CLIP', 'Segment selection', { requestRange: `${startSec}s - ${endSec}s`, matchedSegments: relevant.length, firstMatch: relevant[0]?.startTime, lastMatch: relevant[relevant.length-1]?.startTime });
    if (!relevant.length) throw new Error('No segments found in the requested time range');

    // 3. Download each segment through the proxy
    const tsPaths = [];
    for (let i = 0; i < relevant.length; i++) {
      if (activeDownloads.get(clipName)?.cancelled) {
        throw Object.assign(new Error('Cancelled'), { cancelled: true });
      }
      const seg = relevant[i];
      const tsPath = path.join(tempDir, `seg_${String(i).padStart(4, '0')}.ts`);
      const buf = await proxyFetchBuffer(seg.url);
      fs.writeFileSync(tsPath, buf);
      tsPaths.push(tsPath);
      broadcastProgress(clipName, Math.round(((i + 1) / relevant.length) * 60));
    }

    // 4. Write ffmpeg concat list and join segments into a single .ts
    const listFile = path.join(tempDir, 'files.txt');
    fs.writeFileSync(listFile, tsPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));

    const concatPath = path.join(tempDir, 'concat.ts');
    const concatArgs = buildConcatArgs(listFile, concatPath);
    ffmpegCommands.push({ step: '1. Segment concat (join .ts segments)', args: ['ffmpeg', ...concatArgs] });
    await new Promise((resolve, reject) => {
      const proc = spawn(getFfmpegPath(), concatArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      activeDownloads.set(clipName, { proc, phase: 'concat', cancelled: false });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('close', code => {
        ffmpegStepLogs.push({ step: '1. Segment concat', stderr });
        if (activeDownloads.get(clipName)?.cancelled) { reject(Object.assign(new Error('Cancelled'), { cancelled: true })); return; }
        code === 0 ? resolve() : reject(new Error(`ffmpeg concat failed (code ${code})`));
      });
      proc.on('error', reject);
    });

    broadcastProgress(clipName, 70);

    // 5. Trim to exact range — with optional watermark, GPU accel, custom ffmpeg options
    const ssOffset = Math.max(0, startSec - relevant[0].startTime);
    debugLog('CLIP', 'Trim params', { ssOffset, startSec, firstSegStart: relevant[0].startTime, durationSec });
    const wmFilter = buildWatermarkFilter(watermark);
    const imgWmArgs = buildImageWatermarkArgs(imageWatermark);
    const hasOutro = outro && outro.filePath && fs.existsSync(outro.filePath);
    const trimmedPath = hasOutro ? path.join(tempDir, 'trimmed.mp4') : out;

    // FFmpeg encoding config — shared across steps 2, 3, 4
    const opts = ffmpegOptions || {};
    const videoCodec = opts.videoCodec || 'libx264';
    const preset = opts.preset || 'fast';
    const crf = opts.crf || '18';

    await new Promise((resolve, reject) => {
      const ffArgs = ['-y'];

      if (opts.hwaccel) {
        ffArgs.push('-hwaccel', opts.hwaccel);
        if (opts.hwaccelOutputFormat) ffArgs.push('-hwaccel_output_format', opts.hwaccelOutputFormat);
        if (opts.hwaccelDevice !== undefined && opts.hwaccelDevice !== '') ffArgs.push('-hwaccel_device', String(opts.hwaccelDevice));
      }

      ffArgs.push('-i', concatPath);

      if (imgWmArgs) {
        ffArgs.push(...imgWmArgs.inputs);
      }

      ffArgs.push('-ss', String(ssOffset), '-t', String(durationSec));

      if (imgWmArgs) {
        if (wmFilter) {
          // Both text + image: apply text drawtext on video, then overlay image
          const fc = imgWmArgs.filterComplex.replace(
            '[0:v]setpts=PTS-STARTPTS[base]',
            `[0:v]setpts=PTS-STARTPTS,${wmFilter}[base]`
          );
          ffArgs.push('-filter_complex', fc + ';[0:a]asetpts=PTS-STARTPTS[aout]');
          ffArgs.push('-map', '0:v', '-map', '[aout]');
        } else {
          ffArgs.push('-filter_complex', imgWmArgs.filterComplex + ';[0:a]asetpts=PTS-STARTPTS[aout]');
          ffArgs.push('-map', '0:v', '-map', '[aout]');
        }
      } else {
        // No image watermark — simple -vf (existing behavior)
        const ptsFilter = 'setpts=PTS-STARTPTS';
        ffArgs.push('-vf', wmFilter ? ptsFilter + ',' + wmFilter : ptsFilter);
        ffArgs.push('-af', 'asetpts=PTS-STARTPTS');
      }
      ffArgs.push('-c:v', videoCodec);
      if (videoCodec === 'libx264' || videoCodec === 'libx265') {
        ffArgs.push('-preset', preset, '-crf', crf);
      } else if (videoCodec === 'h264_nvenc' || videoCodec === 'hevc_nvenc') {
        ffArgs.push('-preset', opts.nvencPreset || 'p4', '-cq', crf);
      }
      ffArgs.push('-bf', '0');

      // Audio
      const audioCodec = opts.audioCodec || 'aac';
      const audioBitrate = opts.audioBitrate || '192k';
      ffArgs.push('-c:a', audioCodec, '-b:a', audioBitrate);
      ffArgs.push('-movflags', '+faststart', '-use_editlist', '0');
      ffArgs.push(trimmedPath);

      ffmpegCommands.push({ step: '2. Trim & encode (seek, cut, transcode)', args: ['ffmpeg', ...ffArgs] });
      debugLog('FFMPEG', 'Trim command', { args: ffArgs.join(' ') });
      const proc = spawn(getFfmpegPath(), ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      activeDownloads.set(clipName, { proc, phase: 'trim', cancelled: false });

      let stderr = '';
      proc.stderr.on('data', d => {
        stderr += d;
        const m = d.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (m) {
          const elapsed = +m[1] * 3600 + +m[2] * 60 + +m[3];
          const trimProgress = hasOutro ? 20 : 30;
          broadcastProgress(clipName, 70 + Math.min(trimProgress, Math.round((elapsed / durationSec) * trimProgress)));
        }
      });
      proc.on('close', code => {
        ffmpegStepLogs.push({ step: '2. Trim & encode', stderr: stderr.toString() });
        if (activeDownloads.get(clipName)?.cancelled) { reject(Object.assign(new Error('Cancelled'), { cancelled: true })); return; }
        if (code === 0 && fs.existsSync(trimmedPath)) resolve();
        else reject(new Error(`ffmpeg trim failed (code ${code}):\n${stderr.toString().slice(-400)}`));
      });
      proc.on('error', err => reject(new Error('ffmpeg not found: ' + err.message)));
    });

    // 6. Append outro if provided
    if (hasOutro) {
      broadcastProgress(clipName, 90);

      // Get the clip's resolution via ffprobe
      const probeResult = await new Promise((resolve, reject) => {
        const proc = spawn(getFfprobePath(), [
          '-v', 'error', '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height',
          '-of', 'csv=p=0', trimmedPath
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        proc.stdout.on('data', d => stdout += d);
        proc.on('close', code => {
          if (code === 0) {
            const [w, h] = stdout.trim().split(',').map(Number);
            resolve({ width: w || 1920, height: h || 1080 });
          } else {
            resolve({ width: 1920, height: 1080 });
          }
        });
        proc.on('error', () => resolve({ width: 1920, height: 1080 }));
      });

      // Re-encode outro to match clip format
      const outroResized = path.join(tempDir, 'outro_resized.mp4');
      const outroResizeArgs = ['-y'];
      if (opts.hwaccel) {
        outroResizeArgs.push('-hwaccel', opts.hwaccel);
        if (opts.hwaccelDevice !== undefined && opts.hwaccelDevice !== '') outroResizeArgs.push('-hwaccel_device', String(opts.hwaccelDevice));
      }
      outroResizeArgs.push(
        '-i', outro.filePath,
        '-vf', `scale=${probeResult.width}:${probeResult.height}:force_original_aspect_ratio=decrease,pad=${probeResult.width}:${probeResult.height}:(ow-iw)/2:(oh-ih)/2`,
        '-c:v', videoCodec
      );
      if (videoCodec === 'libx264' || videoCodec === 'libx265') {
        outroResizeArgs.push('-preset', preset, '-crf', crf);
      } else if (videoCodec === 'h264_nvenc' || videoCodec === 'hevc_nvenc') {
        outroResizeArgs.push('-preset', opts.nvencPreset || 'p4', '-cq', crf);
      }
      outroResizeArgs.push(
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart',
        outroResized
      );
      ffmpegCommands.push({ step: '3. Outro resize (scale to clip resolution)', args: ['ffmpeg', ...outroResizeArgs] });
      await new Promise((resolve, reject) => {
        const proc = spawn(getFfmpegPath(), outroResizeArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        activeDownloads.set(clipName, { proc, phase: 'outro-resize', cancelled: false });
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('close', code => {
          ffmpegStepLogs.push({ step: '3. Outro resize', stderr });
          if (activeDownloads.get(clipName)?.cancelled) { reject(Object.assign(new Error('Cancelled'), { cancelled: true })); return; }
          code === 0 ? resolve() : reject(new Error('Outro resize failed'));
        });
        proc.on('error', reject);
      });

      // Concat clip + outro using the concat FILTER (not demuxer).
      // The concat demuxer with -c copy ignores MP4 edit lists and reads
      // raw packet timestamps — AAC priming delay (~21ms) produces negative
      // audio PTS that the demuxer shifts forward, pushing video start_time
      // to ~0.021s. X/Twitter shows this as a black first frame.
      // The concat filter re-encodes through a unified filter graph with
      // proper timestamp control, producing start_time=0.000000.
      const concatFilterArgs = ['-y'];
      // No -hwaccel here: both inputs are short pre-encoded MP4s.
      // Software decode avoids pixel-format mismatch between inputs
      // (CUDA decodes to nv12/cuda, software to yuv420p — concat filter rejects the mix).
      // NVENC encoding on the output side is still used for speed.
      concatFilterArgs.push('-i', trimmedPath, '-i', outroResized);
      concatFilterArgs.push(
        '-filter_complex',
        '[0:v]setpts=PTS-STARTPTS,setsar=1[v0];[0:a]asetpts=PTS-STARTPTS[a0];' +
        '[1:v]setpts=PTS-STARTPTS,setsar=1[v1];[1:a]asetpts=PTS-STARTPTS[a1];' +
        '[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]',
        '-map', '[vout]', '-map', '[aout]'
      );
      concatFilterArgs.push('-c:v', videoCodec);
      if (videoCodec === 'libx264' || videoCodec === 'libx265') {
        concatFilterArgs.push('-preset', preset, '-crf', crf);
      } else if (videoCodec === 'h264_nvenc' || videoCodec === 'hevc_nvenc') {
        concatFilterArgs.push('-preset', opts.nvencPreset || 'p4', '-cq', crf);
      }
      concatFilterArgs.push(
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart', out
      );
      ffmpegCommands.push({ step: '4. Concat filter (clip + outro)', args: ['ffmpeg', ...concatFilterArgs] });
      await new Promise((resolve, reject) => {
        const proc = spawn(getFfmpegPath(), concatFilterArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        activeDownloads.set(clipName, { proc, phase: 'final-concat', cancelled: false });
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('close', code => {
          ffmpegStepLogs.push({ step: '4. Concat filter', stderr });
          if (activeDownloads.get(clipName)?.cancelled) { reject(Object.assign(new Error('Cancelled'), { cancelled: true })); return; }
          code === 0 ? resolve() : reject(new Error('Final concat failed:\n' + stderr.slice(-500)));
        });
        proc.on('error', reject);
      });
    }

    broadcastProgress(clipName, 100);
    activeDownloads.delete(clipName);
    const fileSize = fs.statSync(out).size;
    debugLog('CLIP', 'Download complete', { clipName, filePath: out, fileSize });

    // Store ffmpeg commands + logs for clip log viewer
    clipFfmpegLogs.set(clipName, {
      commands: ffmpegCommands.map(c => ({ step: c.step, args: sanitize(c.args.join(' ')) })),
      logs: ffmpegStepLogs.map(l => ({ step: l.step, stderr: sanitize(l.stderr) })),
      timestamp: new Date().toISOString(),
      filePath: sanitize(out),
      fileSize,
    });

    // Output all FFmpeg commands to debug log (dev feature)
    if (logFfmpegCommands) {
      for (const cmd of ffmpegCommands) {
        debugLog('FFMPEG', `[${clipName}] ${cmd.step}`, { command: `ffmpeg ${cmd.args.join(' ')}` });
      }
    }

    // Write batch manifest if in batch mode
    if (batchManifest) {
      const manifestPath = path.join(outputDir, '_manifest.txt');
      const cfg = batchManifest.ffmpegConfig || {};
      const lines = [
        `${'='.repeat(60)}`,
        `  Batch Test Manifest — ${clipName}`,
        `  ${new Date().toISOString()}`,
        `${'='.repeat(60)}`,
        ``,
        `Clip ${batchManifest.batchIndex} of ${batchManifest.batchTotal}`,
        `Batch ID: ${batchManifest.batchId}`,
        ``,
        `--- Clip Parameters ---`,
        `IN:       ${startSec}s`,
        `Duration: ${durationSec}s`,
        ``,
        `--- FFmpeg Configuration ---`,
        `Video Codec:     ${cfg.videoCodec || 'libx264'}`,
        `Preset:          ${cfg.preset || 'fast'}`,
        `CRF/CQ:          ${cfg.crf || '18'}`,
        `Audio Codec:     ${cfg.audioCodec || 'aac'}`,
        `Audio Bitrate:   ${cfg.audioBitrate || '192k'}`,
        `HW Accel:        ${cfg.hwaccel || 'none'}`,
        `HW Output Fmt:   ${cfg.hwaccelOutputFormat || 'default'}`,
        `HW Device:       ${cfg.hwaccelDevice || 'default'}`,
        `NVENC Preset:    ${cfg.nvencPreset || 'n/a'}`,
        `Watermark:       ${batchManifest.hasWatermark ? 'yes' : 'no'}`,
        `Outro:           ${batchManifest.hasOutro ? 'yes' : 'no'}`,
        ``,
        `--- FFmpeg Commands (${ffmpegCommands.length} steps) ---`,
        ...ffmpegCommands.map(cmd => `\n[${cmd.step}]\n${sanitize(cmd.args.join(' '))}`),
        ``,
        `--- Output ---`,
        `File: ${path.basename(out)}`,
        `Size: ${fileSize} bytes (${(fileSize / 1048576).toFixed(1)} MB)`,
        `Path: ${sanitize(out)}`,
        ``,
        ``,
      ];
      fs.appendFileSync(manifestPath, lines.join('\n'));
      debugLog('CLIP', 'Batch manifest written', { manifestPath });
    }

    return { success: true, filePath: out, displayPath: sanitize(out), fileName: path.basename(out), fileSize };

  } catch (err) {
    activeDownloads.delete(clipName);
    if (err.cancelled) {
      debugLog('CLIP', 'Download cancelled by user', { clipName });
      return { success: false, cancelled: true };
    }
    debugLog('ERROR', 'Download failed', { clipName, error: err.message });
    throw err;
  } finally {
    if (keepTempFiles) {
      debugLog('CLIP', 'Keeping temp files (dev feature enabled)', { tempDir });
    } else {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }
});

// ── IPC: native file drag ────────────────────────────────────────
ipcMain.on('ondragstart', (event, filePath) => {
  if (!fs.existsSync(filePath)) return;
  event.sender.startDrag({
    file: filePath,
    icon: nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAlSURBVDhPY/j//z8DJYCJgUIwasChMWAoLRhVPWpgqjHgHwMAaGgDCALkBQAAAABJRU5ErkJggg=='
    )
  });
});

// ── Window ───────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 860,
    minWidth: 1000, minHeight: 600,
    backgroundColor: '#0a0a0b',
    title: `ClippingHub v${app.getVersion()}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // App loads from http://localhost:<proxyPort>. All cross-origin video
      // traffic (Rumble HLS) goes through the local proxy, so same-origin
      // policy is fine. hls.js script comes from cdn.jsdelivr.net (https from
      // http is allowed under default policy).
      webSecurity: true,
      webviewTag: true,
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://localhost:${proxyPort}`);
  if (!app.isPackaged) mainWindow.webContents.openDevTools({ mode: 'bottom' });
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Close child windows so the app quits
    if (hubWindow && !hubWindow.isDestroyed()) hubWindow.close();
    if (debugWindow && !debugWindow.isDestroyed()) debugWindow.close();
    if (postCaptionWindow && !postCaptionWindow.isDestroyed()) postCaptionWindow.close();
  });
}

// ── Boot ─────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Application menu — provides Cmd/Ctrl+C/V/X/A accelerators.
  // Without this, copy/paste doesn't work on macOS (and is hidden on Win/Linux).
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ]));

  clipsDir = path.join(app.getPath('videos'), 'ClipperHub');
  ensureConfigDir();
  ensurePanelLayoutConfig();
  initDebugLog();
  registerBatchIPC(debugLog);

  const httpServer = http.createServer(expressApp);
  httpServer.listen(0, '127.0.0.1', () => {
    proxyPort = httpServer.address().port;
    debugLog('SESSION', `Server listening on port ${proxyPort}`);
    debugLog('SESSION', `Clips dir: ${clipsDir}`);
    createWindow();
    if (app.isPackaged) setupAutoUpdater();
  });
});

// ── Auto-Update Check ───────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  autoUpdater.on('checking-for-update', () => send('update:checking'));
  autoUpdater.on('update-available', (info) => {
    send('update:available', { version: info.version });
  });
  autoUpdater.on('update-not-available', (info) => send('update:none', { version: info && info.version }));
  autoUpdater.on('error', (err) => send('update:error', String(err && err.message || err)));
  autoUpdater.on('download-progress', (p) =>
    send('update:progress', { percent: Math.round(p.percent || 0) })
  );
  autoUpdater.on('update-downloaded', () => send('update:downloaded'));

  mainWindow.webContents.once('did-finish-load', () => {
    autoUpdater.checkForUpdates().catch(() => {});
  });
}

ipcMain.handle('update:check', () => autoUpdater.checkForUpdates().catch(() => null));
ipcMain.handle('update:download', () => autoUpdater.downloadUpdate().catch(() => null));
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:quit', () => { app.quit(); });

// App config import/export — bundles all top-level *.json files in CONFIG_DIR
// into a single JSON file the user can save/share/restore.
function _readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}
ipcMain.handle('app:export-config', async () => {
  ensureConfigDir();
  const bundle = { _version: 1, _exportedAt: new Date().toISOString(), files: {} };
  try {
    const entries = fs.readdirSync(CONFIG_DIR);
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const data = _readJsonSafe(path.join(CONFIG_DIR, name));
      if (data !== null) bundle.files[name] = data;
    }
  } catch (e) { return { success: false, error: e.message }; }
  const result = await dialog.showSaveDialog({
    title: 'Export ClippingHub config',
    defaultPath: 'clippinghub-config.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), 'utf-8');
    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('app:import-config', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Import ClippingHub config',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.files || typeof parsed.files !== 'object') {
      return { success: false, error: 'Invalid config bundle' };
    }
    ensureConfigDir();
    const names = Object.keys(parsed.files);
    for (const name of names) {
      // Only allow flat *.json filenames into CONFIG_DIR (no path traversal)
      if (!/^[a-zA-Z0-9_\-]+\.json$/.test(name)) continue;
      const dest = path.join(CONFIG_DIR, name);
      fs.writeFileSync(dest, JSON.stringify(parsed.files[name], null, 2), 'utf-8');
    }
    return { success: true, restored: names.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Layout config files ────────────────────────────────────────────
ipcMain.handle('layouts:get-builtins', async () => {
  ensurePanelLayoutConfig();
  return listLayoutFiles(PANEL_LAYOUTS_DIR, DEFAULT_WORKSPACE_SET);
});

ipcMain.handle('layouts:list', async () => {
  ensurePanelLayoutConfig();
  return listLayoutFiles(PANEL_LAYOUTS_DIR, DEFAULT_WORKSPACE_SET);
});

ipcMain.handle('layouts:save', async (_, payload) => {
  try {
    ensurePanelLayoutConfig();
    const opts = payload || {};
    const source = opts.layout && typeof opts.layout === 'object' ? opts.layout : {};
    const desiredKey = opts.key ? sanitizeLayoutKey(opts.key) : '';
    const key = desiredKey || undefined;
    const name = String(opts.name || source.name || desiredKey || 'Layout').trim() || 'Layout';
    const result = saveLayoutFile(PANEL_LAYOUTS_DIR, {
      key,
      name,
      layout: Object.assign({}, source, { name })
    });
    return { success: true, key: result.key, layout: Object.assign({ _filename: result.key }, result.layout) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('layouts:delete', async (_, key) => {
  try {
    ensurePanelLayoutConfig();
    const result = deleteLayoutFile(PANEL_LAYOUTS_DIR, key, DEFAULT_WORKSPACE_SET);
    if (!result.success) return result;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('layouts:load-state', async () => {
  ensurePanelLayoutConfig();
  return loadPanelLayoutState();
});

ipcMain.handle('layouts:save-state', async (_, state) => {
  try {
    ensurePanelLayoutConfig();
    const next = savePanelLayoutState(state);
    return { success: true, state: next };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('layouts:save-current', async (_, layout) => {
  try {
    ensurePanelLayoutConfig();
    savePanelCurrentLayout(layout);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('layouts:load-current', async () => {
  ensurePanelLayoutConfig();
  return loadPanelCurrentLayout();
});

ipcMain.handle('layouts:clear-current', async () => {
  ensurePanelLayoutConfig();
  clearPanelCurrentLayout();
  return { success: true };
});

// ── Floating panel windows ──────────────────────────────────────────
const floatWindows = new Map(); // floatId → BrowserWindow

ipcMain.handle('float:create', (event, { floatId, panelType, x, y, width, height, title }) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const win = new BrowserWindow({
    width: width || 460,
    height: height || 320,
    x: x != null ? Math.round(x) : undefined,
    y: y != null ? Math.round(y) : undefined,
    frame: false,
    parent: null,
    resizable: true,
    minimizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'src', 'float-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'float.html'), {
    query: { floatId, panelType, title: title || panelType }
  });

  win.once('ready-to-show', () => win.show());

  win.on('closed', () => {
    floatWindows.delete(floatId);
    if (parent && !parent.isDestroyed()) {
      parent.webContents.send('float:closed', floatId);
    }
  });

  win.on('moved', () => {
    if (parent && !parent.isDestroyed()) {
      const bounds = win.getBounds();
      parent.webContents.send('float:moved', { floatId, x: bounds.x, y: bounds.y });
    }
  });

  win.on('resized', () => {
    if (parent && !parent.isDestroyed()) {
      const bounds = win.getBounds();
      parent.webContents.send('float:resized', { floatId, width: bounds.width, height: bounds.height });
    }
  });

  floatWindows.set(floatId, win);
  return { floatId };
});

ipcMain.handle('float:close', (event, floatId) => {
  const win = floatWindows.get(floatId);
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle('float:dock', (event, floatId) => {
  const win = floatWindows.get(floatId);
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.on('float:send-state', (event, { floatId, state }) => {
  const win = floatWindows.get(floatId);
  if (win && !win.isDestroyed()) {
    win.webContents.send('float:state-update', state);
  }
});

ipcMain.on('float:message', (event, { floatId, channel, data }) => {
  // On dock-drag-request, hide the float window so main window receives mouse events
  if (channel === 'dock-drag-request') {
    const win = floatWindows.get(floatId);
    if (win && !win.isDestroyed()) win.hide();
  }

  const mainWin = BrowserWindow.getAllWindows().find(w =>
    w.webContents !== event.sender && !w.isDestroyed()
  );
  if (mainWin) {
    mainWin.webContents.send('float:message', { floatId, channel, data });
  }
});

ipcMain.handle('float:show', (event, floatId) => {
  const win = floatWindows.get(floatId);
  if (win && !win.isDestroyed()) win.show();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => { if (!mainWindow) createWindow(); });
