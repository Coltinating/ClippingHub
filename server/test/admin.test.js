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
function next(ws, predicate) {
  return new Promise(r => {
    function on(d) {
      const m = JSON.parse(d.toString());
      if (!predicate || predicate(m)) {
        ws.off('message', on);
        r(m);
      }
    }
    ws.on('message', on);
  });
}

describe('admin', () => {
  let h;
  beforeAll(async () => { h = await startServer({ port: 0, dataDir: ':memory:' }); });
  afterAll(async () => { await h.close(); });

  it('admin can list lobbies and send chat without joining', async () => {
    // Clipper Alice creates a lobby.
    const a = await open(`ws://127.0.0.1:${h.port}/ws`);
    await send(a, { type: 'hello', user: { id: 'alice', name: 'Alice' } });
    await next(a, m => m.type === 'hello:ack');
    await send(a, { type: 'lobby:create', name: 'Night Crew', password: '' });
    const aState = await next(a, m => m.type === 'lobby:state');
    const code = aState.lobby.code;

    // Admin connects, lists lobbies, sends a quick chat without joining.
    const adm = await open(`ws://127.0.0.1:${h.port}/ws`);
    await send(adm, {
      type: 'hello',
      user: { id: 'admin1', name: 'Mark' },
      admin: { name: 'Mark' }
    });
    await next(adm, m => m.type === 'hello:ack');

    await send(adm, { type: 'admin:list-lobbies' });
    const list = await next(adm, m => m.type === 'admin:lobbies');
    expect(list.lobbies.length).toBeGreaterThanOrEqual(1);
    const summary = list.lobbies.find(l => l.code === code);
    expect(summary).toBeTruthy();
    expect(summary.memberCount).toBe(1);

    // Admin sends a chat to Alice's lobby without ghost-joining.
    const aChatP = next(a, m => m.type === 'chat:message');
    await send(adm, { type: 'admin:send-chat', code, text: 'attention all' });
    const chat = await aChatP;
    expect(chat.message.text).toBe('attention all');
    expect(chat.message.userName.startsWith('[DEV] ')).toBe(true);

    a.close(); adm.close();
  });

  it('admin can join with bypassed password and is tagged isAdmin', async () => {
    // Clipper creates a password-protected lobby.
    const a = await open(`ws://127.0.0.1:${h.port}/ws`);
    await send(a, { type: 'hello', user: { id: 'bob', name: 'Bob' } });
    await next(a, m => m.type === 'hello:ack');
    await send(a, { type: 'lobby:create', name: 'Locked', password: 'secret' });
    const aState = await next(a, m => m.type === 'lobby:state');
    const code = aState.lobby.code;

    // Admin connects and joins with a wrong password — should still succeed.
    const adm = await open(`ws://127.0.0.1:${h.port}/ws`);
    await send(adm, {
      type: 'hello',
      user: { id: 'admin2', name: 'Mark' },
      admin: { name: 'Mark' }
    });
    await next(adm, m => m.type === 'hello:ack');

    await send(adm, { type: 'lobby:join', code, password: 'WRONG' });
    const joined = await next(adm, m => m.type === 'lobby:state');
    expect(joined.lobby.code).toBe(code);
    const adminMember = joined.lobby.members.find(m => m.id === 'admin2');
    expect(adminMember).toBeTruthy();
    expect(adminMember.isAdmin).toBe(true);
    expect(adminMember.name.startsWith('[DEV] ')).toBe(true);
    expect(adminMember.role).toBe('clipper');

    a.close(); adm.close();
  });

  it('non-admin cannot use admin:list-lobbies', async () => {
    const ws = await open(`ws://127.0.0.1:${h.port}/ws`);
    await send(ws, { type: 'hello', user: { id: 'rando', name: 'Rando' } });
    await next(ws, m => m.type === 'hello:ack');
    await send(ws, { type: 'admin:list-lobbies' });
    const m = await next(ws, mm => mm.type === 'error');
    expect(m.code).toBe('forbidden');
    ws.close();
  });
});
