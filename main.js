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
let clipsDir = null;

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

ipcMain.handle('download-clip', async (event, { m3u8Url, startSec, durationSec, clipName, watermark, outro, ffmpegOptions }) => {
  fs.mkdirSync(clipsDir, { recursive: true });

  const safeName = (clipName || 'clip')
    .replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-').toLowerCase().slice(0, 80);

  let out = path.join(clipsDir, `${safeName}.mp4`);
  for (let i = 1; fs.existsSync(out); i++) out = path.join(clipsDir, `${safeName}-${i}.mp4`);

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

    // 5. Trim to exact range — with optional watermark, GPU accel, custom ffmpeg options
    const ssOffset = Math.max(0, startSec - relevant[0].startTime);
    const wmFilter = buildWatermarkFilter(watermark);
    const hasOutro = outro && outro.filePath && fs.existsSync(outro.filePath);
    const trimmedPath = hasOutro ? path.join(tempDir, 'trimmed.mp4') : out;

    await new Promise((resolve, reject) => {
      const ffArgs = ['-y'];

      // GPU acceleration (input side)
      const opts = ffmpegOptions || {};
      if (opts.hwaccel) {
        ffArgs.push('-hwaccel', opts.hwaccel);
        if (opts.hwaccelOutputFormat) ffArgs.push('-hwaccel_output_format', opts.hwaccelOutputFormat);
        if (opts.hwaccelDevice !== undefined && opts.hwaccelDevice !== '') ffArgs.push('-hwaccel_device', String(opts.hwaccelDevice));
      }

      ffArgs.push('-i', concatPath, '-ss', String(ssOffset), '-t', String(durationSec));

      if (wmFilter) ffArgs.push('-vf', wmFilter);

      // Video codec
      const videoCodec = opts.videoCodec || 'libx264';
      const preset = opts.preset || 'fast';
      const crf = opts.crf || '18';
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

      const proc = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr.on('data', d => {
        stderr += d;
        const m = d.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (m) {
          const elapsed = +m[1] * 3600 + +m[2] * 60 + +m[3];
          const trimProgress = hasOutro ? 20 : 30;
          mainWindow?.webContents.send('clip-progress', {
            clipName, progress: 70 + Math.min(trimProgress, Math.round((elapsed / durationSec) * trimProgress))
          });
        }
      });
      proc.on('close', code => {
        if (code === 0 && fs.existsSync(trimmedPath)) resolve();
        else reject(new Error(`ffmpeg trim failed (code ${code}):\n${stderr.slice(-400)}`));
      });
      proc.on('error', err => reject(new Error('ffmpeg not found: ' + err.message)));
    });

    // 6. Append outro if provided
    if (hasOutro) {
      mainWindow?.webContents.send('clip-progress', { clipName, progress: 90 });

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
      await new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', [
          '-y', '-i', outro.filePath,
          '-vf', `scale=${probeResult.width}:${probeResult.height}:force_original_aspect_ratio=decrease,pad=${probeResult.width}:${probeResult.height}:(ow-iw)/2:(oh-ih)/2`,
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
          '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
          '-movflags', '+faststart',
          outroResized
        ], { stdio: 'pipe' });
        proc.on('close', code => code === 0 ? resolve() : reject(new Error('Outro resize failed')));
        proc.on('error', reject);
      });

      // Re-encode trimmed clip to ensure matching codec params
      const clipReady = path.join(tempDir, 'clip_ready.mp4');
      await new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', [
          '-y', '-i', trimmedPath,
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
          '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
          '-movflags', '+faststart',
          clipReady
        ], { stdio: 'pipe' });
        proc.on('close', code => code === 0 ? resolve() : reject(new Error('Clip prep failed')));
        proc.on('error', reject);
      });

      // Concat clip + outro
      const concatList = path.join(tempDir, 'final_concat.txt');
      fs.writeFileSync(concatList, `file '${clipReady.replace(/'/g, "'\\''")}'\nfile '${outroResized.replace(/'/g, "'\\''")}'`);

      await new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', [
          '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
          '-c', 'copy', '-movflags', '+faststart', out
        ], { stdio: 'pipe' });
        proc.on('close', code => code === 0 ? resolve() : reject(new Error('Final concat failed')));
        proc.on('error', reject);
      });
    }

    mainWindow?.webContents.send('clip-progress', { clipName, progress: 100 });
    return { success: true, filePath: out, fileName: path.basename(out), fileSize: fs.statSync(out).size };

  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
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
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Boot ─────────────────────────────────────────────────────────
app.whenReady().then(() => {
  clipsDir = path.join(app.getPath('videos'), 'ClipperHub');
  ensureConfigDir();

  const httpServer = http.createServer(expressApp);
  httpServer.listen(0, '127.0.0.1', () => {
    proxyPort = httpServer.address().port;
    console.log(`Clipper Hub running on port ${proxyPort}`);
    createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => { if (!mainWindow) createWindow(); });
