import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
require('../../src/lib/rthub-protocol.js');
require('../../src/lib/rthub-state.js');
const { RthubClient } = require('../../src/lib/rthub-client.js');

class FakeWS {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWS.last = this;
    FakeWS.all.push(this);
  }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; if (this.onclose) this.onclose({}); }
  _open() { this.readyState = 1; if (this.onopen) this.onopen({}); }
  _msg(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
}
FakeWS.all = [];

function build(extra) {
  return new RthubClient(Object.assign({
    url: 'wss://r/ws',
    sessionId: 's1',
    clientId: 'me',
    profile: { name: 'Me', color: '#fff', role: 'clipper' },
    wsCtor: function (u) { return new FakeWS(u); }
  }, extra || {}));
}

describe('RthubClient', () => {
  beforeEach(() => { FakeWS.last = null; FakeWS.all = []; });

  it('connects to wss://host/ws/{sessionId}?clientId=...', () => {
    const c = build();
    c.connect();
    expect(FakeWS.last.url).toMatch(/\/ws\/s1\?clientId=me$/);
  });

  it('url-encodes special chars in sessionId and clientId', () => {
    const c = build({ sessionId: 'abc/def', clientId: 'u id+1' });
    c.connect();
    expect(FakeWS.last.url).toContain('/ws/abc%2Fdef');
    expect(FakeWS.last.url).toContain('clientId=u%20id%2B1');
  });

  it('sends peerProfile immediately after open', async () => {
    const c = build();
    const p = c.connect();
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    await p;
    const profileSends = FakeWS.last.sent.filter(m => m.type === 'peerProfile');
    expect(profileSends).toHaveLength(1);
    expect(profileSends[0].name).toBe('Me');
    expect(profileSends[0].role).toBe('clipper');
  });

  it('emits lobby:state once after stateSnapshot arrives (legacy-shape)', () => {
    const c = build();
    const seen = [];
    c.on('lobby:state', (m) => seen.push(m));
    c.connect();
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0].lobby.code).toBe('s1');
  });

  it('translates inbound presenceUpdate to legacy member:joined / member:left', () => {
    const c = build();
    const events = [];
    c.on('member:joined', (m) => events.push(['j', m.member.id]));
    c.on('member:left',   (m) => events.push(['l', m.memberId]));
    c.connect();
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    FakeWS.last._msg({ type: 'presenceUpdate', clientId: 'p2', action: 'join', name: 'Bob', role: 'helper', ts: 1 });
    FakeWS.last._msg({ type: 'presenceUpdate', clientId: 'p2', action: 'leave', ts: 2 });
    expect(events).toEqual([['j', 'p2'], ['l', 'p2']]);
  });

  it('emits chat:message when chatMessage arrives', () => {
    const c = build();
    const seen = [];
    c.on('chat:message', (m) => seen.push(m));
    c.connect();
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    FakeWS.last._msg({ type: 'chatMessage', id: 'c1', body: 'hi', author: 'Bob', userId: 'p2', ts: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0].message.text).toBe('hi');
  });

  it('upsertRange flattens and sends clipRangeUpsert', () => {
    const c = build();
    c.connect();
    FakeWS.last._open();
    c.upsertRange({ id: 'r1', inTime: 100, status: 'queued', clipperId: 'me' });
    const out = FakeWS.last.sent.find(m => m.type === 'clipRangeUpsert');
    expect(out.id).toBe('r1');
    expect(out.inTime).toBe(100);
    expect(out.status).toBe('queued');
  });

  it('removeRange sends clipRangeRemove', () => {
    const c = build();
    c.connect();
    FakeWS.last._open();
    c.removeRange('r1');
    const out = FakeWS.last.sent.find(m => m.type === 'clipRangeRemove');
    expect(out.id).toBe('r1');
  });

  it('createDelivery sends delivery with toClientId and kind', () => {
    const c = build();
    c.connect();
    FakeWS.last._open();
    c.createDelivery({ toUserId: 'u-target', type: 'clip', rangeId: 'r1', payload: { x: 1 } });
    const out = FakeWS.last.sent.find(m => m.type === 'delivery');
    expect(out.toClientId).toBe('u-target');
    expect(out.kind).toBe('clip');
    expect(out.rangeId).toBe('r1');
    expect(out.payload).toEqual({ x: 1 });
  });

  it('sendChat sends chatMessage with body', () => {
    const c = build();
    c.connect();
    FakeWS.last._open();
    c.sendChat('hello');
    const out = FakeWS.last.sent.find(m => m.type === 'chatMessage');
    expect(out.body).toBe('hello');
    expect(out.author).toBe('Me');
    expect(out.userId).toBe('me');
  });

  it('re-sends peerProfile on reconnect', () => {
    const c = build();
    c.connect();
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    expect(FakeWS.last.sent.filter(m => m.type === 'peerProfile')).toHaveLength(1);

    FakeWS.last.close();
    c._reconnectNow();
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    expect(FakeWS.last.sent.filter(m => m.type === 'peerProfile')).toHaveLength(1);
    expect(FakeWS.all.length).toBeGreaterThanOrEqual(2);
  });

  it('dedupes a delivery that arrives twice (same rangeId+sender+ts)', () => {
    const c = build();
    const events = [];
    c.on('clip:delivery', (m) => events.push(m.delivery.id));
    c.connect();
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    const d = {
      type: 'delivery', toClientId: 'me', kind: 'clip',
      rangeId: 'r1', payload: {}, ts: 99, sourceClientId: 'p'
    };
    FakeWS.last._msg(d);
    FakeWS.last._msg(d);
    expect(events).toHaveLength(1);
  });

  it('updateProfile sends peerProfile when connected', () => {
    const c = build();
    c.connect();
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    const before = FakeWS.last.sent.filter(m => m.type === 'peerProfile').length;
    c.updateProfile({ name: 'Renamed' });
    const after = FakeWS.last.sent.filter(m => m.type === 'peerProfile');
    expect(after).toHaveLength(before + 1);
    expect(after[after.length - 1].name).toBe('Renamed');
  });

  it('emits timeline/playback/selection/cursor for inbound sync messages', () => {
    const c = build();
    const seen = {};
    ['timeline:update', 'playback:update', 'selection:update', 'cursor:update', 'cliprange:update']
      .forEach(t => { seen[t] = []; c.on(t, m => seen[t].push(m)); });
    c.connect();
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    FakeWS.last._msg({ type: 'timelineUpdate', positionMs: 1000 });
    FakeWS.last._msg({ type: 'playbackUpdate', state: 'play', positionMs: 1000, rate: 1 });
    FakeWS.last._msg({ type: 'selectionUpdate', clipIds: ['r1'] });
    FakeWS.last._msg({ type: 'cursorUpdate', positionMs: 500 });
    FakeWS.last._msg({ type: 'clipRangeUpdate', inMs: 0, outMs: 1000 });
    expect(seen['timeline:update']).toHaveLength(1);
    expect(seen['playback:update']).toHaveLength(1);
    expect(seen['selection:update']).toHaveLength(1);
    expect(seen['cursor:update']).toHaveLength(1);
    expect(seen['cliprange:update']).toHaveLength(1);
  });

  it('outbound sync senders build correct envelopes', () => {
    const c = build();
    c.connect();
    FakeWS.last._open();
    c.sendTimeline(1500);
    c.sendPlayback('playing', 1500, 1);
    c.sendSelection(['r1', 'r2']);
    c.sendCursor(2000);
    c.sendClipRange(0, 1000);
    const types = FakeWS.last.sent.map(m => m.type);
    expect(types).toContain('timelineUpdate');
    expect(types).toContain('playbackUpdate');
    expect(types).toContain('selectionUpdate');
    expect(types).toContain('cursorUpdate');
    expect(types).toContain('clipRangeUpdate');
    const tl = FakeWS.last.sent.find(m => m.type === 'timelineUpdate');
    expect(tl.positionMs).toBe(1500);
    const pb = FakeWS.last.sent.find(m => m.type === 'playbackUpdate');
    expect(pb.state).toBe('playing');
    expect(pb.rate).toBe(1);
  });

  it('errorEvent surfaces as error event', () => {
    const c = build();
    const seen = [];
    c.on('error', (m) => seen.push(m));
    c.connect();
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    FakeWS.last._msg({ type: 'errorEvent', code: 'BAD_THING', message: 'nope' });
    expect(seen).toHaveLength(1);
    expect(seen[0].code).toBe('BAD_THING');
  });

  it('getLobby returns the current internal lobby snapshot', () => {
    const c = build();
    expect(c.getLobby()).toBeNull();
    c.connect();
    FakeWS.last._open();
    FakeWS.last._msg({
      type: 'stateSnapshot',
      presence: [{ type: 'presenceUpdate', clientId: 'p2', action: 'join', name: 'Bob', role: 'helper', ts: 1 }],
      chat: [], clipRanges: []
    });
    const lobby = c.getLobby();
    expect(lobby).not.toBeNull();
    expect(lobby.code).toBe('s1');
    expect(lobby.members).toHaveLength(1);
  });

  it('disconnect prevents auto-reconnect', () => {
    const c = build();
    c.connect();
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    const before = FakeWS.all.length;
    c.disconnect();
    // Reconnect timer should not fire because _stopped=true
    c._reconnectNow();
    expect(FakeWS.all.length).toBe(before);
  });
});

describe('RthubClient reconnect strategy', () => {
  beforeEach(() => { FakeWS.last = null; FakeWS.all = []; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('schedules a retry even when first connect never succeeded', () => {
    const c = build();
    c.connect();
    expect(FakeWS.all.length).toBe(1);
    FakeWS.last.close(); // never opened, never snapshot — old code skipped retry here
    vi.advanceTimersByTime(1100); // > max first jitter (500..1000ms)
    expect(FakeWS.all.length).toBe(2);
  });

  it('grows the backoff base on each consecutive failure', () => {
    const c = build();
    c.connect();
    expect(c._backoffMs).toBe(500);
    FakeWS.last.close();
    expect(c._backoffMs).toBe(1000);
    vi.advanceTimersByTime(1100);
    FakeWS.last.close();
    expect(c._backoffMs).toBe(2000);
    vi.advanceTimersByTime(2100);
    FakeWS.last.close();
    expect(c._backoffMs).toBe(4000);
  });

  it('caps the backoff at 30s', () => {
    const c = build();
    c.connect();
    for (let i = 0; i < 12; i++) {
      FakeWS.last.close();
      vi.advanceTimersByTime(60_000);
    }
    expect(c._backoffMs).toBeLessThanOrEqual(30_000);
  });

  it('resets backoff to 500ms after a successful snapshot', () => {
    const c = build();
    c.connect();
    FakeWS.last.close();
    expect(c._backoffMs).toBe(1000);
    vi.advanceTimersByTime(1100);
    FakeWS.last._open();
    FakeWS.last._msg({ type: 'stateSnapshot', presence: [], chat: [], clipRanges: [] });
    expect(c._backoffMs).toBe(500);
  });

  it('stops retrying after disconnect()', () => {
    const c = build();
    c.connect();
    FakeWS.last.close();
    c.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.all.length).toBe(1);
  });
});
