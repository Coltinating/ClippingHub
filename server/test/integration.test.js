import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../src/index.js';

function open(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.once('open', () => res(ws));
    ws.once('error', rej);
  });
}
function send(ws, msg) { return new Promise(r => ws.send(JSON.stringify(msg), r)); }
function next(ws) {
  return new Promise(r => ws.once('message', d => r(JSON.parse(d.toString()))));
}

describe('integration', () => {
  let h;
  beforeAll(async () => { h = await startServer({ port: 0, dataDir: ':memory:' }); });
  afterAll(async () => { await h.close(); });

  it('hello → create-lobby → state', async () => {
    const ws = await open(`ws://127.0.0.1:${h.port}/ws`);
    await send(ws, { type: 'hello', user: { id: 'u1', name: 'Mark' } });
    const ack = await next(ws);
    expect(ack.type).toBe('hello:ack');
    await send(ws, { type: 'lobby:create', name: 'NS', password: '' });
    const state = await next(ws);
    expect(state.type).toBe('lobby:state');
    expect(state.lobby.members[0].id).toBe('u1');
    ws.close();
  });

  it('two clients see member:joined and chat broadcast', async () => {
    const a = await open(`ws://127.0.0.1:${h.port}/ws`);
    await send(a, { type: 'hello', user: { id: 'ua', name: 'A' } });
    await next(a);
    await send(a, { type: 'lobby:create', name: 'L', password: '' });
    const aState = await next(a);
    const code = aState.lobby.code;

    const b = await open(`ws://127.0.0.1:${h.port}/ws`);
    await send(b, { type: 'hello', user: { id: 'ub', name: 'B' } });
    await next(b);

    const aJoinedP = new Promise(r => a.on('message', d => {
      const m = JSON.parse(d.toString());
      if (m.type === 'member:joined') r(m);
    }));
    await send(b, { type: 'lobby:join', code, password: '' });
    await next(b);
    const aJoined = await aJoinedP;
    expect(aJoined.member.id).toBe('ub');

    const aChatP = new Promise(r => a.on('message', d => {
      const m = JSON.parse(d.toString());
      if (m.type === 'chat:message') r(m);
    }));
    await send(b, { type: 'chat:send', text: 'hello' });
    const broadcast = await aChatP;
    expect(broadcast.message.text).toBe('hello');

    a.close();
    b.close();
  });
});
