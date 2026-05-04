import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const M = require('../../src/player/timeline-zoom-math.js');

describe('timeToFrac / fracToTime', () => {
  it('round-trips a time within view to the same time', () => {
    const view = { start: 100, end: 200 };
    const f = M.timeToFrac(view, 150);
    expect(f).toBe(0.5);
    expect(M.fracToTime(view, f)).toBe(150);
  });

  it('returns 0 at view start, 1 at view end', () => {
    const view = { start: 0, end: 18000 };
    expect(M.timeToFrac(view, 0)).toBe(0);
    expect(M.timeToFrac(view, 18000)).toBe(1);
  });
});

describe('clampView', () => {
  it('keeps span fixed when start would go negative', () => {
    const v = M.clampView({ start: -50, end: 50 }, /*total*/ 1000);
    expect(v.start).toBe(0);
    expect(v.end).toBe(100);
  });

  it('keeps span fixed when end would exceed total', () => {
    const v = M.clampView({ start: 950, end: 1050 }, 1000);
    expect(v.start).toBe(900);
    expect(v.end).toBe(1000);
  });

  it('passes through a valid view unchanged', () => {
    const v = M.clampView({ start: 100, end: 200 }, 1000);
    expect(v).toEqual({ start: 100, end: 200 });
  });
});

describe('zoomAround', () => {
  it('zooms in around cursor and keeps cursor at same fraction', () => {
    const v = M.zoomAround(
      { start: 0, end: 1000 },
      /*cursorFrac*/ 0.5,
      /*factor*/ 0.5,
      /*total*/ 1000,
      /*minSpan*/ 2
    );
    expect(v.end - v.start).toBe(500);
    expect(v.start).toBe(250);
    expect(v.end).toBe(750);
  });

  it('clamps to minSpan', () => {
    const v = M.zoomAround({ start: 100, end: 110 }, 0.5, 0.1, 1000, 5);
    expect(v.end - v.start).toBe(5);
  });

  it('clamps to total when zooming out past full range', () => {
    const v = M.zoomAround({ start: 100, end: 200 }, 0.5, 100, 1000, 2);
    expect(v.end - v.start).toBe(1000);
    expect(v.start).toBe(0);
    expect(v.end).toBe(1000);
  });
});

describe('shiftView', () => {
  it('shifts both ends by delta and preserves span', () => {
    const v = M.shiftView({ start: 100, end: 200 }, 50, 1000);
    expect(v.start).toBe(150);
    expect(v.end).toBe(250);
  });

  it('clamps without shrinking span at left edge', () => {
    const v = M.shiftView({ start: 100, end: 200 }, -500, 1000);
    expect(v.start).toBe(0);
    expect(v.end).toBe(100);
  });
});

describe('pickTickStep', () => {
  it('picks 1800 (30min) for a 5h span', () => {
    expect(M.pickTickStep(18000)).toBe(1800);
  });

  it('picks 1 (1s) for a 10s span', () => {
    expect(M.pickTickStep(10)).toBe(1);
  });

  it('picks 60 (1min) for a 10min span', () => {
    expect(M.pickTickStep(600)).toBe(60);
  });
});

describe('edgeAutoPanShift', () => {
  it('returns 0 when cursor is in the middle', () => {
    const s = M.edgeAutoPanShift({ localX: 500, width: 1000, span: 100, edgeFrac: 0.06, pxPerFrame: 6 });
    expect(s).toBe(0);
  });

  it('returns negative shift when cursor is near left edge', () => {
    const s = M.edgeAutoPanShift({ localX: 5, width: 1000, span: 100, edgeFrac: 0.06, pxPerFrame: 6 });
    expect(s).toBeLessThan(0);
  });

  it('returns positive shift when cursor is near right edge', () => {
    const s = M.edgeAutoPanShift({ localX: 995, width: 1000, span: 100, edgeFrac: 0.06, pxPerFrame: 6 });
    expect(s).toBeGreaterThan(0);
  });
});
