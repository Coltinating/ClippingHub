import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { mintSessionId } = require('../../src/lib/session-id.js');

describe('mintSessionId', () => {
  it('returns a 6-char uppercase alphanumeric string', () => {
    const id = mintSessionId();
    expect(id).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('returns a different id on each call (overwhelmingly likely)', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(mintSessionId());
    expect(ids.size).toBeGreaterThan(95);
  });

  it('avoids visually ambiguous characters (0/O, 1/I/L)', () => {
    for (let i = 0; i < 200; i++) {
      const id = mintSessionId();
      expect(id).not.toMatch(/[01OIL]/);
    }
  });
});
