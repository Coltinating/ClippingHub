import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from '../src/index.js';

describe('http /health', () => {
  let handle;
  beforeAll(async () => { handle = await startServer({ port: 0, dataDir: ':memory:' }); });
  afterAll(async () => { await handle.close(); });
  it('returns ok', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
