import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db.js';
import { LobbyStore } from '../src/lobby-store.js';

describe('LobbyStore', () => {
  let store;
  beforeEach(() => { store = new LobbyStore(openDb(':memory:')); });

  it('creates a lobby and returns full snapshot', () => {
    const lobby = store.createLobby({
      name: 'Night Shift', password: '', user: { id: 'u1', name: 'Mark' }
    });
    expect(lobby.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(lobby.members).toHaveLength(1);
    expect(lobby.members[0].role).toBe('clipper');
    expect(lobby.hostId).toBe('u1');
  });

  it('joins as viewer when host already exists', () => {
    const a = store.createLobby({ name: 'L', password: '', user: { id: 'u1', name: 'A' } });
    const b = store.joinLobby({ code: a.code, password: '', user: { id: 'u2', name: 'B' } });
    expect(b.members.find(m => m.id === 'u2').role).toBe('viewer');
  });

  it('rejects wrong password', () => {
    const a = store.createLobby({ name: 'L', password: 'pw', user: { id: 'u1', name: 'A' } });
    expect(() => store.joinLobby({ code: a.code, password: 'wrong', user: { id: 'u2', name: 'B' } }))
      .toThrow(/password/i);
  });

  it('appends chat with id + timestamp', () => {
    const a = store.createLobby({ name: 'L', password: '', user: { id: 'u1', name: 'A' } });
    const msg = store.addChat({ code: a.code, userId: 'u1', userName: 'A', text: 'hi' });
    expect(msg.id).toBeTruthy();
    expect(msg.text).toBe('hi');
    const snap = store.getLobby(a.code);
    expect(snap.chat).toHaveLength(1);
  });

  it('upserts and removes a clip range', () => {
    const a = store.createLobby({ name: 'L', password: '', user: { id: 'u1', name: 'A' } });
    store.upsertRange(a.code, { id: 'r1', userId: 'u1', inTime: 1, outTime: 2 });
    expect(store.getLobby(a.code).clipRanges).toHaveLength(1);
    store.removeRange(a.code, 'r1');
    expect(store.getLobby(a.code).clipRanges).toHaveLength(0);
  });

  it('collapses undelivered duplicate deliveries', () => {
    const a = store.createLobby({ name: 'L', password: '', user: { id: 'u1', name: 'A' } });
    const d1 = store.createDelivery(a.code, { type: 'clip', fromUserId: 'u1', toUserId: 'u2', rangeId: 'r1', payload: {} });
    const d2 = store.createDelivery(a.code, { type: 'clipUpdate', fromUserId: 'u1', toUserId: 'u2', rangeId: 'r1', payload: { x: 1 } });
    expect(d1.id).toBe(d2.id);
    const undelivered = store.pendingDeliveriesFor(a.code, 'u2');
    expect(undelivered).toHaveLength(1);
  });
});
