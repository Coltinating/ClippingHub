import { describe, test, expect, beforeEach, vi } from 'vitest';

const FLAG_KEY = 'ch.tutorial.seen.v1';

function makeEngine(globalRef) {
  vi.resetModules();
  global.window = globalRef;
  return require('../../src/tutorial/tutorial-engine.js');
}

describe('first-run detection', () => {
  beforeEach(() => {
    delete global.window;
  });

  test('isFirstRun true when flag absent', () => {
    const store = {};
    const engine = makeEngine({
      localStorage: {
        getItem: (k) => store[k] || null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
      },
    });
    expect(engine.isFirstRun()).toBe(true);
  });

  test('isFirstRun false when flag set', () => {
    const store = { [FLAG_KEY]: '1' };
    const engine = makeEngine({
      localStorage: {
        getItem: (k) => store[k] || null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(engine.isFirstRun()).toBe(false);
  });

  test('markSeen sets flag', () => {
    const store = {};
    const engine = makeEngine({
      localStorage: {
        getItem: (k) => store[k] || null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
      },
    });
    engine.markSeen();
    expect(store[FLAG_KEY]).toBe('1');
  });
});
