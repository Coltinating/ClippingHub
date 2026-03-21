const { app, BrowserWindow, ipcMain, nativeImage, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { URL } = require('url');
const express = require('express');
const http = require('http');
const https = require('https');

// ── Batch Testing (dev) ─────────────────────────────────────────
const { registerBatchIPC } = require('./src/batch/batch-ipc');

// ── Debug Logger ─────────────────────────────────────────────────
const DEBUG_DIR = path.join(
  process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
  'ClippingHub', 'logs'
);
let debugLogStream = null;
let debugSessionId = null;

function initDebugLog() {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  debugSessionId = stamp;
  const logPath = path.join(DEBUG_DIR, `session_${stamp}.log`);
  debugLogStream = fs.createWriteStream(logPath, { flags: 'a' });
  debugLog('SESSION', `Started — pid=${process.pid} electron=${process.versions.electron} node=${process.versions.node}`);
  debugLog('SESSION', `Log file: ${logPath}`);
}

// Sanitize paths and identifiers from log output
const _userDir = require('os').homedir();
const _userDirRegex = new RegExp(_userDir.replace(/[\\\/]/g, '[\\\\/\\\\\\\\]'), 'gi');
const _usernameRegex = new RegExp('(?<=[\\\\/\\\\\\\\])' + path.basename(_userDir) + '(?=[\\\\/\\\\\\\\])', 'gi');
const _computerNameRegex = process.env.COMPUTERNAME
  ? new RegExp(process.env.COMPUTERNAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  : null;

function sanitize(str) {
  if (typeof str !== 'string') return str;
  let s = str.replace(_userDirRegex, 'C:\\Users\\ANON');
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

function debugLog(category, message, data) {
  const ts = new Date().toISOString();
  const safeMessage = sanitize(message);
  const safeData = sanitizeData(data);
  const entry = { ts, category, message: safeMessage, data: safeData };
  const line = safeData !== undefined
    ? `[${ts}] [${category}] ${safeMessage} ${JSON.stringify(safeData)}`
    : `[${ts}] [${category}] ${safeMessage}`;
  if (debugLogStream) debugLogStream.write(line + '\n');
  console.log(line);
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

// Active download process registry (clipName → { proc, phase, cancelled })
const activeDownloads = new Map();

// Detachable hub window
let hubWindow = null;

// Broadcast progress to main window + hub window
function broadcastProgress(clipName, progress) {
  const data = { clipName, progress };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('clip-progress', data);
  if (hubWindow && !hubWindow.isDestroyed()) hubWindow.webContents.send('clip-progress', data);
}

// ── Config paths (AppData/Roaming) ──────────────────────────────
const APPDATA = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming');
const CONFIG_DIR = path.join(APPDATA, 'ClippingHub');
const USER_CONFIG_PATH = path.join(CONFIG_DIR, 'user_config.json');
const WATERMARK_CONFIG_PATH = path.join(CONFIG_DIR, 'watermark_config.json');
const CHANNEL_CONFIG_PATH = path.join(CONFIG_DIR, 'channel_config.json');

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// ── Rumble session partition ─────────────────────────────────────
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
      reject(new Error('No stream found in 25s. Try Browse Rumble to navigate manually.'));
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

// ── IPC: Rumble navigator ────────────────────────────────────────
ipcMain.handle('open-navigator', (event, { url } = {}) => {
  if (navWindow && !navWindow.isDestroyed()) {
    navWindow.focus();
    if (url) navWindow.loadURL(url);
    return { opened: true };
  }

  const ses = session.fromPartition(PARTITION);

  navWindow = new BrowserWindow({
    width: 1100, height: 760,
    title: 'Browse Rumble — Clipper Hub',
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

// ══════════════════════════════════════════════════════════════════
// ── Watermark: build ffmpeg drawtext filter ──────────────────────
// (Ported from ClipperWATERMARKTESTING)
// ══════════════════════════════════════════════════════════════════

const FONT_FILE_MAP = {
  'Arial':         'arial.ttf',
  'Impact':        'impact.ttf',
  'Georgia':       'georgia.ttf',
  'Courier New':   'cour.ttf',
  'Verdana':       'verdana.ttf',
  'Tahoma':        'tahoma.ttf',
  'Trebuchet MS':  'trebuc.ttf',
  'Comic Sans MS': 'comic.ttf',
};

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

  const fontFileName = FONT_FILE_MAP[fontFamily] || 'arial.ttf';
  const fontsDir = path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'Fonts');
  const fontPath = path.join(fontsDir, fontFileName).replace(/\\/g, '/').replace(/:/g, '\\:');

  return `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${ffColor}:x=${x}:y=${y}:fontfile='${fontPath}'`;
}

// ══════════════════════════════════════════════════════════════════
// ── IPC: download clip via ffmpeg ────────────────────────────────
// Clipper's segment-based download pipeline — PRESERVED FROM CLIPPER
// Added: watermark filter, outro concatenation, GPU accel options
// ══════════════════════════════════════════════════════════════════

ipcMain.handle('download-clip', async (event, { m3u8Url, startSec, durationSec, clipName, watermark, imageWatermark, outro, ffmpegOptions, batchOutputDir, batchManifest, keepTempFiles, logFfmpegCommands }) => {
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

  const proxyBase = `http://127.0.0.1:${proxyPort}`;

  const toProxyUrl = (url) => {
    if (!url.startsWith('http')) return proxyBase + url;
    if (url.startsWith(proxyBase)) return url;
    return `${proxyBase}/proxy?url=${encodeURIComponent(url)}`;
  };

  const fetchText = (url) => new Promise((resolve, reject) => {
    const abs = toProxyUrl(url);
    http.get(abs, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });

  const fetchBuffer = (url) => new Promise((resolve, reject) => {
    const abs = toProxyUrl(url);
    http.get(abs, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });

  const parseSegments = (text) => {
    const mod = require('./src/lib/ffmpeg-args.js');
    return mod.parseSegments(text);
  };

  const resolveMediaUrl = async (url) => {
    const text = await fetchText(url);
    if (!text.includes('#EXT-X-STREAM-INF')) return { url, text };
    const lines = text.split('\n');
    let bestBw = -1, bestUrl = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
        const bw = parseInt(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || '0');
        const next = lines[i + 1]?.trim();
        if (next && !next.startsWith('#') && bw > bestBw) { bestBw = bw; bestUrl = next; }
      }
    }
    if (!bestUrl) throw new Error('No variant stream found in master playlist');
    const mediaUrl = bestUrl.startsWith('http') ? bestUrl : proxyBase + bestUrl;
    const mediaText = await fetchText(mediaUrl);
    return { url: mediaUrl, text: mediaText };
  };

  const tempDir = path.join(clipsDir, `_tmp_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Register early so cancelClip() can set the cancelled flag during segment download
    activeDownloads.set(clipName, { proc: null, phase: 'segments', cancelled: false });

    // 1. Resolve to a media playlist and parse segments
    debugLog('CLIP', 'Resolving media playlist...');
    const { text: mediaText } = await resolveMediaUrl(m3u8Url);
    const { segments, mediaSequence, totalDuration } = parseSegments(mediaText);
    debugLog('CLIP', 'Playlist parsed', { segmentCount: segments.length, mediaSequence, totalDuration, firstSeg: segments[0]?.startTime, lastSeg: segments[segments.length-1]?.startTime });
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
      const buf = await fetchBuffer(seg.url);
      fs.writeFileSync(tsPath, buf);
      tsPaths.push(tsPath);
      broadcastProgress(clipName, Math.round(((i + 1) / relevant.length) * 60));
    }

    // 4. Write ffmpeg concat list and join segments into a single .ts
    const listFile = path.join(tempDir, 'files.txt');
    fs.writeFileSync(listFile, tsPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));

    const concatPath = path.join(tempDir, 'concat.ts');
    const { buildConcatArgs, buildImageWatermarkArgs } = require('./src/lib/ffmpeg-args.js');
    const concatArgs = buildConcatArgs(listFile, concatPath);
    ffmpegCommands.push({ step: '1. Segment concat (join .ts segments)', args: ['ffmpeg', ...concatArgs] });
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', concatArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
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

      // GPU acceleration (input side)
      if (opts.hwaccel) {
        ffArgs.push('-hwaccel', opts.hwaccel);
        if (opts.hwaccelOutputFormat) ffArgs.push('-hwaccel_output_format', opts.hwaccelOutputFormat);
        if (opts.hwaccelDevice !== undefined && opts.hwaccelDevice !== '') ffArgs.push('-hwaccel_device', String(opts.hwaccelDevice));
      }

      ffArgs.push('-i', concatPath, '-ss', String(ssOffset), '-t', String(durationSec));

      if (imgWmArgs) {
        // Image watermark — use filter_complex with second input
        ffArgs.push(...imgWmArgs.inputs);
        if (wmFilter) {
          // Both text + image: apply text drawtext on video, then overlay image
          const fc = imgWmArgs.filterComplex.replace(
            '[0:v]setpts=PTS-STARTPTS[base]',
            `[0:v]setpts=PTS-STARTPTS,${wmFilter}[base]`
          );
          ffArgs.push('-filter_complex', fc);
        } else {
          ffArgs.push('-filter_complex', imgWmArgs.filterComplex);
        }
      } else {
        // No image watermark — simple -vf (existing behavior)
        const ptsFilter = 'setpts=PTS-STARTPTS';
        ffArgs.push('-vf', wmFilter ? ptsFilter + ',' + wmFilter : ptsFilter);
      }
      ffArgs.push('-c:v', videoCodec);
      if (videoCodec === 'libx264' || videoCodec === 'libx265') {
        ffArgs.push('-preset', preset, '-crf', crf);
      } else if (videoCodec === 'h264_nvenc' || videoCodec === 'hevc_nvenc') {
        ffArgs.push('-preset', opts.nvencPreset || 'p4', '-cq', crf);
      }

      // Audio
      const audioCodec = opts.audioCodec || 'aac';
      const audioBitrate = opts.audioBitrate || '192k';
      ffArgs.push('-c:a', audioCodec, '-b:a', audioBitrate);
      ffArgs.push('-movflags', '+faststart', trimmedPath);

      ffmpegCommands.push({ step: '2. Trim & encode (seek, cut, transcode)', args: ['ffmpeg', ...ffArgs] });
      debugLog('FFMPEG', 'Trim command', { args: ffArgs.join(' ') });
      const proc = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
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
        const proc = spawn('ffprobe', [
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
        outroResizeArgs.push('-preset', preset, '-crf', '15');
      } else if (videoCodec === 'h264_nvenc' || videoCodec === 'hevc_nvenc') {
        outroResizeArgs.push('-preset', opts.nvencPreset || 'p4', '-cq', '15');
      }
      outroResizeArgs.push(
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart',
        outroResized
      );
      ffmpegCommands.push({ step: '3. Outro resize (scale to clip resolution)', args: ['ffmpeg', ...outroResizeArgs] });
      await new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', outroResizeArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
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

      // Re-encode trimmed clip to ensure matching codec params
      const clipReady = path.join(tempDir, 'clip_ready.mp4');
      const clipPrepArgs = ['-y'];
      if (opts.hwaccel) {
        clipPrepArgs.push('-hwaccel', opts.hwaccel);
        if (opts.hwaccelDevice !== undefined && opts.hwaccelDevice !== '') clipPrepArgs.push('-hwaccel_device', String(opts.hwaccelDevice));
      }
      clipPrepArgs.push(
        '-i', trimmedPath,
        '-c:v', videoCodec
      );
      if (videoCodec === 'libx264' || videoCodec === 'libx265') {
        clipPrepArgs.push('-preset', preset, '-crf', '15');
      } else if (videoCodec === 'h264_nvenc' || videoCodec === 'hevc_nvenc') {
        clipPrepArgs.push('-preset', opts.nvencPreset || 'p4', '-cq', '15');
      }
      clipPrepArgs.push(
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart',
        clipReady
      );
      ffmpegCommands.push({ step: '4. Clip prep (normalize for concat)', args: ['ffmpeg', ...clipPrepArgs] });
      await new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', clipPrepArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        activeDownloads.set(clipName, { proc, phase: 'clip-prep', cancelled: false });
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('close', code => {
          ffmpegStepLogs.push({ step: '4. Clip prep', stderr });
          if (activeDownloads.get(clipName)?.cancelled) { reject(Object.assign(new Error('Cancelled'), { cancelled: true })); return; }
          code === 0 ? resolve() : reject(new Error('Clip prep failed'));
        });
        proc.on('error', reject);
      });

      // Concat clip + outro
      const concatList = path.join(tempDir, 'final_concat.txt');
      fs.writeFileSync(concatList, `file '${clipReady.replace(/'/g, "'\\''")}'\nfile '${outroResized.replace(/'/g, "'\\''")}'`);

      const finalConcatArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', '-movflags', '+faststart', out];
      ffmpegCommands.push({ step: '5. Final concat (clip + outro)', args: ['ffmpeg', ...finalConcatArgs] });
      await new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', finalConcatArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        activeDownloads.set(clipName, { proc, phase: 'final-concat', cancelled: false });
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('close', code => {
          ffmpegStepLogs.push({ step: '5. Final concat', stderr });
          if (activeDownloads.get(clipName)?.cancelled) { reject(Object.assign(new Error('Cancelled'), { cancelled: true })); return; }
          code === 0 ? resolve() : reject(new Error('Final concat failed'));
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
    title: 'Clipper Hub',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      webviewTag: true,
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://localhost:${proxyPort}`);
  mainWindow.webContents.openDevTools({ mode: 'bottom' });
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Close child windows so the app quits
    if (hubWindow && !hubWindow.isDestroyed()) hubWindow.close();
    if (debugWindow && !debugWindow.isDestroyed()) debugWindow.close();
  });
}

// ── Boot ─────────────────────────────────────────────────────────
app.whenReady().then(() => {
  clipsDir = path.join(app.getPath('videos'), 'ClipperHub');
  ensureConfigDir();
  initDebugLog();
  registerBatchIPC(debugLog);

  const httpServer = http.createServer(expressApp);
  httpServer.listen(0, '127.0.0.1', () => {
    proxyPort = httpServer.address().port;
    debugLog('SESSION', `Server listening on port ${proxyPort}`);
    debugLog('SESSION', `Clips dir: ${clipsDir}`);
    createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => { if (!mainWindow) createWindow(); });
