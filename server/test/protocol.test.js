import { describe, it, expect } from 'vitest';
import { Inbound, Outbound } from '../src/wire/protocol.js';

describe('Inbound', () => {
  it('parses hello', () => {
    const msg = Inbound.parse({ type: 'hello', user: { id: 'u1', name: 'Mark' } });
    expect(msg.type).toBe('hello');
  });
  it('rejects unknown type', () => {
    expect(() => Inbound.parse({ type: 'wat' })).toThrow();
  });
  it('parses chat:send with text trim', () => {
    const m = Inbound.parse({ type: 'chat:send', text: '  hi  ' });
    expect(m.text).toBe('  hi  ');
  });
});

describe('Outbound', () => {
  it('parses lobby:state envelope', () => {
    const m = Outbound.parse({
      type: 'lobby:state',
      lobby: { code: 'AB12CD', name: 'x', members: [], chat: [], clipRanges: [], deliveries: [] }
    });
    expect(m.lobby.code).toBe('AB12CD');
  });
});
