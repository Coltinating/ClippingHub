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

describe('state machine', () => {
  function fakeContent() {
    return {
      sections: [
        { id: 's1', title: 'One', steps: [{ id: 'a' }, { id: 'b' }] },
        { id: 's2', title: 'Two', steps: [{ id: 'c' }] },
      ],
    };
  }

  function memStore() {
    const data = {};
    return {
      getItem: (k) => data[k] || null,
      setItem: (k, v) => { data[k] = v; },
      removeItem: (k) => { delete data[k]; },
      _data: data,
    };
  }

  test('starts in idle state after init', () => {
    const engine = makeEngine({ localStorage: memStore() });
    engine.init(fakeContent());
    expect(engine.getState().phase).toBe('idle');
  });

  test('openTOC -> toc phase', () => {
    const engine = makeEngine({ localStorage: memStore() });
    engine.init(fakeContent());
    engine.openTOC();
    expect(engine.getState().phase).toBe('toc');
  });

  test('startSection -> in-section, step 0', () => {
    const engine = makeEngine({ localStorage: memStore() });
    engine.init(fakeContent());
    engine.startSection('s1');
    const s = engine.getState();
    expect(s.phase).toBe('in-section');
    expect(s.sectionId).toBe('s1');
    expect(s.stepIndex).toBe(0);
  });

  test('next advances step', () => {
    const engine = makeEngine({ localStorage: memStore() });
    engine.init(fakeContent());
    engine.startSection('s1');
    engine.next();
    expect(engine.getState().stepIndex).toBe(1);
  });

  test('next on last step -> returns to TOC + marks completed', () => {
    const engine = makeEngine({ localStorage: memStore() });
    engine.init(fakeContent());
    engine.startSection('s1');
    engine.next(); // step b
    engine.next(); // beyond end
    const s = engine.getState();
    expect(s.phase).toBe('toc');
    expect(s.completed.s1).toBe(true);
  });

  test('back at step 0 stays at step 0', () => {
    const engine = makeEngine({ localStorage: memStore() });
    engine.init(fakeContent());
    engine.startSection('s1');
    engine.back();
    expect(engine.getState().stepIndex).toBe(0);
  });

  test('exit -> idle, no flag set', () => {
    const ls = memStore();
    const engine = makeEngine({ localStorage: ls });
    engine.init(fakeContent());
    engine.startSection('s1');
    engine.exit();
    expect(engine.getState().phase).toBe('idle');
    expect(ls._data['ch.tutorial.seen.v1']).toBeUndefined();
  });

  test('skipTutorial -> idle + flag set', () => {
    const ls = memStore();
    const engine = makeEngine({ localStorage: ls });
    engine.init(fakeContent());
    engine.skipTutorial();
    expect(engine.getState().phase).toBe('idle');
    expect(ls._data['ch.tutorial.seen.v1']).toBe('1');
  });
});
