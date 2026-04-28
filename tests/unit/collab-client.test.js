import { describe, it, expect, vi } from 'vitest';
import { CollabClient } from '../../src/lib/collab-client.js';

class FakeWS {
  constructor() {
    this.sent = [];
    this.readyState = 0;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  send(m) { this.sent.push(JSON.parse(m)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  _recv(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

describe('CollabClient', () => {
  it('sends hello on open and resolves connect()', async () => {
    const fakes = [];
    const c = new CollabClient({
      url: 'ws://x',
      user: { id: 'u1', name: 'M' },
      wsCtor: () => { const f = new FakeWS(); fakes.push(f); return f; }
    });
    const p = c.connect();
    await new Promise(r => setTimeout(r, 5));
    fakes[0]._recv({ type: 'hello:ack', serverVersion: '0.1.0' });
    await p;
    expect(fakes[0].sent[0].type).toBe('hello');
  });

  it('createLobby resolves with lobby state', async () => {
    let f;
    const c = new CollabClient({
      url: 'ws://x',
      user: { id: 'u1', name: 'M' },
      wsCtor: () => (f = new FakeWS())
    });
    const cp = c.connect();
    await new Promise(r => setTimeout(r, 5));
    f._recv({ type: 'hello:ack', serverVersion: '0.1.0' });
    await cp;
    const p = c.createLobby({ name: 'L', password: '' });
    f._recv({
      type: 'lobby:state',
      lobby: { code: 'AB12CD', name: 'L', members: [], chat: [], clipRanges: [], deliveries: [] }
    });
    const lobby = await p;
    expect(lobby.code).toBe('AB12CD');
  });

  it('emits chat:message events', async () => {
    let f;
    const c = new CollabClient({
      url: 'ws://x',
      user: { id: 'u1', name: 'M' },
      wsCtor: () => (f = new FakeWS())
    });
    const cp = c.connect();
    await new Promise(r => setTimeout(r, 5));
    f._recv({ type: 'hello:ack', serverVersion: '0.1.0' });
    await cp;
    const handler = vi.fn();
    c.on('chat:message', handler);
    f._recv({ type: 'chat:message', message: { text: 'hi' } });
    expect(handler).toHaveBeenCalledWith({ type: 'chat:message', message: { text: 'hi' } });
  });
});
