import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { CollabStore } = require('../../src/lib/collab-store.js');

describe('CollabStore', () => {
  it('applies lobby:state then member:joined', () => {
    const s = new CollabStore();
    s.apply({
      type: 'lobby:state',
      lobby: { code: 'AB12CD', name: 'L', members: [], chat: [], clipRanges: [], deliveries: [] }
    });
    s.apply({
      type: 'member:joined',
      member: { id: 'u2', name: 'B', role: 'viewer', joinedAt: 1, lastSeenAt: 1 }
    });
    expect(s.state.members).toHaveLength(1);
    expect(s.state.members[0].id).toBe('u2');
  });

  it('clears on lobby:closed', () => {
    const s = new CollabStore();
    s.apply({
      type: 'lobby:state',
      lobby: { code: 'X', name: 'L', members: [], chat: [], clipRanges: [], deliveries: [] }
    });
    s.apply({ type: 'lobby:closed', code: 'X' });
    expect(s.state).toBeNull();
  });

  it('updates a member on member:updated', () => {
    const s = new CollabStore();
    s.apply({
      type: 'lobby:state',
      lobby: {
        code: 'X', name: 'L',
        members: [{ id: 'u1', name: 'A', role: 'clipper', joinedAt: 1, lastSeenAt: 1 }],
        chat: [], clipRanges: [], deliveries: []
      }
    });
    s.apply({
      type: 'member:updated',
      member: { id: 'u1', name: 'A', role: 'helper', joinedAt: 1, lastSeenAt: 2 }
    });
    expect(s.state.members[0].role).toBe('helper');
  });

  it('appends and replaces clip ranges by id', () => {
    const s = new CollabStore();
    s.apply({
      type: 'lobby:state',
      lobby: { code: 'X', name: 'L', members: [], chat: [], clipRanges: [], deliveries: [] }
    });
    s.apply({ type: 'clip:range-upserted', range: { id: 'r1', inTime: 1, outTime: 2 } });
    s.apply({ type: 'clip:range-upserted', range: { id: 'r1', inTime: 1, outTime: 5 } });
    expect(s.state.clipRanges).toHaveLength(1);
    expect(s.state.clipRanges[0].outTime).toBe(5);
    s.apply({ type: 'clip:range-removed', id: 'r1' });
    expect(s.state.clipRanges).toHaveLength(0);
  });

  it('notifies subscribers on apply', () => {
    const s = new CollabStore();
    let calls = 0;
    s.subscribe(() => { calls++; });
    s.apply({
      type: 'lobby:state',
      lobby: { code: 'X', name: 'L', members: [], chat: [], clipRanges: [], deliveries: [] }
    });
    expect(calls).toBe(1);
  });
});
