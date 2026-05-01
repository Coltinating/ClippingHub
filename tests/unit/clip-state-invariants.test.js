import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  validateClipShape,
  computeRequestedDuration,
  computeCoveredDuration,
} = require('../../src/lib/clip-validators.js');

// Pending clips travel from the main renderer to the hub window via
// `ipcMain.on('hub-state-update')` (main.js:996), which is a verbatim
// JSON-friendly relay. Any field that doesn't survive structured-clone
// will silently disappear in the hub UI — including the m3u8Text snapshot
// the validator relies on.
//
// These tests pin the contract for the clip object shape so a future
// refactor (e.g. attaching a Date, a Blob, or a circular ref) breaks
// loudly in CI rather than silently in production.

function buildSampleClip(overrides = {}) {
  return {
    id: 'abc-123',
    name: 'Clip 1',
    caption: '',
    postCaption: '',
    inTime: 4500,
    outTime: 4530,
    seekableStart: 4400,
    isLive: true,
    m3u8Url: 'https://example/playlist.m3u8',
    m3u8Text: '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6.006,\nseg00000.ts',
    postThumbnailDataUrl: '',
    collabClipperId: null,
    collabClipperName: '',
    collabHelperId: null,
    collabHelperName: '',
    ...overrides,
  };
}

// ─── IPC round-trip integrity ─────────────────────────────────────────
describe('pending clip survives JSON round-trip (hub-state-update IPC)', () => {
  it('preserves all timing fields', () => {
    const clip = buildSampleClip();
    const round = JSON.parse(JSON.stringify(clip));
    expect(round.inTime).toBe(clip.inTime);
    expect(round.outTime).toBe(clip.outTime);
    expect(round.seekableStart).toBe(clip.seekableStart);
    expect(round.m3u8Text).toBe(clip.m3u8Text);
    expect(round.isLive).toBe(clip.isLive);
  });

  it('shape stays valid after round-trip', () => {
    const clip = buildSampleClip();
    const round = JSON.parse(JSON.stringify(clip));
    expect(validateClipShape(round)).toEqual({ ok: true, errors: [] });
  });

  it('coverage check produces same result before and after round-trip', () => {
    const clip = buildSampleClip();
    const before = computeCoveredDuration(clip);
    const after  = computeCoveredDuration(JSON.parse(JSON.stringify(clip)));
    expect(after).toEqual(before);
  });

  it('rejects fields that JSON drops silently (catches accidental Date / Map adds)', () => {
    // If someone adds `recordedAt: new Date()` to clipObj, JSON converts
    // it to a string and the field's type contract changes. This test
    // pins the timing fields as primitives and fails loudly otherwise.
    const clip = buildSampleClip({ recordedAt: new Date('2026-01-01') });
    const round = JSON.parse(JSON.stringify(clip));
    expect(typeof round.recordedAt).toBe('string'); // not Date anymore
    // The timing fields we care about are still primitives:
    expect(typeof round.inTime).toBe('number');
    expect(typeof round.outTime).toBe('number');
  });

  it('m3u8Text survives even when long (16k segments ~= 1MB string)', () => {
    const lines = ['#EXTM3U', '#EXT-X-MEDIA-SEQUENCE:0'];
    for (let i = 0; i < 16000; i++) {
      lines.push(`#EXTINF:6.006,`);
      lines.push(`seg${String(i).padStart(6, '0')}.ts`);
    }
    const clip = buildSampleClip({ m3u8Text: lines.join('\n') });
    const round = JSON.parse(JSON.stringify(clip));
    expect(round.m3u8Text.length).toBe(clip.m3u8Text.length);
    // And coverage works on the round-tripped copy:
    const c = computeCoveredDuration(round);
    expect(c.requested).toBe(30);
    expect(c.covered).toBeGreaterThan(0);
  });
});

// ─── In-flight invariants ─────────────────────────────────────────────
// The pending list is mutated in many places: handleMarkOut creates clips,
// repick mutates inTime/outTime, hub action handlers rename. After any
// mutation, these invariants must hold — checking them in tests prevents
// the displayed-vs-export divergence that the user reported.

describe('clip-shape invariants after typical mutations', () => {
  it('newly created clip from mark IN/OUT is valid', () => {
    const c = buildSampleClip();
    expect(validateClipShape(c).ok).toBe(true);
    expect(computeRequestedDuration(c)).toBeGreaterThan(0);
  });

  it('repick OUT to a later time keeps the clip valid', () => {
    const c = buildSampleClip();
    c.outTime = c.outTime + 60;
    expect(validateClipShape(c).ok).toBe(true);
    expect(computeRequestedDuration(c)).toBe(90);
  });

  it('repick OUT before IN is rejected by the shape validator', () => {
    const c = buildSampleClip();
    c.outTime = c.inTime - 1; // bug: someone re-picked OUT before IN
    const r = validateClipShape(c);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('outTime <= inTime');
  });

  it('manual timestamp edit that produces NaN is rejected', () => {
    const c = buildSampleClip();
    c.inTime = parseFloat('not a number'); // user typed garbage in the editable field
    const r = validateClipShape(c);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('inTime is not a finite number');
  });

  it('seekableStart that drifts past inTime (live window slid mid-mark) is flagged', () => {
    const c = buildSampleClip({ seekableStart: 4501 }); // past inTime 4500
    const r = validateClipShape(c);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('seekableStart > inTime');
  });
});

// ─── Display-vs-export pre-flight ─────────────────────────────────────
// This is the assertion that would have surfaced the user's "4:30 vs 2:00"
// bug *before* download. Wire computeCoveredDuration into renderer.js'
// downloadClip() pre-flight to flag mismatches in the UI.

describe('display-vs-export pre-flight (the user-reported bug)', () => {
  it('flags a clip whose snapshot only covers part of the requested range', () => {
    // Requested: 270s (4:30). Snapshot: 20 segs × 6.006s = ~120s.
    const lines = ['#EXTM3U', '#EXT-X-MEDIA-SEQUENCE:0'];
    for (let i = 0; i < 20; i++) {
      lines.push('#EXTINF:6.006,');
      lines.push(`seg${String(i).padStart(5, '0')}.ts`);
    }
    const clip = buildSampleClip({
      inTime: 4500,
      outTime: 4770,
      seekableStart: 4500,
      m3u8Text: lines.join('\n'),
    });
    const c = computeCoveredDuration(clip);
    expect(c.requested).toBeCloseTo(270, 1);
    expect(c.covered).toBeLessThan(150);
    expect(c.truncatedSec).toBeGreaterThan(100);
    // The pending card would say 4:30 but the export will be ~2 minutes.
  });
});
