import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../src/index.js';

function helper(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  return new Promise(res => ws.once('open', () => res(ws)));
}

describe('transcription', () => {
  let h;
  beforeAll(async () => { h = await startServer({ port: 0, dataDir: ':memory:' }); });
  afterAll(async () => { await h.close(); });

  it('emits transcript:status running and at least one chunk', async () => {
    const ws = await helper(h.port);
    const messages = [];
    ws.on('message', d => messages.push(JSON.parse(d.toString())));
    ws.send(JSON.stringify({ type: 'hello', user: { id: 'u1', name: 'M' } }));
    await new Promise(r => setTimeout(r, 50));
    ws.send(JSON.stringify({ type: 'lobby:create', name: 'L', password: '' }));
    await new Promise(r => setTimeout(r, 50));
    ws.send(JSON.stringify({
      type: 'transcript:start',
      channelId: 'nickjfuentes',
      videoUrl: 'https://rumble.com/v123-test.html'
    }));
    await new Promise(r => setTimeout(r, 1500));
    ws.send(JSON.stringify({ type: 'transcript:stop' }));
    await new Promise(r => setTimeout(r, 50));
    ws.close();
    expect(messages.some(m => m.type === 'transcript:status' && m.status === 'running')).toBe(true);
    expect(messages.some(m => m.type === 'transcript:chunk')).toBe(true);
    expect(messages.some(m => m.type === 'transcript:status' && m.status === 'stopped')).toBe(true);
  }, 5000);
});
