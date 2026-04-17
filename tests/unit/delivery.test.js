import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const d = require('../../src/lib/delivery.js');

describe('formatLockedClipName', () => {
  it('prepends {Helper}-{name}', () => {
    expect(d.formatLockedClipName('Owl', 'Epic')).toBe('Owl-Epic');
  });
  it('handles empty helper', () => {
    expect(d.formatLockedClipName('', 'Epic')).toBe('Epic');
  });
  it('defaults empty name to "Clip"', () => {
    expect(d.formatLockedClipName('Owl', '')).toBe('Owl-Clip');
  });
  it('does not double-prefix', () => {
    expect(d.formatLockedClipName('Owl', 'Owl-Thing')).toBe('Owl-Thing');
  });
});

describe('buildClipDeliveryPayload', () => {
  it('extracts transferrable fields only', () => {
    const clip = {
      id: 'x', name: 'Epic', caption: 'local', postCaption: 'post',
      inTime: 1, outTime: 2, m3u8Url: 'u', m3u8Text: 't',
      isLive: true, seekableStart: 0, foo: 'nope'
    };
    expect(d.buildClipDeliveryPayload(clip)).toEqual({
      name: 'Epic', caption: '', postCaption: 'post',
      inTime: 1, outTime: 2, m3u8Url: 'u', m3u8Text: 't',
      isLive: true, seekableStart: 0
    });
  });
  it('coerces missing fields to defaults', () => {
    expect(d.buildClipDeliveryPayload({})).toEqual({
      name: '', caption: '', postCaption: '',
      inTime: 0, outTime: 0, m3u8Url: '', m3u8Text: null,
      isLive: false, seekableStart: 0
    });
  });
});

describe('buildClipperClipFromDelivery', () => {
  it('produces locked-prefix name + empty caption', () => {
    const delivery = {
      id: 'd1', rangeId: 'r1', fromUserId: 'h1', fromUserName: 'Owl', fromUserColor: '#0f0',
      payload: { name: 'Moment', inTime: 5, outTime: 10, postCaption: 'hype',
                 m3u8Url: 'u', m3u8Text: 't', isLive: true, seekableStart: 0 }
    };
    const clip = d.buildClipperClipFromDelivery(delivery);
    expect(clip.name).toBe('Owl-Moment');
    expect(clip.caption).toBe('');
    expect(clip.postCaption).toBe('hype');
    expect(clip.inTime).toBe(5);
    expect(clip.outTime).toBe(10);
    expect(clip.receivedFromDeliveryId).toBe('d1');
    expect(clip.sentByRangeId).toBe('r1');
    expect(clip.helperColor).toBe('#0f0');
    expect(clip.helperName).toBe('Owl');
  });
});

describe('matchExistingClipByDelivery', () => {
  it('finds by sentByRangeId', () => {
    const list = [{ id: 'a' }, { id: 'b', sentByRangeId: 'r1' }];
    expect(d.matchExistingClipByDelivery({ rangeId: 'r1' }, list)).toEqual({ id: 'b', sentByRangeId: 'r1' });
  });
  it('returns null when no match', () => {
    expect(d.matchExistingClipByDelivery({ rangeId: 'x' }, [])).toBeNull();
  });
});
