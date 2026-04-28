import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses defaults when env vars missing', () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(3535);
    expect(cfg.maxLobbies).toBe(200);
  });
  it('parses PORT from env', () => {
    const cfg = loadConfig({ PORT: '4000' });
    expect(cfg.port).toBe(4000);
  });
  it('throws on non-numeric PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
  });
});
