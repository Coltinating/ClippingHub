// Songs dedup helper.
//
// Used by main.js scan-clip-songs IPC handler to maintain a single user-chosen
// .txt of recognized tracks across many Shazam scans. The format is one
// "Artist - Title" per line. Dedup is case-insensitive on the (artist, title)
// pair so re-scanning the same range doesn't produce repeats.

const fs = require('fs');
const path = require('path');

function makeKey(artist, title) {
  const a = String(artist || '').trim().toLowerCase();
  const t = String(title || '').trim().toLowerCase();
  return `${a}|||${t}`;
}

function formatLine(artist, title) {
  return `${String(artist).trim()} - ${String(title).trim()}`;
}

// Strip a leading "[HH:MM:SS]  " timestamp prefix produced by older runs of
// scan.py. Keeps backward compat with files written before main.js owned the
// dedup format.
function stripTimestampPrefix(line) {
  return line.replace(/^\s*\[\d{1,2}:\d{2}:\d{2}\]\s*/, '');
}

function parseExistingFile(filePath) {
  const seen = new Set();
  if (!filePath || !fs.existsSync(filePath)) return seen;
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (_) {
    return seen;
  }
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripTimestampPrefix(rawLine).trim();
    if (!line) continue;
    // Split on the FIRST " - " so titles containing " - Remix" etc. survive.
    const idx = line.indexOf(' - ');
    if (idx < 0) continue;
    const artist = line.slice(0, idx);
    const title = line.slice(idx + 3);
    if (!artist.trim() || !title.trim()) continue;
    seen.add(makeKey(artist, title));
  }
  return seen;
}

function appendIfNew(filePath, seen, artist, title) {
  if (!filePath) return false;
  const a = String(artist || '').trim();
  const t = String(title || '').trim();
  if (!a || !t) return false;
  const key = makeKey(a, t);
  if (seen.has(key)) return false;
  seen.add(key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, formatLine(a, t) + '\n', 'utf-8');
  return true;
}

module.exports = {
  makeKey,
  formatLine,
  parseExistingFile,
  appendIfNew,
};
