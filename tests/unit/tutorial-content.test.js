import { describe, test, expect } from 'vitest';

const content = require('../../src/tutorial/tutorial-content.js');

describe('tutorial content schema', () => {
  test('has 5 sections in order', () => {
    expect(content.sections.length).toBe(5);
    expect(content.sections.map((s) => s.id)).toEqual([
      'getting-started', 'basic-clipping', 'watermarks', 'outros', 'encoding',
    ]);
  });

  test('every section has id, title, blurb, steps', () => {
    content.sections.forEach((s) => {
      expect(typeof s.id).toBe('string');
      expect(typeof s.title).toBe('string');
      expect(typeof s.blurb).toBe('string');
      expect(Array.isArray(s.steps)).toBe(true);
      expect(s.steps.length).toBeGreaterThan(0);
    });
  });

  test('every step has id, title, body', () => {
    content.sections.forEach((s) => {
      s.steps.forEach((st) => {
        expect(typeof st.id).toBe('string');
        expect(typeof st.title).toBe('string');
        expect(typeof st.body).toBe('string');
      });
    });
  });

  test('step ids unique within a section', () => {
    content.sections.forEach((s) => {
      const ids = s.steps.map((st) => st.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  test('placement values are valid', () => {
    const valid = new Set(['top', 'bottom', 'left', 'right', 'auto', 'center']);
    content.sections.forEach((s) => {
      s.steps.forEach((st) => {
        if (st.placement) expect(valid.has(st.placement)).toBe(true);
      });
    });
  });
});
