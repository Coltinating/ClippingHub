const { app, BrowserWindow, ipcMain, nativeImage, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { URL } = require('url');
const express = require('express');
const http = require('http');
const https = require('https');

// ── State ───────────────────────────────────────────────────────
let mainWindow = null;
let navWindow = null;
let proxyPort = null;
const liveCaptures = new Map();
let clipsDir = null;

// ── Rumble session partition ─────────────────────────────────────
// All Rumble page loads (navigator, extraction) share this session
// so cookies are preserved — the proxy reuses the same session to
// fetch m3u8 manifests and segments with valid auth credentials.
const PARTITION = 'persist:rumble';

// ── Express app ──────────────────────────────────────────────────
const expressApp = express();
expressApp.use(express.json());

// ── CORS proxy using Electron session.fetch() ────────────────────
// Uses the persist:rumble session so Rumble cookies are forwarded.
// This is essential — Rumble's HLS keys are bound to the session.
expressApp.get('/proxy', async (req, res) => {
  const target = req.query.url;
  console.log('[PROXY]', target ? target.slice(0, 120) : '(no url)');
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
    console.log('[PROXY] status:', response.status, 'ct:', ct);
    res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(response.status);

    if (ct.includes('mpegurl') || target.includes('.m3u8')) {
      // Rewrite all URLs inside the manifest to route through this proxy
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
    console.error('[PROXY] error:', err.message);
    if (!res.headersSent) res.status(502).send('Proxy error: ' + err.message);
  }
});

// Serve renderer static files
expressApp.use(express.static(path.join(__dirname, 'src')));

// ── IPC: extract m3u8 via hidden Electron window ─────────────────
// Opens a hidden browser in the Rumble session, waits for the HLS
// manifest request to fire, then returns the URL. No Playwright needed.
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

    // After DOM loads try to trigger video playback
    hidden.webContents.on('did-finish-load', () => {
      if (found) return;
      setTimeout(() => {
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

// ── IPC: built-in Rumble navigator ───────────────────────────────
// A real browser window pointed at Rumble. When any .m3u8 request
// fires, we send it straight to the main renderer for playback.
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

  // Inject a small notification bar into the Rumble page
  navWindow.webContents.on('did-finish-load', () => {
    navWindow.webContents.insertCSS(`
      #ch-bar { position:fixed;top:0;left:0;right:0;z-index:2147483647;
        background:#18181c;border-bottom:2px solid #e8a455;
        padding:7px 16px;display:flex;align-items:center;gap:10px;
        font-family:system-ui,sans-serif;font-size:12px;color:#d4cfc8; }
      #ch-bar b { color:#e8a455; }
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

// ── IPC: proxy port ──────────────────────────────────────────────
ipcMain.handle('get-proxy-port', () => proxyPort);

// ── IPC: clips directory ─────────────────────────────────────────
ipcMain.handle('get-clips-dir', () => clipsDir);

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

// ── IPC: download clip via ffmpeg ────────────────────────────────
// Instead of handing the m3u8 URL directly to ffmpeg (which fails on
// Rumble's multi-program HLS), we replicate what the Python reference
// script does: parse the playlist ourselves, download each .ts segment
// individually through the existing localhost proxy, then let ffmpeg
// concat+trim local files — which always works reliably.
ipcMain.handle('download-clip', async (event, { m3u8Url, startSec, durationSec, clipName }) => {
  fs.mkdirSync(clipsDir, { recursive: true });

  const safeName = (clipName || 'clip')
    .replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-').toLowerCase().slice(0, 80);

  let out = path.join(clipsDir, `${safeName}.mp4`);
  for (let i = 1; fs.existsSync(out); i++) out = path.join(clipsDir, `${safeName}-${i}.mp4`);

  const proxyBase = `http://127.0.0.1:${proxyPort}`;

  // Route ALL URLs through the local proxy — external https:// URLs are
  // re-wrapped so Node's http.get() never has to speak https directly.
  const toProxyUrl = (url) => {
    if (!url.startsWith('http')) return proxyBase + url;        // relative path
    if (url.startsWith(proxyBase)) return url;                  // already proxied
    return `${proxyBase}/proxy?url=${encodeURIComponent(url)}`; // wrap external URL
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

  // Parse segments out of a media playlist text.
  // Returns [{ url, duration, startTime }]
  const parseSegments = (text) => {
    const lines = text.split('\n');
    const segs = [];
    let t = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXTINF:')) {
        const dur = parseFloat(line.match(/#EXTINF:([\d.]+)/)?.[1] || '0');
        const next = lines[i + 1]?.trim();
        if (next && !next.startsWith('#')) {
          segs.push({ url: next, duration: dur, startTime: t });
          t += dur;
        }
      }
    }
    return segs;
  };

  // Resolve a master playlist down to its highest-bandwidth variant URL
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
    // bestUrl is a proxy-relative path like /proxy?url=...
    const mediaUrl = bestUrl.startsWith('http') ? bestUrl : proxyBase + bestUrl;
    const mediaText = await fetchText(mediaUrl);
    return { url: mediaUrl, text: mediaText };
  };

  const tempDir = path.join(clipsDir, `_tmp_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // 1. Resolve to a media playlist and parse segments
    const { text: mediaText } = await resolveMediaUrl(m3u8Url);
    const segments = parseSegments(mediaText);
    if (!segments.length) throw new Error('No segments found in playlist');

    // 2. Find segments that overlap [startSec, startSec+durationSec)
    const endSec = startSec + durationSec;
    const relevant = segments.filter(s => s.startTime + s.duration > startSec && s.startTime < endSec);
    if (!relevant.length) throw new Error('No segments found in the requested time range');

    // 3. Download each segment through the proxy
    const tsPaths = [];
    for (let i = 0; i < relevant.length; i++) {
      const seg = relevant[i];
      const tsPath = path.join(tempDir, `seg_${String(i).padStart(4, '0')}.ts`);
      const buf = await fetchBuffer(seg.url);
      fs.writeFileSync(tsPath, buf);
      tsPaths.push(tsPath);
      mainWindow?.webContents.send('clip-progress', {
        clipName, progress: Math.round(((i + 1) / relevant.length) * 60)
      });
    }

    // 4. Write ffmpeg concat list and join segments into a single .ts
    const listFile = path.join(tempDir, 'files.txt');
    fs.writeFileSync(listFile, tsPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));

    const concatPath = path.join(tempDir, 'concat.ts');
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', concatPath],
        { stdio: 'pipe' });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg concat failed (code ${code})`)));
      proc.on('error', reject);
    });

    mainWindow?.webContents.send('clip-progress', { clipName, progress: 70 });

    // 5. Remux concat to mp4, snapped to the first .ts fragment boundary so we
    //    never split mid-fragment.  .ts fragments carry PTS values relative to
    //    the live stream origin (e.g. a segment 5 min in starts at PTS ~27M
    //    ticks), NOT relative to zero.  Without resetting them the mp4 has a
    //    large initial timestamp offset which players render as dead/blank space.
    //    -copyts preserves timestamps during processing; -start_at_zero then
    //    shifts the whole presentation so the first packet lands at t=0.
    const snappedDuration = (startSec + durationSec) - relevant[0].startTime;
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-y',
        '-i', concatPath,
        '-t', String(snappedDuration),
        '-c', 'copy',
        '-copyts',
        '-start_at_zero',
        '-movflags', '+faststart',
        out
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr.on('data', d => {
        stderr += d;
        const m = d.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (m) {
          const elapsed = +m[1] * 3600 + +m[2] * 60 + +m[3];
          mainWindow?.webContents.send('clip-progress', {
            clipName, progress: 70 + Math.min(30, Math.round((elapsed / durationSec) * 30))
          });
        }
      });
      proc.on('close', code => {
        if (code === 0 && fs.existsSync(out)) resolve();
        else reject(new Error(`ffmpeg trim failed (code ${code}):\n${stderr.slice(-400)}`));
      });
      proc.on('error', err => reject(new Error('ffmpeg not found: ' + err.message)));
    });

    mainWindow?.webContents.send('clip-progress', { clipName, progress: 100 });
    return { success: true, filePath: out, fileName: path.basename(out), fileSize: fs.statSync(out).size };

  } finally {
    // Clean up temp directory regardless of success or failure
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
});

// ── IPC: live capture ────────────────────────────────────────────
ipcMain.handle('start-live-capture', (_, { captureId, m3u8Url }) => {
  fs.mkdirSync(clipsDir, { recursive: true });
  const tmp = path.join(clipsDir, `_cap_${captureId}.ts`);
  const proc = spawn('ffmpeg', [
    '-headers', 'Referer: https://rumble.com/\r\n',
    '-i', m3u8Url, '-c', 'copy', '-y', tmp
  ], { stdio: 'pipe' });
  liveCaptures.set(captureId, { proc, tmp });
  proc.on('error', () => liveCaptures.delete(captureId));
  return { started: true };
});

ipcMain.handle('stop-live-capture', async (_, { captureId, clipName }) => {
  const cap = liveCaptures.get(captureId);
  if (!cap) return { success: false, error: 'No capture' };

  try { cap.proc.stdin.write('q'); } catch {}
  await new Promise(res => { cap.proc.on('close', res); setTimeout(() => { try { cap.proc.kill(); } catch {} res(); }, 5000); });
  liveCaptures.delete(captureId);

  if (!fs.existsSync(cap.tmp)) return { success: false, error: 'Capture file missing' };

  const safeName = (clipName || 'clip').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-').toLowerCase().slice(0, 80);
  let out = path.join(clipsDir, `${safeName}.mp4`);
  for (let i = 1; fs.existsSync(out); i++) out = path.join(clipsDir, `${safeName}-${i}.mp4`);

  return new Promise(res => {
    const proc = spawn('ffmpeg', ['-i', cap.tmp, '-c', 'copy', '-movflags', '+faststart', '-y', out]);
    proc.on('close', code => {
      try { fs.unlinkSync(cap.tmp); } catch {}
      if (code === 0 && fs.existsSync(out))
        res({ success: true, filePath: out, fileName: path.basename(out), fileSize: fs.statSync(out).size });
      else res({ success: false, error: 'Remux failed' });
    });
    proc.on('error', () => res({ success: false, error: 'ffmpeg not found' }));
  });
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
      webSecurity: false,       // allows HLS.js to fetch cross-origin streams
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://localhost:${proxyPort}`);
  mainWindow.webContents.openDevTools({ mode: 'bottom' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Boot ─────────────────────────────────────────────────────────
app.whenReady().then(() => {
  clipsDir = path.join(app.getPath('videos'), 'ClipperHub');

  const httpServer = http.createServer(expressApp);
  httpServer.listen(0, '127.0.0.1', () => {
    proxyPort = httpServer.address().port;
    console.log(`Clipper Hub running on port ${proxyPort}`);
    createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const [, { proc }] of liveCaptures) try { proc.kill(); } catch {}
  app.quit();
});

app.on('activate', () => { if (!mainWindow) createWindow(); });