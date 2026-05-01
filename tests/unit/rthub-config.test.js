import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ensureClientId } = require('../../src/lib/rthub-config.js');

describe('ensureClientId', () => {
  it('returns the existing id when valid', () => {
    expect(ensureClientId('u_abc123')).toBe('u_abc123');
  });

  it('mints a new url-safe id when input is empty', () => {
    const a = ensureClientId('');
    expect(a).toMatch(/^[A-Za-z0-9._~-]{1,128}$/);
  });

  it('mints a new url-safe id when input has illegal characters', () => {
    const b = ensureClientId('illegal char!');
    expect(b).not.toBe('illegal char!');
    expect(b).toMatch(/^[A-Za-z0-9._~-]{1,128}$/);
  });

  it('mints a new id for null/undefined', () => {
    expect(ensureClientId(null)).toMatch(/^[A-Za-z0-9._~-]{1,128}$/);
    expect(ensureClientId(undefined)).toMatch(/^[A-Za-z0-9._~-]{1,128}$/);
  });

  it('truncates ids longer than 128 chars', () => {
    const long = 'u_' + 'a'.repeat(200);
    const out = ensureClientId(long);
    expect(out.length).toBeLessThanOrEqual(128);
    expect(out).toMatch(/^[A-Za-z0-9._~-]{1,128}$/);
  });

  it('accepts all valid chars in the rthub charset', () => {
    const id = 'A.z_0~9-test';
    expect(ensureClientId(id)).toBe(id);
  });
});
