import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const P = require('../../src/lib/rthub-protocol.js');

describe('rangeToUpsert', () => {
  it('flattens a full legacy range blob to the rthub flat schema', () => {
    const range = {
      id: 'r1', inTime: 1, outTime: 2, status: 'queued',
      pendingOut: false, streamKey: 'foo', name: 'My Clip',
      caption: 'cap', postCaption: 'post', fileName: 'f.mp4',
      clipperId: 'u1', clipperName: 'Alice',
      helperId: 'u2', helperName: 'Bob',
      userId: 'u1', userName: 'Alice',
      extraGarbage: 'should be dropped'
    };
    const out = P.rangeToUpsert(range);
    expect(out.type).toBe('clipRangeUpsert');
    expect(out.id).toBe('r1');
    expect(out.inTime).toBe(1000);   // 1s → 1000ms (spec wants integer ms)
    expect(out.outTime).toBe(2000);
    expect(out.status).toBe('queued');
    expect(out.pendingOut).toBe(false);
    expect(out.clipperName).toBe('Alice');
    expect(out.helperId).toBe('u2');
    expect(out.extraGarbage).toBeUndefined();
  });

  it('converts fractional second times to integer ms (sanitizer rejects floats)', () => {
    const out = P.rangeToUpsert({ id: 'r1', inTime: 35.123, outTime: 41.987 });
    expect(out.inTime).toBe(35123);
    expect(out.outTime).toBe(41987);
    expect(Number.isInteger(out.inTime)).toBe(true);
    expect(Number.isInteger(out.outTime)).toBe(true);
  });

  it('omits absent optional fields rather than sending null', () => {
    const out = P.rangeToUpsert({ id: 'r1' });
    expect(out.id).toBe('r1');
    expect('caption' in out).toBe(false);
    expect('clipperId' in out).toBe(false);
  });

  it('handles null/undefined input', () => {
    expect(P.rangeToUpsert(null)).toEqual({ type: 'clipRangeUpsert' });
    expect(P.rangeToUpsert(undefined)).toEqual({ type: 'clipRangeUpsert' });
  });

  it('omits null fields (server interprets null as missing)', () => {
    const out = P.rangeToUpsert({ id: 'r1', caption: null });
    expect('caption' in out).toBe(false);
  });
});

describe('upsertToRange', () => {
  it('rebuilds a legacy-shaped range record from a rthub upsert', () => {
    const msg = { type: 'clipRangeUpsert', id: 'r1', inTime: 100000, status: 'done', clipperId: 'u1' };
    const out = P.upsertToRange(msg);
    expect(out.id).toBe('r1');
    expect(out.inTime).toBe(100); // 100000ms → 100s
    expect(out.status).toBe('done');
    expect(out.clipperId).toBe('u1');
    expect('type' in out).toBe(false);
  });

  it('handles missing fields cleanly', () => {
    const out = P.upsertToRange({ type: 'clipRangeUpsert', id: 'r1' });
    expect(out.id).toBe('r1');
  });

  it('round-trips a fractional seconds range through rangeToUpsert + upsertToRange', () => {
    const wire = P.rangeToUpsert({ id: 'r1', inTime: 35.123, outTime: 41.987 });
    const back = P.upsertToRange(wire);
    expect(back.inTime).toBeCloseTo(35.123, 3);
    expect(back.outTime).toBeCloseTo(41.987, 3);
  });
});

describe('presenceToMember', () => {
  it('builds the member shape collab-store expects', () => {
    const pres = {
      type: 'presenceUpdate', clientId: 'u1', action: 'join',
      name: 'Alice', color: '#5bb1ff', role: 'helper',
      xHandle: 'alice', assistUserId: 'u2', ts: 1700000000000
    };
    const m = P.presenceToMember(pres);
    expect(m.id).toBe('u1');
    expect(m.name).toBe('Alice');
    expect(m.role).toBe('helper');
    expect(m.color).toBe('#5bb1ff');
    expect(m.xHandle).toBe('alice');
    expect(m.assistUserId).toBe('u2');
    expect(m.joinedAt).toBe(1700000000000);
    expect(m.lastSeenAt).toBe(1700000000000);
    expect(m.pfpDataUrl).toBeNull();
  });

  it('defaults role to viewer when missing', () => {
    const m = P.presenceToMember({ type: 'presenceUpdate', clientId: 'u1', action: 'join' });
    expect(m.role).toBe('viewer');
  });

  it('returns null for null/undefined input', () => {
    expect(P.presenceToMember(null)).toBeNull();
    expect(P.presenceToMember(undefined)).toBeNull();
  });
});

describe('chatToLegacy', () => {
  it('maps rthub chatMessage to the legacy chat record', () => {
    const msg = {
      type: 'chatMessage', id: 'c1', body: 'hello',
      author: 'Alice', userId: 'u1', ts: 1700000000000, sourceClientId: 'u1'
    };
    const out = P.chatToLegacy(msg);
    expect(out.id).toBe('c1');
    expect(out.text).toBe('hello');
    expect(out.userId).toBe('u1');
    expect(out.userName).toBe('Alice');
    expect(out.createdAt).toBe(1700000000000);
  });

  it('falls back to sourceClientId when userId is missing', () => {
    const out = P.chatToLegacy({
      type: 'chatMessage', id: 'c1', body: 'hi', sourceClientId: 'u-src'
    });
    expect(out.userId).toBe('u-src');
  });

  it('returns null for null input', () => {
    expect(P.chatToLegacy(null)).toBeNull();
  });
});

describe('sanitizeOutbound', () => {
  it('keeps a valid color', () => {
    const m = P.sanitizeOutbound({ type: 'peerProfile', color: '#5bb1ff' });
    expect(m.color).toBe('#5bb1ff');
  });
  it('drops malformed color (#fff, "red", missing #)', () => {
    expect(P.sanitizeOutbound({ type: 'peerProfile', color: '#fff' }).color).toBeUndefined();
    expect(P.sanitizeOutbound({ type: 'peerProfile', color: 'red' }).color).toBeUndefined();
    expect(P.sanitizeOutbound({ type: 'peerProfile', color: '5bb1ff' }).color).toBeUndefined();
  });
  it('drops out-of-enum role', () => {
    expect(P.sanitizeOutbound({ type: 'peerProfile', role: 'admin' }).role).toBeUndefined();
    expect(P.sanitizeOutbound({ type: 'peerProfile', role: 'helper' }).role).toBe('helper');
  });
  it('drops out-of-enum status on clipRangeUpsert', () => {
    expect(P.sanitizeOutbound({ type: 'clipRangeUpsert', id: 'r1', status: 'wat' }).status).toBeUndefined();
    expect(P.sanitizeOutbound({ type: 'clipRangeUpsert', id: 'r1', status: 'queued' }).status).toBe('queued');
  });
  it('truncates over-length strings to spec caps', () => {
    const longName = 'a'.repeat(200);
    expect(P.sanitizeOutbound({ type: 'peerProfile', name: longName }).name.length).toBe(80);
  });
  it('returns null for messages with required fields missing or invalid', () => {
    expect(P.sanitizeOutbound({ type: 'clipRangeUpsert' })).toBeNull();
    expect(P.sanitizeOutbound({ type: 'chatMessage', body: '' })).toBeNull();
    expect(P.sanitizeOutbound({ type: 'chatMessage', id: '', body: 'hi' })).toBeNull();
    expect(P.sanitizeOutbound({ type: 'delivery', toClientId: 'a', kind: 'wat', rangeId: 'r1' })).toBeNull();
  });
  it('passes through unknown types unchanged (forward-compat)', () => {
    const m = P.sanitizeOutbound({ type: 'futureType', whatever: 1 });
    expect(m).toEqual({ type: 'futureType', whatever: 1 });
  });
  it('drops invalid playback state but keeps required positionMs', () => {
    expect(P.sanitizeOutbound({ type: 'playbackUpdate', state: 'play', positionMs: 100 })).toBeNull();
    const ok = P.sanitizeOutbound({ type: 'playbackUpdate', state: 'playing', positionMs: 100 });
    expect(ok.state).toBe('playing');
    expect(ok.positionMs).toBe(100);
  });
  it('coerces negative positionMs to null (rejects)', () => {
    expect(P.sanitizeOutbound({ type: 'timelineUpdate', positionMs: -5 })).toBeNull();
    expect(P.sanitizeOutbound({ type: 'timelineUpdate', positionMs: 0 }).positionMs).toBe(0);
  });
});

describe('deliveryToLegacy', () => {
  it('maps rthub delivery to the legacy delivery record collab-ui expects', () => {
    const msg = {
      type: 'delivery', toClientId: 'u-me', kind: 'clip',
      rangeId: 'r1', payload: { name: 'Clip', inTime: 0, outTime: 1000 },
      ts: 1700000000000, sourceClientId: 'u-helper'
    };
    const out = P.deliveryToLegacy(msg, () => ({ name: 'Bob', color: '#ff7a59' }));
    expect(out.type).toBe('clip');
    expect(out.toUserId).toBe('u-me');
    expect(out.fromUserId).toBe('u-helper');
    expect(out.rangeId).toBe('r1');
    expect(out.fromUserName).toBe('Bob');
    expect(out.fromUserColor).toBe('#ff7a59');
    expect(out.id).toMatch(/^d_/);
    expect(out.payload.name).toBe('Clip');
  });

  it('idempotent id: same delivery in twice gets the same synthetic id', () => {
    const msg = {
      type: 'delivery', toClientId: 'u-me', kind: 'clip', rangeId: 'r1',
      payload: {}, ts: 1700000000000, sourceClientId: 'u-h'
    };
    const a = P.deliveryToLegacy(msg, () => ({}));
    const b = P.deliveryToLegacy(msg, () => ({}));
    expect(a.id).toBe(b.id);
  });

  it('survives missing peerLookup', () => {
    const msg = {
      type: 'delivery', toClientId: 'u-me', kind: 'clip', rangeId: 'r1',
      payload: {}, ts: 1, sourceClientId: 'u-h'
    };
    const out = P.deliveryToLegacy(msg);
    expect(out.fromUserName).toBe('');
    expect(out.fromUserColor).toBe('');
  });

  it('returns null for null input', () => {
    expect(P.deliveryToLegacy(null, () => ({}))).toBeNull();
  });
});
