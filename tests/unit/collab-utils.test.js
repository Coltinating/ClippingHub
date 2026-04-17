import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const utils = require('../../src/lib/collab-utils.js');

describe('collab-utils', () => {
  it('builds actor labels with helper suffix', () => {
    const label = utils.getDisplayActor({
      userName: 'MainClipper',
      clipperName: 'MainClipper',
      helperName: 'HelperOne'
    });
    expect(label).toBe('MainClipper (HelperOne)');
  });

  it('builds active indicator text with deduped actor names', () => {
    const out = utils.buildIndicatorAtTime([
      { inTime: 10, outTime: 30, clipperName: 'A', helperName: 'H1' },
      { inTime: 20, outTime: 40, clipperName: 'A', helperName: 'H1' },
      { inTime: 15, outTime: 18, clipperName: 'B', helperName: '' }
    ], 17);
    expect(out).toEqual({
      text: 'Clipped/Being Clipped by A (H1), B',
      names: ['A (H1)', 'B']
    });
  });

  it('maps activity status text for feed line', () => {
    expect(utils.getActivityVerb('marking')).toBe('selected');
    expect(utils.getActivityVerb('queued')).toBe('queued');
    expect(utils.getActivityVerb('downloading')).toBe('downloading');
    expect(utils.getActivityVerb('done')).toBe('downloaded');
  });
});

describe('formatClipAttribution', () => {
  it('returns "by Clipper" when no helper', () => {
    expect(utils.formatClipAttribution({ clipperName: 'Socks' })).toBe('by Socks');
  });
  it('returns "by Clipper (Helper)" when helper differs', () => {
    expect(utils.formatClipAttribution({ clipperName: 'Socks', helperName: 'Owl' })).toBe('by Socks (Owl)');
  });
  it('collapses when helper equals clipper (case-insensitive)', () => {
    expect(utils.formatClipAttribution({ clipperName: 'Socks', helperName: 'socks' })).toBe('by Socks');
  });
  it('falls back to userName when clipperName missing', () => {
    expect(utils.formatClipAttribution({ userName: 'Anon' })).toBe('by Anon');
  });
  it('returns empty string when no identity', () => {
    expect(utils.formatClipAttribution({})).toBe('');
  });
});
