import { describe, test, expect, beforeEach, vi } from 'vitest';

function loadOverlay(globalRef) {
  vi.resetModules();
  global.window = globalRef;
  return require('../../src/tutorial/tutorial-overlay.js');
}

describe('tutorial body templating', () => {
  beforeEach(() => { delete global.window; });

  test('replaces {{kb.id}} with user override when present', () => {
    const overlay = loadOverlay({
      userConfig: { keybinds: { markIn: 'g' } },
      KeybindRegistry: {
        REGISTRY: [{ id: 'markIn', default: 'i' }],
        formatBinding: (b) => b ? b.toUpperCase() : '?',
      },
    });
    const out = overlay._templateBody('Press {{kb.markIn}} to mark.');
    expect(out).toBe('Press <kbd>G</kbd> to mark.');
  });

  test('falls back to KeybindRegistry default when user override missing', () => {
    const overlay = loadOverlay({
      userConfig: { keybinds: {} },
      KeybindRegistry: {
        REGISTRY: [{ id: 'markOut', default: 'k' }],
        formatBinding: (b) => b ? b.toUpperCase() : '?',
      },
    });
    const out = overlay._templateBody('Mark {{kb.markOut}} now.');
    expect(out).toBe('Mark <kbd>K</kbd> now.');
  });

  test('handles multiple tokens in same string', () => {
    const overlay = loadOverlay({
      userConfig: { keybinds: { markIn: 'g', markOut: 'k' } },
      KeybindRegistry: {
        REGISTRY: [],
        formatBinding: (b) => String(b),
      },
    });
    const out = overlay._templateBody('{{kb.markIn}} then {{kb.markOut}}');
    expect(out).toBe('<kbd>g</kbd> then <kbd>k</kbd>');
  });

  test('escapes formatted bind to prevent HTML injection', () => {
    const overlay = loadOverlay({
      userConfig: { keybinds: { evil: '<script>x</script>' } },
      KeybindRegistry: {
        REGISTRY: [],
        formatBinding: (b) => b,
      },
    });
    const out = overlay._templateBody('Press {{kb.evil}}');
    expect(out).toBe('Press <kbd>&lt;script&gt;x&lt;/script&gt;</kbd>');
  });

  test('leaves unknown tokens with no bind as ?', () => {
    const overlay = loadOverlay({
      userConfig: {},
      KeybindRegistry: {
        REGISTRY: [],
        formatBinding: (b) => (b == null ? '?' : String(b)),
      },
    });
    const out = overlay._templateBody('Hit {{kb.nonexistent}}');
    expect(out).toBe('Hit <kbd>?</kbd>');
  });
});
