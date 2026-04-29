import { describe, it, test, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db.js';
import { LobbyStore } from '../src/lobby-store.js';

function buildTestDb() { return openDb(':memory:'); }

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

describe('cleanupHelpersOf', () => {
  test('returns affected helper rows and demotes them to viewer', () => {
    const db = buildTestDb();
    const store = new LobbyStore(db);
    const lobby = store.createLobby({ name: 'T', password: '', user: { id: 'host', name: 'Host' } });
    store.joinLobby({ code: lobby.code, password: '', user: { id: 'h1', name: 'H1' } });
    store.setMemberRole(lobby.code, 'h1', 'helper');
    // manually set assist_user_id to 'host'
    db.prepare("UPDATE members SET assist_user_id=? WHERE lobby_code=? AND id=?").run('host', lobby.code, 'h1');

    const affected = store.cleanupHelpersOf(lobby.code, 'host');
    expect(affected).toHaveLength(1);
    expect(affected[0].id).toBe('h1');
    expect(affected[0].role).toBe('viewer');
    expect(affected[0].assistUserId).toBeNull();
  });

  test('returns empty array when no helpers assigned to clipper', () => {
    const db = buildTestDb();
    const store = new LobbyStore(db);
    const lobby = store.createLobby({ name: 'T', password: '', user: { id: 'host', name: 'Host' } });
    const result = store.cleanupHelpersOf(lobby.code, 'host');
    expect(result).toEqual([]);
  });
});

describe('setMemberAssist with role', () => {
  test('updates both role and assist_user_id atomically', () => {
    const db = buildTestDb();
    const store = new LobbyStore(db);
    const lobby = store.createLobby({ name: 'T', password: '', user: { id: 'clipper1', name: 'C1' } });
    store.joinLobby({ code: lobby.code, password: '', user: { id: 'u2', name: 'U2' } });

    const updated = store.setMemberAssist(lobby.code, 'u2', 'clipper1', 'helper');
    expect(updated.role).toBe('helper');
    expect(updated.assistUserId).toBe('clipper1');
  });

  test('backward compat: omitting role does not change role', () => {
    const db = buildTestDb();
    const store = new LobbyStore(db);
    const lobby = store.createLobby({ name: 'T', password: '', user: { id: 'clipper1', name: 'C1' } });
    store.joinLobby({ code: lobby.code, password: '', user: { id: 'u2', name: 'U2' } });
    store.setMemberRole(lobby.code, 'u2', 'helper');

    const updated = store.setMemberAssist(lobby.code, 'u2', 'clipper1'); // no role param
    expect(updated.role).toBe('helper'); // unchanged
    expect(updated.assistUserId).toBe('clipper1');
  });
});

describe('leaveLobby returns affectedHelpers', () => {
  test('demotes helpers when their clipper leaves', () => {
    const db = buildTestDb();
    const store = new LobbyStore(db);
    const lobby = store.createLobby({ name: 'T', password: '', user: { id: 'clipper1', name: 'C1' } });
    store.joinLobby({ code: lobby.code, password: '', user: { id: 'h1', name: 'H1' } });
    store.setMemberAssist(lobby.code, 'h1', 'clipper1', 'helper');

    const result = store.leaveLobby(lobby.code, 'clipper1');
    expect(result.affectedHelpers).toHaveLength(1);
    expect(result.affectedHelpers[0].id).toBe('h1');
    expect(result.affectedHelpers[0].role).toBe('viewer');
  });
});

describe('setMemberRole returns affectedHelpers', () => {
  test('auto-detaches helpers when clipper is demoted', () => {
    const db = buildTestDb();
    const store = new LobbyStore(db);
    const lobby = store.createLobby({ name: 'T', password: '', user: { id: 'clipper1', name: 'C1' } });
    store.joinLobby({ code: lobby.code, password: '', user: { id: 'h1', name: 'H1' } });
    store.setMemberAssist(lobby.code, 'h1', 'clipper1', 'helper');

    const result = store.setMemberRole(lobby.code, 'clipper1', 'viewer');
    expect(result.affectedHelpers).toHaveLength(1);
    expect(result.affectedHelpers[0].id).toBe('h1');
    expect(result.affectedHelpers[0].role).toBe('viewer');
  });
});

describe('updateMemberProfile', () => {
  test('patches name + xHandle + color + pfpDataUrl, leaves role/assist intact', () => {
    const store = new LobbyStore(buildTestDb());
    store.createLobby({ name: 'L', user: { id: 'u1', name: 'Alice' }, code: 'AAAAAA' });
    store.joinLobby({ code: 'AAAAAA', user: { id: 'u2', name: 'Bob', xHandle: '@b', color: '#000000', pfpDataUrl: '' } });
    store.setMemberRole('AAAAAA', 'u2', 'clipper');
    const updated = store.updateMemberProfile('AAAAAA', 'u2', { name: 'Bobby', xHandle: '@bobby', color: '#ffffff', pfpDataUrl: '' });
    expect(updated.name).toBe('Bobby');
    expect(updated.xHandle).toBe('@bobby');
    expect(updated.color).toBe('#ffffff');
    expect(updated.role).toBe('clipper'); // role untouched
  });

  test('returns null when member does not exist', () => {
    const store = new LobbyStore(buildTestDb());
    store.createLobby({ name: 'L', user: { id: 'u1', name: 'Alice' }, code: 'AAAAAA' });
    expect(() => store.updateMemberProfile('AAAAAA', 'ghost', { name: 'X' })).not.toThrow();
    expect(store.updateMemberProfile('AAAAAA', 'ghost', { name: 'X' })).toBeNull();
  });
});
