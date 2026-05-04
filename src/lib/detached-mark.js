// Helpers for the detached-player window: build a mark payload to ship over
// IPC, and validate incoming mark payloads on the receiving side.
(function () {
  'use strict';

  function uid() {
    return 'det-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function buildMarkPayload({ inTime, outTime, m3u8Url, isLive, name }) {
    if (typeof inTime !== 'number' || typeof outTime !== 'number') return null;
    if (!(outTime > inTime)) return null;
    return {
      id: uid(),
      name: name || 'Detached Clip',
      inTime, outTime,
      m3u8Url, isLive: !!isLive,
      source: 'detached',
      caption: '', postCaption: '',
      createdAt: new Date().toISOString(),
    };
  }

  function validateIncomingMark(p) {
    return !!(
      p &&
      typeof p.id === 'string' &&
      typeof p.inTime === 'number' &&
      typeof p.outTime === 'number' &&
      p.outTime > p.inTime &&
      typeof p.source === 'string'
    );
  }

  const exportsObj = { uid, buildMarkPayload, validateIncomingMark };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
  if (typeof window !== 'undefined') window.DetachedMark = exportsObj;
})();
