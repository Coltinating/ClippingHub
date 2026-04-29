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

async function setupMember(url, userId, userName) {
  const ws = await open(url);
  await send(ws, { type: 'hello', user: { id: userId, name: userName } });
  await next(ws); // hello:ack
  return {
    ws,
    userId,
    send: (msg) => send(ws, msg),
    recv: () => next(ws),
    collect: (type) => {
      const msgs = [];
      ws.on('message', d => {
        const p = JSON.parse(d.toString());
        if (p.type === type) msgs.push(p);
      });
      return msgs;
    }
  };
}

function tick(ms = 50) { return new Promise(r => setTimeout(r, ms)); }

describe('integration', () => {
  let h;
  beforeAll(async () => { h = await startServer({ port: 0, dataDir: ':memory:' }); });
  afterAll(async () => { await h.close(); });

  async function twoMemberLobby(h) {
    const host = await setupMember(`ws://127.0.0.1:${h.port}/ws`, 'host1', 'Host');
    await host.send({ type: 'lobby:create', name: 'TL', password: '' });
    const stateMsg = await host.recv();
    const code = stateMsg.lobby.code;
    const guest = await setupMember(`ws://127.0.0.1:${h.port}/ws`, 'guest1', 'Guest');
    await guest.send({ type: 'lobby:join', code, password: '' });
    await guest.recv(); // lobby:state
    await host.recv();  // member:joined
    return { host, guest, code };
  }

  async function threeMemberLobby(h) {
    const { host, guest, code } = await twoMemberLobby(h);
    const guest2 = await setupMember(`ws://127.0.0.1:${h.port}/ws`, 'guest2', 'Guest2');
    await guest2.send({ type: 'lobby:join', code, password: '' });
    await guest2.recv(); // lobby:state
    await host.recv();   // member:joined
    await guest.recv();  // member:joined
    return { host, guest, guest2, code };
  }

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

  describe('member:set-assist with role (atomic)', () => {
    it('applies role and assistUserId atomically, emits one member:updated', async () => {
      const { host, guest } = await twoMemberLobby(h);
      const updates = [];
      guest.ws.on('message', m => { const p = JSON.parse(m.toString()); if (p.type === 'member:updated') updates.push(p); });

      await guest.send({ type: 'member:set-assist', assistUserId: host.userId, role: 'helper' });
      await tick();

      expect(updates).toHaveLength(1);
      expect(updates[0].member.role).toBe('helper');
      expect(updates[0].member.assistUserId).toBe(host.userId);
      host.ws.close(); guest.ws.close();
    });

    it('rejects assist targeting non-clipper with invalid_assist_target', async () => {
      const { host, guest, guest2 } = await threeMemberLobby(h);
      const errors = [];
      guest.ws.on('message', m => { const p = JSON.parse(m.toString()); if (p.type === 'error') errors.push(p); });

      await guest.send({ type: 'member:set-assist', assistUserId: guest2.userId, role: 'helper' });
      await tick();

      expect(errors[0]?.code).toBe('invalid_assist_target');
      host.ws.close(); guest.ws.close(); guest2.ws.close();
    });

    it('rejects assist targeting self', async () => {
      const { host, guest } = await twoMemberLobby(h);
      const errors = [];
      guest.ws.on('message', m => { const p = JSON.parse(m.toString()); if (p.type === 'error') errors.push(p); });

      await guest.send({ type: 'member:set-assist', assistUserId: guest.userId, role: 'helper' });
      await tick();

      expect(errors[0]?.code).toBe('invalid_assist_target');
      host.ws.close(); guest.ws.close();
    });
  });

  describe('auto-detach on Clipper lifecycle', () => {
    it('lobby:leave detaches helpers with member:updated(viewer)', async () => {
      const { host, guest } = await twoMemberLobby(h);
      await guest.send({ type: 'member:set-assist', assistUserId: host.userId, role: 'helper' });
      await tick();

      const cascades = [];
      guest.ws.on('message', m => { const p = JSON.parse(m.toString()); if (p.type === 'member:updated') cascades.push(p); });

      await host.send({ type: 'lobby:leave' });
      await tick(100);

      const guestUpdate = cascades.find(u => u.member.id === guest.userId);
      expect(guestUpdate?.member.role).toBe('viewer');
      expect(guestUpdate?.member.assistUserId).toBeNull();
      host.ws.close(); guest.ws.close();
    });

    it('member:set-role demotion cascades helper cleanup', async () => {
      const { host, guest } = await twoMemberLobby(h);
      await guest.send({ type: 'member:set-assist', assistUserId: host.userId, role: 'helper' });
      await tick();

      const cascades = [];
      guest.ws.on('message', m => { const p = JSON.parse(m.toString()); if (p.type === 'member:updated') cascades.push(p); });

      await host.send({ type: 'member:set-role', memberId: host.userId, role: 'viewer' });
      await tick(100);

      const guestUpdate = cascades.find(u => u.member.id === guest.userId);
      expect(guestUpdate?.member.role).toBe('viewer');
      host.ws.close(); guest.ws.close();
    });
  });
});
