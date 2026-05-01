import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { RthubState } = require('../../src/lib/rthub-state.js');

describe('RthubState', () => {
  let s;
  beforeEach(() => { s = new RthubState({ sessionId: 'sess-1', myClientId: 'me' }); });

  it('initializes with no lobby', () => {
    expect(s.snapshot()).toBeNull();
  });

  it('apply(stateSnapshot) builds the lobby shape', () => {
    s.apply({
      type: 'stateSnapshot',
      presence: [
        { type: 'presenceUpdate', clientId: 'me', action: 'join', name: 'Me', role: 'clipper', ts: 1 },
        { type: 'presenceUpdate', clientId: 'p2', action: 'join', name: 'Bob', role: 'helper', ts: 1 }
      ],
      chat: [{ type: 'chatMessage', id: 'c1', body: 'hi', author: 'Bob', userId: 'p2', ts: 2 }],
      clipRanges: [{ type: 'clipRangeUpsert', id: 'r1', inTime: 0, outTime: 1000, status: 'queued' }]
    });
    const lobby = s.snapshot();
    expect(lobby.code).toBe('sess-1');
    expect(lobby.members).toHaveLength(2);
    expect(lobby.chat).toHaveLength(1);
    expect(lobby.chat[0].text).toBe('hi');
    expect(lobby.clipRanges).toHaveLength(1);
    expect(lobby.clipRanges[0].id).toBe('r1');
    expect(lobby.deliveries).toEqual([]);
  });

  it('presenceUpdate action=join appends a member', () => {
    s.apply({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    s.apply({ type: 'presenceUpdate', clientId: 'p2', action: 'join', name: 'Bob', role: 'helper', ts: 1 });
    expect(s.snapshot().members).toHaveLength(1);
    expect(s.snapshot().members[0].name).toBe('Bob');
  });

  it('presenceUpdate action=join overwrites existing entry (profile refresh)', () => {
    s.apply({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    s.apply({ type: 'presenceUpdate', clientId: 'p2', action: 'join', name: 'Bob', role: 'helper', ts: 1 });
    s.apply({ type: 'presenceUpdate', clientId: 'p2', action: 'join', name: 'Robert', role: 'helper', ts: 2 });
    expect(s.snapshot().members).toHaveLength(1);
    expect(s.snapshot().members[0].name).toBe('Robert');
  });

  it('presenceUpdate action=leave removes a member', () => {
    s.apply({
      type: 'stateSnapshot',
      presence: [{ type: 'presenceUpdate', clientId: 'p2', action: 'join', name: 'Bob', role: 'helper', ts: 1 }],
      chat: [], clipRanges: []
    });
    s.apply({ type: 'presenceUpdate', clientId: 'p2', action: 'leave', ts: 2 });
    expect(s.snapshot().members).toHaveLength(0);
  });

  it('chatMessage appends to chat list', () => {
    s.apply({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    s.apply({ type: 'chatMessage', id: 'c1', body: 'hi', author: 'Bob', userId: 'p2', ts: 2 });
    expect(s.snapshot().chat).toHaveLength(1);
    expect(s.snapshot().chat[0].text).toBe('hi');
  });

  it('clipRangeUpsert inserts then updates by id', () => {
    s.apply({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    s.apply({ type: 'clipRangeUpsert', id: 'r1', inTime: 100, status: 'queued' });
    expect(s.snapshot().clipRanges).toHaveLength(1);
    expect(s.snapshot().clipRanges[0].inTime).toBe(100);
    s.apply({ type: 'clipRangeUpsert', id: 'r1', inTime: 200, status: 'done' });
    expect(s.snapshot().clipRanges).toHaveLength(1);
    expect(s.snapshot().clipRanges[0].inTime).toBe(200);
    expect(s.snapshot().clipRanges[0].status).toBe('done');
  });

  it('clipRangeRemove deletes by id', () => {
    s.apply({
      type: 'stateSnapshot', presence: [], chat: [],
      clipRanges: [{ type: 'clipRangeUpsert', id: 'r1', inTime: 100 }]
    });
    s.apply({ type: 'clipRangeRemove', id: 'r1' });
    expect(s.snapshot().clipRanges).toHaveLength(0);
  });

  it('reset() drops state', () => {
    s.apply({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    s.reset();
    expect(s.snapshot()).toBeNull();
  });

  it('events before stateSnapshot lazily seed the lobby', () => {
    s.apply({ type: 'chatMessage', id: 'c1', body: 'early', author: 'Bob', ts: 1 });
    expect(s.snapshot()).not.toBeNull();
    expect(s.snapshot().chat).toHaveLength(1);
  });

  it('ignores unknown message types without crashing', () => {
    s.apply({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    expect(() => s.apply({ type: 'someFutureMessage', foo: 'bar' })).not.toThrow();
    expect(() => s.apply(null)).not.toThrow();
    expect(() => s.apply({})).not.toThrow();
  });
});
