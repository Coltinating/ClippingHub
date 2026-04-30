import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const dedup = require('../../src/lib/songs-dedup.js');
const { parseExistingFile, makeKey, formatLine, appendIfNew } = dedup;

let tmpFile;
beforeEach(() => {
  tmpFile = path.join(os.tmpdir(), `songs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
});
afterEach(() => {
  try { fs.unlinkSync(tmpFile); } catch (_) {}
});

describe('makeKey', () => {
  it('lowercases and trims artist + title for case-insensitive dedup', () => {
    expect(makeKey(' Foo Bar ', ' Hello World ')).toBe('foo bar|||hello world');
  });

  it('treats different case as the same key', () => {
    expect(makeKey('Foo', 'Bar')).toBe(makeKey('FOO', 'BAR'));
  });
});

describe('formatLine', () => {
  it('renders Artist - Title', () => {
    expect(formatLine('Foo', 'Bar')).toBe('Foo - Bar');
  });

  it('strips surrounding whitespace', () => {
    expect(formatLine('  Foo  ', '  Bar  ')).toBe('Foo - Bar');
  });
});

describe('parseExistingFile', () => {
  it('returns empty Set when file does not exist', () => {
    const seen = parseExistingFile(tmpFile);
    expect(seen).toBeInstanceOf(Set);
    expect(seen.size).toBe(0);
  });

  it('parses lines like "Artist - Title" into keys', () => {
    fs.writeFileSync(tmpFile, 'Foo - Bar\nBaz - Qux\n');
    const seen = parseExistingFile(tmpFile);
    expect(seen.has(makeKey('Foo', 'Bar'))).toBe(true);
    expect(seen.has(makeKey('Baz', 'Qux'))).toBe(true);
    expect(seen.size).toBe(2);
  });

  it('skips empty lines and lines without a separator', () => {
    fs.writeFileSync(tmpFile, '\nNotALine\nFoo - Bar\n  \n');
    const seen = parseExistingFile(tmpFile);
    expect(seen.size).toBe(1);
    expect(seen.has(makeKey('Foo', 'Bar'))).toBe(true);
  });

  it('handles legacy timestamped lines like "[00:00:42]  Foo - Bar"', () => {
    fs.writeFileSync(tmpFile, '[00:00:42]  Foo - Bar\n[00:01:11]  Baz - Qux\n');
    const seen = parseExistingFile(tmpFile);
    expect(seen.size).toBe(2);
    expect(seen.has(makeKey('Foo', 'Bar'))).toBe(true);
    expect(seen.has(makeKey('Baz', 'Qux'))).toBe(true);
  });

  it('ignores titles that contain " - " in the middle by splitting on the FIRST separator', () => {
    fs.writeFileSync(tmpFile, 'Foo - Bar - Remix\n');
    const seen = parseExistingFile(tmpFile);
    expect(seen.has(makeKey('Foo', 'Bar - Remix'))).toBe(true);
  });
});

describe('appendIfNew', () => {
  it('returns true and writes the line on first occurrence', () => {
    const seen = new Set();
    const written = appendIfNew(tmpFile, seen, 'Foo', 'Bar');
    expect(written).toBe(true);
    expect(fs.readFileSync(tmpFile, 'utf-8')).toBe('Foo - Bar\n');
    expect(seen.has(makeKey('Foo', 'Bar'))).toBe(true);
  });

  it('returns false and does not append on duplicate', () => {
    const seen = new Set();
    appendIfNew(tmpFile, seen, 'Foo', 'Bar');
    const written = appendIfNew(tmpFile, seen, 'foo', 'bar'); // case-different
    expect(written).toBe(false);
    expect(fs.readFileSync(tmpFile, 'utf-8')).toBe('Foo - Bar\n');
  });

  it('appends across multiple distinct songs', () => {
    const seen = new Set();
    appendIfNew(tmpFile, seen, 'Foo', 'Bar');
    appendIfNew(tmpFile, seen, 'Baz', 'Qux');
    appendIfNew(tmpFile, seen, 'Foo', 'Bar');
    expect(fs.readFileSync(tmpFile, 'utf-8')).toBe('Foo - Bar\nBaz - Qux\n');
  });

  it('rejects empty artist or title without writing', () => {
    const seen = new Set();
    expect(appendIfNew(tmpFile, seen, '', 'Bar')).toBe(false);
    expect(appendIfNew(tmpFile, seen, 'Foo', '   ')).toBe(false);
    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  it('seeds the set from the existing file when called fresh', () => {
    fs.writeFileSync(tmpFile, 'Foo - Bar\n');
    const seen = parseExistingFile(tmpFile);
    const written = appendIfNew(tmpFile, seen, 'Foo', 'Bar');
    expect(written).toBe(false);
    expect(fs.readFileSync(tmpFile, 'utf-8')).toBe('Foo - Bar\n');
  });

  it('creates parent directory if missing', () => {
    const subFile = path.join(os.tmpdir(), `songs-deep-${Date.now()}`, 'nested', 'songs.txt');
    const seen = new Set();
    try {
      const written = appendIfNew(subFile, seen, 'Foo', 'Bar');
      expect(written).toBe(true);
      expect(fs.readFileSync(subFile, 'utf-8')).toBe('Foo - Bar\n');
    } finally {
      try { fs.rmSync(path.dirname(path.dirname(subFile)), { recursive: true, force: true }); } catch (_) {}
    }
  });
});
