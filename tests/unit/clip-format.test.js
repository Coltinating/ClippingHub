import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { fmtHMS, fmtDur } = require('../../src/lib/clip-format.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '../..');

// ─── Spec ──────────────────────────────────────────────────────────────
describe('fmtHMS — clip-card IN/OUT timestamp', () => {
  it('formats whole-second positive durations as HH:MM:SS', () => {
    expect(fmtHMS(0)).toBe('00:00:00');
    expect(fmtHMS(59)).toBe('00:00:59');
    expect(fmtHMS(60)).toBe('00:01:00');
    expect(fmtHMS(3599)).toBe('00:59:59');
    expect(fmtHMS(3600)).toBe('01:00:00');
    expect(fmtHMS(3661)).toBe('01:01:01');
  });

  it('floors fractional seconds', () => {
    expect(fmtHMS(59.999)).toBe('00:00:59');
    expect(fmtHMS(0.4)).toBe('00:00:00');
  });

  it('clamps negative / NaN to 00:00:00 instead of "NaN:NaN:NaN"', () => {
    expect(fmtHMS(-1)).toBe('00:00:00');
    expect(fmtHMS(NaN)).toBe('00:00:00');
    expect(fmtHMS(undefined)).toBe('00:00:00');
  });

  it('handles long streams (10h+) without breaking width', () => {
    expect(fmtHMS(36000)).toBe('10:00:00');
    expect(fmtHMS(99999)).toBe('27:46:39');
  });
});

describe('fmtDur — clip-card DUR field', () => {
  it('shows M:SS under 1 hour', () => {
    expect(fmtDur(30)).toBe('0:30');
    expect(fmtDur(60)).toBe('1:00');
    expect(fmtDur(270)).toBe('4:30'); // ← exactly the case the user reported
    expect(fmtDur(3599)).toBe('59:59');
  });

  it('shows H:MM:SS at and past 1 hour', () => {
    expect(fmtDur(3600)).toBe('1:00:00');
    expect(fmtDur(3661)).toBe('1:01:01');
  });

  it('renders "0:00" for falsy / negative / NaN — never "NaN:NaN" on a card', () => {
    expect(fmtDur(0)).toBe('0:00');
    expect(fmtDur(-5)).toBe('0:00');
    expect(fmtDur(NaN)).toBe('0:00');
    expect(fmtDur(undefined)).toBe('0:00');
    expect(fmtDur(null)).toBe('0:00');
  });

  it('floors fractional seconds (no ":00.5" weirdness)', () => {
    expect(fmtDur(30.999)).toBe('0:30');
  });
});

// ─── Cross-file consistency check ──────────────────────────────────────
// fmtHMS / fmtDur are duplicated inline in production HTML/JS files. This
// test extracts each copy and runs it through the same spec, so divergence
// between the production copies and src/lib/clip-format.js is caught at CI
// time rather than in user-visible UI.
//
// If you intentionally rewrite a copy, update both src/lib/clip-format.js
// and these production sites, then re-run the suite.

const PROD_SITES = [
  'src/hub.html',
  'src/player2.js',
  // post-caption.html only ships fmtDur (no fmtHMS) — included to verify
  // its dur-formatter agrees with the spec.
  'src/post-caption.html',
];

function extractFn(source, name) {
  // Match `function NAME(...) { ... }` with balanced braces on a single
  // function. Cheap heuristic — sufficient for these small functions.
  const reHeader = new RegExp(`function\\s+${name}\\s*\\(`, 'm');
  const headMatch = source.match(reHeader);
  if (!headMatch) return null;
  const start = headMatch.index;
  let i = source.indexOf('{', start);
  if (i < 0) return null;
  let depth = 1;
  i++;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return source.slice(start, i);
}

function compileFn(fnSource, deps = '') {
  // Extracted source may reference helpers like `pad2`. Inject minimal deps.
  const wrapped = `${deps}\n${fnSource}\nreturn ${fnSource.match(/function\s+(\w+)/)[1]};`;
  // eslint-disable-next-line no-new-func
  return new Function(wrapped)();
}

const PAD2_HELPER = `function pad2(n) { return String(n).padStart(2, '0'); }`;

describe('production copies of fmtHMS / fmtDur agree with the canonical spec', () => {
  const cases = {
    fmtHMS: [
      [0, '00:00:00'],
      [59, '00:00:59'],
      [3661, '01:01:01'],
      [-1, '00:00:00'],
    ],
    fmtDur: [
      [30, '0:30'],
      [270, '4:30'],
      [3661, '1:01:01'],
      [-5, '0:00'],
      [NaN, '0:00'],
    ],
  };

  for (const rel of PROD_SITES) {
    const abs = resolve(repoRoot, rel);
    let source = '';
    try { source = readFileSync(abs, 'utf8'); } catch { /* file may not exist */ }
    if (!source) continue;

    for (const [fnName, expected] of Object.entries(cases)) {
      const fnSrc = extractFn(source, fnName);
      // post-caption.html doesn't have fmtHMS — skip rather than fail.
      if (!fnSrc) continue;
      it(`${rel} :: ${fnName} matches spec`, () => {
        const fn = compileFn(fnSrc, PAD2_HELPER);
        for (const [input, want] of expected) {
          expect(fn(input), `${rel} ${fnName}(${String(input)})`).toBe(want);
        }
      });
    }
  }
});
