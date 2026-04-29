import { describe, it, expect } from 'vitest';

// Locks the contract for isAdvancedMode(): reads window.userConfig.devFeatures.advancedPanelSystem,
// defaults to false when any layer is missing. The same logic lives inside panels.js (browser IIFE),
// re-derived here against an injectable global so it's testable.

function isAdvancedMode(globalRef) {
  var w = globalRef || (typeof window !== 'undefined' ? window : {});
  return !!(w.userConfig && w.userConfig.devFeatures && w.userConfig.devFeatures.advancedPanelSystem);
}

describe('isAdvancedMode', () => {
  it('returns false when userConfig is missing', () => {
    expect(isAdvancedMode({})).toBe(false);
  });
  it('returns false when devFeatures is missing', () => {
    expect(isAdvancedMode({ userConfig: {} })).toBe(false);
  });
  it('returns false when flag is explicitly false', () => {
    expect(isAdvancedMode({ userConfig: { devFeatures: { advancedPanelSystem: false } } })).toBe(false);
  });
  it('returns true when flag is true', () => {
    expect(isAdvancedMode({ userConfig: { devFeatures: { advancedPanelSystem: true } } })).toBe(true);
  });
});
